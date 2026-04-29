import { ai as gemini } from "@workspace/integrations-gemini-ai";
import { logger } from "./logger";

export type Phase =
  | "research"
  | "architect"
  | "design"
  | "integration"
  | "frontend"
  | "backend"
  | "qa"
  | "tests"
  | "validate"
  | "patch";

export interface ExecutionPlan {
  phases: Phase[];
  reason: string;
  scope: "fast-patch" | "feature" | "full-build";
}

export const PLAN_FAST_PATCH: ExecutionPlan = {
  phases: ["patch"],
  reason: "Cambio pequeño sobre la app existente.",
  scope: "fast-patch",
};

export const PLAN_FEATURE: ExecutionPlan = {
  phases: ["architect", "frontend", "validate", "patch"],
  reason: "Nueva pantalla o feature sobre la app existente.",
  scope: "feature",
};

export const PLAN_FULL: ExecutionPlan = {
  phases: [
    "research",
    "architect",
    "design",
    "integration",
    "frontend",
    "backend",
    "qa",
    "tests",
    "validate",
    "patch",
  ],
  reason: "App nueva desde cero.",
  scope: "full-build",
};

const COSMETIC_RX =
  /\b(color|colores|fondo|background|texto|tama[ñn]o|font|fuente|margen|padding|espac|alineaci[oó]n|centrar|alinear|redondeado|negrita|cursiva|borde|border|botón|boton|button|hover|sombra|shadow|opacidad|opacity|icono|emoji|titulo|título|subtítulo|subtitulo|placeholder|cambia|cambiar|ajusta|pon|poner|ponme|hazlo|hacerlo|m[aá]s grande|m[aá]s peque[ñn]o|arregla|corrige|fix|typo)\b/i;

const FEATURE_RX =
  /\b(nueva pantalla|nueva p[aá]gina|nuevo componente|a[ñn]ade|a[ñn]adir|agrega|agregar|agr[eé]gale|crea una secci[oó]n|crea un componente|implementa|implementar|incluye un formulario|conecta con|integra con|backend para|API para|login|signup|registro|autenticaci[oó]n|stripe|pago|carrito|filtro|filtros|b[uú]squeda|search bar|navbar|footer|sidebar|dashboard nuevo)\b/i;

const FULL_BUILD_RX =
  /\b(crea una app|cr[eé]ame una app|construye una|haz una app|clona|clon de|tipo (instagram|tinder|wallapop|spotify|airbnb|uber|amazon|youtube|tiktok|whatsapp|netflix)|marketplace|red social|saas|mvp|landing completa|app completa|aplicaci[oó]n completa)\b/i;

function heuristicPlan(prompt: string, hasExistingApp: boolean): ExecutionPlan {
  const trimmed = prompt.trim();
  const wordCount = trimmed.split(/\s+/).length;

  if (FULL_BUILD_RX.test(trimmed) || !hasExistingApp) {
    return { ...PLAN_FULL, reason: !hasExistingApp ? "App nueva (sin código previo)." : "Petición describe una app entera." };
  }
  if (FEATURE_RX.test(trimmed) && hasExistingApp) {
    return PLAN_FEATURE;
  }
  if (COSMETIC_RX.test(trimmed) && hasExistingApp && wordCount < 25) {
    return PLAN_FAST_PATCH;
  }
  if (hasExistingApp && wordCount < 15) {
    return PLAN_FAST_PATCH;
  }
  return PLAN_FEATURE;
}

const PLANNER_SYSTEM = `Eres el "Planner" de AppForge. Recibes una petición de usuario y decides qué fases del pipeline ejecutar.

Devuelve SOLO un JSON con la forma:
{ "scope": "fast-patch" | "feature" | "full-build", "reason": "explicación breve en castellano (1 frase)" }

Reglas:
- "fast-patch": cambio cosmético o textual sobre una app existente (ej: "cambia el color del botón", "pon el título en mayúsculas", "arregla el bug del login").
- "feature": añadir una nueva pantalla, componente, formulario o integración sobre una app que ya existe.
- "full-build": el usuario pide una app entera desde cero ("crea un Spotify", "haz un marketplace").

NUNCA pongas comentarios, prosa, ni markdown alrededor del JSON.`;

export async function planExecution(
  prompt: string,
  options: { hasExistingApp: boolean } = { hasExistingApp: false },
): Promise<ExecutionPlan> {
  const heuristic = heuristicPlan(prompt, options.hasExistingApp);

  try {
    const response = await Promise.race([
      gemini.models.generateContent({
        model: "gemini-2.5-flash",
        contents: `App existente: ${options.hasExistingApp ? "sí" : "no"}\nPetición: ${prompt.slice(0, 1500)}`,
        config: {
          systemInstruction: PLANNER_SYSTEM,
          temperature: 0,
          maxOutputTokens: 200,
        },
      }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("planner timeout")), 8000),
      ),
    ]);
    const text = (response as { text?: string })?.text ?? "";
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return heuristic;
    const parsed = JSON.parse(match[0]) as { scope?: string; reason?: string };
    const reason = (parsed.reason ?? "").toString().slice(0, 240);
    if (parsed.scope === "fast-patch" && options.hasExistingApp) {
      return { ...PLAN_FAST_PATCH, reason: reason || PLAN_FAST_PATCH.reason };
    }
    if (parsed.scope === "feature" && options.hasExistingApp) {
      return { ...PLAN_FEATURE, reason: reason || PLAN_FEATURE.reason };
    }
    if (parsed.scope === "full-build") {
      return { ...PLAN_FULL, reason: reason || PLAN_FULL.reason };
    }
    return heuristic;
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : String(err) },
      "planner call failed, using heuristic",
    );
    return heuristic;
  }
}

export function planSummaryEs(plan: ExecutionPlan): string {
  switch (plan.scope) {
    case "fast-patch":
      return `🧭 Plan: petición pequeña, solo aplicaré un parche directo (saltando investigación y diseño). ${plan.reason}`;
    case "feature":
      return `🧭 Plan: feature sobre app existente — arquitecto, frontend, validación y parches. ${plan.reason}`;
    case "full-build":
      return `🧭 Plan: app nueva, ejecutando el pipeline completo. ${plan.reason}`;
  }
}
