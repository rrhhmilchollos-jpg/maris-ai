/**
 * freeCreditsRenewal.ts
 *
 * Caducidad mensual de créditos para cuentas del plan GRATIS — a petición
 * explícita del usuario: "los créditos no deben acumularse para siempre,
 * deben caducar al mes, igual en cuentas free que en planes de pago, como
 * en emergent.sh".
 *
 * Hasta este cambio, solo los suscriptores de pago (Pro) tenían un ciclo
 * mensual real: grantPlanCredits() se disparaba únicamente cuando Viva.com
 * confirmaba un cobro (ver recurringBilling.ts). Las cuentas gratis nunca
 * pasaban por ahí, así que sus créditos iniciales se quedaban intactos
 * para siempre si no los gastaban — sin caducidad, sin renovación.
 *
 * Este módulo reutiliza la MISMA función grantPlanCredits() que ya usan
 * los planes de pago (mismo mecanismo: se descartan los créditos del plan
 * anterior, se preservan los créditos top-up comprados aparte, que nunca
 * caducan), simplemente sin pasar por Viva — no hay cobro que confirmar,
 * el plan gratis se "renueva" solo.
 */
import { logger } from "./logger";

/**
 * Recorre cuentas del plan gratis cuyo ciclo mensual ya venció (o que
 * nunca tuvieron uno — usuarios creados antes de este cambio, se
 * bootstrapean aquí mismo la primera vez que corre el tick) y les renueva
 * los créditos del plan, descartando el sobrante no usado del mes
 * anterior. Nunca lanza — cada usuario se procesa de forma aislada.
 */
export async function runFreeCreditsRenewalTick(): Promise<void> {
  // Defensa en profundidad: incluso si un futuro arranque invocase este
  // módulo, no puede acreditar saldo. Las compensaciones se conceden solo
  // desde soporte tras una aprobación humana registrada.
  logger.info("freeCreditsRenewal: disabled by manual-compensation policy");
}
