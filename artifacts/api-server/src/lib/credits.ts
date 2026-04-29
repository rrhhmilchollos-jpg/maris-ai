import { eq, sql } from "drizzle-orm";
import { db } from "./db";
import { creditTransactions, users } from "@workspace/db/schema";

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
