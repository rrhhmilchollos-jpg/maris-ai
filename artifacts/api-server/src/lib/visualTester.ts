import { execSync } from "node:child_process";
// puppeteer importado dinámicamente para evitar crash al arrancar si no está instalado
type Browser = any; type Page = any;
import type { Logger } from "pino";
import { GeneratedApp } from "@workspace/db/schema";
import { CoreOrchestrator } from "@workspace/services";
import { validateBundle } from "./validate";
import { compactBundleForPrompt, estimatePromptTokens, extractJsonObject, mergePatchIntoBundle, createClaudeMessageWithFallback } from "./shared-agents";
import { logger as rootLogger } from "./logger";

/**
 * Visual Testing Agent.
 *
 * Takes server-side screenshots of the public deploy URL (`/p/<slug>`) at three
 * viewports, asks Claude Sonnet 4.6 vision to score the result and list issues,
 * and — when `autoFix` is enabled — re-runs Claude with the current bundle to
 * patch the visual problems and persists the new bundle. Loops up to
 * MAX_FIX_CYCLES times.
 *
 * Designed to be safe to call from both:
 *   - the generation pipeline (auto mode), and
 *   - an on-demand HTTP endpoint (POST /api/apps/:id/visual-test).
 *
 * Chromium itself is provided by the Maris AI Nix package `chromium` — see
 * `chromiumExecutablePath()` for resolution.
 */

const VIEWPORTS = [
  { name: "desktop", width: 1280, height: 800 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "mobile", width: 390, height: 844 },
] as const;

const MAX_FIX_CYCLES = 3;
const SCREENSHOT_TIMEOUT_MS = 30_000;

type Severity = "critical" | "major" | "minor";

export type VisualIssue = {
  severity: Severity;
  type: string;
  viewport: string;
  description: string;
  cssfix: string;
};

export type VisualAnalysis = {
  visuallyCorrect: boolean;
  overallScore: number;
  issues: VisualIssue[];
  positives: string[];
  summary: string;
};

export type ViewportShot = {
  viewport: string;
  width: number;
  height: number;
  /** base64-encoded PNG (no data: prefix) */
  data: string;
  mimeType: "image/png";
  consoleErrors: string[];
};

export type VisualReport = {
  cycles: number;
  fixesApplied: number;
  finalAnalysis: VisualAnalysis;
  screenshots: ViewportShot[];
};

export class VisualTesterError extends Error {
  constructor(
    public readonly code:
      | "no_chromium"
      | "no_slug"
      | "screenshot_failed"
      | "analysis_failed",
    message: string,
  ) {
    super(message);
    this.name = "VisualTesterError";
  }
}

let cachedExec: string | null | undefined;

/**
 * Resolve Chromium binary path. Honors PUPPETEER_EXECUTABLE_PATH first, then
 * falls back to `which chromium` (Nix-installed package on Maris AI).
 */
export function chromiumExecutablePath(): string | null {
  if (cachedExec !== undefined) return cachedExec;
  const fromEnv = process.env.PUPPETEER_EXECUTABLE_PATH;
  if (fromEnv) {
    cachedExec = fromEnv;
    return fromEnv;
  }
  // Rutas conocidas de Chromium en diferentes entornos (sync, sin await)
  const { existsSync } = require("fs");
  const knownPaths = [
    "/usr/bin/chromium",           // Debian/Ubuntu apt-get install chromium
    "/usr/bin/chromium-browser",   // Ubuntu alternativo
    "/usr/bin/google-chrome",      // Chrome en Linux
    "/snap/bin/chromium",          // Snap
  ];

  for (const p of knownPaths) {
    try {
      if (existsSync(p)) {
        cachedExec = p;
        return p;
      }
    } catch {}
  }

  // Último recurso: which
  try {
    const out = execSync("which chromium || which chromium-browser || which google-chrome", { encoding: "utf8" }).trim();
    cachedExec = out || null;
  } catch {
    cachedExec = null;
  }
  return cachedExec;
}

async function launchBrowser(): Promise<Browser> {
  const exec = chromiumExecutablePath();
  if (!exec) {
    throw new VisualTesterError(
      "no_chromium",
      "Chromium no está instalado. Instálalo via Nix (paquete 'chromium').",
    );
  }
  const { default: puppeteer } = await import("puppeteer");
  return await puppeteer.launch({
    headless: true,
    executablePath: exec,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--hide-scrollbars",
    ],
  });
}

async function captureViewport(
  browser: Browser,
  url: string,
  viewport: (typeof VIEWPORTS)[number],
): Promise<ViewportShot> {
  const page: Page = await browser.newPage();
  const consoleErrors: string[] = [];
  page.on("console", (msg: any) => {
    if (msg.type() === "error") consoleErrors.push(msg.text().slice(0, 500));
  });
  page.on("pageerror", (err: Error) => consoleErrors.push(err.message.slice(0, 500)));

  try {
    await page.setViewport({
      width: viewport.width,
      height: viewport.height,
      deviceScaleFactor: 1,
    });
    await page.goto(url, {
      waitUntil: "networkidle2",
      timeout: SCREENSHOT_TIMEOUT_MS,
    });
    // Give React more time to paint — apps with lazy loading or animations need longer
    await new Promise((r) => setTimeout(r, 2500));
    // Esperar a que el #root tenga contenido (React hydration)
    try {
      await page.waitForFunction(
        "document.getElementById('root') && document.getElementById('root').children.length > 0",
        { timeout: 5000 }
      );
    } catch (_) {
      // Si no hay #root con contenido en 5s, continuar de todas formas
    }
    // Trigger lazy/scroll-revealed content. We pass strings instead of arrow
    // functions so this file doesn't need DOM lib types in tsconfig.
    await page.evaluate("window.scrollTo(0, document.body.scrollHeight / 2)");
    await new Promise((r) => setTimeout(r, 600));
    await page.evaluate("window.scrollTo(0, 0)");
    await new Promise((r) => setTimeout(r, 600));
    const buf = await page.screenshot({ fullPage: true, type: "png" });
    return {
      viewport: viewport.name,
      width: viewport.width,
      height: viewport.height,
      data: Buffer.from(buf).toString("base64"),
      mimeType: "image/png",
      consoleErrors,
    };
  } finally {
    await page.close().catch(() => {});
  }
}

/**
 * Capture screenshots of a deployed app at the standard three viewports.
 * Exported so the autonomous evaluator (`lib/evaluator.ts`) can reuse the
 * exact same Puppeteer setup without re-implementing browser launch + viewport
 * iteration. Returns one ViewportShot per VIEWPORT — failures are captured as
 * empty `data` plus a console-error string so callers can decide how strict
 * to be.
 */
export async function takeScreenshots(url: string): Promise<ViewportShot[]> {
  const browser = await launchBrowser();
  try {
    const shots: ViewportShot[] = [];
    for (const vp of VIEWPORTS) {
      try {
        shots.push(await captureViewport(browser, url, vp));
      } catch (err) {
        // We log but continue to the next viewport so a single broken one
        // doesn't kill the whole report.
        shots.push({
          viewport: vp.name,
          width: vp.width,
          height: vp.height,
          data: "",
          mimeType: "image/png",
          consoleErrors: [
            `Screenshot capture failed: ${err instanceof Error ? err.message : String(err)}`,
          ],
        });
      }
    }
    return shots;
  } finally {
    await browser.close().catch(() => {});
  }
}

/**
 * Strip ```json fences and try to parse JSON from a model response.
 */
function safeJsonParse<T>(raw: string): T | null {
  try {
    const cleaned = raw
      .trim()
      .replace(/^```(?:json)?\n?/i, "")
      .replace(/\n?```$/i, "")
      .trim();
    return JSON.parse(cleaned) as T;
  } catch {
    // Try to locate the first { ... } object.
    const m = raw.match(/\{[\s\S]*\}/);
    if (m) {
      try {
        return JSON.parse(m[0]) as T;
      } catch {
        /* fall through */
      }
    }
    return null;
  }
}

async function analyzeWithVision(
  shots: ViewportShot[],
  app: { title: string; description?: string | null },
  prompt: string,
): Promise<VisualAnalysis> {
  // Build the multimodal content array.
  type ContentBlock =
    | { type: "text"; text: string }
    | {
        type: "image";
        source: { type: "base64"; media_type: "image/png"; data: string };
      };
  const content: ContentBlock[] = [];
  for (const shot of shots) {
    if (!shot.data) continue;
    content.push({
      type: "text",
      text: `=== ${shot.viewport.toUpperCase()} (${shot.width}x${shot.height}) ===`,
    });
    content.push({
      type: "image",
      source: { type: "base64", media_type: "image/png", data: shot.data },
    });
    if (shot.consoleErrors.length > 0) {
      content.push({
        type: "text",
        text: `Errores de consola en ${shot.viewport}:\n${shot.consoleErrors
          .slice(0, 5)
          .join("\n")}`,
      });
    }
  }

  if (content.length === 0) {
    throw new VisualTesterError(
      "screenshot_failed",
      "No se pudo capturar ningún screenshot válido para analizar.",
    );
  }

  content.push({
    type: "text",
    text: `VISUAL EVALUATOR — Agente #9 del equipo Maris AI

[IDENTIDAD Y PROPOSITO]
Eres el Visual Evaluator — el agente que analiza screenshots reales de la app generada.
Tu proposito: garantizar que lo que el usuario VE en su pantalla coincide con lo que pidio y tiene calidad profesional.

[CHAIN OF THOUGHT VISUAL]
PASO 1 — Mira cada screenshot con ojos de usuario final, no de developer.
PASO 2 — Compara lo que ves con lo que el prompt original del usuario pedia.
PASO 3 — Identifica problemas reales (no preferencias esteticas).
PASO 4 — Proporciona fixes accionables y especificos.

[ANTI-DESVIO]
- Un score de 100 no es el objetivo — la HONESTIDAD es el objetivo.
- No pases apps rotas. No penalices decisiones de diseño validas.
- Si ves una pantalla en blanco, es SIEMPRE un critico. Sin excepcion.
- Si el responsive falla en mobile, es SIEMPRE un mayor. Sin excepcion.

VISUAL EVALUATOR — Maris AI Quality Gate

CHECKLIST VISUAL OBLIGATORIO (revisa TODOS en cada screenshot):

CRÍTICOS (score -30 cada uno):
□ Pantalla en blanco o completamente negra → BLOCKER absoluto
□ Texto blanco sobre fondo blanco (o negro sobre negro) → ilegible
□ Componentes cortados o fuera del viewport
□ Barra de navegación ausente en desktop

MAYORES (score -15 cada uno):
□ Texto demasiado pequeño (menos de 14px estimado)
□ Botones sin padding suficiente (menos de 8px)
□ Layout roto en mobile (elementos superpuestos)
□ Imágenes con ratio incorrecto (estiradas o comprimidas)
□ Formularios con campos sin labels visibles
□ Colores de texto con contraste insuficiente

MENORES (score -5 cada uno):
□ Espaciado inconsistente entre secciones
□ Texto en inglés cuando debería ser en español
□ Iconos pixelados o mal alineados
□ Bordes o sombras excesivos que distraen

PUNTOS POSITIVOS (+10 cada uno):
□ Hero section impactante y clara
□ Paleta de colores coherente y profesional
□ Tipografía legible y jerarquía visual clara
□ Cards con información bien organizada
□ CTA buttons visibles y con buen contraste

App: ${app.title}
Descripcion: ${app.description ?? "(no disponible)"}
Prompt original del usuario: ${prompt.slice(0, 800)}

PROCESO DE ANALISIS (ejecuta TODO):

1. PANTALLA EN BLANCO O CONTENIDO MINIMO
   - Hay contenido real visible o es una pantalla vacia?
   - El contenido corresponde a lo que el usuario pidio?

2. LAYOUT Y ESTRUCTURA
   - El layout es coherente y bien estructurado?
   - Los elementos se solapan o hay overflow horizontal?
   - La navbar/header existe y es funcional visualmente?
   - Footer presente si aplica?

3. RESPONSIVE (critico — analiza cada viewport)
   - Desktop: layout de pantalla completa correcto?
   - Tablet: adaptacion al ancho medio correcta?
   - Mobile: texto legible? botones tocables? sin scroll horizontal?
   - Los breakpoints de Tailwind se aplican correctamente?

4. TIPOGRAFIA Y LEGIBILIDAD
   - El texto es legible contra el fondo?
   - Hay suficiente contraste (WCAG aproximado)?
   - Los tamanos de fuente son apropiados por viewport?

5. CONSISTENCIA VISUAL
   - Los colores son coherentes entre secciones?
   - El estilo es uniforme (no mezcla estilos sin razon)?
   - Las imagenes cargan o hay placeholders rotos?

6. ERRORES DE CONSOLA VISIBLES
   - Hay mensajes de error en la UI?
   - Hay elementos que claramente fallan al renderizar?

7. CALIDAD DEL DISENO
   - Se ve profesional para su sector?
   - El diseno transmite el proposito del producto?
   - Hay elementos claramente feos o rotos (no preferencia estetica, sino problema real)?

8. CUMPLIMIENTO DEL PROMPT
   - La app muestra lo que el usuario pidio?
   - Falta alguna funcionalidad que deberia ser visible?

CRITERIOS DE PUNTUACION:
- 90-100: App excelente, todo funciona, diseno profesional, responsive perfecto
- 75-89: App buena, un issue minor o dos, nada critico
- 60-74: App funcional pero con problemas de responsividad o diseno
- 40-59: Problemas significativos visibles, layout roto o contenido faltante
- 0-39: Pantalla en blanco, app completamente rota, o contenido incorrecto

Devuelve EXCLUSIVAMENTE JSON valido (sin markdown, sin backticks):

{
  "visuallyCorrect": boolean,
  "overallScore": number,
  "viewportScores": { "desktop": number, "tablet": number, "mobile": number },
  "issues": [
    {
      "severity": "critical" | "major" | "minor",
      "type": "blank_page" | "broken_layout" | "missing_content" | "bad_contrast" | "not_responsive" | "overlapping_elements" | "missing_navbar" | "console_errors" | "broken_images" | "text_overflow" | "touch_targets_small" | "prompt_mismatch" | "inconsistent_style",
      "viewport": "desktop" | "tablet" | "mobile" | "all",
      "description": "descripcion exacta en espanol de que esta mal y donde",
      "cssfix": "instruccion EXACTA y ACCIONABLE de como arreglarlo con Tailwind o CSS"
    }
  ],
  "positives": ["lista de cosas que estan bien implementadas"],
  "summary": "resumen ejecutivo de 2-3 frases en espanol",
  "recommendedAction": "deploy_ready" | "fix_minor" | "fix_major" | "redesign_needed"
}`,
  });

  // Visual analysis uses Sonnet — tiene vision multimodal excelente.
  // ENCONTRADO: esta llamada era la única de los 11 agentes que NO pasaba
  // por createClaudeMessageWithFallback — sin el timeout de inactividad,
  // sin reintentos en errores transitorios (red, 5xx) y sin fallback de
  // modelo (Sonnet→Opus) que sí tienen el resto de agentes. Un simple
  // parpadeo de red aquí tiraba abajo la única verificación visual real
  // de toda la generación. También tenía un fallback a Gemini Vision que
  // ya no puede funcionar (Gemini se quitó por completo del proyecto en
  // junio de 2026, sin API key configurada) — sustituido por el mismo
  // mecanismo de reintento/fallback de Anthropic que usa el resto del
  // pipeline, consistente con el resto de agentes.
  let text = "";
  try {
    const response = await createClaudeMessageWithFallback("visual-evaluator", "claude-sonnet-4-6", {
      max_tokens: 4000,
      messages: [{ role: "user", content }],
    });
    text = response.content
      .map((b: any) => (b.type === "text" ? b.text : ""))
      .filter(Boolean)
      .join("\n");
  } catch (visionErr: any) {
    rootLogger.error({ visionErr }, "Visual Evaluator: fallaron todos los reintentos/modelos");
    // Fail-closed, no fail-open: si no se pudo verificar visualmente de
    // verdad, NO se asume que la app está bien (ver más abajo el mismo
    // criterio para JSON no parseable) — se marca como necesita revisión
    // para que el bucle de reparación lo intente de nuevo o escale,
    // en vez de dejar pasar una app sin verificación real.
    return {
      visuallyCorrect: false,
      overallScore: 0,
      issues: [
        {
          severity: "critical",
          type: "console_errors",
          viewport: "all",
          description: "No se pudo completar la verificación visual (fallo de conexión con el modelo de IA tras varios reintentos).",
          cssfix: "Reintentar la evaluación visual.",
        },
      ],
      positives: [],
      summary: "Verificación visual incompleta — tratar como pendiente de revisión, no como aprobada.",
    };
  }

  const parsed = safeJsonParse<VisualAnalysis>(text);
  if (!parsed) {
    // ENCONTRADO: si la respuesta de Claude Vision no se podía parsear como
    // JSON (truncada, formato inesperado, etc.), el sistema ASUMÍA que la
    // app estaba bien (visuallyCorrect:true, score 70, sin issues) y la
    // dejaba pasar sin ninguna verificación real — justo lo contrario de
    // lo que se le pide a un "quality gate". Mismo criterio fail-closed que
    // el bloque catch de arriba: si no se pudo verificar de verdad, se
    // marca como necesita revisión, nunca como aprobada por defecto.
    rootLogger.warn({ textPreview: text.slice(0, 200) }, "Visual Evaluator: respuesta no parseable — tratando como necesita revisión, no como OK");
    return {
      visuallyCorrect: false,
      overallScore: 0,
      issues: [
        {
          severity: "critical",
          type: "console_errors",
          viewport: "all",
          description: "La verificación visual no devolvió un resultado interpretable.",
          cssfix: "Reintentar la evaluación visual.",
        },
      ],
      positives: [],
      summary: "Verificación visual incompleta (respuesta no parseable) — tratar como pendiente de revisión, no como aprobada.",
    };
  }

  // Defensive defaults.
  const issues = (parsed.issues ?? []).filter(
    (i) => i && typeof i.severity === "string",
  );
  const overall = Number.isFinite(parsed.overallScore) ? parsed.overallScore : 70;
  return {
    visuallyCorrect:
      overall >= 70 && !issues.some((i) => i.severity === "critical"),
    overallScore: overall,
    issues,
    positives: parsed.positives ?? [],
    summary: parsed.summary ?? "",
  };
}

/**
 * Apply visual fixes by sending Claude the current bundle plus the issue list
 * and asking for a complete patched bundle back. Keeps the
 * `// === FILE: <path> ===` separator convention used by the rest of the
 * generator.
 */
/**
 * Aplica correcciones al bundle basándose en los issues detectados por Claude Vision.
 *
 * Hay DOS caminos según la gravedad:
 *
 * A) DAÑO ESTRUCTURAL (cualquier issue crítico): delega al CoreOrchestrator
 *    (edición por hitos) que toca cada archivo por separado — sin límite de tokens.
 *    El prompt incluye: issues exactos de Claude Vision + App.tsx actual + prompt
 *    original del usuario. El orquestador sabe exactamente qué está roto y qué
 *    tiene que construir.
 *
 * B) ISSUES NO ESTRUCTURALES (solo mayores/menores de CSS/responsive): patcher
 *    de una sola pasada con 12k tokens — suficiente para estilos y layout.
 */
async function applyVisualFixes(opts: {
  bundle: string;
  issues: VisualIssue[];
  app: { title: string; description?: string | null };
  /** Prompt original del usuario — el orquestador lo necesita para saber
   *  qué módulos construir (dashboard dental, pacientes, citas, etc.). */
  userPrompt?: string;
  backendCode?: string;
  /** ENCONTRADO en un caso real del usuario: cuando el camino del
   *  CoreOrchestrator se activaba (issue crítico), el callback de progreso
   *  que se le pasaba era `() => {}` — VACÍO. Mientras el orquestador
   *  generaba 10 archivos en lotes (varios minutos con llamadas reales a
   *  Claude), el mensaje "Generando el arreglo..." se quedaba FIJO sin
   *  ninguna actualización, indistinguible visualmente de estar realmente
   *  atascado. Este callback opcional conecta ese progreso real, igual que
   *  ya se hace para el resto de fases del ciclo (ver runVisualTester). */
  onProgress?: (note: string) => void;
}): Promise<{ frontendCode: string; backendCode?: string } | null> {
  const { bundle, issues, app } = opts;

  // Issues no-menores ordenados por severidad — esto es exactamente lo que
  // Claude Vision reportó, incluyendo descripción completa y cssfix.
  const actionableIssues = issues
    .filter((i) => i.severity !== "minor")
    .slice(0, 10);

  if (actionableIssues.length === 0) return null;

  // CAMINO A: cualquier critical activa el orquestador por hitos.
  // No filtramos por tipo — cualquier issue crítico (blank_page, 404, missing_navbar,
  // missing_content, prompt_mismatch, broken_layout, console_errors) requiere
  // reconstrucción estructural que supera los 12k tokens del patcher single-pass.
  const hasCritical = actionableIssues.some((i) => i.severity === "critical");

  if (hasCritical) {
    rootLogger.info(
      { issueCount: actionableIssues.length, types: actionableIssues.filter(i=>i.severity==="critical").map(i=>i.type) },
      "[applyVisualFixes] Issues críticos → CoreOrchestrator (edición por hitos)",
    );
    try {
      const orchestrator = new CoreOrchestrator(process.cwd(), { model: "claude-sonnet-4-6" });

      // Bloque con los issues EXACTOS de Claude Vision — descripción completa,
      // tipo, viewport y sugerencia de fix tal como los reportó el modelo.
      const issuesBlock = actionableIssues.map((i, n) =>
        `ISSUE ${n + 1} [${i.severity.toUpperCase()}] tipo="${i.type}" viewport="${i.viewport}"\n` +
        `  Descripción: ${i.description}\n` +
        `  Fix sugerido: ${i.cssfix || "(ver instrucciones generales)"}`
      ).join("\n\n");

      // Contexto del usuario: qué app quería construir
      const userContext = opts.userPrompt
        ? `PROMPT ORIGINAL DEL USUARIO (funcionalidades que debe tener la app):\n${opts.userPrompt.slice(0, 3000)}`
        : `Descripción del proyecto: ${app.description ?? "(sin descripción disponible)"}`;

      // App.tsx actual — para que el code agent vea exactamente el código roto
      function extractFile(bun: string, name: string): string {
        const esc = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const m = bun.match(new RegExp("// === FILE: " + esc + " ===\\n([\\s\\S]*?)(?=\\n// === FILE:|$)"));
        return m ? m[1].trim() : "";
      }
      const appTsx = extractFile(bundle, "src/App.tsx")
        || extractFile(bundle, "src/app.tsx")
        || extractFile(bundle, "src/main.tsx")
        || "";
      const routerBlock = appTsx
        ? "\n\nCÓDIGO ACTUAL DE src/App.tsx (el archivo del router):\n" + appTsx.slice(0, 4000)
        : "";

      const structuralPrompt =
        "[REPARACIÓN AUTOMÁTICA — TESTING VISUAL IA]\n" +
        "App: " + JSON.stringify(app.title) + "\n\n" +
        userContext + (routerBlock ? "\n\n" + routerBlock : "") + "\n\n" +
        "ISSUES DETECTADOS POR CLAUDE VISION (repáralos todos):\n" + issuesBlock + "\n\n" +
        "INSTRUCCIONES (en orden de prioridad):\n" +
        "1. ROUTER/404: mover el catch-all <Route path='*'> al ÚLTIMO lugar en App.tsx.\n" +
        "2. NAVBAR: si falta, crear <Navbar> con links a todos los módulos del prompt.\n" +
        "3. CONTENIDO: reconstruir componentes vacíos con TODAS las funcionalidades del prompt — dashboard, pacientes, citas, facturación, notificaciones — mock data real en español.\n" +
        "4. Tocar TODOS los archivos necesarios. NO dejar return null ni TODOs.";


      const editResult = await orchestrator.editProjectIncremental(
        structuralPrompt,
        bundle,
        opts.backendCode || "",
        (update: any) => {
          if (update?.status) opts.onProgress?.(update.status);
        },
      );
      if (editResult.frontendCode?.trim().length > 0) {
        const backendChanged = !!opts.backendCode
          && editResult.backendCode
          && editResult.backendCode !== opts.backendCode;
        return {
          frontendCode: editResult.frontendCode,
          backendCode: backendChanged ? editResult.backendCode : undefined,
        };
      }
      rootLogger.warn("[applyVisualFixes] editProjectIncremental no devolvió bundle válido — fallback a single-pass");
    } catch (err) {
      rootLogger.warn({ err }, "[applyVisualFixes] editProjectIncremental falló — fallback a single-pass");
    }
  }

  // CAMINO B: patcher single-pass para issues no estructurales (responsive, contraste, etc.)
  const fixList = actionableIssues.map((i, n) =>
    (n + 1) + ". [" + i.severity + "/" + i.viewport + "] " + i.type + ": " + i.description + "\n   Fix: " + i.cssfix
  ).join("\n");

  const compactBundle = compactBundleForPrompt(
    bundle,
    actionableIssues.map((i) => i.type + " " + i.description + " " + i.cssfix),
    65_000,
  );
  rootLogger.info(
    { tokens: estimatePromptTokens(compactBundle), issues: actionableIssues.length },
    "[applyVisualFixes] single-pass patcher",
  );

  // Mismo motivo que en analyzeWithVision más arriba: sin
  // createClaudeMessageWithFallback, este agente (el que aplica los
  // parches reales tras detectar issues visuales) no tenía timeout de
  // inactividad ni reintento en fallos transitorios — un simple parpadeo
  // de red aquí dejaba la app sin reparar en ese ciclo.
  const response = await createClaudeMessageWithFallback("visual-evaluator", "claude-sonnet-4-6", {
    max_tokens: 20000,
    messages: [{
      role: "user",
      content:
        "Eres el Visual Fix Agent de Maris AI. Aplica estos fixes al bundle sin romper nada más.\n" +
        "App: " + app.title + "\n" +
        "Prompt original: " + (opts.userPrompt || app.description || "").slice(0, 1000) + "\n\n" +
        "ISSUES A REPARAR:\n" + fixList + "\n\n" +
        "REGLAS:\n" +
        "- Devuelve SOLO JSON: { \"changedFiles\": { \"ruta\": \"contenido completo\" }, \"fixesSummary\": [...] }\n" +
        "- Para missing_navbar: añade NavBar con links a todas las secciones\n" +
        "- Para blank_page: asegúrate de que '/' renderiza contenido real\n" +
        "- Para responsive: usa breakpoints Tailwind sm: md: lg:\n" +
        "- Mueve cualquier catch-all 404 al final del router\n\n" +
        "BUNDLE:\n" + compactBundle
    }],
  });

  const text = response.content
    .map((b: any) => b.type === "text" ? b.text : "")
    .filter(Boolean).join("\n").trim()
    .replace(/^```(?:[a-zA-Z]+)?\n?/, "").replace(/\n?```$/, "").trim();

  const parsed = extractJsonObject<{ changedFiles?: Record<string, string>; deletedFiles?: string[]; frontendCode?: string }>(text);
  if (parsed?.changedFiles && Object.keys(parsed.changedFiles).length > 0) {
    return { frontendCode: mergePatchIntoBundle(bundle, parsed.changedFiles, Array.isArray(parsed.deletedFiles) ? parsed.deletedFiles : []) };
  }
  if (parsed?.frontendCode?.includes("// === FILE:")) return { frontendCode: parsed.frontendCode };
  if (text.includes("// === FILE:") && text.length >= bundle.length / 3) return { frontendCode: text };
  return null;
}


export async function analyzePreviewScreenshots(opts: {
  shots: ViewportShot[];
  app: { title: string; description?: string | null };
  prompt: string;
}): Promise<VisualAnalysis> {
  return analyzeWithVision(opts.shots, opts.app, opts.prompt);
}

/**
 * Apply visual fixes iteratively for apps without a publicSlug (preview mode).
 * Uses the preview URL to re-screenshot after each fix cycle.
 * Exported so the visual-test endpoint can use it for apps not yet deployed.
 */
export async function applyVisualFixesAndSave(opts: {
  appId: string;
  app: { title: string; description?: string | null; frontendCode: string; backendCode?: string };
  analysis: VisualAnalysis;
  previewUrl: string;
  prompt: string;
  maxCycles?: number;
  log?: Logger;
  /** Mismo motivo que en applyVisualFixes/runVisualTester: sin esto, el
   *  camino del CoreOrchestrator (issues críticos) no reportaba ningún
   *  progreso intermedio mientras generaba varios archivos en lotes. */
  onProgress?: (note: string) => void | Promise<void>;
}): Promise<{ fixesApplied: number; cycles: number; finalAnalysis: VisualAnalysis }> {
  const { appId, app, previewUrl, prompt, maxCycles = 3, log, onProgress } = opts;
  const report = async (note: string) => { try { await onProgress?.(note); } catch { /* nunca bloquear el ciclo por un fallo de progreso */ } };
  let currentAnalysis = opts.analysis;
  let currentBundle = app.frontendCode;
  let currentBackendCode = app.backendCode;
  let fixesApplied = 0;
  let cycle = 0;

  while (cycle < maxCycles && !currentAnalysis.visuallyCorrect) {
    cycle++;
    const fixable = currentAnalysis.issues.filter((i) => i.severity !== "minor");
    if (fixable.length === 0) break;

    log?.info({ appId, cycle, issues: fixable.length }, "[applyVisualFixesAndSave] Applying fixes");
    await report(`Ciclo ${cycle} — ${fixable.length} problema(s) detectado(s). Generando el arreglo...`);

    const patchResult = await applyVisualFixes({
      bundle: currentBundle,
      issues: fixable,
      app: { title: app.title, description: app.description },
      userPrompt: prompt,
      backendCode: currentBackendCode,
      onProgress: (note) => { void report(`Ciclo ${cycle} — ${note}`); },
    });
    if (!patchResult) {
      log?.warn({ appId, cycle }, "[applyVisualFixesAndSave] No patch returned");
      break;
    }
    const patched = patchResult.frontendCode;

    // Validate the patched bundle before saving
    const validation = await validateBundle(patched);
    if (!validation.ok) {
      log?.warn({ appId, cycle, errors: validation.issues.length, issues: validation.issues.slice(0, 10) }, "[applyVisualFixesAndSave] Patched bundle failed validation");
      break;
    }

    // Save the patched bundle (and backend, if the structural fix touched it) to DB
    const previousBundle = currentBundle;
    const previousBackendCode = currentBackendCode;
    const dbUpdate: Record<string, string> = { frontendCode: patched };
    if (patchResult.backendCode) dbUpdate.backendCode = patchResult.backendCode;
    const updated = await GeneratedApp.findOneAndUpdate(
      { _id: appId, frontendCode: previousBundle },
      dbUpdate,
      { new: false },
    );
    if (!updated) {
      log?.warn({ appId, cycle }, "[applyVisualFixesAndSave] Bundle changed concurrently — aborting");
      break;
    }
    currentBundle = patched;
    if (patchResult.backendCode) currentBackendCode = patchResult.backendCode;
    fixesApplied++;

    // Re-screenshot and re-analyze with the new bundle
    const scoreBeforeThisPatch = currentAnalysis.overallScore;
    await new Promise((r) => setTimeout(r, 1500));
    try {
      const newShots = await takeScreenshots(previewUrl);
      const newAnalysis = await analyzeWithVision(
        newShots,
        { title: app.title, description: app.description },
        prompt,
      );
      log?.info({ appId, cycle, scoreBefore: scoreBeforeThisPatch, scoreAfter: newAnalysis.overallScore }, "[applyVisualFixesAndSave] Re-analysis after fix");

      // Mismo problema confirmado en runVisualTester (ver su comentario
      // detallado) y corregido aquí con el mismo patrón: si el parche
      // empeoró la puntuación visual real, se revierte el bundle al estado
      // anterior en vez de quedarse con una regresión sin detectar.
      if (newAnalysis.overallScore < scoreBeforeThisPatch) {
        log?.warn({ appId, cycle, scoreBefore: scoreBeforeThisPatch, scoreAfter: newAnalysis.overallScore }, "[applyVisualFixesAndSave] Patch REGRESSED the visual score — reverting");
        const revertUpdate: Record<string, string> = { frontendCode: previousBundle };
        if (patchResult.backendCode && previousBackendCode) revertUpdate.backendCode = previousBackendCode;
        await GeneratedApp.findOneAndUpdate({ _id: appId }, revertUpdate);
        currentBundle = previousBundle;
        if (patchResult.backendCode && previousBackendCode) currentBackendCode = previousBackendCode;
        fixesApplied = Math.max(0, fixesApplied - 1);
        // currentAnalysis se queda con el análisis ANTERIOR (no se sobreescribe con newAnalysis) — es el que corresponde al bundle finalmente guardado.
        break;
      }
      currentAnalysis = newAnalysis;
    } catch (reErr) {
      log?.warn({ appId, cycle, err: (reErr as Error).message }, "[applyVisualFixesAndSave] Re-screenshot failed");
      break;
    }
  }

  return { fixesApplied, cycles: cycle, finalAnalysis: currentAnalysis };
}

/**
 * Run the visual testing agent end-to-end against a deployed app.
 *
 * Returns a report regardless of success; if `autoFix` is true and Claude
 * proposes new bundle versions, those are persisted to
 * `generated_apps.frontendCode` between cycles.
 */
export async function runVisualTester(opts: {
  app: {
    id: number;
    title: string;
    description: string | null;
    frontendCode: string;
    backendCode?: string;
    publicSlug: string;
  };
  baseUrl: string;
  prompt: string;
  autoFix: boolean;
  log?: Logger;
  /** ENCONTRADO en un video real del usuario probando el producto: el
   *  panel mostraba una simulación de pasos de progreso con setInterval
   *  cada 4s (7 pasos = 28s) que se quedaba CONGELADA en el último mensaje
   *  ("Verificando mejoras con Claude Vision...") durante minutos cuando
   *  el ciclo real (con varias rondas de CoreOrchestrator) tardaba más de
   *  esos 28s — el usuario veía un indicador estático sin relación con el
   *  trabajo real que el backend sí seguía haciendo de fondo. Este
   *  callback opcional reporta el progreso REAL fase por fase, para que
   *  el frontend lo muestre tal cual en vez de simularlo. */
  onProgress?: (note: string) => void | Promise<void>;
}): Promise<VisualReport> {
  const { app, baseUrl, prompt, autoFix, log, onProgress } = opts;
  const report = async (note: string) => { try { await onProgress?.(note); } catch { /* nunca bloquear el ciclo por un fallo de progreso */ } };
  // Usamos /_inner directamente para que Puppeteer capture el contenido real
  // en lugar del wrapper HTML que solo contiene un <iframe> (que Puppeteer no penetra)
  const url = `${baseUrl.replace(/\/$/, "")}/p/${app.publicSlug}/_inner`;

  let currentBundle = app.frontendCode;
  let currentBackendCode = app.backendCode;
  let cycle = 0;
  let fixesApplied = 0;
  let lastShots: ViewportShot[] = [];
  let lastAnalysis: VisualAnalysis = {
    visuallyCorrect: false,
    overallScore: 0,
    issues: [],
    positives: [],
    summary: "Sin análisis",
  };

  let hasFreshAnalysis = false; // true cuando lastAnalysis ya corresponde al bundle actual (re-análisis del ciclo anterior) — evita una captura+análisis redundante

  while (cycle < (autoFix ? MAX_FIX_CYCLES : 1)) {
    cycle++;
    log?.info({ appId: app.id, cycle, url }, "VisualTester cycle start");

    if (!hasFreshAnalysis) {
      await report(`Ciclo ${cycle}/${autoFix ? MAX_FIX_CYCLES : 1} — capturando screenshots reales...`);
      lastShots = await takeScreenshots(url);
      await report(`Ciclo ${cycle} — Claude Vision analizando la app...`);
      lastAnalysis = await analyzeWithVision(
        lastShots,
        { title: app.title, description: app.description },
        prompt,
      );

      log?.info(
        {
          appId: String(app.id),
          cycle,
          score: lastAnalysis.overallScore,
          issues: lastAnalysis.issues.length,
        },
        "VisualTester analysis",
      );
    }
    hasFreshAnalysis = false; // se vuelve a poner true solo si el siguiente parche mejora y reutilizamos su re-análisis

    if (lastAnalysis.visuallyCorrect || !autoFix) break;
    const fixable = lastAnalysis.issues.filter((i) => i.severity !== "minor");
    if (fixable.length === 0) break;

    await report(`Ciclo ${cycle} — puntuación ${lastAnalysis.overallScore}/100, ${fixable.length} problema(s). Generando el arreglo...`);
    const patchResult = await applyVisualFixes({
      bundle: currentBundle,
      issues: fixable,
      app: { title: app.title, description: app.description },
      userPrompt: prompt,
      backendCode: currentBackendCode,
      onProgress: (note) => { void report(`Ciclo ${cycle} — ${note}`); },
    });
    if (!patchResult) {
      log?.warn({ appId: app.id, cycle }, "VisualTester fix returned no patch");
      break;
    }
    const patched = patchResult.frontendCode;

    await report(`Ciclo ${cycle} — validando el código generado...`);
    // Validate the patched bundle BEFORE persisting so we never overwrite a
    // working app with a corrupted Claude response. If esbuild can't build it,
    // we keep the old bundle and stop the loop.
    const validation = await validateBundle(patched);
    if (!validation.ok) {
      log?.warn(
        { appId: app.id, cycle, errors: validation.issues.length, issues: validation.issues.slice(0, 10) },
        "VisualTester patched bundle failed validation — keeping previous bundle",
      );
      break;
    }

    // Optimistic concurrency: only overwrite if the row's frontendCode still
    // matches what we started this cycle with. If a chat edit raced with us,
    // the WHERE matches 0 rows and we abort (better stale screenshot than
    // clobbered user edits).
    const previousBundle = currentBundle;
    const previousBackendCode = currentBackendCode;
    const dbUpdate: Record<string, string> = { frontendCode: patched };
    if (patchResult.backendCode) dbUpdate.backendCode = patchResult.backendCode;
    const updated = await GeneratedApp.findOneAndUpdate(
      { _id: String(app.id), frontendCode: previousBundle },
      dbUpdate,
      { new: false },
    );
    if (!updated) {
      log?.warn(
        { appId: app.id, cycle },
        "VisualTester aborted — bundle changed concurrently (chat edit?)",
      );
      break;
    }

    currentBundle = patched;
    if (patchResult.backendCode) currentBackendCode = patchResult.backendCode;
    fixesApplied++;
    await report(`Ciclo ${cycle} — corrección aplicada. Re-verificando con Claude Vision...`);

    // ENCONTRADO en un video real del usuario probando el producto: el
    // score reportado terminó PEOR que al empezar (32→28→22) — confirmado
    // leyendo el código que NINGÚN punto del ciclo comparaba si el parche
    // generado por el modelo realmente MEJORABA la puntuación visual real
    // antes de quedarse con él; solo se validaba que COMPILARA (esbuild),
    // no que la app se viera mejor según Claude Vision. Un parche puede
    // arreglar el issue que se le pidió y a la vez introducir una
    // regresión visual nueva (ej. mover el banner de cookies tapando el
    // contenido) — confirmado posible al revisar los issues reales del
    // video, donde Claude Vision señaló exactamente ese tipo de problema.
    // FIX: tras guardar el parche, re-capturar y re-analizar AHORA MISMO
    // (no esperar al siguiente ciclo) y comparar el score nuevo contra el
    // anterior — si empeora, revertir el bundle al estado previo a este
    // parche y detener el ciclo aquí, devolviendo el mejor resultado real
    // alcanzado en vez de seguir empeorando sin que nadie lo note.
    const scoreBeforeThisPatch = lastAnalysis.overallScore;
    const reShots = await takeScreenshots(url);
    const reAnalysis = await analyzeWithVision(
      reShots,
      { title: app.title, description: app.description },
      prompt,
    );
    log?.info(
      { appId: app.id, cycle, scoreBefore: scoreBeforeThisPatch, scoreAfter: reAnalysis.overallScore },
      "VisualTester re-analysis after patch — comparing for regression",
    );

    if (reAnalysis.overallScore < scoreBeforeThisPatch) {
      log?.warn(
        { appId: app.id, cycle, scoreBefore: scoreBeforeThisPatch, scoreAfter: reAnalysis.overallScore },
        "VisualTester patch REGRESSED the visual score — reverting to previous bundle",
      );
      await report(`Ciclo ${cycle} — el arreglo empeoró la puntuación (${scoreBeforeThisPatch}→${reAnalysis.overallScore}). Revirtiendo al estado anterior...`);
      const revertUpdate: Record<string, string> = { frontendCode: previousBundle };
      // Solo revertimos backendCode si este parche concreto lo había tocado
      // — si no lo tocó, dbUpdate nunca lo incluyó y no hay nada que revertir ahí.
      if (patchResult.backendCode && previousBackendCode) revertUpdate.backendCode = previousBackendCode;
      await GeneratedApp.findOneAndUpdate(
        { _id: String(app.id) },
        revertUpdate,
      );
      currentBundle = previousBundle;
      if (patchResult.backendCode && previousBackendCode) currentBackendCode = previousBackendCode;
      fixesApplied = Math.max(0, fixesApplied - 1); // el parche se descartó — no cuenta como corrección real aplicada
      // lastAnalysis se queda con el análisis ANTERIOR (scoreBeforeThisPatch),
      // que es el que de verdad corresponde al bundle finalmente guardado.
      break;
    }

    // El parche mejoró o se mantuvo igual — adoptamos el nuevo análisis
    // como referencia para decidir si seguir intentando en el próximo ciclo,
    // evitando repetir una captura+análisis idéntica al inicio del bucle.
    lastShots = reShots;
    lastAnalysis = reAnalysis;
    hasFreshAnalysis = true;
    if (reAnalysis.visuallyCorrect) break;

    // Snapshot the post-fix bundle so the user can roll back if the visual
    // tester's "improvement" actually regressed something. Fire-and-forget.
    void import("./appRevisions").then(({ snapshotCurrentApp }) =>
      snapshotCurrentApp({
        appId: String(app.id),
        source: "visual-fix",
        summary: `Reparación visual automática (ciclo ${cycle})`,
      }),
    );

    // Brief pause so the public deploy route reflects the new bundle when
    // puppeteer hits it again on the next cycle.
    await new Promise((r) => setTimeout(r, 1200));
  }

  return {
    cycles: cycle,
    fixesApplied,
    finalAnalysis: lastAnalysis,
    screenshots: lastShots,
  };
}
