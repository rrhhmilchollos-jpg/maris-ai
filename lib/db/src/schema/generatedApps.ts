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
  // GitHub repo identifier in `owner/repo` form. Stored alongside githubRepoUrl
  // so subsequent pushes can target the SAME repo (commit on top of main)
  // instead of creating a new one each click. Filled the first time the
  // user pushes; reused on every update afterwards. If the repo is deleted
  // on GitHub the next push detects that and recreates a fresh repo.
  githubRepoFullName: text("github_repo_full_name"),
  // Vercel project ID — assigned the FIRST time the user clicks "Desplegar
  // en Vercel". Reused on subsequent deploys so updates land on the SAME
  // project (and the same custom URL) instead of creating a new one each
  // time. Null until the first Vercel deploy.
  vercelProjectId: text("vercel_project_id"),
  // Last public URL Vercel returned for this app. Null until first deploy.
  // Format: "https://<project>-<hash>.vercel.app" or the user's custom domain
  // if they set one in their Vercel dashboard later.
  vercelDeployUrl: text("vercel_deploy_url"),
  // Custom domain the user attached to this app's Vercel project (e.g.
  // "mitienda.com"). Only set after the user spends ≥ 50 EUR — gated server
  // side, not just in the UI. Null = no custom domain, the app is reachable
  // only at the default *.vercel.app URL above.
  vercelCustomDomain: text("vercel_custom_domain"),
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
  // The architect's planned page list captured at generation time. Fed back
  // into the autonomous visual evaluator so the vision model can verify the
  // app actually contains the screens the architect promised (e.g., "did the
  // dashboard render the 'Pricing' page from the plan?"). Null for legacy
  // rows generated before this column existed — evaluator falls back to
  // user-intent-only grounding in that case.
  plannedPages: jsonb("planned_pages").$type<
    Array<{ name: string; route?: string; purpose?: string }>
  >(),
  // Persistent agent memory specific to THIS app. The agent appends short
  // notes here after each successful edit (e.g. "the user wants dark mode by
  // default", "all colors must use the brand palette #6B46C1", "the login
  // flow uses Clerk"). It is read back in every subsequent edit so behavior
  // stays consistent. The user can also view and edit it from the app
  // panel — it's their app, their rules. Hard-capped at ~3 KB by the writer
  // so it never explodes the prompt budget.
  agentNotes: text("agent_notes").notNull().default(""),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export type GeneratedAppRow = typeof generatedApps.$inferSelect;
export type InsertGeneratedApp = typeof generatedApps.$inferInsert;
