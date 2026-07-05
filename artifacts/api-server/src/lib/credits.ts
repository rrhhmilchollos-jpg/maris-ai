import { connectDB } from "./db";
import { User, CreditTransaction } from "@workspace/db/schema";
import { CREDIT_PACKAGES } from "./payments";
 
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
}): Promise<{ creditsAdded: number; alreadyProcessed: boolean; newBalance: number }> {
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
    return {
      creditsAdded: 0,
      alreadyProcessed: true,
      newBalance: user?.credits ?? 0,
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
 
  const updated = await User.findByIdAndUpdate(
    userId,
    { $inc: { credits: Math.round(amount) } },
    { new: true, projection: { credits: 1 } },
  ).lean();
 
  return {
    creditsAdded: amount,
    alreadyProcessed: false,
    newBalance: updated?.credits ?? 0,
  };
}
 
/**
 * Refund a previously-charged amount of credits and log the transaction.
 */
export async function refundCredits(opts: {
  userId: string;
  isAdmin: boolean;
  amount: number;
  description: string;
}): Promise<void> {
  await connectDB();
  const { userId, isAdmin, amount, description } = opts;
  if (isAdmin || amount <= 0) return;
 
  await CreditTransaction.create({
    userId,
    kind: "refund",
    amount: Math.abs(amount),
    description,
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
  //    - Mantener los créditos top-up (no caducan)
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
