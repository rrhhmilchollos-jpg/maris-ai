import { anthropic } from "@workspace/integrations-anthropic-ai";
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
  phases: ["patch", "validate"],
  reason: "Cambio mínimo sobre una app existente que ya funciona.",
  scope: "fast-patch",
};

export const PLAN_FEATURE: ExecutionPlan = {
  phases: ["architect", "design", "frontend", "qa", "tests", "validate", "patch"],
  reason: "Nueva pantalla, bug o feature sobre la app existente con control de calidad completo.",
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
  reason: "App nueva desde cero con pipeline completo y revisión de calidad.",
  scope: "full-build",
};

const COSMETIC_RX =
  /\b(color|colores|fondo|background|texto|tama[ñn]o|font|fuente|margen|padding|espac|alineaci[oó]n|centrar|alinear|redondeado|negrita|cursiva|borde|border|botón|boton|button|hover|sombra|shadow|opacidad|opacity|icono|emoji|titulo|título|subtítulo|subtitulo|placeholder|cambia|cambiar|ajusta|pon|poner|ponme|hazlo|hacerlo|m[aá]s grande|m[aá]s peque[ñn]o|typo)\b/i;

const FEATURE_RX =
  /\b(nueva pantalla|nueva p[aá]gina|nuevo componente|a[ñn]ade|a[ñn]adir|agrega|agregar|agr[eé]gale|crea una secci[oó]n|crea un componente|implementa|implementar|incluye un formulario|conecta con|integra con|backend para|API para|login|signup|registro|autenticaci[oó]n|stripe|pago|carrito|filtro|filtros|b[uú]squeda|search bar|navbar|footer|sidebar|dashboard nuevo)\b/i;

const FULL_BUILD_RX =
  /\b(crea una app|cr[eé]ame una app|construye una|haz una app|clona|clon de|tipo (instagram|tinder|wallapop|spotify|airbnb|uber|amazon|youtube|tiktok|whatsapp|netflix)|marketplace|red social|saas|mvp|landing completa|app completa|aplicaci[oó]n completa)\b/i;

// Bug reports / dependency errors must NEVER fall into fast-patch — the symptom
// the user describes is often only the visible tip and the real fix may need
// the architect to revisit imports, packages, or wiring across files. Forcing
// these into "feature" guarantees architect+frontend+validate+patch all run.
// Refinado tras code-review: quitados "404|500|importar|repara" como matches
// genéricos para evitar falsos positivos en frases inocentes ("pon Error 404 en
// el hero", "quiero importar un CSV", "preparar el deploy"). En su lugar se
// exige contexto técnico ("error 404", "error 500", "import faltante", etc).
const BUG_RX =
  /\b(error|errores|fallo|falla|fall[oó]|crash|crashea|excepci[oó]n|exception|stack trace|no funciona|no anda|no carga|no compila|build (failed|roto|fall[oó])|dependencia|dependencias|dependency|módulo no encontrado|modulo no encontrado|cannot find|module not found|undefined is not|null is not|reference ?error|type ?error|syntax ?error|unhandled|rejection|import faltante|paquete faltante|missing package|pantalla en blanco|blank page|white screen|roto|rota|reparar|arregla|arreglar|corrige|corregir|fix|debugg?ear|depurar)\b/i;

function heuristicPlan(prompt: string, hasExistingApp: boolean): ExecutionPlan {
  const trimmed = prompt.trim();
  const wordCount = trimmed.split(/\s+/).length;

  if (FULL_BUILD_RX.test(trimmed) || !hasExistingApp) {
    return { ...PLAN_FULL, reason: !hasExistingApp ? "App nueva (sin código previo)." : "Petición describe una app entera." };
  }
  // Bug/dependency reports take precedence over the cosmetic regex so a
  // message like "arregla el error de dependencia" is treated as a bug, not
  // as a cosmetic tweak.
  if (BUG_RX.test(trimmed) && hasExistingApp) {
    return { ...PLAN_FEATURE, reason: "Reporte de error o dependencia — ejecuto arquitecto + validación completa." };
  }
  if (FEATURE_RX.test(trimmed) && hasExistingApp) {
    return PLAN_FEATURE;
  }
  if (COSMETIC_RX.test(trimmed) && hasExistingApp && wordCount <= 10 && !FEATURE_RX.test(trimmed)) {
    return PLAN_FAST_PATCH;
  }
  // Antes cualquier petición corta entraba en fast-patch. Eso hacía que mensajes
  // ambiguos como "arregla esto" o "mejóralo" fueran demasiado rápidos y pobres.
  // Ahora, si no es un cambio cosmético inequívoco, escalamos a feature.
  if (hasExistingApp && wordCount <= 6 && COSMETIC_RX.test(trimmed) && !BUG_RX.test(trimmed)) {
    return PLAN_FAST_PATCH;
  }
  return PLAN_FEATURE;
}

const PLANNER_SYSTEM = `Eres el "Planner" de Maris AI. Recibes una petición de usuario y decides qué fases del pipeline ejecutar.

Devuelve SOLO un JSON con la forma:
{ "scope": "fast-patch" | "feature" | "full-build", "reason": "explicación breve en castellano (1 frase)" }

Reglas:
- "fast-patch": SOLO cambios estrictamente visuales o de texto sobre una app que YA funciona (ej: "cambia el color del botón a azul", "pon el título en mayúsculas", "centra el logo"). Si hay la más mínima duda, NO uses fast-patch.
- "feature": añadir nueva pantalla / componente / formulario / integración, O reportes de error / bug / dependencia / "no funciona" / "falla" / "está roto" / "arregla X". CUALQUIER reporte de problema técnico va aquí, NUNCA a fast-patch — el síntoma puede esconder un problema más amplio que requiere re-arquitectar imports o paquetes.
- "full-build": el usuario pide una app entera desde cero ("crea un Spotify", "haz un marketplace").

REGLA DE ORO: ante la duda, escala (fast-patch → feature → full-build). Es mejor "pasarse" haciendo más fases que entregar código roto.

NUNCA pongas comentarios, prosa, ni markdown alrededor del JSON.`;

export async function planExecution(
  prompt: string,
  options: { hasExistingApp: boolean } = { hasExistingApp: false },
): Promise<ExecutionPlan> {
  const heuristic = heuristicPlan(prompt, options.hasExistingApp);

  try {
    const response = await Promise.race([
      anthropic.messages.create({
        model: "claude-sonnet-4-6",
        max_tokens: 200,
        system: PLANNER_SYSTEM,
        messages: [{ role: "user", content: `App existente: ${options.hasExistingApp ? "sí" : "no"}\nPetición: ${prompt.slice(0, 1500)}` }],
      }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("planner timeout")), 8000),
      ),
    ]);
    const text = (response as any).content?.[0]?.text ?? "";
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return heuristic;
    const parsed = JSON.parse(match[0]) as { scope?: string; reason?: string };
    const reason = (parsed.reason ?? "").toString().slice(0, 240);
    if (parsed.scope === "fast-patch" && options.hasExistingApp) {
      // Post-guard determinístico: aunque el LLM diga fast-patch, si la
      // petición tiene marcadores de bug/dependencia/error, escala a feature.
      // El LLM puede equivocarse o ser convencido por una redacción casual,
      // pero un reporte técnico no debe entrar nunca al shortcut.
      if (BUG_RX.test(prompt)) {
        return {
          ...PLAN_FEATURE,
          reason: "Reporte de error o dependencia detectado — promovido a flujo completo (architect + validate + patch).",
        };
      }
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
      // Importante: NO decir "saltando X" — sí se valida y sí se auto-repara
      // si el parche no compila. El mensaje original era engañoso y le hacía
      // creer al usuario que se omitían pasos críticos. Si el parche no
      // converge, el flujo escala automáticamente a "feature" con el pipeline
      // completo (architect + frontend + validate + patch).
      return `🧭 Plan: cambio pequeño — aplico el parche, lo valido en memoria y, si algo falla, escalo automáticamente al flujo completo. ${plan.reason}`;
    case "feature":
      return `🧭 Plan: re-arquitecto, reviso diseño, regenero el frontend, paso QA/tests, valido todo el bundle y aplico parches hasta que compile sin errores. ${plan.reason}`;
    case "full-build":
      return `🧭 Plan: app nueva — pipeline completo (investigación → arquitecto → diseño → integraciones → frontend + backend → QA/tests → validación → parches). No termino hasta que el código compile sin errores. ${plan.reason}`;
  }
}
