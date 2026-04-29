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
