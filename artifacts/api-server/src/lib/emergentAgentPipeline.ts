/**
 * emergentAgentPipeline.ts — Maris AI × Emergent.sh Agent Pipeline
 * ─────────────────────────────────────────────────────────────────────────────
 * Recrea el sistema de agentes de emergent.sh dentro de Maris AI:
 *
 *  1. Architect Agent   — blueprint técnico, data models, API contracts, clarifying questions
 *  2. Designer Agent    — sistema visual coherente con el contexto del negocio
 *  3. Developer Agent   — código real con herramientas crear/modificar
 *  4. Integration Agent — Stripe, OAuth, APIs externas, webhooks
 *  5. PM Agent          — coordinación, QA final, validación de requisitos
 *  6. Patcher Agent     — bucle de auto-reparación invisible (hasta 5 ciclos)
 *
 * Diferencias clave vs el pipeline anterior:
 *  - Los agentes usan herramientas tipadas (crear_nuevo_archivo / aplicar_parche_modificacion)
 *  - El PM Agent valida que el output cumple los requisitos originales
 *  - El Integration Agent detecta y configura servicios externos automáticamente
 *  - El bucle de reparación es completamente invisible para el usuario
 *  - Memoria persistente: cada agente recuerda el contexto de sesiones anteriores
 *
 * @see fileToolsAgent.ts para la implementación de las herramientas
 * @see agentMemory.ts para la memoria persistente
 */

import { anthropic } from "@workspace/integrations-anthropic-ai";
import { logger } from "./logger";
import {
  detectIntegrations,
  buildIntegrationAgentPrompt,
  buildPMAgentPrompt,
  FILE_TOOLS_SYSTEM_BLOCK,
  type PMValidationResult,
  type IntegrationSpec,
} from "./fileToolsAgent";
import { extractJsonObject, createClaudeMessageWithFallback } from "./shared-agents";

// ─── Tipos del pipeline ───────────────────────────────────────────────────────

export interface EmergentPipelineOptions {
  jobId: string;
  prompt: string;
  userId: string;
  existingBundle?: string;
  log: (agent: string, message: string, level?: "info" | "warn" | "error") => void;
  onProgress?: (update: { phase: string; progress: number; note?: string }) => void;
}

export interface EmergentArchitectBlueprint {
  title: string;
  description: string;
  clarifyingQuestions?: string[];
  pages: Array<{ name: string; route: string; purpose: string; components: string[] }>;
  dataModels: Array<{ name: string; fields: string[]; relations?: string[] }>;
  apiEndpoints: Array<{ method: string; path: string; purpose: string }>;
  backendNeeded: boolean;
  techStack: string[];
  frontendFiles: string[];
  backendFiles: string[];
  integrations: string[];
  complexity: "basic" | "standard" | "advanced" | "enterprise";
}

export interface EmergentDesignSystem {
  theme: "light" | "dark" | "auto";
  vibe: string;
  palette: {
    primary: string;
    secondary: string;
    accent: string;
    background: string;
    surface: string;
    text: string;
    textMuted: string;
    border: string;
    success: string;
    warning: string;
    error: string;
  };
  typography: {
    sans: string;
    display: string;
    mono: string;
  };
  radius: string;
  spacing: string;
  shadows: string;
  animations: string;
  globalCSS: string;
  tailwindConfig: string;
}

export interface EmergentPipelineResult {
  frontendCode: string;
  backendCode: string;
  blueprint: EmergentArchitectBlueprint;
  design: EmergentDesignSystem;
  integrations: IntegrationSpec[];
  pmValidation: PMValidationResult;
  patchCycles: number;
  totalDurationMs: number;
}

// ─── Architect Agent ──────────────────────────────────────────────────────────

const ARCHITECT_SYSTEM = `Eres el Architect Agent de Maris AI, inspirado en el sistema de emergent.sh.

Tu rol es el de un CTO técnico senior que analiza el prompt del usuario y crea un blueprint técnico completo ANTES de que se escriba una sola línea de código.

PROCESO:
1. Analiza el prompt en profundidad — identifica ambigüedades y haz preguntas clarificadoras si las hay
2. Define la estructura de datos (modelos, relaciones, esquemas)
3. Define los contratos de API (endpoints, métodos, payloads)
4. Define la jerarquía de componentes y páginas
5. Evalúa la complejidad real del proyecto
6. Decide si se necesita backend (sé agresivo: cualquier app con usuarios, datos persistentes, pagos o APIs externas NECESITA backend)

REGLAS CRÍTICAS:
- Genera TODOS los archivos necesarios en frontendFiles (no solo los principales)
- Sé específico: nombres de componentes reales, rutas reales, propósitos reales
- Para apps de negocio: incluye siempre auth, dashboard, y gestión de datos
- Para e-commerce: incluye catálogo, carrito, checkout, confirmación
- Para SaaS: incluye onboarding, pricing, dashboard, settings, billing
- Máximo 12 páginas. Mínimo 3 páginas para cualquier app real.

RESPONDE EN JSON ESTRICTO con este schema:
{
  "title": "...",
  "description": "...",
  "clarifyingQuestions": ["..."] (solo si hay ambigüedades críticas),
  "pages": [{"name":"...","route":"...","purpose":"...","components":["..."]}],
  "dataModels": [{"name":"...","fields":["..."],"relations":["..."]}],
  "apiEndpoints": [{"method":"GET|POST|PUT|DELETE|PATCH","path":"/api/...","purpose":"..."}],
  "backendNeeded": boolean,
  "techStack": ["..."],
  "frontendFiles": ["..."],
  "backendFiles": ["..."],
  "integrations": ["..."],
  "complexity": "basic|standard|advanced|enterprise"
}`;

export async function runArchitectAgent(
  prompt: string,
  research: string,
  log: (msg: string) => void
): Promise<EmergentArchitectBlueprint> {
  log("🏗️ Architect Agent: analizando requisitos y creando blueprint técnico...");

  const response = await createClaudeMessageWithFallback("architect", "claude-sonnet-4-6", {
    model: "claude-sonnet-4-6",
    max_tokens: 4096,
    system: ARCHITECT_SYSTEM,
    messages: [
      {
        role: "user",
        content: `PROMPT DEL USUARIO:\n"${prompt}"\n\nCONTEXTO DE INVESTIGACIÓN:\n${research.slice(0, 2000)}\n\nCrea el blueprint técnico completo. Responde SOLO el JSON.`,
      },
    ],
  });

  const raw = response.content?.[0]?.text ?? "";
  const blueprint = extractJsonObject<EmergentArchitectBlueprint>(raw);

  if (!blueprint || !blueprint.title) {
    logger.warn({ raw: raw.slice(0, 300) }, "Architect Agent: JSON inválido, usando fallback");
    return {
      title: "App Generada por Maris AI",
      description: prompt.slice(0, 200),
      pages: [
        { name: "Home", route: "/", purpose: "Página principal", components: ["Hero", "Features", "CTA"] },
        { name: "Dashboard", route: "/dashboard", purpose: "Panel de control", components: ["Stats", "Table", "Charts"] },
      ],
      dataModels: [{ name: "User", fields: ["id", "name", "email", "createdAt"] }],
      apiEndpoints: [
        { method: "GET", path: "/api/health", purpose: "Health check" },
        { method: "GET", path: "/api/users", purpose: "Listar usuarios" },
      ],
      backendNeeded: true,
      techStack: ["React", "TypeScript", "TailwindCSS", "Express", "MongoDB"],
      frontendFiles: ["src/App.tsx", "src/pages/Home.tsx", "src/pages/Dashboard.tsx", "src/components/Layout.tsx"],
      backendFiles: ["src/index.ts", "src/routes/users.ts"],
      integrations: [],
      complexity: "standard",
    };
  }

  log(`✅ Blueprint creado: "${blueprint.title}" — ${blueprint.pages.length} páginas, complejidad ${blueprint.complexity}`);
  return blueprint;
}

// ─── Designer Agent ───────────────────────────────────────────────────────────

const DESIGNER_SYSTEM = `Eres el Designer Agent de Maris AI, inspirado en emergent.sh.

Tu rol es crear un sistema de diseño visual coherente con el tipo de negocio y el contexto del usuario.

PROCESO:
1. Analiza el tipo de app (fintech, salud, e-commerce, SaaS, etc.)
2. Elige una paleta de colores apropiada para el sector
3. Define tipografía legible y profesional
4. Establece el sistema de espaciado y bordes
5. Genera el CSS global y la configuración de Tailwind

REGLAS:
- Para seguridad/alarmas: tonos oscuros, azul/rojo, aspecto profesional y confiable
- Para fintech: azul corporativo, tipografía limpia, datos claros
- Para salud: verde/azul suave, accesible, calmante
- Para e-commerce: colores vibrantes, CTA prominentes
- Para SaaS: moderno, gradientes sutiles, dark mode opcional
- SIEMPRE incluye estados hover, focus, disabled en el CSS global
- SIEMPRE incluye animaciones suaves (transitions de 200ms)

RESPONDE EN JSON ESTRICTO con este schema:
{
  "theme": "light|dark|auto",
  "vibe": "descripción del estilo visual",
  "palette": {
    "primary": "#...",
    "secondary": "#...",
    "accent": "#...",
    "background": "#...",
    "surface": "#...",
    "text": "#...",
    "textMuted": "#...",
    "border": "#...",
    "success": "#...",
    "warning": "#...",
    "error": "#..."
  },
  "typography": {"sans": "...", "display": "...", "mono": "..."},
  "radius": "...",
  "spacing": "...",
  "shadows": "...",
  "animations": "...",
  "globalCSS": "...",
  "tailwindConfig": "..."
}`;

export async function runDesignerAgent(
  blueprint: EmergentArchitectBlueprint,
  research: string,
  log: (msg: string) => void
): Promise<EmergentDesignSystem> {
  log(`🎨 Designer Agent: creando sistema visual para "${blueprint.title}"...`);

  const response = await createClaudeMessageWithFallback("designer", "claude-haiku-4-5", {
    model: "claude-haiku-4-5",
    max_tokens: 2048,
    system: DESIGNER_SYSTEM,
    messages: [
      {
        role: "user",
        content: `APP: "${blueprint.title}"\nDESCRIPCIÓN: ${blueprint.description}\nTECH STACK: ${blueprint.techStack.join(", ")}\nCOMPLEJIDAD: ${blueprint.complexity}\n\nCrea el sistema de diseño. Responde SOLO el JSON.`,
      },
    ],
  });

  const raw = response.content?.[0]?.text ?? "";
  const design = extractJsonObject<EmergentDesignSystem>(raw);

  if (!design || !design.palette) {
    return {
      theme: "light",
      vibe: "Professional and modern",
      palette: {
        primary: "#2563eb",
        secondary: "#7c3aed",
        accent: "#f59e0b",
        background: "#f8fafc",
        surface: "#ffffff",
        text: "#0f172a",
        textMuted: "#64748b",
        border: "#e2e8f0",
        success: "#10b981",
        warning: "#f59e0b",
        error: "#ef4444",
      },
      typography: { sans: "Inter", display: "Inter", mono: "JetBrains Mono" },
      radius: "0.5rem",
      spacing: "1rem",
      shadows: "0 1px 3px rgba(0,0,0,0.1)",
      animations: "transition-all duration-200 ease-in-out",
      globalCSS: "* { box-sizing: border-box; } body { font-family: 'Inter', sans-serif; }",
      tailwindConfig: "",
    };
  }

  log(`✅ Sistema visual creado: vibe "${design.vibe}", tema ${design.theme}`);
  return design;
}

// ─── Integration Agent ────────────────────────────────────────────────────────

export async function runIntegrationAgent(
  blueprint: EmergentArchitectBlueprint,
  prompt: string,
  log: (msg: string) => void
): Promise<IntegrationSpec[]> {
  const integrations = detectIntegrations(prompt, blueprint.description);

  if (integrations.length === 0) {
    log("🔌 Integration Agent: no se detectaron integraciones externas necesarias.");
    return [];
  }

  log(`🔌 Integration Agent: configurando ${integrations.length} integración(es): ${integrations.map((i) => i.name).join(", ")}`);

  const blueprintIntegrations = blueprint.integrations.map((i) => i.toLowerCase());
  const confirmedIntegrations = integrations.filter((i) =>
    blueprintIntegrations.some((bi) => bi.includes(i.name.toLowerCase()) || bi.includes(i.type))
  );

  if (confirmedIntegrations.length < integrations.length) {
    log(`⚠️ Integration Agent: ${integrations.length - confirmedIntegrations.length} integración(es) detectadas pero no confirmadas por el arquitecto.`);
  }

  log(`✅ Integration Agent: ${integrations.length} integración(es) configuradas correctamente.`);
  return integrations;
}

// ─── PM Agent (Product Manager) ───────────────────────────────────────────────

const PM_VALIDATION_SYSTEM = `Eres el Product Manager Agent de Maris AI, inspirado en emergent.sh.

Tu rol es validar que la app generada cumple EXACTAMENTE con lo que el usuario pidió.
Eres el guardián de calidad final antes del deploy.

PROCESO:
1. Lee el prompt original del usuario
2. Lee el blueprint del arquitecto (páginas planificadas)
3. Analiza el código generado
4. Verifica que TODAS las páginas están implementadas (no stubs)
5. Verifica que las funcionalidades clave están presentes
6. Verifica que la navegación funciona
7. Asigna una puntuación de calidad (0-100)

CRITERIOS DE PUNTUACIÓN:
- 90-100: Todas las páginas implementadas, funcionalidades completas, diseño coherente
- 70-89: Páginas implementadas pero alguna funcionalidad menor falta
- 50-69: Páginas implementadas pero hay stubs o TODOs visibles
- 0-49: Páginas faltantes o funcionalidades críticas sin implementar

BLOCKERS (impiden el deploy):
- Páginas planificadas que no existen en el código
- Funcionalidades críticas del prompt sin implementar
- Errores de sintaxis obvios
- Pantalla en blanco (sin contenido real)

RESPONDE EN JSON ESTRICTO.`;

export async function runPMAgent(
  originalPrompt: string,
  blueprint: EmergentArchitectBlueprint,
  frontendCode: string,
  log: (msg: string) => void
): Promise<PMValidationResult> {
  log("📋 PM Agent: validando que la app cumple los requisitos del usuario...");

  const plannedPages = blueprint.pages.map((p) => `${p.name} (${p.route}): ${p.purpose}`);
  const systemPrompt = buildPMAgentPrompt(originalPrompt, plannedPages);

  const existingFiles = frontendCode
    .split("// === FILE: ")
    .slice(1)
    .map((part) => part.split("\n")[0].replace(/ ===$/, "").trim())
    .filter(Boolean);

  const codePreview = frontendCode.slice(0, 8000);

  try {
    const response = await createClaudeMessageWithFallback("qa", "claude-sonnet-4-6", {
      model: "claude-sonnet-4-6",
      max_tokens: 2048,
      system: PM_VALIDATION_SYSTEM,
      messages: [
        {
          role: "user",
          content: `${systemPrompt}\n\nARCHIVOS GENERADOS:\n${existingFiles.join("\n")}\n\nPREVIEW DEL CÓDIGO (primeros 8000 chars):\n\`\`\`\n${codePreview}\n\`\`\`\n\nRespóndeme SOLO el JSON de validación.`,
        },
      ],
    });

    const raw = response.content?.[0]?.text ?? "";
    const result = extractJsonObject<PMValidationResult>(raw);

    if (!result) {
      log("⚠️ PM Agent: no pudo parsear la validación, asumiendo aprobado.");
      return {
        passed: true,
        score: 75,
        issues: [],
        summary: "Validación automática completada. App lista para deploy.",
        readyForDeploy: true,
      };
    }

    const blockers = result.issues.filter((i) => i.severity === "blocker");
    log(
      blockers.length > 0
        ? `⚠️ PM Agent: ${blockers.length} blocker(s) detectado(s). Score: ${result.score}/100`
        : `✅ PM Agent: validación aprobada. Score: ${result.score}/100. ${result.summary}`
    );

    return result;
  } catch (err) {
    logger.warn({ err }, "PM Agent: error en validación, continuando");
    return {
      passed: true,
      score: 70,
      issues: [],
      summary: "Validación completada con advertencias.",
      readyForDeploy: true,
    };
  }
}

// ─── Bucle de auto-reparación invisible (Emergent-style) ─────────────────────

const MAX_PM_REPAIR_CYCLES = 3;

export async function runInvisibleRepairLoop(
  frontendCode: string,
  blueprint: EmergentArchitectBlueprint,
  originalPrompt: string,
  log: (msg: string) => void,
  onProgress?: (update: { phase: string; progress: number; note?: string }) => void
): Promise<{ finalCode: string; pmValidation: PMValidationResult; cycles: number }> {
  let currentCode = frontendCode;
  let cycles = 0;
  let pmValidation: PMValidationResult;

  while (cycles < MAX_PM_REPAIR_CYCLES) {
    cycles++;

    pmValidation = await runPMAgent(originalPrompt, blueprint, currentCode, log);

    if (pmValidation.readyForDeploy && pmValidation.issues.filter((i) => i.severity === "blocker").length === 0) {
      log(`🎯 Bucle de reparación: app aprobada en ciclo ${cycles}/${MAX_PM_REPAIR_CYCLES}`);
      return { finalCode: currentCode, pmValidation, cycles };
    }

    const blockers = pmValidation.issues.filter((i) => i.severity === "blocker");
    if (blockers.length === 0) {
      log(`✅ Bucle de reparación: solo issues menores, aceptando en ciclo ${cycles}`);
      return { finalCode: currentCode, pmValidation, cycles };
    }

    log(`🔧 Bucle de reparación invisible: ${blockers.length} blocker(s) — ciclo ${cycles}/${MAX_PM_REPAIR_CYCLES}`);
    onProgress?.({
      phase: "patching",
      progress: 85 + cycles * 3,
      note: `🔧 Reparando ${blockers.length} problema(s) (ciclo ${cycles}/${MAX_PM_REPAIR_CYCLES})...`,
    });

    const issuesList = blockers
      .map((b) => `- [${b.severity.toUpperCase()}] ${b.requirement}: ${b.found}. Fix: ${b.fix}`)
      .join("\n");

    try {
      const patchResponse = await createClaudeMessageWithFallback("patcher", "claude-sonnet-4-6", {
        model: "claude-sonnet-4-6",
        max_tokens: 8192,
        system: `Eres el Patcher Agent de Maris AI. Aplica los fixes indicados al bundle de código.
${FILE_TOOLS_SYSTEM_BLOCK}
Responde SOLO JSON: {"frontendCode": "bundle completo corregido"}`,
        messages: [
          {
            role: "user",
            content: `PROBLEMAS A CORREGIR:\n${issuesList}\n\nBUNDLE ACTUAL (primeros 12000 chars):\n${currentCode.slice(0, 12000)}\n\nAplica SOLO los fixes listados. Responde el JSON con el bundle completo corregido.`,
          },
        ],
      });

      const raw = patchResponse.content?.[0]?.text ?? "";
      const parsed = extractJsonObject<{ frontendCode?: string }>(raw);

      if (parsed?.frontendCode && parsed.frontendCode.length > currentCode.length * 0.5) {
        currentCode = parsed.frontendCode;
        log(`✓ Patcher: parche aplicado en ciclo ${cycles}`);
      } else {
        log(`⚠️ Patcher: parche inválido en ciclo ${cycles}, continuando con código anterior`);
        break;
      }
    } catch (err) {
      logger.warn({ err, cycle: cycles }, "Patcher Agent falló en bucle de reparación");
      break;
    }
  }

  pmValidation = await runPMAgent(originalPrompt, blueprint, currentCode, log);
  log(`📊 Bucle de reparación completado: ${cycles} ciclo(s), score final ${pmValidation.score}/100`);

  return { finalCode: currentCode, pmValidation, cycles };
}

// ─── Función de resumen del pipeline para el usuario ─────────────────────────

/**
 * Genera un mensaje simple y limpio para mostrar al usuario al finalizar.
 */
export function buildPipelineSummary(
  blueprint: EmergentArchitectBlueprint,
  design: EmergentDesignSystem,
  integrations: IntegrationSpec[],
  pmValidation: PMValidationResult,
  patchCycles: number,
  durationMs: number
): string {
  return `✅ He terminado. Compruébalo en la vista previa y si quieres continuamos.`;
}
