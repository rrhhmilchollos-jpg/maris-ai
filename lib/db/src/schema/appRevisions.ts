import {
  pgTable,
  serial,
  integer,
  text,
  timestamp,
  jsonb,
  index,
} from "drizzle-orm/pg-core";
import { generatedApps } from "./generatedApps";

export const appRevisions = pgTable(
  "app_revisions",
  {
    id: serial("id").primaryKey(),
    appId: integer("app_id")
      .notNull()
      .references(() => generatedApps.id, { onDelete: "cascade" }),
    jobId: integer("job_id"),
    source: text("source").notNull(),
    summary: text("summary").notNull().default(""),
    frontendCode: text("frontend_code"),
    backendCode: text("backend_code"),
    techStack: jsonb("tech_stack").$type<string[]>().notNull().default([]),
    plannedPages: jsonb("planned_pages").$type<
      Array<{ name: string; route?: string; purpose?: string }>
    >(),
    agentNotes: text("agent_notes").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    // Primary access pattern: list newest-first per app, and look one up
    // by id during restore. The composite covers both.
    appCreatedIdx: index("app_revisions_app_created_idx").on(
      t.appId,
      t.createdAt.desc(),
    ),
  }),
);

export type AppRevisionRow = typeof appRevisions.$inferSelect;
export type InsertAppRevision = typeof appRevisions.$inferInsert;
