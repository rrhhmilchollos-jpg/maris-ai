import { pgTable, serial, text, integer, timestamp, boolean, jsonb } from "drizzle-orm/pg-core";

export const generationJobs = pgTable("generation_jobs", {
  id: serial("id").primaryKey(),
  userId: text("user_id").notNull(),
  prompt: text("prompt").notNull(),
  status: text("status").notNull().default("pending"),
  phase: text("phase").notNull().default("queued"),
  progress: integer("progress").notNull().default(0),
  appId: integer("app_id"),
  errorMessage: text("error_message"),
  // Run params persisted at enqueue time so a worker (possibly in a separate
  // process) can reload everything it needs from this row alone, given just
  // the jobId.
  editAppId: integer("edit_app_id"),
  coderModel: text("coder_model").default("auto").notNull(),
  language: text("language").default("typescript").notNull(),
  attachmentIds: jsonb("attachment_ids").$type<number[]>().default([]).notNull(),
  isAdmin: boolean("is_admin").default(false).notNull(),
  // Tracking for the queue/worker:
  // - retryCount: how many times the queue has retried this job after a worker crash
  // - workerId:   opaque id of the worker that picked it up (for debugging)
  retryCount: integer("retry_count").default(0).notNull(),
  workerId: text("worker_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export type GenerationJob = typeof generationJobs.$inferSelect;
export type InsertGenerationJob = typeof generationJobs.$inferInsert;
