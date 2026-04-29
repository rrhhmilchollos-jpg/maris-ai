import {
  pgTable,
  serial,
  text,
  timestamp,
  jsonb,
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
  status: text("status").notNull().default("ready"),
  // Coder model preference: "auto" (default routing), "gemini-2.5-flash", or "claude-sonnet-4-6".
  // Architect/Backend always stay on Sonnet; only the Coder/Edit role obeys this.
  coderModel: text("coder_model").notNull().default("auto"),
  // Public deploy URL slug. Null until the user clicks "Publicar". Globally unique.
  publicSlug: text("public_slug").unique(),
  // Last GitHub repo URL pushed to. Null until the user clicks "Subir a GitHub".
  githubRepoUrl: text("github_repo_url"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export type GeneratedAppRow = typeof generatedApps.$inferSelect;
export type InsertGeneratedApp = typeof generatedApps.$inferInsert;
