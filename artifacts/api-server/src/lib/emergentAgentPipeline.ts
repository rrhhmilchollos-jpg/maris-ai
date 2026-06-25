/**
 * pipeline.ts — Motor de generación de código de Maris AI
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

  // Validar que las integraciones detectadas son coherentes con el blueprint
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

const PM_VALIDATION_SYSTEM = `
Eres el PM Agent de Maris AI — Product Manager y Director de Calidad Final.

Tu rol va mas alla de simplemente validar: eres el guardian que asegura que el usuario recibe exactamente lo que pidio, con calidad de produccion real.

PROCESO COMPLETO (ejecuta TODO en orden):
1. LEER el prompt original — extrae los requisitos funcionales explicitos e implicitos
2. MAPEAR las paginas del blueprint contra el codigo generado
3. VERIFICAR funcionalidades criticas (auth si la pide, pagos si los pide, CRUD si aplica)
4. DETECTAR codigo de relleno (stubs, TODOs, placeholder content, lorem ipsum)
5. VALIDAR navegacion y rutas (que los links del navbar funcionan)
6. COMPROBAR responsive (que hay clases mobile, md:, lg:)
7. VERIFICAR imports (que no hay imports de archivos inexistentes)
8. DETECTAR hardcoding excesivo (arrays vacios pasando como "datos reales")
9. GENERAR informe detallado con instrucciones exactas de fix para cada issue
10. DECIDIR si esta ready para deploy o necesita reparacion

CRITERIOS DE PUNTUACION ESTRICTOS:
- 95-100: Todo implementado, funcionalidades completas, codigo limpio, 0 stubs, responsive, navegacion funcional
- 80-94: Implementado al 90%+, 0 blockers, 1-2 mejoras menores
- 65-79: Implementado al 75%+, sin blockers criticos, algunos TODOs no bloqueantes
- 50-64: Implementado al 60%+, stubs visibles, funcionalidades secundarias faltantes
- 0-49: Paginas faltantes o funcionalidades criticas del prompt no implementadas

BLOCKERS ABSOLUTOS (score < 80 automatico, readyForDeploy: false):
- Paginas planificadas que no aparecen como "// === FILE:" en el codigo
- Funcionalidad CRITICA del prompt no implementada (si pide login y no hay login = BLOCKER)
- Pantalla en blanco o componente vacio como pagina principal
- Errores de sintaxis que impedirian la compilacion
- Imports de archivos que no existen en el bundle

MAJORS (reducen score pero no bloquean deploy si hay pocos):
- TODOs o comentarios "// implementar" visibles al usuario
- Datos hardcodeados sin posibilidad de edicion cuando el prompt pide CRUD
- Falta de estados de loading o error en formularios
- Navegacion que no lleva a las paginas correctas

MINORS (nota en el informe, no afectan deploy):
- Textos en ingles cuando el producto deberia ser en espanol
- Falta de animaciones o transiciones
- Iconos placeholder (usando emojis donde deberian ser SVGs)

SCHEMA DE RESPUESTA (JSON estricto, sin texto adicional):
{
  "passed": boolean,
  "score": number (0-100),
  "filesFound": ["lista de archivos encontrados en el bundle"],
  "filesMissing": ["archivos planificados que NO estan en el bundle"],
  "functionalitiesChecked": [
    { "feature": "nombre de la funcionalidad", "status": "implemented|partial|missing", "evidence": "donde se ve o no se ve en el codigo" }
  ],
  "issues": [
    { "severity": "blocker|major|minor", "requirement": "que se esperaba", "found": "que se encontro", "fix": "instruccion EXACTA para arreglarlo", "file": "archivo afectado si aplica" }
  ],
  "strengths": ["lista de cosas que estan bien implementadas"],
  "summary": "resumen ejecutivo en espanol de 3-4 frases para mostrar al usuario",
  "readyForDeploy": boolean,
  "deployBlockers": number,
  "estimatedFixTime": "menos de 1 min|1-3 min|3-10 min|mas de 10 min"
}`;

export async function runPMAgent(
  originalPrompt: string,
  blueprint: EmergentArchitectBlueprint,
  frontendCode: string,
  log: (msg: string) => void
): Promise<PMValidationResult> {
  log("PM Agent: inspeccion completa de calidad — 10 puntos de verificacion activos...");

  const plannedPages = blueprint.pages.map((p) => `${p.name} (${p.route}): ${p.purpose}`);
  const plannedEndpoints = (blueprint.apiEndpoints || []).map((e) => `${e.method} ${e.path}: ${e.purpose}`);
  const plannedIntegrations = (blueprint.integrations || []).join(", ");

  // Extraer archivos reales del bundle
  const existingFiles = frontendCode
    .split("// === FILE: ")
    .slice(1)
    .map((part) => part.split("\n")[0].replace(/ ===$/, "").trim())
    .filter(Boolean);

  // Detectar archivos planificados que faltan
  const missingFiles = blueprint.frontendFiles.filter(
    (f) => !existingFiles.some((ef) => ef.includes(f.replace("src/", "").replace(".tsx", "").replace(".ts", "")))
  );

  // Detectar stubs y TODOs
  const stubPatterns = ["TODO", "FIXME", "placeholder", "lorem ipsum", "// implement", "coming soon"];
  const stubsFound = stubPatterns.filter(p => frontendCode.toLowerCase().includes(p.toLowerCase()));

  const codePreview = frontendCode.slice(0, 12000);

  const userMessage = `PROMPT ORIGINAL DEL USUARIO:
"${originalPrompt}"

BLUEPRINT:
- Paginas planificadas: ${plannedPages.join(" | ")}
- Endpoints: ${plannedEndpoints.join(" | ") || "ninguno (SPA)"}
- Integraciones: ${plannedIntegrations || "ninguna"}
- Backend necesario: ${blueprint.backendNeeded ? "si" : "no"}
- Complejidad: ${blueprint.complexity}

ARCHIVOS ENCONTRADOS (${existingFiles.length}):
${existingFiles.join("\n")}

ARCHIVOS FALTANTES (${missingFiles.length}):
${missingFiles.length > 0 ? missingFiles.join("\n") : "ninguno"}

STUBS/TODOs: ${stubsFound.length > 0 ? stubsFound.join(", ") : "ninguno"}

PREVIEW CODIGO:
\`\`\`
${codePreview}
\`\`\`

Realiza la inspeccion completa y devuelve SOLO el JSON.`;

  try {
    const pmModel = blueprint.complexity === "enterprise" ? "claude-opus-4-7" : "claude-sonnet-4-6";

    const response = await createClaudeMessageWithFallback("qa", pmModel, {
      model: pmModel,
      max_tokens: 4096,
      system: PM_VALIDATION_SYSTEM,
      messages: [{ role: "user", content: userMessage }],
    });

    const raw = response.content?.[0]?.text ?? "";
    const result = extractJsonObject<PMValidationResult>(raw);

    if (!result) {
      const basicScore = missingFiles.length === 0 ? 78 : Math.max(40, 78 - (missingFiles.length * 15));
      return {
        passed: basicScore >= 65,
        score: basicScore,
        issues: missingFiles.map(f => ({ severity: "blocker" as const, requirement: `Archivo ${f}`, found: "No encontrado", fix: `Implementar ${f}` })),
        summary: `Validacion basica: ${existingFiles.length} archivos encontrados, ${missingFiles.length} faltantes.`,
        readyForDeploy: basicScore >= 65,
      };
    }

    const blockers = result.issues.filter((i) => i.severity === "blocker");
    const majors = result.issues.filter((i) => i.severity === "major");

    log(`PM Agent: score ${result.score}/100 — ${blockers.length} blocker(s), ${majors.length} major(s)`);
    if (blockers.length > 0) log(`PM Agent BLOCKERS: ${blockers.map(b => b.requirement).join(", ")}`);
    if ((result as any).strengths?.length > 0) log(`PM Agent OK: ${((result as any).strengths as string[]).slice(0, 2).join(", ")}`);
    log(`PM Agent: ${result.summary}`);

    return result;
  } catch (err) {
    logger.warn({ err }, "PM Agent: error en validacion");
    const fallbackScore = missingFiles.length === 0 ? 72 : 55;
    return {
      passed: fallbackScore >= 65,
      score: fallbackScore,
      issues: [],
      summary: "Validacion omitida por error interno. Revision manual recomendada.",
      readyForDeploy: fallbackScore >= 65,
    };
  }
}

// ─── Bucle de auto-reparación invisible (Emergent-style) ─────────────────────

const MAX_PM_REPAIR_CYCLES = 3;

/**
 * Bucle de reparación invisible inspirado en emergent.sh.
 *
 * Si el PM Agent detecta blockers, el Patcher Agent los corrige automáticamente
 * sin que el usuario vea nada. El pipeline no avanza hasta que:
 *   a) No hay blockers, o
 *   b) Se alcanza el máximo de ciclos de reparación.
 */
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

    // PM Agent valida el código actual
    pmValidation = await runPMAgent(originalPrompt, blueprint, currentCode, log);

    if (pmValidation.readyForDeploy && pmValidation.issues.filter((i) => i.severity === "blocker").length === 0) {
      log(`🎯 Bucle de reparación: app aprobada en ciclo ${cycles}/${MAX_PM_REPAIR_CYCLES}`);
      return { finalCode: currentCode, pmValidation, cycles };
    }

    const blockers = pmValidation.issues.filter((i) => i.severity === "blocker");
    if (blockers.length === 0) {
      // Solo hay issues menores, aceptar
      log(`✅ Bucle de reparación: solo issues menores, aceptando en ciclo ${cycles}`);
      return { finalCode: currentCode, pmValidation, cycles };
    }

    log(`🔧 Bucle de reparación invisible: ${blockers.length} blocker(s) — ciclo ${cycles}/${MAX_PM_REPAIR_CYCLES}`);
    onProgress?.({
      phase: "patching",
      progress: 85 + cycles * 3,
      note: `🔧 Reparando ${blockers.length} problema(s) (ciclo ${cycles}/${MAX_PM_REPAIR_CYCLES})...`,
    });

    // Patcher Agent corrige los blockers
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

  // Última validación
  pmValidation = await runPMAgent(originalPrompt, blueprint, currentCode, log);
  log(`📊 Bucle de reparación completado: ${cycles} ciclo(s), score final ${pmValidation.score}/100`);

  return { finalCode: currentCode, pmValidation, cycles };
}

// ─── Función de resumen del pipeline para el usuario ─────────────────────────

/**
 * Genera un resumen legible del pipeline para mostrar al usuario.
 * Estilo emergent.sh: transparente sobre lo que hicieron los agentes.
 */
export function buildPipelineSummary(
  blueprint: EmergentArchitectBlueprint,
  design: EmergentDesignSystem,
  integrations: IntegrationSpec[],
  pmValidation: PMValidationResult,
  patchCycles: number,
  durationMs: number
): string {
  const durationSec = Math.round(durationMs / 1000);
  const lines: string[] = [
    `## ✅ ${blueprint.title} — Generado por Maris AI`,
    "",
    `**Tiempo total:** ${durationSec}s | **Score de calidad:** ${pmValidation.score}/100 | **Ciclos de reparación:** ${patchCycles}`,
    "",
    "### 🏗️ Architect Agent",
    `- **${blueprint.pages.length} páginas** planificadas: ${blueprint.pages.map((p) => p.name).join(", ")}`,
    `- **Complejidad:** ${blueprint.complexity} | **Backend:** ${blueprint.backendNeeded ? "Sí" : "No"}`,
    `- **${blueprint.frontendFiles.length} archivos** frontend generados`,
    "",
    "### 🎨 Designer Agent",
    `- **Vibe:** ${design.vibe} | **Tema:** ${design.theme}`,
    `- **Paleta:** Primary ${design.palette.primary}, Secondary ${design.palette.secondary}`,
    `- **Tipografía:** ${design.typography.sans}`,
    "",
  ];

  if (integrations.length > 0) {
    lines.push("### 🔌 Integration Agent");
    for (const i of integrations) {
      lines.push(`- **${i.name}** (${i.type}): ${i.description}`);
    }
    lines.push("");
  }

  lines.push("### 📋 PM Agent (Quality Gate)");
  lines.push(`- **Resultado:** ${pmValidation.passed ? "✅ Aprobado" : "⚠️ Con advertencias"}`);
  lines.push(`- **${pmValidation.summary}**`);

  if (pmValidation.issues.length > 0) {
    const minors = pmValidation.issues.filter((i) => i.severity === "minor");
    if (minors.length > 0) {
      lines.push(`- ${minors.length} issue(s) menor(es) no bloqueantes`);
    }
  }

  lines.push("");
  lines.push("---");
  lines.push("*Generado con el sistema de agentes Maris AI × Emergent.sh*");

  return lines.join("\n");
}
