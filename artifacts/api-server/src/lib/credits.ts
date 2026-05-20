import { connectDB } from "./db";
import { User, CreditTransaction } from "@workspace/db/schema";
import { CREDIT_PACKAGES } from "./stripe";
 
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
 * Atomically credit a Stripe purchase to the user, with idempotency on
 * (userId, stripeSessionId).
 */
export async function creditPurchase(opts: {
  userId: string;
  amount: number;
  stripeSessionId: string;
  description: string;
}): Promise<{ creditsAdded: number; alreadyProcessed: boolean; newBalance: number }> {
  await connectDB();
  const { userId, amount, stripeSessionId, description } = opts;
 
  // Idempotency check — if a transaction with this sessionId already exists, skip.
  const existing = await CreditTransaction.findOne(
    { userId, stripeSessionId },
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
  });
 
  const updated = await User.findByIdAndUpdate(
    userId,
    { $inc: { credits: amount } },
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
  const updated = await User.findOneAndUpdate(
    { _id: userId, credits: { $gte: amount } },
    { $inc: { credits: -amount } },
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
 
  const LOW_CREDIT_THRESHOLD = 10; // Define el umbral de créditos bajos
  if (updated.credits < LOW_CREDIT_THRESHOLD) {
    // Aquí se podría integrar un sistema de notificación (email, webhook, etc.)
    // Por ahora, lo registramos en el log.
    logger.warn({ userId, currentCredits: updated.credits }, "¡Advertencia! Créditos de usuario bajos.");
  }

  return { ok: true, newBalance: updated.credits };
}
