import express, { Router, type IRouter, type Request, type Response } from "express";
import { eq, sql } from "drizzle-orm";
import { db } from "../lib/db";
import { generatedApps, appRuntimeErrors } from "@workspace/db/schema";
import { buildDeployHtml, SLUG_PATTERN } from "../lib/deployBundle";

const router: IRouter = Router();

/**
 * Trim a free-form string field reported by the iframe before persisting.
 * Caps the length so a runaway error message can't bloat the database, and
 * normalizes whitespace. Returns null for empty / non-string input.
 */
function trimField(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  if (!t) return null;
  return t.length > max ? t.slice(0, max) : t;
}

/**
 * Coerce a JSON value to a positive integer line/column number, or null.
 * Browsers sometimes report 0 or absurdly large values — we keep only sane
 * 1..1e7 ints.
 */
function trimLine(v: unknown): number | null {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n) || n <= 0 || n > 1e7) return null;
  return Math.floor(n);
}

/**
 * In-memory rate limit per slug. A faulty published app can fire dozens of
 * errors per second (e.g. an error inside a render loop), and we don't want
 * a single broken page to flood the DB with thousands of identical rows.
 *
 * Token bucket: at most BURST inserts per slug per WINDOW_MS. Tokens reset
 * each window. Map is bounded by SLUG_PATTERN (10-char [a-z0-9]) so the
 * footprint is tiny in practice; we still GC entries older than 10 minutes
 * so a long-running server doesn't grow unbounded.
 */
const ERROR_BURST = 20;
const ERROR_WINDOW_MS = 60_000;
type RateEntry = { count: number; windowStart: number };
const rateBuckets = new Map<string, RateEntry>();

function consumeErrorToken(slug: string): boolean {
  const now = Date.now();
  // Lazy GC of stale buckets (10x window) to keep the map bounded.
  if (rateBuckets.size > 1000) {
    for (const [k, v] of rateBuckets.entries()) {
      if (now - v.windowStart > ERROR_WINDOW_MS * 10) rateBuckets.delete(k);
    }
  }
  const bucket = rateBuckets.get(slug);
  if (!bucket || now - bucket.windowStart > ERROR_WINDOW_MS) {
    rateBuckets.set(slug, { count: 1, windowStart: now });
    return true;
  }
  if (bucket.count >= ERROR_BURST) return false;
  bucket.count += 1;
  return true;
}

/**
 * Public, unauthenticated error sink for the published iframe sandbox.
 *
 * The iframe is sandboxed without `allow-same-origin`, so it runs at an
 * opaque origin. It can still POST same-host URLs — we accept the report
 * over `text/plain` (CORS-safe content type so no preflight is needed) and
 * parse the JSON ourselves.
 *
 * The sandbox cannot read AppForge cookies/sessions, so this endpoint is
 * unauthenticated by design. The slug is the app's public identity. We
 * rate-limit per slug to defend against runaway error loops.
 */
router.post(
  "/p/:slug/_error",
  express.text({ type: "*/*", limit: "16kb" }),
  async (req: Request, res: Response) => {
    const rawSlug = req.params.slug;
    const slug = Array.isArray(rawSlug) ? rawSlug[0] : rawSlug;
    if (!slug || typeof slug !== "string" || !SLUG_PATTERN.test(slug)) {
      // Always return 204 even on bad input — the iframe is fire-and-forget
      // and shouldn't be retrying based on response codes.
      res.status(204).end();
      return;
    }
    if (!consumeErrorToken(slug)) {
      res.status(204).end();
      return;
    }
    let payload: Record<string, unknown> = {};
    try {
      const body = typeof req.body === "string" ? req.body : "";
      if (body) {
        const parsed = JSON.parse(body);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          payload = parsed as Record<string, unknown>;
        }
      }
    } catch {
      // Malformed body — ignore silently. Always 204 so the sandbox doesn't
      // retry or surface a network error in its console.
      res.status(204).end();
      return;
    }
    const message = trimField(payload.message, 1000) ?? "(sin mensaje)";
    // Reject dummy/no-op messages we generate ourselves to avoid noise.
    if (message === "Script error.") {
      res.status(204).end();
      return;
    }
    const kindRaw = trimField(payload.kind, 32) ?? "error";
    const kind = kindRaw === "unhandledrejection" ? "unhandledrejection" : "error";
    const stack = trimField(payload.stack, 4000);
    const source = trimField(payload.source, 500);
    const lineno = trimLine(payload.lineno);
    const colno = trimLine(payload.colno);
    const pathname = trimField(payload.pathname, 500);
    const userAgent = trimField(req.headers["user-agent"], 500);
    try {
      // Look up the app id with a single targeted query rather than fetching
      // the whole row — this endpoint is on the hot path for broken apps and
      // we don't want to pay for `frontend_code` (potentially MBs) just to
      // record an error.
      const [app] = await db
        .select({ id: generatedApps.id })
        .from(generatedApps)
        .where(eq(generatedApps.publicSlug, slug))
        .limit(1);
      if (!app) {
        res.status(204).end();
        return;
      }
      await db.insert(appRuntimeErrors).values({
        appId: app.id,
        kind,
        message,
        source,
        lineno,
        colno,
        stack,
        userAgent,
        pathname,
      });
      // Cap the table per-app at 200 most-recent rows: deletes everything
      // older than the newest 200 by id. Keeps storage bounded for long-lived
      // broken apps without losing the most relevant recent context.
      await db.execute(sql`
        DELETE FROM ${appRuntimeErrors}
         WHERE app_id = ${app.id}
           AND id NOT IN (
             SELECT id FROM ${appRuntimeErrors}
              WHERE app_id = ${app.id}
              ORDER BY id DESC
              LIMIT 200
           )
      `);
    } catch (err) {
      req.log.error({ err, slug }, "Failed to record runtime error");
    }
    res.status(204).end();
  },
);

/**
 * Public, unauthenticated view of a deployed app.
 *
 * This router is mounted at the application root (NOT under /api) so that the
 * URL the user shares — e.g. https://my.repl.co/p/abc123 — works for anyone
 * with the link. We rebuild the HTML on every request rather than caching it
 * in the DB, so re-deploying after an edit is automatic.
 */
// Inner-frame route: serves the bundled user app HTML directly. Loaded as
// the `src` of the sandboxed iframe in the wrapper at /p/:slug. Using a real
// URL (instead of `srcdoc`) lets the routing shim call
// `history.replaceState('/')` so SPA routers see the home pathname. Sandbox
// without `allow-same-origin` keeps the iframe at an opaque origin so it
// cannot read AppForge cookies even though it's served from the same domain.
router.get("/p/:slug/_inner", async (req: Request, res: Response) => {
  const rawSlug = req.params.slug;
  const slug = Array.isArray(rawSlug) ? rawSlug[0] : rawSlug;
  if (!slug || typeof slug !== "string" || !SLUG_PATTERN.test(slug)) {
    res.status(404).type("text/plain").send("Not found");
    return;
  }
  const [row] = await db
    .select()
    .from(generatedApps)
    .where(eq(generatedApps.publicSlug, slug))
    .limit(1);
  if (!row) {
    res.status(404).type("text/plain").send("No publicada.");
    return;
  }
  try {
    const innerHtml = await buildDeployHtml({
      bundle: row.frontendCode,
      title: row.title,
      slug,
    });
    res.setHeader("Cache-Control", "no-store, max-age=0");
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    // Defense-in-depth CSP. Even though sandboxing is the hard isolation
    // boundary, we lock down what the AI-generated bundle can do at the HTTP
    // level too. Must permit:
    //   * inline `<script>` (the routing shim and the user bundle)
    //   * `unsafe-eval` (esm.sh dynamic imports + Tailwind Play CDN)
    //   * https: scripts/styles/fonts/connections (esm.sh, Tailwind CDN, etc.)
    //   * any image/font/XHR origin the user app may need
    res.setHeader(
      "Content-Security-Policy",
      [
        "default-src 'self' https: data: blob:",
        "script-src 'unsafe-inline' 'unsafe-eval' https:",
        "style-src 'unsafe-inline' https:",
        "font-src https: data:",
        "img-src 'self' https: data: blob:",
        "connect-src https:",
        "frame-src 'self' data: blob:",
        "child-src 'self' data: blob:",
      ].join("; "),
    );
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.send(innerHtml);
  } catch (err) {
    req.log.error({ err, slug }, "inner build failed");
    res.status(500).type("text/plain").send(String(err));
  }
});

router.get("/p/:slug", async (req: Request, res: Response) => {
  // `req.params.slug` is typed as `string | string[]` under the generic
  // Express types we re-use across routes. The route literal `/p/:slug` only
  // ever populates a single string, but we coerce defensively rather than
  // cast away the union.
  const rawSlug = req.params.slug;
  const slug = Array.isArray(rawSlug) ? rawSlug[0] : rawSlug;
  // Strict charset check: only the exact 10-char [a-z0-9] format produced by
  // makeSlug is acceptable. This rejects scanner traffic and prevents any
  // unexpected SQL parameter shapes from reaching the lookup.
  if (!slug || typeof slug !== "string" || !SLUG_PATTERN.test(slug)) {
    res.status(404).type("text/plain").send("Not found");
    return;
  }
  const [row] = await db
    .select()
    .from(generatedApps)
    .where(eq(generatedApps.publicSlug, slug))
    .limit(1);
  if (!row) {
    res.status(404).type("text/plain").send("Esta app no existe o ya no está publicada.");
    return;
  }
  try {
    // SECURITY: the generated app is untrusted, AI-written JavaScript and we
    // host it on the same domain as our authenticated /api routes. If we
    // served the inner HTML directly at /p/:slug, a malicious bundle could
    // `fetch('/api/...')` with the visitor's session cookies and exfiltrate
    // their data.
    //
    // Mitigation: serve a tiny wrapper at /p/:slug whose only content is a
    // top-level sandboxed iframe pointed at /p/:slug/_inner. Without
    // `allow-same-origin`, the iframe runs in an opaque origin: no access to
    // AppForge cookies/localStorage, and same-origin fetches are not
    // credentialed. We use `src=` (not `srcdoc=`) so the iframe has a real
    // document URL that the routing shim can `history.replaceState` to "/" —
    // routers like wouter/react-router then match the home route. With
    // `srcdoc`, location.pathname returns "srcdoc" and the prototype getter
    // is bypassed by the browser's host-object internal slots, leaving the
    // app rendering only its layout chrome (blank middle).
    const safeTitle = (row.title || "AppForge App").replace(/[<&>]/g, "");
    const innerUrl = `/p/${encodeURIComponent(slug)}/_inner`;
    const wrapper = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${safeTitle}</title>
  <style>html,body{margin:0;padding:0;height:100%;background:#fff;}iframe{border:0;width:100vw;height:100vh;display:block;}</style>
</head>
<body>
  <iframe sandbox="allow-scripts" referrerpolicy="no-referrer" src="${innerUrl}"></iframe>
</body>
</html>`;
    res.setHeader("Cache-Control", "no-store, max-age=0");
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    // CSP notes:
    //   * The wrapper document itself has no scripts — only the sandboxed
    //     iframe loaded via `srcdoc`. The wrapper's <style> is inline so we
    //     allow `'unsafe-inline'` for styles.
    //   * `srcdoc` iframes inherit CSP from the parent in modern browsers, so
    //     this CSP must also permit everything the user's bundle needs to
    //     run: an inline `<script type="module">` (the bundle), Tailwind from
    //     cdn.tailwindcss.com, modules from esm.sh, and any image/font/XHR
    //     traffic those modules trigger.
    //   * Loosening these directives is safe because the iframe runs sandboxed
    //     WITHOUT `allow-same-origin`, so it has an opaque origin and cannot
    //     read AppForge cookies, localStorage, or make credentialed requests
    //     against /api. The hard isolation boundary is sandboxing, not CSP.
    res.setHeader(
      "Content-Security-Policy",
      [
        "default-src 'self' https: data: blob:",
        "script-src 'unsafe-inline' 'unsafe-eval' https:",
        "style-src 'unsafe-inline' https:",
        "font-src https: data:",
        "img-src 'self' https: data: blob:",
        "connect-src https:",
        "frame-src 'self' data: blob:",
        "child-src 'self' data: blob:",
      ].join("; "),
    );
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.send(wrapper);
  } catch (err) {
    req.log.error({ err, slug }, "Public deploy build failed");
    res
      .status(500)
      .type("text/plain")
      .send("No pudimos construir esta app. Vuelve a publicarla desde el panel.");
  }
});

export default router;
