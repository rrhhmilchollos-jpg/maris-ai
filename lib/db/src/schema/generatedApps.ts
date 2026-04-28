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
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export type GeneratedAppRow = typeof generatedApps.$inferSelect;
export type InsertGeneratedApp = typeof generatedApps.$inferInsert;
