import { anthropic as zocoia } from "@workspace/integrations-anthropic-ai";
/**
 * ─────────────────────────────────────────────────────────────────────────────
 * Maris AI — Prompt Cache Manager
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * COMPLEMENTO: No modifica ninguna BD ni configuración existente.
 * Solo añade cache_control: { type: "ephemeral" } a los system prompts
 * estáticos para reducir el coste de tokens de entrada en un ~90%.
 *
 * Zoco IA Prompt Caching:
 *  - Los tokens leídos desde caché cuestan 0.1x del precio base.
 *  - El caché dura 5 minutos (se renueva en cada hit).
 *  - Solo se aplica a bloques estáticos (system prompts, instrucciones fijas).
 *  - Mínimo 1024 tokens para activar el caché (los prompts de Maris superan esto).
 *
 * Uso:
 *   import { cachedSystem, cachedSystemMulti } from "./promptCache";
 *
 *   // Sistema simple (un solo bloque)
 *   system: cachedSystem(mySystemPrompt)
 *
 *   // Sistema con parte estática + parte dinámica
 *   system: cachedSystemMulti(staticPart, dynamicPart)
 *
 * ─────────────────────────────────────────────────────────────────────────────
 */

export type CacheControl = { type: "ephemeral" };

export interface CachedTextBlock {
  type: "text";
  text: string;
  cache_control: CacheControl;
}

export interface TextBlock {
  type: "text";
  text: string;
}

/**
 * Envuelve un system prompt estático con cache_control para zocoia.
 * Úsalo cuando el system prompt NO cambia entre llamadas del mismo agente.
 *
 * @param text - El system prompt completo
 * @returns Array de un bloque con cache_control activado
 */
export function cachedSystem(text: string): CachedTextBlock[] {
  return [
    {
      type: "text",
      text,
      cache_control: { type: "ephemeral" },
    },
  ];
}

/**
 * Crea un sistema con DOS bloques:
 *  1. Parte estática (instrucciones, reglas, stack) → CACHEADA (90% descuento)
 *  2. Parte dinámica (contexto del proyecto actual) → NO cacheada (varía por request)
 *
 * Esto es el patrón óptimo para agentes que tienen instrucciones fijas
 * pero necesitan inyectar contexto variable (estado del proyecto, historial).
 *
 * @param staticPart  - Instrucciones que NO cambian (reglas, stack, formato)
 * @param dynamicPart - Contexto que SÍ cambia (estado del proyecto, resumen)
 * @returns Array de dos bloques: el primero cacheado, el segundo no
 */
export function cachedSystemMulti(
  staticPart: string,
  dynamicPart: string,
): (CachedTextBlock | TextBlock)[] {
  return [
    {
      type: "text",
      text: staticPart,
      cache_control: { type: "ephemeral" },
    },
    {
      type: "text",
      text: dynamicPart,
    },
  ];
}

/**
 * Prefill del asistente para forzar salida JSON directa.
 * Evita que el modelo genere texto conversacional antes del JSON,
 * ahorrando tokens de salida (los más caros, 5x el precio de entrada).
 *
 * Úsalo añadiendo este mensaje al array de messages:
 *   messages: [
 *     { role: "user", content: userPrompt },
 *     assistantPrefill()   // ← fuerza al modelo a continuar desde aquí
 *   ]
 *
 * @returns Mensaje de rol "assistant" que inicia el JSON
 */
export function assistantPrefill(): { role: "assistant"; content: string } {
  return { role: "assistant", content: '{"' };
}

/**
 * Prefill específico para respuestas de código frontend.
 * Fuerza al modelo a empezar directamente con el JSON de frontendCode.
 */
export function assistantPrefillFrontend(): { role: "assistant"; content: string } {
  return { role: "assistant", content: '{"frontendCode":"' };
}

/**
 * Prefill para respuestas de planificación (milestones/plan).
 */
export function assistantPrefillPlan(): { role: "assistant"; content: string } {
  return { role: "assistant", content: '{"milestones":[' };
}

/**
 * Prefill para respuestas de arquitectura.
 */
export function assistantPrefillArchitect(): { role: "assistant"; content: string } {
  return { role: "assistant", content: '{"title":"' };
}

/**
 * Helper: comprueba si un system prompt tiene suficientes tokens para
 * beneficiarse del caché (Zoco IA requiere mínimo 1024 tokens ≈ ~3500 chars).
 */
export function isWorthCaching(text: string): boolean {
  return text.length >= 3500;
}

/**
 * Aplica cache_control solo si el prompt es suficientemente largo.
 * Para prompts cortos (< 1024 tokens) el caché no aplica y Zoco IA
 * simplemente lo ignora, pero es buena práctica no añadirlo innecesariamente.
 */
export function smartCachedSystem(text: string): CachedTextBlock[] | string {
  if (isWorthCaching(text)) {
    return cachedSystem(text);
  }
  return text;
}
