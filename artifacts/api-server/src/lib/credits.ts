import { connectDB } from "./db";
import { User, CreditTransaction } from "@workspace/db/schema";
import { CREDIT_PACKAGES } from "./payments";
import { checkLowBalance, checkSpikeRate } from "./notificationService";
 
/**
 * Lifetime EUR spent by the user, in cents.
 */
export async function getUserSpentCents(userId: string): Promise<number> {
  await connectDB();
 
  const eurPriceByCredits = new Map<number, number>();
  for (const pkg of CREDIT_PACKAGES) {
    if (pkg.currency === "eur") {
      eurPriceByCredits.set(pkg.credits, pkg.priceCents);
    }
  }
 
  const rows = await CreditTransaction.find(
    { userId, kind: "purchase" },
    { amount: 1 },
  ).lean();
 
  let totalCents = 0;
  for (const r of rows) {
    const cents = eurPriceByCredits.get(r.amount);
    if (cents) totalCents += cents;
  }
  return totalCents;
}
 
/**
 * @deprecated El umbral de gasto ya no se usa para desbloquear el dominio
 * propio. Mantenido solo para no romper consumidores legacy.
 */
export const CUSTOM_DOMAIN_MIN_SPEND_CENTS = 0;
 
/**
 * Devuelve true si el usuario ha hecho al menos UNA compra de créditos.
 */
export async function userHasAnyPurchase(userId: string): Promise<boolean> {
  await connectDB();
  const row = await CreditTransaction.findOne(
    { userId, kind: "purchase" },
    { _id: 1 },
  ).lean();
  return row !== null;
}
 
/**
 * Atomically credit a purchase (Stripe o Viva.com) to the user, with
 * idempotency on (userId, stripeSessionId) o (userId, vivaOrderCode) —
 * exactamente uno de los dos debe proporcionarse según el proveedor de
 * pago que confirmó la transacción.
 */
export async function creditPurchase(opts: {
  userId: string;
  amount: number;
  stripeSessionId?: string;
  vivaOrderCode?: string;
  description: string;
  // ENCONTRADO: estos campos nunca se guardaban -- "Ingresos totales" en
  // el panel admin llevaba mostrando 0€ desde siempre para TODAS las
  // compras, no solo por un caso puntual. vivaTransactionId es
  // imprescindible para poder reembolsar de verdad vía la API de Viva
  // (vivaOrderCode identifica el PEDIDO, no la transacción de cobro).
  priceCents?: number;
  gateway?: "viva" | "stripe" | "legacy";
  vivaTransactionId?: string;
  cardLast4?: string;
  cardBrand?: string;
}): Promise<{ creditsAdded: number; alreadyProcessed: boolean; newBalance: number; priceCents?: number }> {
  await connectDB();
  const { userId, amount, stripeSessionId, vivaOrderCode, description, priceCents, gateway, vivaTransactionId, cardLast4, cardBrand } = opts;

  if (!stripeSessionId && !vivaOrderCode) {
    throw new Error("creditPurchase requiere stripeSessionId o vivaOrderCode para garantizar idempotencia");
  }

  // Idempotency check — if a transaction with this sessionId/orderCode already exists, skip.
  const idempotencyQuery = stripeSessionId ? { userId, stripeSessionId } : { userId, vivaOrderCode };
  const existing = await CreditTransaction.findOne(
    idempotencyQuery,
    { _id: 1 },
  ).lean();
 
  if (existing) {
    const user = await User.findById(userId, { credits: 1 }).lean();
    const existingTx = await CreditTransaction.findOne(idempotencyQuery, { priceCents: 1 }).lean();
    return {
      creditsAdded: 0,
      alreadyProcessed: true,
      newBalance: user?.credits ?? 0,
      priceCents: (existingTx as any)?.priceCents,
    };
  }
 
  // Insert the transaction and bump the balance atomically via findOneAndUpdate.
  await CreditTransaction.create({
    userId,
    kind: "purchase",
    amount,
    description,
    stripeSessionId,
    vivaOrderCode,
    priceCents,
    gateway,
    vivaTransactionId,
    cardLast4,
    cardBrand,
    status: "succeeded",
  });
 
  const thirtyDaysFromNow = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  const currentUser = await User.findById(userId, { topUpCreditsExpiresAt: 1 }).lean();
  const currentExpiry = (currentUser as any)?.topUpCreditsExpiresAt;
  const newExpiry = currentExpiry && new Date(currentExpiry) > thirtyDaysFromNow ? currentExpiry : thirtyDaysFromNow;

  const updated = await User.findByIdAndUpdate(
    userId,
    { $inc: { credits: Math.round(amount) }, $set: { topUpCreditsExpiresAt: newExpiry } },
    { new: true, projection: { credits: 1 } },
  ).lean();
 
  return {
    creditsAdded: amount,
    alreadyProcessed: false,
    newBalance: updated?.credits ?? 0,
    // ENCONTRADO A PETICION DEL USUARIO (revisando por que Google Ads
    // mostraba la conversion "Compra" con 0 datos): esta funcion nunca
    // devolvia el importe real cobrado -- billing-success.tsx (frontend)
    // leia data?.amountEur que NUNCA existio en esta respuesta, caia
    // siempre a 0, y asi se ha estado reportando CADA compra real a
    // Google Ads/GA4 con valor 0€ desde siempre. Se devuelve priceCents
    // (ya calculado antes de esta funcion, de forma determinista, ver
    // billing.ts) para que el tracking pueda usar el importe real.
    priceCents,
  };
}
 
/**
 * Tick diario: expira el saldo de créditos de recarga (top-up) cuyo plazo
 * de 30 días ya pasó. Mismo patrón que runFreeCreditsRenewalTick — solo
 * reduce el `credits` total en la parte top-up (nunca toca planCredits,
 * que tiene su propio ciclo de renovación mensual ya existente).
 *
 * A petición explícita del usuario: aplica también al saldo que los
 * clientes ya tenían antes del cambio de política (creditPurchase ya deja
 * topUpCreditsExpiresAt puesto en cada compra nueva; para el saldo previo
 * al cambio, el backfill de despliegue le da 30 días desde el día del
 * lanzamiento — ver migración).
 */
export async function runTopUpExpirationTick(): Promise<void> {
  await connectDB();
  const now = new Date();
  const expiredUsers = await User.find(
    { topUpCreditsExpiresAt: { $lte: now }, credits: { $gt: 0 } },
    { _id: 1, credits: 1, planCredits: 1 },
  ).lean();

  for (const u of expiredUsers) {
    const topUpPortion = Math.max(0, (u.credits ?? 0) - (u.planCredits ?? 0));
    if (topUpPortion <= 0) {
      // No quedaba top-up real (ya consumido) — solo limpiar la fecha para no revisarlo cada día.
      await User.findByIdAndUpdate(u._id, { $unset: { topUpCreditsExpiresAt: "" } });
      continue;
    }
    await User.findByIdAndUpdate(u._id, {
      $inc: { credits: -topUpPortion },
      $unset: { topUpCreditsExpiresAt: "" },
    });
    await CreditTransaction.create({
      userId: String(u._id),
      kind: "usage",
      amount: -topUpPortion,
      description: "Caducidad de créditos de recarga (30 días)",
    });
    try {
      const { notifyTopUpExpired } = await import("./notificationService");
      await notifyTopUpExpired(String(u._id), topUpPortion);
    } catch { /* no bloqueante */ }
  }
}

export async function refundCredits(opts: {
  userId: string;
  isAdmin: boolean;
  amount: number;
  description: string;
  /** Ticket de soporte de categoría refund, aprobado manualmente. */
  supportTicketId: string;
  /** Identificador del miembro de soporte que aprobó el ticket. */
  approvedBy: string;
}): Promise<void> {
  await connectDB();
  const { userId, isAdmin, amount, description, supportTicketId, approvedBy } = opts;
  if (isAdmin || amount <= 0) return;
  if (!supportTicketId || !approvedBy) {
    throw new Error("POLÍTICA DE CRÉDITOS: toda compensación requiere un ticket de soporte aprobado manualmente.");
  }

  await CreditTransaction.create({
    userId,
    kind: "refund",
    amount: Math.abs(amount),
    description: `${description} [ticket:${supportTicketId}; approvedBy:${approvedBy}]`,
  });

  await User.findByIdAndUpdate(userId, { $inc: { credits: amount } });
}
 
/**
 * Atomically deduct `amount` credits from a user and record a usage transaction.
 * Returns ok:true on success, ok:false if insufficient credits.
 */
export async function chargeCredits(opts: {
  userId: string;
  isAdmin: boolean;
  amount: number;
  description: string;
}): Promise<{ ok: true; newBalance: number } | { ok: false; reason: "insufficient" }> {
  await connectDB();
  const { userId, isAdmin, amount, description } = opts;
 
  if (isAdmin) {
    // Admin/owner: unlimited credits, never deducted
    return { ok: true, newBalance: 999999999 };
  }
 
  // Use findOneAndUpdate with $inc only when credits >= amount.
  // MongoDB doesn't support SELECT FOR UPDATE, so we use a conditional update.
  const safeAmount = Math.round(amount); // siempre entero — evita 0.6000000000000014
  const updated = await User.findOneAndUpdate(
    { _id: userId, credits: { $gte: safeAmount } },
    { $inc: { credits: -safeAmount } },
    { new: true, projection: { credits: 1 } },
  ).lean();
 
  if (!updated) {
    return { ok: false, reason: "insufficient" };
  }
 
  await CreditTransaction.create({
    userId,
    kind: "usage",
    amount: -Math.abs(amount),
    description,
  });
 
  const LOW_CREDIT_THRESHOLD = 3; // Umbral de créditos bajos según requisitos
  if (updated.credits <= LOW_CREDIT_THRESHOLD) {
    // El frontend manejará la advertencia visual
  }

  // Fire-and-forget: nunca deben retrasar ni poder tumbar un cobro real.
  checkLowBalance(userId, updated.credits).catch(() => {});
  checkSpikeRate(userId).catch(() => {});

  return { ok: true, newBalance: updated.credits };
}

/**
 * Dar créditos del plan al usuario al inicio o renovación de suscripción.
 * Los créditos del plan caducan al final del ciclo (se resetean en cada renovación).
 * Los créditos comprados (top-up) NO se tocan.
 *
 * Stripe y Viva.com usan campos distintos para identificar la suscripción
 * (Stripe: un ID de objeto Subscription que se cobra solo; Viva: el
 * transactionId del primer pago, que el cron mensual referencia para cada
 * cobro siguiente — ver vivaPayments.ts → chargeRecurringPayment). Por eso
 * ambos son opcionales aquí: el caller pasa el que corresponda según el
 * proveedor que confirmó el pago.
 */
export async function grantPlanCredits(opts: {
  clerkUserId: string;
  planId: string;
  creditsPerMonth: number;
  periodEnd: number; // timestamp Unix
  stripeSubscriptionId?: string;
  vivaInitialTransactionId?: string;
  vivaSourceCode?: string;
}): Promise<void> {
  await connectDB();
  const { clerkUserId, planId, creditsPerMonth, periodEnd, stripeSubscriptionId, vivaInitialTransactionId, vivaSourceCode } = opts;

  const planExpiresAt = new Date(periodEnd * 1000);

  // 1. Obtener créditos actuales del usuario con reintentos
  let user;
  let retries = 3;
  while (retries > 0) {
    try {
      user = await User.findById(clerkUserId, { credits: 1, plan: 1, planCredits: 1 }).lean();
      if (user) break;
    } catch (err) {
      retries--;
      if (retries === 0) throw err;
      await new Promise(r => setTimeout(r, 500));
    }
  }
  if (!user) return;

  // 2. Calcular créditos a añadir:
  //    - Resetear los créditos del plan anterior (que habrán caducado)
  //    - Mantener los créditos top-up (caducan a los 30 días, ver
  //      topUpCreditsExpiresAt / runTopUpExpirationTick más abajo)
  const topUpCredits = Math.max(0, (user.credits ?? 0) - (user.planCredits ?? 0));
  const newTotalCredits = Math.round(topUpCredits + creditsPerMonth);

  // 3. Actualizar usuario con el nuevo plan y créditos (con reintentos)
  retries = 3;
  while (retries > 0) {
    try {
      await User.findByIdAndUpdate(clerkUserId, {
        $set: {
          plan: planId,
          planCredits: creditsPerMonth,
          credits: newTotalCredits,
          planExpiresAt,
          ...(stripeSubscriptionId ? { stripeSubscriptionId } : {}),
          ...(vivaInitialTransactionId ? { vivaInitialTransactionId, vivaLastChargeAt: new Date() } : {}),
          ...(vivaSourceCode ? { vivaSourceCode } : {}),
        },
      });
      break;
    } catch (err) {
      retries--;
      if (retries === 0) throw err;
      await new Promise(r => setTimeout(r, 500));
    }
  }

  // 4. Registrar la transacción
  await CreditTransaction.create({
    userId: clerkUserId,
    kind: "subscription",
    amount: creditsPerMonth,
    description: `Renovación plan ${planId}: ${creditsPerMonth} créditos (válidos hasta ${planExpiresAt.toLocaleDateString("es-ES")})`,
  }).catch(() => { /* best-effort */ });
}
