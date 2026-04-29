import { Router, type IRouter, type Request, type Response } from "express";
import { eq } from "drizzle-orm";
import { db } from "../lib/db";
import { generatedApps } from "@workspace/db/schema";
import { buildDeployHtml, SLUG_PATTERN } from "../lib/deployBundle";

const router: IRouter = Router();

/**
 * Public, unauthenticated view of a deployed app.
 *
 * This router is mounted at the application root (NOT under /api) so that the
 * URL the user shares — e.g. https://my.repl.co/p/abc123 — works for anyone
 * with the link. We rebuild the HTML on every request rather than caching it
 * in the DB, so re-deploying after an edit is automatic.
 */
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
    const innerHtml = await buildDeployHtml({
      bundle: row.frontendCode,
      title: row.title,
    });
    // SECURITY: the generated app is untrusted, AI-written JavaScript and we
    // host it on the same domain as our authenticated /api routes. If we
    // served `innerHtml` directly, a malicious bundle could `fetch('/api/...')`
    // with the visitor's session cookies and exfiltrate their data.
    //
    // Mitigation: wrap the page in a top-level sandboxed iframe loaded via
    // `srcdoc`. Without `allow-same-origin`, the iframe runs in an opaque
    // origin: no access to AppForge cookies/localStorage, and same-origin
    // fetches are not credentialed. We also send a strict CSP on the outer
    // wrapper as defense-in-depth (no scripts at all on the wrapper itself).
    const safeTitle = (row.title || "AppForge App").replace(/[<&>]/g, "");
    // Escape the HTML for safe embedding inside a srcdoc attribute. Quotes
    // must become &quot; so the attribute parser doesn't terminate early.
    const srcdocEscaped = innerHtml
      .replace(/&/g, "&amp;")
      .replace(/"/g, "&quot;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
    const wrapper = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${safeTitle}</title>
  <style>html,body{margin:0;padding:0;height:100%;background:#fff;}iframe{border:0;width:100vw;height:100vh;display:block;}</style>
</head>
<body>
  <iframe sandbox="allow-scripts" referrerpolicy="no-referrer" srcdoc="${srcdocEscaped}"></iframe>
</body>
</html>`;
    res.setHeader("Cache-Control", "no-store, max-age=0");
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    // Block any inline/external script on the wrapper itself; only the
    // iframe's sandboxed inner doc may execute code.
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'none'; frame-src data: blob: 'self'; style-src 'unsafe-inline'; img-src data:; child-src 'self'",
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
