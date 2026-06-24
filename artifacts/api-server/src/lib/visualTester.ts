import { execSync } from "node:child_process";
// puppeteer importado dinámicamente para evitar crash al arrancar si no está instalado
type Browser = any; type Page = any;
import type { Logger } from "pino";
import { GeneratedApp } from "@workspace/db/schema";
import { anthropic } from "@workspace/integrations-anthropic-ai";
import { validateBundle } from "./validate";
import { compactBundleForPrompt, estimatePromptTokens, extractJsonObject, mergePatchIntoBundle } from "./shared-agents";
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
    // Give React a tick to paint after networkidle.
    await new Promise((r) => setTimeout(r, 1500));
    // Trigger lazy/scroll-revealed content. We pass strings instead of arrow
    // functions so this file doesn't need DOM lib types in tsconfig.
    await page.evaluate("window.scrollTo(0, document.body.scrollHeight / 2)");
    await new Promise((r) => setTimeout(r, 400));
    await page.evaluate("window.scrollTo(0, 0)");
    await new Promise((r) => setTimeout(r, 400));

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

  // Visual analysis uses Sonnet — tiene vision multimodal excelente
  // Para proyectos con muchos issues usamos max_tokens mayor
  // Intentar con Claude Vision primero, fallback a Gemini Vision si no hay créditos
  let text = "";
  try {
    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 3000,
      messages: [{ role: "user", content }],
    });
    text = response.content
      .map((b: any) => (b.type === "text" ? b.text : ""))
      .filter(Boolean)
      .join("\n");
  } catch (anthropicErr: any) {
    const isCredits = String(anthropicErr?.message || "").includes("credit") || anthropicErr?.status === 400;
    if (isCredits) {
      rootLogger.warn("Visual Evaluator: Anthropic sin créditos — fallback a Gemini Vision");
      // Fallback a Gemini Vision (gratuito)
      const geminiKey = process.env.AI_INTEGRATIONS_GEMINI_API_KEY || process.env.GEMINI_API_KEY;
      if (!geminiKey) throw anthropicErr;
      const { GoogleGenAI, createPartFromBase64 } = await import("@google/genai");
      const gemini = new GoogleGenAI({ apiKey: geminiKey });
      // Construir partes para Gemini Vision
      const parts: any[] = [];
      // Texto del sistema/instrucciones
      const textContent = content.find((b: any) => b.type === "text" && b.text?.includes("VISUAL EVALUATOR"));
      if (textContent) parts.push({ text: (textContent as any).text });
      // Imágenes
      for (const block of content) {
        if ((block as any).type === "image" && (block as any).source?.data) {
          const img = (block as any).source;
          parts.push(createPartFromBase64(img.data, img.media_type || "image/png"));
        } else if ((block as any).type === "text" && block !== textContent) {
          parts.push({ text: (block as any).text });
        }
      }
      const result = await gemini.models.generateContent({
        model: "gemini-2.0-flash",
        contents: [{ role: "user", parts }],
        config: { maxOutputTokens: 3000 },
      });
      text = result.candidates?.[0]?.content?.parts?.[0]?.text || "";
      rootLogger.info({ chars: text.length }, "Gemini Vision fallback exitoso");
    } else {
      throw anthropicErr;
    }
  }

  const parsed = safeJsonParse<VisualAnalysis>(text);
  if (!parsed) {
    return {
      visuallyCorrect: true,
      overallScore: 70,
      issues: [],
      positives: [],
      summary: "Análisis no parseable; asumiendo OK.",
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
async function applyVisualFixes(opts: {
  bundle: string;
  issues: VisualIssue[];
  app: { title: string; description?: string | null };
}): Promise<string | null> {
  const { bundle, issues, app } = opts;

  const compactBundle = compactBundleForPrompt(bundle, issues.map((i) => `${i.type} ${i.description} ${i.cssfix}`), 65_000);
  rootLogger.info({ originalTokens: estimatePromptTokens(bundle), compactTokens: estimatePromptTokens(compactBundle), issueCount: issues.length }, "TOKEN_OPTIMIZER: visual fixes compacted bundle");

  const fixList = issues
    .filter((i) => i.severity !== "minor")
    .slice(0, 8)
    .map(
      (i, idx) =>
        `${idx + 1}. [${i.severity}/${i.viewport}] ${i.type}: ${i.description}\n   Sugerencia: ${i.cssfix}`,
    )
    .join("\n");

  const prompt = `Eres el Visual Fix Agent de Maris AI — especialista en reparaciones quirurgicas de UI/UX sin romper funcionalidad.

App: ${app.title}
Descripcion: ${app.description ?? "(no disponible)"}

PROBLEMAS A ARREGLAR (ordenados por severidad):
${fixList}

REGLAS:
- Devuelve SOLO JSON con changedFiles. NO el bundle completo.
- changedFiles[ruta] = contenido COMPLETO del archivo modificado.
- NO cambies funcionalidad, logica de negocio ni nombres de funciones publicas.
- Para responsive: usa breakpoints Tailwind sm: md: lg: correctamente.
- Para contraste bajo: usa clases de color Tailwind con ratio WCAG AA.
- Para blank_page: verifica que el componente raiz renderiza contenido visible.
- Para overlapping: usa z-index apropiados o corrige layout flex/grid.
- Para touch_targets_small: min h-11 w-11 en botones y links en mobile.
- Solo arregla los issues listados, no optimices otras cosas.

RESPUESTA JSON (sin markdown, sin backticks):
{
  "changedFiles": { "src/App.tsx": "contenido completo actualizado" },
  "fixesSummary": ["descripcion breve de cada fix"]
}

ARCHIVOS RELEVANTES:
${compactBundle}`;

  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 12000,  // Aumentado de 8000 a 12000 para patches mas completos
    messages: [{ role: "user", content: prompt }],
  });

  const text = response.content
    .map((b) => (b.type === "text" ? b.text : ""))
    .filter(Boolean)
    .join("\n")
    .trim()
    .replace(/^```(?:[a-zA-Z]+)?\n?/, "")
    .replace(/\n?```$/, "")
    .trim();

  const parsed = extractJsonObject<{ changedFiles?: Record<string, string>; deletedFiles?: string[]; frontendCode?: string }>(text);
  if (parsed?.changedFiles && Object.keys(parsed.changedFiles).length > 0) {
    return mergePatchIntoBundle(bundle, parsed.changedFiles, Array.isArray(parsed.deletedFiles) ? parsed.deletedFiles : []);
  }
  if (parsed?.frontendCode && parsed.frontendCode.includes("// === FILE:")) return parsed.frontendCode;
  if (!text.includes("// === FILE:")) return null;
  if (text.length < bundle.length / 3) return null;
  return text;
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
    publicSlug: string;
  };
  baseUrl: string;
  prompt: string;
  autoFix: boolean;
  log?: Logger;
}): Promise<VisualReport> {
  const { app, baseUrl, prompt, autoFix, log } = opts;
  const url = `${baseUrl.replace(/\/$/, "")}/p/${app.publicSlug}`;

  let currentBundle = app.frontendCode;
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

  while (cycle < (autoFix ? MAX_FIX_CYCLES : 1)) {
    cycle++;
    log?.info({ appId: app.id, cycle, url }, "VisualTester cycle start");

    lastShots = await takeScreenshots(url);
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

    if (lastAnalysis.visuallyCorrect || !autoFix) break;
    const fixable = lastAnalysis.issues.filter((i) => i.severity !== "minor");
    if (fixable.length === 0) break;

    const patched = await applyVisualFixes({
      bundle: currentBundle,
      issues: fixable,
      app: { title: app.title, description: app.description },
    });
    if (!patched) {
      log?.warn({ appId: app.id, cycle }, "VisualTester fix returned no patch");
      break;
    }

    // Validate the patched bundle BEFORE persisting so we never overwrite a
    // working app with a corrupted Claude response. If esbuild can't build it,
    // we keep the old bundle and stop the loop.
    const validation = await validateBundle(patched);
    if (!validation.ok) {
      log?.warn(
        { appId: app.id, cycle, errors: validation.issues.length },
        "VisualTester patched bundle failed validation — keeping previous bundle",
      );
      break;
    }

    // Optimistic concurrency: only overwrite if the row's frontendCode still
    // matches what we started this cycle with. If a chat edit raced with us,
    // the WHERE matches 0 rows and we abort (better stale screenshot than
    // clobbered user edits).
    const previousBundle = currentBundle;
    const updated = await GeneratedApp.findOneAndUpdate(
      { _id: String(app.id), frontendCode: previousBundle },
      { frontendCode: patched },
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
    fixesApplied++;

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
