import { pgTable, serial, text, integer, timestamp, index } from "drizzle-orm/pg-core";

/**
 * Files (images, text, csv, json, etc.) the user attaches to a chat message —
 * either the initial prompt on the dashboard or an edit message on app-detail.
 *
 * Storage strategy: small files (≤ 8 MB after multer's hard limit) live as
 * base64 directly in `data_base64`. This keeps the feature self-contained (no
 * extra GCS / object-storage provisioning needed) and is cheap given the
 * expected volume — most users attach a screenshot or two per generation, not
 * a video. We can swap to object storage later without changing the public
 * API: callers always reference attachments by integer id.
 *
 * `appId` is null for "freshly uploaded but not yet attached to a generation"
 * — once the chat message is persisted, the attachment is logically scoped to
 * that app's lifecycle, but we don't enforce a FK to a specific message because
 * the same upload may be referenced from multiple places (e.g. resent in a
 * follow-up edit). Owner enforcement always goes through `userId`.
 */
export const chatAttachments = pgTable(
  "chat_attachments",
  {
    id: serial("id").primaryKey(),
    userId: text("user_id").notNull(),
    appId: integer("app_id"),
    filename: text("filename").notNull(),
    mimeType: text("mime_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    dataBase64: text("data_base64").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t: any) => ({
    userIdx: index("chat_attachments_user_idx").on(t.userId),
  }),
);

export type ChatAttachment = typeof chatAttachments.$inferSelect;
export type InsertChatAttachment = typeof chatAttachments.$inferInsert;
