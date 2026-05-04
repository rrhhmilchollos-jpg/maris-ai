import express, { Router, type IRouter, type Request, type Response } from "express";
import { GeneratedApp, AppRuntimeError } from "@workspace/db/schema";
import { buildDeployHtml, SLUG_PATTERN } from "../lib/deployBundle";
import { connectDB } from "../lib/db";

const router: IRouter = Router();

function trimField(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  if (!t) return null;
  return t.length > max ? t.slice(0, max) : t;
}

function trimLine(v: unknown): number | null {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n) || n <= 0 || n > 1e7) return null;
  return Math.floor(n);
}

const ERROR_BURST = 20;
const ERROR_WINDOW_MS = 60_000;
type RateEntry = { count: number; windowStart: number };
const rateBuckets = new Map<string, RateEntry>();

function consumeErrorToken(slug: string): boolean {
  const now = Date.now();
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
      const app = await GeneratedApp.findOne({ publicSlug: slug }).select("_id").lean();
      if (!app) {
        res.status(204).end();
        return;
      }
      await AppRuntimeError.create({
        appId: app._id,
        kind,
        message,
        source,
        lineno,
        colno,
        stack,
        userAgent,
        pathname,
      });
      const count = await AppRuntimeError.countDocuments({ appId: app._id });
      if (count > 200) {
        const oldest = await AppRuntimeError.find({ appId: app._id })
          .sort({ createdAt: 1 })
          .limit(count - 200)
          .select("_id");
        await AppRuntimeError.deleteMany({ _id: { $in: oldest.map((e) => e._id) } });
      }
    } catch (err) {
      req.log.error({ err, slug }, "Failed to record runtime error");
    }
    res.status(204).end();
  },
);

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
  <iframe sandbox="allow-scripts" referrerpolicy="no-referrer" src="${innerUrl}"></iframe>
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
        "frame-src 'self' data: blob:",
        "child-src 'self' data: blob:",
      ].join("; "),
    );
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.send(wrapper);
  } catch (err) {
    req.log.error({ err, slug }, "Public deploy build failed");
    res.status(500).type("text/plain").send("No pudimos construir esta app.");
  }
});

export default router;
