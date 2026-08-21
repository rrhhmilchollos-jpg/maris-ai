import { Router, type Request, type Response } from "express";
import { logger } from "../lib/logger";

const router = Router();
const targetBase = (process.env.SPAX_AUTH_INTERNAL_URL || "http://spax-auth:3101").replace(/\/$/, "");
const passHeaders = ["authorization", "content-type", "accept", "x-requested-with"];

function targetUrl(req: Request): string {
  const suffix = req.originalUrl.replace(/^\/api\/spax-auth/, "") || "/";
  return `${targetBase}${suffix.startsWith("/") ? suffix : `/${suffix}`}`;
}

router.use(async (req: Request, res: Response) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    // La vista previa usa un iframe con origen opaco. Solo recursos publicados
    // y el alta pública de colaboración requieren esta excepción de CORS; las
    // rutas autenticadas siguen sin recibirla.
    const isPublicResourcesRead = req.method === "GET" && ["/resources", "/animals"].includes(req.path);
    const isPublicCollaborationPath = req.path === "/collaboration-requests";
    const isPublicCollaborationRequest = req.method === "POST" && isPublicCollaborationPath;
    const isPublicCollaborationPreflight = req.method === "OPTIONS" && isPublicCollaborationPath;
    if ((isPublicResourcesRead || isPublicCollaborationRequest || isPublicCollaborationPreflight) && req.headers.origin === "null") {
      res.setHeader("Access-Control-Allow-Origin", "null");
      res.setHeader("Vary", "Origin");
    }
    if (isPublicCollaborationPreflight && req.headers.origin === "null") {
      res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type");
      return res.status(204).send();
    }
    const headers = new Headers();
    for (const name of passHeaders) {
      const value = req.headers[name];
      if (typeof value === "string") headers.set(name, value);
    }
    headers.set("x-forwarded-for", req.ip || "");
    headers.set("x-forwarded-proto", req.protocol || "https");

    const method = req.method.toUpperCase();
    const body = method === "GET" || method === "HEAD" ? undefined : JSON.stringify(req.body ?? {});
    if (body && !headers.has("content-type")) headers.set("content-type", "application/json");

    const upstream = await fetch(targetUrl(req), { method, headers, body, signal: controller.signal });
    const payload = Buffer.from(await upstream.arrayBuffer());
    const contentType = upstream.headers.get("content-type");
    const retryAfter = upstream.headers.get("retry-after");
    if (contentType) res.setHeader("content-type", contentType);
    if (retryAfter) res.setHeader("retry-after", retryAfter);
    res.setHeader("cache-control", "no-store");
    return res.status(upstream.status).send(payload);
  } catch (error) {
    logger.error({ err: error, path: req.originalUrl }, "SPAX auth proxy unavailable");
    return res.status(503).json({ error: "spax_auth_unavailable" });
  } finally {
    clearTimeout(timer);
  }
});

export default router;
