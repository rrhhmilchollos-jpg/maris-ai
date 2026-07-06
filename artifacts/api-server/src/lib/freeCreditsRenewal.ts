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
import { connectDB } from "./db";
import { User } from "@workspace/db/schema";
import { grantPlanCredits } from "./credits";
import { FREE_PLAN_CREDITS } from "./payments";
import { isAdminEmail } from "./auth";
import { logger } from "./logger";

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Recorre cuentas del plan gratis cuyo ciclo mensual ya venció (o que
 * nunca tuvieron uno — usuarios creados antes de este cambio, se
 * bootstrapean aquí mismo la primera vez que corre el tick) y les renueva
 * los créditos del plan, descartando el sobrante no usado del mes
 * anterior. Nunca lanza — cada usuario se procesa de forma aislada.
 */
export async function runFreeCreditsRenewalTick(): Promise<void> {
  await connectDB();

  const now = new Date();

  // Candidatos: plan gratis, y (a) su ciclo ya venció, o (b) nunca tuvieron
  // uno asignado (cuentas creadas antes de este cambio). isAdmin queda
  // fuera de esta consulta porque isAdminEmail ya les da créditos
  // ilimitados por otra vía — no necesitan pasar por aquí.
  const candidates = await User.find(
    {
      plan: "free",
      $or: [{ planExpiresAt: { $lte: now } }, { planExpiresAt: { $exists: false } }],
    },
    { _id: 1, email: 1 },
  ).lean();

  const pending = candidates.filter((u) => !isAdminEmail(u.email));
  if (pending.length === 0) return;

  logger.info({ count: pending.length }, "freeCreditsRenewal: cuentas gratis a renovar este ciclo");

  for (const user of pending) {
    try {
      await grantPlanCredits({
        clerkUserId: user._id,
        planId: "free",
        creditsPerMonth: FREE_PLAN_CREDITS,
        periodEnd: Math.floor((now.getTime() + THIRTY_DAYS_MS) / 1000),
      });
    } catch (err) {
      // Aislado por usuario — igual que recurringBilling.ts, un fallo
      // puntual no debe bloquear la renovación del resto de cuentas.
      logger.error({ err, userId: user._id }, "freeCreditsRenewal: fallo al renovar cuenta gratis — continuando con el resto");
    }
  }
}
