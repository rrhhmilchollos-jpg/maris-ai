import {
  pgTable,
  serial,
  text,
  timestamp,
  jsonb,
  boolean,
} from "drizzle-orm/pg-core";
import { users } from "./users";

export const generatedApps = pgTable("generated_apps", {
  id: serial("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  prompt: text("prompt").notNull(),
  description: text("description").notNull(),
  techStack: jsonb("tech_stack").$type<string[]>().notNull().default([]),
  frontendCode: text("frontend_code").notNull(),
  backendCode: text("backend_code").notNull(),
  // Status values: "ready" (default, working), "failed" (generation failed),
  // "needs_review" (autonomous evaluator rejected after retries — user must
  // either retry or manually review the issues stored in evaluatorSummary).
  status: text("status").notNull().default("ready"),
  // Coder model preference: "auto" (default routing), "gemini-2.5-flash", or "claude-sonnet-4-6".
  // Architect/Backend always stay on Sonnet; only the Coder/Edit role obeys this.
  coderModel: text("coder_model").notNull().default("auto"),
  // Source language preference: "typescript" (default, .tsx files) or "javascript" (.jsx files).
  // Affects file extensions and TS-only syntax in prompts. Edits inherit this.
  language: text("language").notNull().default("typescript"),
  // Public deploy URL slug. Null until the user clicks "Publicar". Globally unique.
  publicSlug: text("public_slug").unique(),
  // Last GitHub repo URL pushed to. Null until the user clicks "Subir a GitHub".
  githubRepoUrl: text("github_repo_url"),
  // Auto-publish toggle. When true, the autonomous visual evaluator deploys
  // the app to /p/<slug> (assigning a fresh slug if needed) and emails the
  // owner the link as soon as the evaluator's verdict is "pass". Off by
  // default — opt-in only, the user must enable it from the project panel.
  autoPublish: boolean("auto_publish").notNull().default(false),
  // Short Spanish summary of the autonomous evaluator's last verdict. Used by
  // the dashboard's red "needs review" panel to show the user *why* the
  // evaluator rejected the app after its retry budget was spent. Null when
  // the evaluator hasn't run or last passed.
  evaluatorSummary: text("evaluator_summary"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export type GeneratedAppRow = typeof generatedApps.$inferSelect;
export type InsertGeneratedApp = typeof generatedApps.$inferInsert;
