import {
  pgTable,
  serial,
  text,
  integer,
  timestamp,
} from "drizzle-orm/pg-core";
import { generatedApps } from "./generatedApps";

/**
 * AI-generated images for a generated app. Populated by the Nano Banana Pro
 * image agent — replaces placeholder Unsplash/picsum URLs in the bundle with
 * real generated images served from `/api/apps/:appId/images/:id`.
 *
 * `data` is a base64 string (matches the b64_json shape Gemini returns). The
 * route reads it, decodes it once, and ships the binary with the right
 * Content-Type. Cached aggressively (immutable) — rows are never mutated.
 */
export const appImages = pgTable("app_images", {
  id: serial("id").primaryKey(),
  appId: integer("app_id")
    .notNull()
    .references(() => generatedApps.id, { onDelete: "cascade" }),
  mimeType: text("mime_type").notNull(),
  // Base64-encoded image bytes. Sized small (~30-100 KB per image) so storing
  // as text in Postgres is fine. Switch to bytea if we ever generate at higher
  // resolutions or in higher quantities.
  data: text("data").notNull(),
  altText: text("alt_text").notNull().default(""),
  // The original placeholder URL we replaced (e.g. an Unsplash URL). Useful
  // for debugging and for re-running the agent idempotently.
  originalUrl: text("original_url").notNull().default(""),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export type AppImageRow = typeof appImages.$inferSelect;
export type InsertAppImage = typeof appImages.$inferInsert;
