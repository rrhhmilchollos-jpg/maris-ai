import { pgTable, serial, text, integer, timestamp, index } from "drizzle-orm/pg-core";
import { generationJobs } from "./generationJobs";

/**
 * Live agent log lines for a generation job. Each row is one terminal-style
 * line emitted by an agent during the pipeline ("Architect → planning 8 pages
 * + 14 components", "Coder → wrote frontend/pages/Home.tsx", "Visual tester →
 * 92/100", etc.). Polled by the dashboard's progress card so the user can see
 * what the agents are actually doing in real time.
 *
 * - `agent` is the originating role (researcher | architect | designer |
 *   integration | coder | qa | validator | patcher | visual-tester |
 *   image-agent | system). Free-text on purpose so adding agents doesn't need
 *   a migration.
 * - `level` is "info" | "warn" | "error". Frontend colours each accordingly.
 * - `message` is short (≤ ~280 chars after we trim) — these are status lines
 *   not full LLM transcripts.
 */
export const jobLogs = pgTable(
  "job_logs",
  {
    id: serial("id").primaryKey(),
    jobId: integer("job_id")
      .notNull()
      .references(() => generationJobs.id, { onDelete: "cascade" }),
    level: text("level").notNull().default("info"),
    agent: text("agent").notNull(),
    message: text("message").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t: any) => ({
    jobIdIdx: index("job_logs_job_id_idx").on(t.jobId, t.id),
  }),
);

export type JobLog = typeof jobLogs.$inferSelect;
export type InsertJobLog = typeof jobLogs.$inferInsert;
