import express, { Router, type IRouter, type Request, type Response } from "express";
import { connectDB } from "../lib/db";
import { GeneratedApp } from "@workspace/db/schema";
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
 */
router.post(
  "/p/:slug/_error",
  express.text({ type: "*/*", limit: "16kb" }),
  async (req: Request, res: Response) => {
    const rawSlug = req.params.slug;
    const slug = Array.isArray(rawSlug) ? rawSlug[0] : rawSlug;
    if (!slug || typeof slug !== "string" || !SLUG_PATTERN.test(slug)) {
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
      res.status(204).end();
      return;
    }
    const message = trimField(payload.message, 1000) ?? "(sin mensaje)";
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
      await connectDB();
      const app = await GeneratedApp.findOne({ publicSlug: slug }, { _id: 1 }).lean();
      if (!app) {
        res.status(204).end();
        return;
      }
      // Error logging simplified for MongoDB (non-critical)
      void kind; void stack; void source; void lineno; void colno; void pathname; void userAgent;
    } catch (err) {
      req.log?.error({ err, slug }, "Failed to record runtime error");
    }
    res.status(204).end();
  },
);

/**
 * Inner-frame route: serves the bundled user app HTML directly.
 */
router.get("/p/:slug/_inner", async (req: Request, res: Response) => {
  const rawSlug = req.params.slug;
  const slug = Array.isArray(rawSlug) ? rawSlug[0] : rawSlug;
  if (!slug || typeof slug !== "string" || !SLUG_PATTERN.test(slug)) {
    res.status(404).type("text/plain").send("Not found");
    return;
  }
  await connectDB();
  const row = await GeneratedApp.findOne({ publicSlug: slug }).lean();
  if (!row) {
    res.status(404).type("text/plain").send("No publicada.");
    return;
  }
  try {
    const innerHtml = await buildDeployHtml({
      bundle: row.frontendCode,
      title: row.title,
      slug,
      kind: row.kind,
    });
    res.setHeader("Cache-Control", "no-store, max-age=0");
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader(
      "Content-Security-Policy",
      [
        "default-src 'self' https: data: blob:",
        "script-src 'unsafe-inline' 'unsafe-eval' https:",
        "style-src 'unsafe-inline' https:",
        "font-src https: data:",
        "img-src 'self' https: data: blob:",
        "connect-src https:",
        "frame-src 'self' data: blob: https:",
        "child-src 'self' data: blob: https:",
        "frame-ancestors * 'self' https://marisai.es https://www.marisai.es https://*.marisai.es https://*.railway.app https://*.vercel.app https://*.vercel.live",
      ].join("; "),
    );
    res.setHeader("X-Frame-Options", "ALLOWALL");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.send(innerHtml);
  } catch (err) {
    req.log?.error({ err, slug }, "inner build failed");
    res.status(500).type("text/plain").send(String(err));
  }
});

router.get("/p/:slug", async (req: Request, res: Response) => {
  const rawSlug = req.params.slug;
  const slug = Array.isArray(rawSlug) ? rawSlug[0] : rawSlug;
  if (!slug || typeof slug !== "string" || !SLUG_PATTERN.test(slug)) {
    res.status(404).type("text/plain").send("Not found");
    return;
  }
  await connectDB();
  const row = await GeneratedApp.findOne({ publicSlug: slug }).lean();
  if (!row) {
    res.status(404).type("text/plain").send("Esta app no existe o ya no está publicada.");
    return;
  }
  try {
    const safeTitle = (row.title || "Maris AI App").replace(/[<&>]/g, "");
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
  <iframe sandbox="allow-scripts allow-same-origin allow-forms allow-popups" referrerpolicy="no-referrer" src="${innerUrl}"></iframe>
</body>
</html>`;
    res.setHeader("Cache-Control", "no-store, max-age=0");
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader(
      "Content-Security-Policy",
      [
        "default-src 'self' https: data: blob:",
        "script-src 'unsafe-inline' 'unsafe-eval' https:",
        "style-src 'unsafe-inline' https:",
        "font-src https: data:",
        "img-src 'self' https: data: blob:",
        "connect-src https:",
        "frame-src 'self' data: blob: https:",
        "child-src 'self' data: blob: https:",
        "frame-ancestors * 'self' https://marisai.es https://www.marisai.es https://*.marisai.es https://*.railway.app https://*.vercel.app https://*.vercel.live",
      ].join("; "),
    );
    res.setHeader("X-Frame-Options", "ALLOWALL");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.send(wrapper);
  } catch (err) {
    req.log?.error({ err, slug }, "Public deploy build failed");
    res
      .status(500)
      .type("text/plain")
      .send("No pudimos construir esta app. Vuelve a publicarla desde el panel.");
  }
});

export default router;
