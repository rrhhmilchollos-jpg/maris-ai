import { and, eq, sql } from "drizzle-orm";
import { db } from "./db";
import { creditTransactions, users } from "@workspace/db/schema";
import { CREDIT_PACKAGES } from "./stripe";

/**
 * Lifetime EUR spent by the user, in cents. Used to gate features that
 * we only want to expose to paying customers (custom Vercel domains,
 * priority queue, …).
 *
 * We compute this on demand from `credit_transactions` rows of
 * `kind = "purchase"` instead of caching it. The price isn't stored on
 * the row directly (only the credits granted), so we look up the matching
 * EUR-priced package by credit count. USD packages (e.g. the annual
 * mega-pack) and unmatched amounts are skipped — they don't count toward
 * the EUR threshold by design. Spend is small and bounded per user, so
 * this query is cheap and we don't need a cached column.
 */
export async function getUserSpentCents(userId: string): Promise<number> {
  const eurPriceByCredits = new Map<number, number>();
  for (const pkg of CREDIT_PACKAGES) {
    if (pkg.currency === "eur") {
      eurPriceByCredits.set(pkg.credits, pkg.priceCents);
    }
  }
  const rows = await db
    .select({ amount: creditTransactions.amount })
    .from(creditTransactions)
    .where(
      and(
        eq(creditTransactions.userId, userId),
        eq(creditTransactions.kind, "purchase"),
      ),
    );
  let totalCents = 0;
  for (const r of rows) {
    const cents = eurPriceByCredits.get(r.amount);
    if (cents) totalCents += cents;
  }
  return totalCents;
}

/**
 * EUR threshold required to unlock a custom Vercel domain. Kept in one
 * place so the gate, the API response, and the UI message can never
 * disagree.
 */
export const CUSTOM_DOMAIN_MIN_SPEND_CENTS = 5000;

/**
 * Atomically credit a Stripe purchase to the user, with hard idempotency on
 * `(userId, stripeSessionId)`. Safe to call concurrently from the
 * `/billing/confirm` polling endpoint AND the Stripe webhook — at most one
 * caller will actually grant credits; everyone else gets `alreadyProcessed`.
 *
 * Idempotency is enforced two ways:
 *   1. A partial unique index on `credit_transactions(user_id, stripe_session_id)`
 *      where `stripe_session_id IS NOT NULL` — the database refuses dupes.
 *   2. `INSERT ... ON CONFLICT DO NOTHING RETURNING id` — if the row was
 *      inserted we get an id back and proceed to bump the balance, otherwise
 *      we no-op. The whole pair runs inside a single transaction so we never
 *      end up with a ledger row but no balance bump (or vice versa).
 */
export async function creditPurchase(opts: {
  userId: string;
  amount: number;
  stripeSessionId: string;
  description: string;
}): Promise<{ creditsAdded: number; alreadyProcessed: boolean; newBalance: number }> {
  const { userId, amount, stripeSessionId, description } = opts;
  return await db.transaction(async (tx) => {
    const inserted = await tx
      .insert(creditTransactions)
      .values({
        userId,
        kind: "purchase",
        amount,
        description,
        stripeSessionId,
      })
      .onConflictDoNothing({
        target: [creditTransactions.userId, creditTransactions.stripeSessionId],
      })
      .returning({ id: creditTransactions.id });

    if (inserted.length === 0) {
      // Already processed by a concurrent caller (other endpoint or retry).
      const [row] = await tx
        .select({ credits: users.credits })
        .from(users)
        .where(eq(users.id, userId));
      return {
        creditsAdded: 0,
        alreadyProcessed: true,
        newBalance: row?.credits ?? 0,
      };
    }

    const [updated] = await tx
      .update(users)
      .set({
        credits: sql`${users.credits} + ${amount}`,
        updatedAt: new Date(),
      })
      .where(eq(users.id, userId))
      .returning({ credits: users.credits });
    return {
      creditsAdded: amount,
      alreadyProcessed: false,
      newBalance: updated?.credits ?? 0,
    };
  });
}

/**
 * Refund a previously-charged amount of credits and log the transaction.
 * No-op for admins (they were never charged in the first place).
 */
export async function refundCredits(opts: {
  userId: string;
  isAdmin: boolean;
  amount: number;
  description: string;
}): Promise<void> {
  const { userId, isAdmin, amount, description } = opts;
  if (isAdmin || amount <= 0) return;
  await db.transaction(async (tx) => {
    await tx.insert(creditTransactions).values({
      userId,
      kind: "refund",
      amount: Math.abs(amount),
      description,
    });
    await tx
      .update(users)
      .set({ credits: sql`${users.credits} + ${amount}`, updatedAt: new Date() })
      .where(eq(users.id, userId));
  });
}

/**
 * Atomically deduct `amount` credits from a user and record a usage transaction.
 *
 * Returns the new balance on success, or `null` if the user does not have
 * enough credits. Admins are not charged (mirrors the convention used by the
 * generation endpoint in routes/apps.ts).
 *
 * The whole thing runs inside a single transaction so credits + ledger never
 * drift apart even if the API server is killed mid-call.
 */
export async function chargeCredits(opts: {
  userId: string;
  isAdmin: boolean;
  amount: number;
  description: string;
}): Promise<{ ok: true; newBalance: number } | { ok: false; reason: "insufficient" }> {
  const { userId, isAdmin, amount, description } = opts;
  if (isAdmin) {
    const [row] = await db
      .select({ credits: users.credits })
      .from(users)
      .where(eq(users.id, userId));
    return { ok: true, newBalance: row?.credits ?? 0 };
  }
  return await db.transaction(async (tx) => {
    const [row] = await tx
      .select({ credits: users.credits })
      .from(users)
      .where(eq(users.id, userId))
      .for("update");
    if (!row || row.credits < amount) {
      return { ok: false, reason: "insufficient" } as const;
    }
    await tx.insert(creditTransactions).values({
      userId,
      kind: "usage",
      amount: -Math.abs(amount),
      description,
    });
    await tx
      .update(users)
      .set({ credits: sql`${users.credits} - ${amount}`, updatedAt: new Date() })
      .where(eq(users.id, userId));
    return { ok: true, newBalance: row.credits - amount } as const;
  });
}
