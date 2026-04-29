import {
  pgTable,
  serial,
  text,
  integer,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { generatedApps } from "./generatedApps";

/**
 * Runtime errors reported by the published app's iframe sandbox.
 *
 * The sandbox bundle wires `window.error` and `window.unhandledrejection`
 * handlers that POST a small JSON payload to /p/:slug/_error. We persist them
 * here so the app's owner can see in the panel that a real visitor hit a
 * blank page or a broken interaction, and regenerate the app.
 *
 * - `kind` is "error" or "unhandledrejection" — matches the browser event
 *   name so we can display it as-is.
 * - `message` is the error.message (or stringified rejection reason),
 *   trimmed server-side to a sane size to keep payloads small.
 * - `source`/`lineno`/`colno` are the location reported by the browser when
 *   available (often null for cross-origin scripts).
 * - `stack` is the parsed stack trace, trimmed.
 * - `userAgent` and `pathname` (the visitor's virtual SPA route) are kept
 *   for debugging context — none of this contains Maris AI user data, since
 *   the iframe is opaque-origin and cannot read Maris AI cookies.
 */
export const appRuntimeErrors = pgTable(
  "app_runtime_errors",
  {
    id: serial("id").primaryKey(),
    appId: integer("app_id")
      .notNull()
      .references(() => generatedApps.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    message: text("message").notNull(),
    source: text("source"),
    lineno: integer("lineno"),
    colno: integer("colno"),
    stack: text("stack"),
    userAgent: text("user_agent"),
    pathname: text("pathname"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => ({
    appIdIdx: index("app_runtime_errors_app_id_idx").on(t.appId, t.id),
  }),
);

export type AppRuntimeErrorRow = typeof appRuntimeErrors.$inferSelect;
export type InsertAppRuntimeError = typeof appRuntimeErrors.$inferInsert;
