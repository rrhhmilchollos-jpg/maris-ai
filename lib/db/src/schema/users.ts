import { pgTable, text, integer, timestamp } from "drizzle-orm/pg-core";

export const users = pgTable("users", {
  id: text("id").primaryKey(),
  email: text("email").notNull(),
  fullName: text("full_name"),
  imageUrl: text("image_url"),
  credits: integer("credits").notNull().default(10),
  stripeCustomerId: text("stripe_customer_id"),
  // Plan de suscripción: "free" | "standard" | "pro" | "team"
  plan: text("plan").notNull().default("free"),
  // Créditos incluidos en el plan (se renuevan mensualmente, expiran al final del ciclo)
  planCredits: integer("plan_credits").notNull().default(0),
  // Fecha de expiración del plan (cuando se renueva o expira la suscripción)
  planExpiresAt: timestamp("plan_expires_at", { withTimezone: true }),
  // ID de suscripción de Stripe (para gestionar renovaciones y cancelaciones)
  stripeSubscriptionId: text("stripe_subscription_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;
