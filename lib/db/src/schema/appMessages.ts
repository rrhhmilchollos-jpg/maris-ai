import { pgTable, serial, text, integer, timestamp } from "drizzle-orm/pg-core";
import { generatedApps } from "./generatedApps";

export const appMessages = pgTable("app_messages", {
  id: serial("id").primaryKey(),
  appId: integer("app_id")
    .notNull()
    .references(() => generatedApps.id, { onDelete: "cascade" }),
  role: text("role").notNull(),
  content: text("content").notNull(),
  // JSON-encoded array of chat_attachments.id values referenced by this message.
  // Stored as text (not pg array) to keep the schema portable and avoid having
  // to teach the rest of the codebase about Postgres array semantics. Default
  // "[]" so old rows and partial writes never crash the serializer.
  attachmentIds: text("attachment_ids").notNull().default("[]"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export type AppMessage = typeof appMessages.$inferSelect;
export type InsertAppMessage = typeof appMessages.$inferInsert;
