import {
  pgTable,
  serial,
  text,
  integer,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { users } from "./users";

export const creditTransactions = pgTable(
  "credit_transactions",
  {
    id: serial("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    amount: integer("amount").notNull(),
    description: text("description").notNull(),
    stripeSessionId: text("stripe_session_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    // Hard idempotency guard for Stripe credit purchases. The same
    // checkout.session.id can arrive twice (the success page polling
    // /billing/confirm AND the webhook firing in parallel). Without this
    // unique constraint a race between them double-credits the user.
    //
    // We use a *non-partial* unique index. In Postgres, NULL is never equal
    // to NULL inside a unique index, so non-stripe ledger entries — `kind:
    // 'use'` deductions, manual admin grants — with `stripe_session_id =
    // NULL` can still coexist freely. Only purchase rows with a concrete
    // session id are forced to be unique. This shape (vs a partial index)
    // also lets `INSERT ... ON CONFLICT (user_id, stripe_session_id)`
    // infer the constraint without needing an extra predicate.
    stripeSessionUq: uniqueIndex("credit_tx_stripe_session_uq").on(
      table.userId,
      table.stripeSessionId,
    ),
  }),
);

export type CreditTransactionRow = typeof creditTransactions.$inferSelect;
export type InsertCreditTransaction = typeof creditTransactions.$inferInsert;
