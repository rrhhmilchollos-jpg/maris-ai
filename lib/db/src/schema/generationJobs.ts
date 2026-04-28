import { pgTable, serial, text, integer, timestamp } from "drizzle-orm/pg-core";

export const generationJobs = pgTable("generation_jobs", {
  id: serial("id").primaryKey(),
  userId: text("user_id").notNull(),
  prompt: text("prompt").notNull(),
  status: text("status").notNull().default("pending"),
  phase: text("phase").notNull().default("queued"),
  progress: integer("progress").notNull().default(0),
  appId: integer("app_id"),
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export type GenerationJob = typeof generationJobs.$inferSelect;
export type InsertGenerationJob = typeof generationJobs.$inferInsert;
