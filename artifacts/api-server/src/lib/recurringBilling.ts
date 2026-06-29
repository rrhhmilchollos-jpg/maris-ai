/**
 * recurringBilling.ts
 *
 * Cobro mensual recurrente de suscripciones vía Viva.com.
 *
 * A diferencia de Stripe (donde una Subscription se cobra sola y Stripe
 * dispara invoice.payment_succeeded), Viva.com NO tiene ese automatismo:
 * el comercio (nosotros) debe disparar explícitamente una transacción
 * nueva cada mes, referenciando el transactionId del primer pago en el que
 * el cliente dio su consentimiento (allowRecurring=true en Smart
 * Checkout) — ver vivaPayments.ts → chargeRecurringPayment.
 *
 * Este módulo recorre periódicamente a los usuarios con una suscripción
 * Viva activa (vivaInitialTransactionId presente) cuyo planExpiresAt esté
 * a punto de vencer, y dispara el cobro de la siguiente cuota.
 */
import { connectDB } from "./db";
import { User } from "@workspace/db/schema";
import { chargeRecurringPayment } from "./vivaPayments";
import { grantPlanCredits } from "./credits";
import { SUBSCRIPTION_PLANS } from "./payments";
import { logger } from "./logger";

// Ventana de disparo: cobramos cuando faltan ≤24h para que expire el
// período actual — suficiente margen para reintentar si el primer intento
// falla (tarjeta rechazada, etc.) antes de que el usuario se quede sin
// créditos del plan de un día para otro.
const RENEWAL_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * Recorre usuarios con suscripción Viva activa próxima a vencer y dispara
 * el cobro de la siguiente cuota. Pensado para llamarse periódicamente
 * (ver index.ts) — nunca lanza, cada usuario se procesa de forma aislada
 * para que el fallo de uno no bloquee al resto.
 */
export async function runRecurringBillingTick(): Promise<void> {
  await connectDB();

  const now = new Date();
  const windowEnd = new Date(now.getTime() + RENEWAL_WINDOW_MS);

  // Candidatos: tienen referencia de pago recurrente de Viva, su plan no es
  // free, y planExpiresAt cae dentro de la ventana de renovación (incluye
  // ya vencidos — por si el servidor estuvo caído un rato).
  const candidates = await User.find(
    {
      vivaInitialTransactionId: { $exists: true, $ne: null },
      plan: { $ne: "free" },
      planExpiresAt: { $lte: windowEnd },
    },
    { _id: 1, email: 1, plan: 1, vivaInitialTransactionId: 1, vivaSourceCode: 1, vivaLastChargeAt: 1, planExpiresAt: 1 },
  ).lean();

  if (candidates.length === 0) return;

  logger.info({ count: candidates.length }, "recurringBilling: candidatos a renovación encontrados");

  for (const user of candidates) {
    try {
      await chargeUserRenewal(user as any);
    } catch (err) {
      // Aislado por usuario — un fallo individual (tarjeta rechazada, error
      // de red puntual) no debe impedir que se procesen los demás.
      logger.error({ err, userId: user._id }, "recurringBilling: fallo al renovar usuario — continuando con el resto");
    }
  }
}

async function chargeUserRenewal(user: {
  _id: string;
  email?: string;
  plan: string;
  vivaInitialTransactionId: string;
  vivaSourceCode?: string;
  vivaLastChargeAt?: Date;
  planExpiresAt?: Date;
}): Promise<void> {
  // Evitar doble cobro si el tick se ejecuta dos veces seguidas antes de
  // que planExpiresAt se actualice (ej. proceso reiniciado a mitad) — un
  // cobro reciente (últimas 6h) para el mismo usuario se considera ya
  // procesado para este ciclo.
  if (user.vivaLastChargeAt && Date.now() - user.vivaLastChargeAt.getTime() < 6 * 60 * 60 * 1000) {
    logger.info({ userId: user._id }, "recurringBilling: cobro reciente ya registrado — omitiendo este ciclo");
    return;
  }

  const plan = SUBSCRIPTION_PLANS.find((p) => p.id === user.plan);
  if (!plan || plan.price <= 0) {
    logger.warn({ userId: user._id, plan: user.plan }, "recurringBilling: plan desconocido o gratuito — omitiendo");
    return;
  }

  const charge = await chargeRecurringPayment({
    parentTransactionId: user.vivaInitialTransactionId,
    amount: Math.round(plan.price * 100),
    customerTrns: `Renovación ${plan.name} — ${plan.creditsPerMonth} créditos/mes`,
    merchantTrns: `subscription-renewal:${user._id}:${plan.id}`,
    sourceCode: user.vivaSourceCode,
  });

  if (!charge || charge.statusId !== "F") {
    logger.error({ userId: user._id, charge }, "recurringBilling: cobro recurrente fallido o no confirmado");
    try {
      const { notifyAdminPaymentError } = await import("./notify");
      await notifyAdminPaymentError({
        userEmail: user.email,
        userId: user._id,
        event: "viva.recurring_charge_failed",
        error: charge ? `StatusId inesperado: ${charge.statusId}` : "chargeRecurringPayment devolvió null (ver logs de vivaPayments para el detalle del rechazo)",
      });
    } catch { /* nunca bloquear por un fallo de notificación */ }
    // No degradamos el plan aquí automáticamente — un solo fallo puntual
    // (tarjeta caducada, fondos insuficientes momentáneos) no debe cortar
    // el acceso de inmediato. El próximo tick (cada hora, ver index.ts)
    // reintentará mientras planExpiresAt siga dentro de la ventana.
    // Si varios días después sigue sin cobrarse, planExpiresAt habrá
    // quedado en el pasado y hasActiveSubscription ya reflejará eso en
    // /billing/status — el front es quien decide qué mostrar al usuario.
    return;
  }

  // Cobro confirmado — renovar créditos y empujar el vencimiento un mes más.
  const periodEnd = Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60;
  await grantPlanCredits({
    clerkUserId: user._id,
    planId: plan.id,
    creditsPerMonth: plan.creditsPerMonth,
    periodEnd,
    vivaInitialTransactionId: user.vivaInitialTransactionId, // se mantiene el MISMO transactionId inicial — Viva siempre referencia el primero, no el último cobro
    vivaSourceCode: user.vivaSourceCode,
  });

  logger.info({ userId: user._id, plan: plan.id, transactionId: charge.transactionId }, "recurringBilling: renovación cobrada y créditos acreditados");

  try {
    const { notifyAdminSubscriptionRenewed } = await import("./notify");
    await notifyAdminSubscriptionRenewed({
      userEmail: user.email || user._id,
      userId: user._id,
      plan: plan.id,
      credits: plan.creditsPerMonth,
    });
  } catch { /* best-effort */ }
}
