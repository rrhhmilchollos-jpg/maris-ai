import { pgTable, serial, text, integer, timestamp } from "drizzle-orm/pg-core";
import { generatedApps } from "./generatedApps";

export const appMessages = pgTable("app_messages", {
  id: serial("id").primaryKey(),
  appId: integer("app_id")
    .notNull()
    .references(() => generatedApps.id, { onDelete: "cascade" }),
  role: text("role").notNull(),
  content: text("content").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export type AppMessage = typeof appMessages.$inferSelect;
export type InsertAppMessage = typeof appMessages.$inferInsert;
