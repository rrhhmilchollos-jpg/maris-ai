import { logger } from "./logger";

/**
 * Política de seguridad para automatizaciones que pueden modificar aplicaciones.
 *
 * La plataforma mantiene validaciones deterministas (build, esquema, permisos),
 * pero los agentes LLM de prueba/reparación quedan DESACTIVADOS por defecto. Un
 * operador puede activarlos temporalmente en un entorno controlado definiendo la
 * variable exactamente a `true`; cualquier otro valor conserva el modo seguro.
 */
export const AUTOMATED_REPAIR_ENABLED = process.env.MARIS_AUTOMATED_REPAIR_ENABLED === "true";
export const VISUAL_AUTOFIX_ENABLED = process.env.MARIS_VISUAL_AUTOFIX_ENABLED === "true";

export function logAutomationDisabled(
  automation: "testing-agent" | "autopilot-repair" | "visual-autofix",
  context: Record<string, unknown> = {},
): void {
  logger.info(
    { automation, ...context },
    "Automatización de reparación omitida por política segura; no se modifica el código de clientes.",
  );
}
