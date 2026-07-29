import { anthropic as zocoia } from "@workspace/integrations-anthropic-ai";
import { GenerationJob } from "@workspace/db/schema";
import { logger } from "./logger";

/**
 * usageMeter.ts — cobro granular interno (coste real de API) por job.
 *
 * IMPORTANTE — esto NO cambia lo que se le cobra al cliente (eso sigue
 * siendo el precio plano de KIND_COSTS/HEALTH_CHECK_COST/etc. en
 * routes/apps.ts, decidido antes de arrancar el job). Lo que hace este
 * módulo es medir cuánto le cuesta REALMENTE a Maris AI cada job en
 * tokens de Zoco IA, para que el panel de admin (ver adminUsage.ts)
 * pueda comparar coste real vs. lo cobrado y detectar jobs que están
 * perdiendo dinero (el "Conundrum del Crédito" de Emergent, pero visto
 * desde el lado del negocio en vez de cobrárselo también al cliente).
 *
 * Precios por 1M tokens (USD), actualizar aquí si cambian las tarifas
 * de zocoia. Fuente: pricing público de Claude a fecha de este código.
 */
const PRICING_PER_MILLION_TOKENS_USD: Record<string, { input: number; output: number }> = {
  "zoco-plus": { input: 3, output: 15 },
  "zoco-max": { input: 15, output: 75 },
  default: { input: 3, output: 15 },
};

/**
 * Conversión aproximada de coste interno real (USD cents) a "créditos" —
 * usada SOLO para el presupuesto máximo por tarea y el widget en vivo del
 * cliente (una estimación de cuánto "vale" en créditos lo que el agente
 * ha gastado hasta ahora). NO es la tarifa exacta que se cobra al cliente
 * (esa sigue siendo KIND_COSTS, plana, decidida al lanzar el job).
 */
export const CENTS_PER_CREDIT_BUDGET_ESTIMATE = 8;

export function estimateCostCents(model: string, inputTokens: number, outputTokens: number): number {
  const pricing = PRICING_PER_MILLION_TOKENS_USD[model] ?? PRICING_PER_MILLION_TOKENS_USD.default;
  const usd =
    (inputTokens / 1_000_000) * pricing.input +
    (outputTokens / 1_000_000) * pricing.output;
  return Math.round(usd * 100);
}

/**
 * Registra el coste real de una llamada a la API en el job correspondiente.
 * Fire-and-forget deliberado: un fallo aquí (Mongo caído, lo que sea) NUNCA
 * debe tumbar la generación real del cliente — es solo contabilidad interna.
 */
export function recordApiUsage(opts: {
  jobId?: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  agent?: string;
}): void {
  const { jobId, model, inputTokens, outputTokens, agent } = opts;
  if (!jobId) return; // metering opcional — no todos los call sites lo pasan (aún)
  if (!inputTokens && !outputTokens) return;

  const costCents = estimateCostCents(model, inputTokens, outputTokens);

  GenerationJob.findByIdAndUpdate(jobId, {
    $inc: {
      internalApiCostCents: costCents,
      apiCallCount: 1,
      internalInputTokens: inputTokens,
      internalOutputTokens: outputTokens,
    },
  })
    .catch((err: unknown) => {
      logger.warn({ err, jobId, agent }, "[usageMeter] No se pudo registrar el coste interno (no bloqueante)");
    });
}
