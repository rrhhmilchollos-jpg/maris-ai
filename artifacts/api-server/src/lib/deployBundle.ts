import * as esbuild from "esbuild";
import { randomInt } from "node:crypto";
import { bundleToFiles } from "./exportZip";
import { isStaticHtmlBundle } from "@workspace/bundle-format";
import { injectWatermarkToHTML } from "./watermark";
import { resolveDynamicPins } from "./dynamicPinning";
import { logger } from "./logger";
import { buildSeoGeoMetadata, seoHeadTags, type SeoGeoMetadata } from "./seoGeoOptimizer";

/**
 * Bundles the generated frontend into a single self-contained HTML page that
 * loads React + the user's Tailwind config and runs without any build step.
 *
 * Strategy:
 *   1. Parse the '// === FILE:' bundle into a virtual filesystem.
 *   2. Pick an entry (src/main.tsx → src/index.tsx → src/App.tsx).
 *   3. Run esbuild in-memory: bundle TSX/TS, externalize bare imports so we can
 *      satisfy them via an esm.sh import map at runtime.
 *   4. Wrap the bundle in HTML with Tailwind CDN + import map.
 *
 * Returns the HTML string. Throws if the bundle has no usable entry or fails
 * to compile.
 */
export async function buildDeployHtml(opts: {
  bundle: string;
  title: string;
  /**
   * Public slug of the deployed app. Used by the in-page error reporter to
   * POST captured runtime errors to `/p/<slug>/_error` so the owner can see
   * them in the panel. Optional — when absent (e.g. the validate/visualTester
   * pipelines that build a throwaway HTML), the reporter is a no-op.
   */
  slug?: string;
  /**
   * Project kind. Non-JS kinds (python-api, django) cannot be bundled with
   * esbuild — we serve a static informational landing card instead, with
   * instructions for running the project locally and the canonical export
   * paths (ZIP / GitHub / Vercel).
   */
  kind?: string | null;
  /**
   * Si es true, inyecta la marca de agua "Hecho con Maris AI" (con enlace
   * real a marisai.es) antes de </body>. ENCONTRADO: todo el sistema de
   * watermark.ts (CSS, HTML, lógica shouldHaveWatermark) existía completo
   * y bien construido, pero injectWatermarkToHTML nunca se llamaba desde
   * ningún punto real del flujo de deploy — ninguna app generada, de
   * ningún cliente, mostraba nunca la marca de agua ni generaba el
   * backlink real a marisai.es que se pretendía con este sistema.
   */
  hasWatermark?: boolean;
  /** URL a la que apunta el botón "Eliminar" del watermark (página de pago). */
  removeWatermarkUrl?: string;
  /** SEO+GEO calculado automáticamente para la página final. */
  seoMetadata?: SeoGeoMetadata;
}): Promise<string> {
  if (isNonJsKindLocal(opts.kind)) {
    return buildNonJsLandingHtml({
      bundle: opts.bundle,
      title: opts.title,
      kind: opts.kind ?? "",
    });
  }

  // ENCONTRADO CON DATOS REALES (a petición del usuario: import de un HTML
  // estático puro -- FANTASYWEB-maris-ai.zip, solo un index.html, sin
  // src/App.tsx ni nada de React -- mostraba una vista previa en blanco
  // total, sin ningún error visible). Causa: pickEntry() más abajo exige
  // encontrar src/main.tsx, src/index.tsx o src/App.tsx -- un HTML
  // completo y autocontenido (con su propio <html>/<head>/<style>/
  // <script>, típico de proyectos importados que no son React) no tiene
  // ninguno de esos archivos, pickEntry devuelve null, y la función
  // lanzaba un error que se perdía en silencio antes de llegar al
  // iframe -- de ahí la pantalla en blanco sin explicación.
  //
  // FIX: si el bundle es un proyecto HTML estático (con o sin CSS/JS
  // aparte -- ya no exige que sea un único archivo, esa versión antigua
  // se sustituyó por la comprobación compartida con validate.ts y el
  // resto del proyecto, vía @workspace/bundle-format), se sirve
  // directamente el index.html real, sin pasar por esbuild -- no hace
  // falta "compilar" nada que el navegador ya sabe interpretar.
  const rawVfs = bundleToFiles(opts.bundle);
  if (isStaticHtmlBundle(rawVfs)) {
    const htmlContent = rawVfs["index.html"];
    if (/^\s*<!DOCTYPE html>|^\s*<html[\s>]/i.test(htmlContent)) {
      logger.info({ title: opts.title }, "buildDeployHtml: bundle es un proyecto HTML estático -- sirviendo index.html directamente sin esbuild");
      const seo = opts.seoMetadata || buildSeoGeoMetadata({ title: opts.title, publicSlug: opts.slug });
      const withSeo = htmlContent.replace(/<head([^>]*)>/i, (_match, attrs) => `<head${attrs}>\n  ${seoHeadTags(seo)}`);
      return opts.hasWatermark ? injectWatermarkToHTML(withSeo, undefined, opts.removeWatermarkUrl) : withSeo;
    }
  }

  const vfs = bundleToFiles(opts.bundle);
  const entry = pickEntry(vfs);
  if (!entry) {
    throw new Error(
      "El bundle no contiene un punto de entrada (src/main.tsx, src/index.tsx o src/App.tsx).",
    );
  }

  // Collect bare-import package names so we can build an import map. Tailwind
  // is provided via CDN so it's filtered out below; everything else gets a
  // pinned esm.sh URL.
  const externals = new Set<string>();
  // Collect CSS contents from any `import './foo.css'` statements. esbuild
  // can't emit CSS in `write: false` mode without an outdir, so we intercept
  // CSS files in the loader, return a JS no-op for the import, and inject the
  // raw CSS into the deployed HTML head as a `<style>` tag. This preserves
  // styles in the deployed page without needing a separate CSS bundle.
  const collectedCss: string[] = [];

  // Compilar con retry automático — repara archivos truncados uno por uno hasta 10 intentos
  let result: esbuild.BuildResult | null = null;
  const repairedFiles = new Set<string>();

  for (let _attempt = 0; _attempt <= 10; _attempt++) {
    try {
      result = await esbuild.build({
        entryPoints: [entry],
        bundle: true,
        write: false,
        format: "esm",
        target: ["es2020"],
        jsx: "automatic",
        jsxImportSource: "react",
        logLevel: "silent",
        plugins: [virtualFsPlugin(vfs, externals, collectedCss)],
      });
      break; // éxito
    } catch (err: any) {
      const errMsg = String(err?.message || err);
      // Detectar archivo roto por nombre en el error
      const m = errMsg.match(/vfs:(src\/[^:]+\.[tj]sx?)/);
      if (m && !repairedFiles.has(m[1])) {
        const brokenFile = m[1];
        repairedFiles.add(brokenFile);
        const name = brokenFile.split("/").pop()?.replace(/\..*$/, "") || "Stub";
        const safeName = name.replace(/[^a-zA-Z0-9_$]/g, "_");
        vfs[brokenFile] = `// stub — archivo truncado\nexport default function ${safeName}() { return null; }\n`;
        continue;
      }
      throw err;
    }
  }
  if (!result) throw new Error("No se pudo compilar el bundle.");

  const code = result.outputFiles?.[0]?.text ?? "";
  if (!code.trim()) {
    throw new Error("El bundler no produjo código.");
  }

  // Resolve which version to load from esm.sh for every external dependency.
  //
  // The AI-generated bundle ships its own `package.json` listing the libs the
  // app imports. We trust that file as the source of truth for versions: a
  // user who deploys today gets the exact versions the AI picked today, and
  // future upstream releases (compatible or breaking) cannot change the
  // deployed page after the fact. This is what protects published apps from
  // silently breaking when, e.g., `lucide-react@0.488` drops the `Facebook`
  // icon a week after deploy.
  //
  // For packages absent from the user's `package.json` (older bundles that
  // never listed deps, or AI hallucinations) we fall back to a curated map of
  // known-good versions for the libs the system prompt tells the model to use.
  // As a last resort we let esm.sh resolve "latest" — risky, but better than
  // failing the deploy outright on an obscure import.
  const userVersions = extractPackageVersions(vfs);
  const reactVersion = resolveVersion("react", userVersions) ?? DEFAULT_VERSIONS.react;
  const reactDomVersion =
    resolveVersion("react-dom", userVersions) ?? DEFAULT_VERSIONS["react-dom"];
  const imports: Record<string, string> = {
    react: `https://esm.sh/react@${reactVersion}`,
    "react/": `https://esm.sh/react@${reactVersion}/`,
    "react-dom": `https://esm.sh/react-dom@${reactDomVersion}`,
    "react-dom/": `https://esm.sh/react-dom@${reactDomVersion}/`,
    "react-dom/client": `https://esm.sh/react-dom@${reactDomVersion}/client`,
  };
  // Auto-pinning dinámico: para los externals que NO resuelven ni por el
  // package.json del bundle ni por DEFAULT_VERSIONS, en vez de dejar que
  // esm.sh resuelva "latest" sin garantía (causa histórica de previews
  // colgados), se resuelven contra registry.npmjs.org + smoke test contra
  // esm.sh, y el pin verificado se persiste en MongoDB (pinned_packages)
  // para que la próxima app que use ese paquete resuelva al instante.
  // Fail-soft: si la resolución dinámica no garantiza nada, se mantiene el
  // comportamiento clásico (import sin versión) — nunca se rompe un deploy
  // que antes funcionaba.
  const unpinnedNames = [...externals]
    .filter((pkg) => !pkg.startsWith("react/") && pkg !== "react")
    .filter((pkg) => !pkg.startsWith("react-dom/") && pkg !== "react-dom")
    .map((pkg) => packageName(pkg))
    .filter((name) => !resolveVersion(name, userVersions) && !DEFAULT_VERSIONS[name]);
  const dynamicPins =
    unpinnedNames.length > 0 ? await resolveDynamicPins(unpinnedNames) : {};

  for (const pkg of externals) {
    if (pkg === "react" || pkg.startsWith("react/")) continue;
    if (pkg === "react-dom" || pkg.startsWith("react-dom/")) continue;
    if (imports[pkg]) continue;
    // Look up the version under the *package* name (e.g. `@react-three/fiber`),
    // not the full specifier which may include a subpath (`lucide-react/icons`).
    const name = packageName(pkg);
    const subpath = pkg.slice(name.length); // "" or "/sub/path"
    const version =
      resolveVersion(name, userVersions) ??
      DEFAULT_VERSIONS[name] ??
      dynamicPins[name];
    // The version goes between the package name and the subpath, never after
    // the subpath: esm.sh URLs are `name@version/subpath`, not
    // `name/subpath@version` (which 404s).
    const target = version ? `${name}@${version}${subpath}` : pkg;
    // ?external=react so esm.sh resolves peer deps against our import-map
    // react instead of bundling its own copy (which would break hooks).
    imports[pkg] = `https://esm.sh/${target}?external=react,react-dom`;
  }

  const safeTitle = (opts.title || "Maris AI App").replace(/[<&>]/g, "");
  const seo = opts.seoMetadata || buildSeoGeoMetadata({ title: opts.title, publicSlug: opts.slug });

  // Inline the user-authored CSS captured during bundling. We escape any
  // `</style>` sequences inside the CSS so they can't terminate the parent
  // `<style>` tag and inject markup into the page.
  const userCss = collectedCss
    .join("\n")
    .replace(/<\/(style)/gi, "<\\/$1");
  const userStyleTag = userCss.trim()
    ? `\n  <style data-appforge-user-css>${userCss}</style>`
    : "";

  // Routing shim: AI-generated apps invariably declare routes like `/`,
  // `/buscar`, `/producto/:id` assuming they're mounted at the site root.
  // But we serve them inside an `srcdoc` sandbox iframe whose URL is
  // `about:srcdoc` — `location.pathname` is empty and `history.replaceState`
  // is silently blocked by Chrome/Firefox on opaque origins. Without
  // normalization, routers such as `wouter` and `react-router` see no match
  // and render their catch-all 404 — the page looks blank between the
  // always-rendered navbar and footer.
  //
  // We solve this by intercepting `Location.prototype.pathname` so it always
  // returns the in-memory "virtual" pathname starting at "/". We also patch
  // `pushState`/`replaceState` to update the virtual pathname (so SPA links
  // still work) and emit a `popstate` so router subscribers re-render.
  // `location.search` and `location.hash` remain pass-through — only
  // `pathname` is virtualized.
  // The slug is templated into the shim so the in-page error reporter can
  // POST to the correct sink. We also derive the report endpoint defensively
  // at runtime from `location.pathname` (`/p/<slug>/_inner`) in case the
  // slug isn't passed (older codepaths) or doesn't match. Both are stripped
  // of any HTML-relevant chars below before being baked into the script tag.
  const safeSlug = JSON.stringify((opts.slug || "").replace(/[^a-z0-9]/gi, ""));
  const routerShim = `(function(){
  // Friendly fallback overlay shown to visitors when the bundle throws
  // during initial render. Without this, a runtime error would leave the
  // iframe stuck on a fully blank page with no clue what happened — exactly
  // the symptom we were trying to surface to users. We only inject it once
  // (ten seconds after load if #root never gained children, or immediately
  // when an error fires before the first paint).
  function showFatalOverlay(detail){
    try {
      if (document.getElementById("__appforge_fatal__")) return;
      var root = document.getElementById("root");
      // If the app already mounted real DOM, leave it alone — a non-fatal
      // error after first paint shouldn't replace a working UI.
      if (root && root.firstElementChild && root.children.length > 0) return;
      var box = document.createElement("div");
      box.id = "__appforge_fatal__";
      box.style.cssText = "position:fixed;inset:0;display:flex;align-items:center;justify-content:center;padding:24px;font-family:ui-sans-serif,system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;background:#0b0d12;color:#e6e8ee;z-index:2147483647;";
      var card = document.createElement("div");
      card.style.cssText = "max-width:520px;text-align:center;background:#11141b;border:1px solid #1f2430;border-radius:16px;padding:28px 28px 24px;box-shadow:0 20px 60px rgba(0,0,0,0.4);";
      var title = document.createElement("div");
      title.textContent = "Esta app no se cargó correctamente";
      title.style.cssText = "font-size:18px;font-weight:600;margin-bottom:8px;";
      var msg = document.createElement("div");
      msg.textContent = "Hubo un error al ejecutarse en tu navegador. El propietario ya recibió el aviso y puede regenerarla desde su panel.";
      msg.style.cssText = "font-size:14px;line-height:1.5;color:#a4abbb;margin-bottom:18px;";
      var detailEl = document.createElement("div");
      detailEl.textContent = detail || "";
      detailEl.style.cssText = "font-size:11px;color:#6b7185;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;word-break:break-word;background:#0b0d12;border:1px solid #1f2430;border-radius:8px;padding:10px;text-align:left;max-height:160px;overflow:auto;display:" + (detail ? "block" : "none") + ";";
      card.appendChild(title);
      card.appendChild(msg);
      if (detail) card.appendChild(detailEl);
      box.appendChild(card);
      document.body.appendChild(box);
      // Avisa a la ventana padre (el editor de Maris AI) de que la preview
      // no renderizó nada, para que pueda disparar una auto-reparación.
      // En apps desplegadas (/p/<slug>, sin iframe padre) esto es un no-op
      // inofensivo: window.parent === window y nadie escucha el mensaje.
      try {
        window.parent.postMessage({ __marisPreview: true, type: "fatal-error", detail: detail || "" }, "*");
      } catch (e) {}
    } catch (e) { /* ignore — we tried */ }
  }

  // POST a captured error back to /p/<slug>/_error. Uses sendBeacon when
  // available so reports survive a page navigation, falls back to fetch with
  // keepalive. Both flows use a CORS-safe content type (text/plain) so no
  // preflight is needed from the opaque-origin sandbox.
  var SLUG = ${safeSlug};
  if (!SLUG) {
    try {
      var m = (window.location.pathname || "").match(/^\\/p\\/([a-z0-9]{10})(?:\\/|$)/);
      if (m) SLUG = m[1];
    } catch (e) {}
  }
  var reportedCount = 0;
  var REPORT_CAP = 10; // hard cap per page-load to avoid loops.
  function reportError(payload) {
    if (!SLUG || reportedCount >= REPORT_CAP) return;
    reportedCount++;
    try {
      var body = JSON.stringify(payload);
      var url = "/p/" + SLUG + "/_error";
      if (navigator.sendBeacon) {
        var blob = new Blob([body], { type: "text/plain;charset=utf-8" });
        if (navigator.sendBeacon(url, blob)) return;
      }
      fetch(url, {
        method: "POST",
        body: body,
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        keepalive: true,
        mode: "cors",
        credentials: "omit",
      }).catch(function(){});
    } catch (e) {}
  }

  try {
    var virtualPath = "/";
    var origPush = window.history.pushState.bind(window.history);
    var origReplace = window.history.replaceState.bind(window.history);
    function extractPath(url) {
      if (typeof url !== "string") return null;
      try {
        // Resolve against current virtual location, then take pathname.
        var u = new URL(url, "http://_appforge_/" + (virtualPath.replace(/^\\//, "")));
        return u.pathname + u.search + u.hash;
      } catch (e) { return null; }
    }
    function setPath(url) {
      var p = extractPath(url);
      if (p) virtualPath = p.split(/[?#]/)[0] || "/";
    }
    window.history.pushState = function(state, title, url) {
      setPath(url);
      try { origPush(state, title, url); } catch (e) {}
      window.dispatchEvent(new PopStateEvent("popstate", { state: state }));
    };
    window.history.replaceState = function(state, title, url) {
      setPath(url);
      try { origReplace(state, title, url); } catch (e) {}
      window.dispatchEvent(new PopStateEvent("popstate", { state: state }));
    };
    // Keep virtualPath aligned with native back/forward navigation. Without
    // this, after the user clicks "back", virtualPath would still hold the
    // previous (now stale) location, breaking relative-link resolution.
    window.addEventListener("popstate", function(){
      try {
        var np = window.location.pathname;
        if (typeof np === "string" && np && np !== "srcdoc") virtualPath = np;
      } catch (e) {}
    });
    // Drop the wrapper path (e.g. /p/abc123/_inner) so any router that reads
    // location.pathname sees "/" and matches the user's home route. Browsers
    // permit replaceState within the same scheme+host even from sandboxed
    // (opaque-origin) iframes, as long as the new URL is same-origin with the
    // document's URL.
    var rewroteOk = false;
    try {
      var p0 = window.location.pathname || "";
      if (p0 !== "/") {
        try { origReplace(null, "", "/"); } catch (e) {}
        virtualPath = "/";
        rewroteOk = (window.location.pathname === "/");
      } else {
        rewroteOk = true;
      }
    } catch (e) {}
    // Defense-in-depth fallback: if the browser refused to rewrite the URL
    // (e.g. opaque-origin policies on srcdoc documents), at least try to
    // shadow Location.prototype.pathname so any router that reads through
    // the prototype chain gets "/". Modern browsers ignore this for direct
    // window.location.pathname reads (host-object internal slots win), but
    // it helps libraries that read via a saved descriptor.
    if (!rewroteOk) {
      try {
        Object.defineProperty(Location.prototype, "pathname", {
          configurable: true,
          get: function() { return virtualPath; },
        });
      } catch (e) {}
    }
  } catch (e) {}
  // ---- Runtime error capture ----
  // We listen to both 'error' (synchronous JS errors + resource load errors
  // like a missing module) and 'unhandledrejection' (async/await failures,
  // unhandled Promise rejections). For each, we surface a friendly overlay
  // when the page would otherwise be blank, and POST a small report so the
  // app's owner can see in the panel that this happened.
  function describeError(err) {
    if (!err) return "";
    if (typeof err === "string") return err;
    try {
      if (err.message) return String(err.message);
      return String(err);
    } catch (e) { return ""; }
  }
  function getStack(err) {
    if (err && typeof err === "object" && typeof err.stack === "string") {
      return err.stack.slice(0, 4000);
    }
    return null;
  }
  window.addEventListener("error", function(e){
    try { console.error("[appforge] runtime error:", e.error || e.message); } catch(_){}
    var err = e && e.error;
    var msg = describeError(err) || (e && e.message) || "Error";
    var stack = getStack(err);
    var src = (e && e.filename) || null;
    var lineno = (e && typeof e.lineno === "number") ? e.lineno : null;
    var colno = (e && typeof e.colno === "number") ? e.colno : null;
    showFatalOverlay(msg + (stack ? "\\n\\n" + stack.split("\\n").slice(0,4).join("\\n") : ""));
    reportError({
      kind: "error",
      message: msg,
      stack: stack,
      source: src,
      lineno: lineno,
      colno: colno,
      pathname: virtualPath || "/",
    });
  }, true);
  window.addEventListener("unhandledrejection", function(e){
    try { console.error("[appforge] unhandled rejection:", e.reason); } catch(_){}
    var reason = e && e.reason;
    var msg = describeError(reason) || "Unhandled rejection";
    var stack = getStack(reason);
    showFatalOverlay(msg + (stack ? "\\n\\n" + stack.split("\\n").slice(0,4).join("\\n") : ""));
    reportError({
      kind: "unhandledrejection",
      message: msg,
      stack: stack,
      source: null,
      lineno: null,
      colno: null,
      pathname: virtualPath || "/",
    });
  });
  // Watchdog: even when no JS error fires (e.g. an import map miss that
  // never resolves, or the bundle silently mounted nothing), the visitor
  // ends up staring at a blank page. After 12 seconds with an empty #root
  // we show a softer "loading slow" message that links to a refresh.
  // This is intentionally generous so a slow CDN cold-start isn't mistaken
  // for a failure.
  setTimeout(function(){
    try {
      var root = document.getElementById("root");
      if (!root || (!root.firstElementChild && !root.textContent.trim())) {
        showFatalOverlay("La página tardó demasiado en aparecer.");
        reportError({
          kind: "error",
          message: "Blank page after 12s — root never mounted",
          stack: null,
          source: null,
          lineno: null,
          colno: null,
          pathname: (typeof virtualPath === "string" ? virtualPath : "/"),
        });
      }
    } catch (e) {}
  }, 12000);
})();`;

  const html = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  ${seoHeadTags(seo)}
  <style>html,body,#root{margin:0;min-height:100vh;font-family:ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;}</style>${userStyleTag}
  <script src="https://cdn.tailwindcss.com"></script>
  <script type="importmap">${JSON.stringify({ imports })}</script>
  <script>${routerShim}</script>
</head>
<body>
  <div id="root"></div>
  <script>
  // Lucide-react icon polyfill
  if (typeof window !== 'undefined') window.__LUCIDE_SAFE_MODE = true;
  // import.meta.env polyfill — evita "Cannot read properties of undefined (reading 'VITE_API_URL')"
  // cuando el bundle generado por el agente accede a import.meta.env en el preview inline
  if (typeof globalThis.importMeta === 'undefined') {
    Object.defineProperty(globalThis, 'importMeta', { value: { env: {} }, configurable: true });
  }
  </script>
  <script type="module">
// import.meta.env polyfill para módulos ES
if (typeof import.meta.env === 'undefined') {
  Object.defineProperty(import.meta, 'env', {
    value: { VITE_API_URL: '', MODE: 'production', DEV: false, PROD: true },
    configurable: true, writable: true
  });
}
${code}
  </script>
</body>
</html>`;

  // Limpiar referencias a assets externos incorrectos (marisai.es/assets)
  // que pueden aparecer si el bundle fue desplegado previamente en Vercel
  const cleanedHtml = html.replace(
    /<link[^>]+href="https?:\/\/(?:www\.)?marisai\.es\/assets\/[^"]*"[^>]*>/gi,
    "<!-- asset eliminado -->"
  );

  if (opts.hasWatermark) {
    return injectWatermarkToHTML(cleanedHtml, undefined, opts.removeWatermarkUrl);
  }
  return cleanedHtml;
}

function pickEntry(vfs: Record<string, string>): string | null {
  const candidates = ["src/main.tsx", "src/main.ts", "src/index.tsx", "src/index.ts", "src/App.tsx"];
  for (const c of candidates) {
    if (vfs[c]) return c;
  }
  return null;
}

/**
 * Known-good versions for the libs the AI is told to use in the system prompt.
 * Used as a fallback for bundles whose `package.json` doesn't list a given
 * dep — e.g. older bundles generated before the model started emitting full
 * dependency lists, or imports the AI added without updating its package.json.
 *
 * If you bump a version here, prefer one that has been smoke-tested against a
 * representative AI-generated app. Do NOT use floating ranges (`^`, `~`) —
 * the whole point of this map is to pin to a specific known-working release.
 */
const DEFAULT_VERSIONS: Record<string, string> = {
  react: "18.3.1",
  "react-dom": "18.3.1",
  wouter: "3.3.5",
  "lucide-react": "0.475.0",
  clsx: "2.1.1",
  "tailwind-merge": "2.5.5",
  "date-fns": "3.6.0",
  zod: "3.23.8",
  // Añadidas junto con la ampliación de librerías permitidas en el Frontend
  // Engineer (apps.ts, lista de imports permitidos) — sin esta entrada, el
  // bundle generado podía importar estas librerías correctamente desde el
  // sandbox E2B (npm install real, sin este mapa), pero el sistema de
  // Preview (este archivo, vía esm.sh sin npm install) caía al último
  // recurso de "latest" sin garantía, o se quedaba colgado resolviendo el
  // import — causa real confirmada de "La página tardó demasiado en
  // aparecer" en apps que sí usan recharts/react-hook-form.
  "framer-motion": "11.11.17",
  recharts: "2.13.3",
  "react-hook-form": "7.54.0",
  "@hookform/resolvers": "3.9.1",
  "react-day-picker": "9.4.0",
  // ── Librerías de juegos ────────────────────────────────────────────────
  // Añadidas para que los juegos generados hagan preview correctamente
  // vía esm.sh sin caer a "latest" sin garantía de compatibilidad.
  // Versiones smoke-tested contra los seedPrompts de templates.ts.
  "three": "0.169.0",
  "@react-three/fiber": "8.17.10",
  "@react-three/drei": "9.114.3",
  "@react-three/rapier": "1.4.0",
  "matter-js": "0.19.0",
  "phaser": "3.87.0",
  "pixi.js": "8.5.2",
  "kaplay": "3001.0.0-beta.1",
  "@babylonjs/core": "7.26.2",
  "howler": "2.2.4",
  "gsap": "3.12.5",
  // Añadidos junto con las instrucciones nuevas de tiempo real/sonido en
  // apps.ts — sin esto en el mapa, el código generado que las use fallaría
  // al resolver el import en el preview real, aunque el agente supiera
  // "en teoría" que existen.
  "socket.io-client": "4.8.3",
  "tone": "15.1.22",
};

/**
 * Extract `name → versionSpec` from the `package.json` shipped inside the
 * AI-generated bundle. Looks at root-level `package.json` first (typical
 * frontend-only bundle layout), then `frontend/package.json` (older nested
 * layout). Merges `dependencies`, `devDependencies` and `peerDependencies`
 * with `dependencies` winning, since runtime deps are what we care about.
 *
 * Returns an empty map (never throws) on missing file or malformed JSON —
 * the caller will simply fall back to `DEFAULT_VERSIONS`.
 */
function extractPackageVersions(vfs: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const path of ["package.json", "frontend/package.json"]) {
    const raw = vfs[path];
    if (!raw) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      continue;
    }
    if (!parsed || typeof parsed !== "object") continue;
    const pkg = parsed as {
      dependencies?: unknown;
      devDependencies?: unknown;
      peerDependencies?: unknown;
    };
    for (const key of ["peerDependencies", "devDependencies", "dependencies"] as const) {
      const block = pkg[key];
      if (!block || typeof block !== "object") continue;
      for (const [name, ver] of Object.entries(block as Record<string, unknown>)) {
        if (typeof ver === "string" && ver.trim()) out[name] = ver.trim();
      }
    }
  }
  return out;
}

/**
 * Pick the package name out of an import specifier. Handles scoped packages
 * (`@scope/name/subpath` → `@scope/name`) and plain packages
 * (`pkg/sub` → `pkg`). Used to look up versions, since `package.json` is
 * keyed by package name not full specifier.
 */
function packageName(spec: string): string {
  if (spec.startsWith("@")) {
    const parts = spec.split("/");
    return parts.slice(0, 2).join("/");
  }
  return spec.split("/")[0];
}

/**
 * Convert a `package.json` version range into an exact version we can pin to
 * in the esm.sh URL. We extract the first semver-shaped substring, which
 * covers exact versions (`1.2.3`), caret/tilde ranges (`^1.2.3`, `~1.2.3`)
 * and bounded ranges (`>=1.2.3 <2`).
 *
 * Returning an exact version (rather than passing the range to esm.sh) is the
 * whole point: even a semver-respecting patch release can ship a regression
 * an already-deployed app would suddenly hit, and a non-respecting release
 * (the lucide-react v0.488 case) would silently break the bundle. Pinning to
 * what was current at deploy time freezes the behavior forever.
 *
 * Returns null when the spec has no semver core (e.g. `latest`, `*`, a git
 * URL, a file path) so the caller can fall through to defaults.
 */
function resolveVersion(name: string, versions: Record<string, string>): string | null {
  const spec = versions[name];
  if (!spec) return null;
  const m = /(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)/.exec(spec);
  return m ? m[1] : null;
}

/**
 * esbuild plugin that resolves imports against our virtual filesystem.
 * Anything that doesn't look like a relative path is recorded in `externals`
 * and marked external so it can be resolved at runtime via an import map.
 */
function virtualFsPlugin(
  vfs: Record<string, string>,
  externals: Set<string>,
  collectedCss: string[],
): esbuild.Plugin {
  return {
    name: "appforge-vfs",
    setup(build) {
      build.onResolve({ filter: /.*/ }, (args) => {
        // Entry points come in with `kind === "entry-point"` and have no
        // importer. They are by definition VFS files (we picked them via
        // pickEntry), so resolve them directly against the VFS rather than
        // falling into the bare-import branch which would mark them external
        // and silently produce an empty bundle.
        if (args.kind === "entry-point") {
          if (vfs[args.path]) return { path: args.path, namespace: "vfs" };
          // Should never happen since pickEntry confirmed this exists, but
          // fail loudly if it does — silent success is the bug we're avoiding.
          return { errors: [{ text: `Entry not found in VFS: ${args.path}` }] };
        }
        // Bare import → external; record so we can add to the import map.
        if (!args.path.startsWith(".") && !args.path.startsWith("/")) {
          // lucide-react: shim propio para evitar errores con iconos inexistentes
          if (args.path === "lucide-react") {
            if (!vfs["__lucide_shim__.tsx"]) {
              vfs["__lucide_shim__.tsx"] = `import React from "react";
const _IconStub = (p: any) => React.createElement("svg", {
  xmlns:"http://www.w3.org/2000/svg",width:p.size||24,height:p.size||24,
  viewBox:"0 0 24 24",fill:"none",stroke:p.color||"currentColor",
  strokeWidth:p.strokeWidth||2,strokeLinecap:"round",strokeLinejoin:"round",
  style:p.style,className:p.className
});
export default _IconStub;
export const createLucideIcon = () => _IconStub;
export const Home = _IconStub;
export const User = _IconStub;
export const Users = _IconStub;
export const Settings = _IconStub;
export const Search = _IconStub;
export const Bell = _IconStub;
export const BellOff = _IconStub;
export const BellRing = _IconStub;
export const Menu = _IconStub;
export const X = _IconStub;
export const Check = _IconStub;
export const ChevronLeft = _IconStub;
export const ChevronRight = _IconStub;
export const ChevronUp = _IconStub;
export const ChevronDown = _IconStub;
export const ArrowLeft = _IconStub;
export const ArrowRight = _IconStub;
export const ArrowUp = _IconStub;
export const ArrowDown = _IconStub;
export const Plus = _IconStub;
export const Minus = _IconStub;
export const Edit = _IconStub;
export const Trash = _IconStub;
export const Trash2 = _IconStub;
export const Eye = _IconStub;
export const EyeOff = _IconStub;
export const Lock = _IconStub;
export const Unlock = _IconStub;
export const Mail = _IconStub;
export const Phone = _IconStub;
export const MapPin = _IconStub;
export const Calendar = _IconStub;
export const Clock = _IconStub;
export const Star = _IconStub;
export const Heart = _IconStub;
export const Bookmark = _IconStub;
export const Share = _IconStub;
export const Download = _IconStub;
export const Upload = _IconStub;
export const File = _IconStub;
export const FileText = _IconStub;
export const Folder = _IconStub;
export const FolderOpen = _IconStub;
export const Image = _IconStub;
export const Video = _IconStub;
export const Music = _IconStub;
export const Mic = _IconStub;
export const Camera = _IconStub;
export const Send = _IconStub;
export const MessageSquare = _IconStub;
export const AlertTriangle = _IconStub;
export const AlertCircle = _IconStub;
export const Info = _IconStub;
export const CheckCircle = _IconStub;
export const XCircle = _IconStub;
export const Shield = _IconStub;
export const Key = _IconStub;
export const LogIn = _IconStub;
export const LogOut = _IconStub;
export const RefreshCw = _IconStub;
export const RefreshCcw = _IconStub;
export const Loader = _IconStub;
export const Loader2 = _IconStub;
export const BarChart = _IconStub;
export const BarChart2 = _IconStub;
export const BarChart3 = _IconStub;
export const LineChart = _IconStub;
export const PieChart = _IconStub;
export const TrendingUp = _IconStub;
export const TrendingDown = _IconStub;
export const Activity = _IconStub;
export const Zap = _IconStub;
export const Globe = _IconStub;
export const Database = _IconStub;
export const Server = _IconStub;
export const Monitor = _IconStub;
export const Smartphone = _IconStub;
export const Package = _IconStub;
export const Box = _IconStub;
export const ShoppingCart = _IconStub;
export const CreditCard = _IconStub;
export const DollarSign = _IconStub;
export const Building = _IconStub;
export const Store = _IconStub;
export const Flag = _IconStub;
export const Tag = _IconStub;
export const Link = _IconStub;
export const ExternalLink = _IconStub;
export const Code = _IconStub;
export const Terminal = _IconStub;
export const HardDrive = _IconStub;
export const Cpu = _IconStub;
export const Power = _IconStub;
export const Battery = _IconStub;
export const Wifi = _IconStub;
export const Sun = _IconStub;
export const Moon = _IconStub;
export const Map = _IconStub;
export const Navigation = _IconStub;
export const Compass = _IconStub;
export const Filter = _IconStub;
export const List = _IconStub;
export const Grid = _IconStub;
export const Layout = _IconStub;
export const Sidebar = _IconStub;
export const Maximize = _IconStub;
export const Minimize = _IconStub;
export const Copy = _IconStub;
export const Clipboard = _IconStub;
export const Move = _IconStub;
export const ZoomIn = _IconStub;
export const ZoomOut = _IconStub;
export const RotateCcw = _IconStub;
export const Repeat = _IconStub;
export const Play = _IconStub;
export const Pause = _IconStub;
export const Square = _IconStub;
export const Circle = _IconStub;
export const GitBranch = _IconStub;
export const Bold = _IconStub;
export const Italic = _IconStub;
export const Underline = _IconStub;
export const Type = _IconStub;
export const AlignLeft = _IconStub;
export const AlignCenter = _IconStub;
export const AlignRight = _IconStub;
export const Volume = _IconStub;
export const Volume1 = _IconStub;
export const Volume2 = _IconStub;
export const VolumeX = _IconStub;
export const Headphones = _IconStub;
export const UserCheck = _IconStub;
export const UserMinus = _IconStub;
export const UserPlus = _IconStub;
export const UserX = _IconStub;
export const Crown = _IconStub;
export const Award = _IconStub;
export const Trophy = _IconStub;
export const Target = _IconStub;
export const Anchor = _IconStub;
export const Tool = _IconStub;
export const Wrench = _IconStub;
export const Hammer = _IconStub;
export const Pen = _IconStub;
export const PenTool = _IconStub;
export const Paperclip = _IconStub;
export const Pin = _IconStub;
export const Car = _IconStub;
export const Truck = _IconStub;
export const Plane = _IconStub;
export const Train = _IconStub;
export const Bike = _IconStub;
export const Thermometer = _IconStub;
export const Weight = _IconStub;
export const Scale = _IconStub;
export const Timer = _IconStub;
export const Hourglass = _IconStub;
export const Watch = _IconStub;
export const CalendarCheck = _IconStub;
export const CalendarDays = _IconStub;
export const CalendarPlus = _IconStub;
export const CalendarX = _IconStub;
export const ChartBar = _IconStub;
export const AreaChart = _IconStub;
export const Siren = _IconStub;
export const Alarm = _IconStub;
export const AlarmCheck = _IconStub;
export const Ambulance = _IconStub;
export const FireExtinguisher = _IconStub;
export const FolderPlus = _IconStub;
export const FolderMinus = _IconStub;
export const FileCode = _IconStub;
export const FileImage = _IconStub;
export const FileArchive = _IconStub;
export const Sparkles = _IconStub;
export const Wand = _IconStub;
export const Wand2 = _IconStub;
export const Lightbulb = _IconStub;
export const FlameKindling = _IconStub;
export const Flame = _IconStub;
export const Snowflake = _IconStub;
export const Droplets = _IconStub;
export const Wind = _IconStub;
export const CloudRain = _IconStub;
export const Rainbow = _IconStub;
export const Route = _IconStub;
export const MapPinned = _IconStub;
export const Waypoints = _IconStub;
export const Ship = _IconStub;
export const Rocket = _IconStub;
export const Brain = _IconStub;
export const Dna = _IconStub;
export const Flask = _IconStub;
export const TestTube = _IconStub;
export const Microscope = _IconStub;
export const Satellite = _IconStub;
export const Telescope = _IconStub;
export const Radio = _IconStub;
export const Tv = _IconStub;
export const Gamepad = _IconStub;
export const Joystick = _IconStub;
export const Mouse = _IconStub;
export const Keyboard = _IconStub;
export const Printer = _IconStub;
export const Scanner = _IconStub;
export const Projector = _IconStub;
export const Webcam = _IconStub;
export const Ruler = _IconStub;
export const PenLine = _IconStub;
export const Highlighter = _IconStub;
export const Eraser = _IconStub;
export const Scissors = _IconStub;
export const Knife = _IconStub;
export const Sword = _IconStub;
export const ShieldCheck = _IconStub;
export const ShieldAlert = _IconStub;
export const ShieldOff = _IconStub;
export const Fingerprint = _IconStub;
export const ScanFace = _IconStub;
export const QrCode = _IconStub;
export const Barcode = _IconStub;
export const Receipt = _IconStub;
export const Invoice = _IconStub;
export const FileSpreadsheet = _IconStub;
export const Table = _IconStub;
export const TableProperties = _IconStub;
export const Columns = _IconStub;
export const Rows = _IconStub;
export const LayoutGrid = _IconStub;
export const LayoutList = _IconStub;
export const LayoutDashboard = _IconStub;
export const PanelLeft = _IconStub;
export const PanelRight = _IconStub;
export const PanelTop = _IconStub;
export const PanelBottom = _IconStub;
export const SplitSquareHorizontal = _IconStub;
export const SplitSquareVertical = _IconStub;
`;
            }
            return { path: "__lucide_shim__.tsx", namespace: "vfs" };
          }
          externals.add(args.path);
          return { path: args.path, external: true };
        }
        const resolved = resolveInVfs(vfs, args.path, args.importer);
        if (!resolved) {
          // Missing file → generar stub automático en vez de marcar external.
          // Marcar external causa errores de runtime porque el navegador no puede
          // resolver imports relativos. Un stub vacío es siempre mejor.
          const stubName = args.path.split("/").pop()?.replace(/\.[^.]+$/, "") || "Missing";
          const stubContent = `export default function ${stubName}() {
  return null;
}
export const ${stubName}Page = ${stubName};
`;
          vfs[args.path] = stubContent;
          return { path: args.path, namespace: "vfs" };
        }
        return { path: resolved, namespace: "vfs" };
      });
      build.onLoad({ filter: /.*/, namespace: "vfs" }, (args) => {
        const contents = vfs[args.path];
        if (contents === undefined) return undefined;
        const ext = args.path.split(".").pop() || "";
        // CSS handling: esbuild can't emit a CSS sibling output when running
        // with `write: false` and no `outdir`. Instead of letting the build
        // fail with "Cannot import ... CSS file without an output path
        // configured", capture the raw CSS contents and replace the import
        // with an empty JS module. The collected CSS is later concatenated
        // into a `<style>` tag in the deployed HTML head.
        if (ext === "css") {
          collectedCss.push(contents);
          return { contents: "", loader: "js" };
        }
        const loader: esbuild.Loader =
          ext === "tsx" ? "tsx"
          : ext === "ts" ? "ts"
          : ext === "jsx" ? "jsx"
          : ext === "json" ? "json"
          : "js";
        return { contents, loader };
      });
    },
  };
}

function resolveInVfs(
  vfs: Record<string, string>,
  spec: string,
  importer: string | undefined,
): string | null {
  // Strip query/hash.
  const clean = spec.replace(/[?#].*$/, "");
  // Convert relative to absolute-within-vfs.
  let target = clean;
  if (clean.startsWith(".")) {
    if (!importer) return null;
    const dir = importer.split("/").slice(0, -1).join("/");
    target = normalize(`${dir}/${clean}`);
  } else if (clean.startsWith("/")) {
    target = clean.slice(1);
  } else {
    target = clean;
  }
  // Strip leading "./" if any survived.
  if (target.startsWith("./")) target = target.slice(2);

  // Direct hit.
  if (vfs[target]) return target;
  // Try with extensions.
  for (const ext of [".tsx", ".ts", ".jsx", ".js", ".css"]) {
    if (vfs[target + ext]) return target + ext;
  }
  // Try as directory index.
  for (const ext of [".tsx", ".ts", ".jsx", ".js"]) {
    const idx = `${target}/index${ext}`;
    if (vfs[idx]) return idx;
  }
  return null;
}

function normalize(p: string): string {
  const parts = p.split("/");
  const out: string[] = [];
  for (const part of parts) {
    if (part === "." || part === "") continue;
    if (part === "..") {
      out.pop();
      continue;
    }
    out.push(part);
  }
  return out.join("/");
}

/**
 * Generate a URL-safe random slug. 10 chars from a 36-character alphabet,
 * sourced from `crypto.randomInt` (CSPRNG) so the URL is unguessable —
 * ~51.7 bits of entropy is plenty for a personal-use SaaS public link.
 */
export function makeSlug(): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  let out = "";
  for (let i = 0; i < 10; i++) {
    out += alphabet[randomInt(0, alphabet.length)];
  }
  return out;
}

/** Matches the format produced by makeSlug — used to reject malformed input. */
export const SLUG_PATTERN = /^[a-z0-9]{10}$/;

/**
 * Local copy of the NON_JS_KINDS check from routes/apps.ts so this lib stays
 * import-free of the route file (which itself imports from here — would
 * create a cycle).
 */
function isNonJsKindLocal(kind: string | null | undefined): boolean {
  return kind === "python-api" || kind === "django";
}

/**
 * Build a static landing card for non-JS kinds (Python). Lists the files in
 * the bundle and tells the user how to run the project locally + how to ship
 * it via ZIP / GitHub / Vercel. No esbuild involved.
 */
function buildNonJsLandingHtml(opts: {
  bundle: string;
  title: string;
  kind: string;
}): string {
  const files = bundleToFiles(opts.bundle);
  const fileNames = Object.keys(files).sort();
  const safeTitle = (opts.title || "Maris AI App").replace(/[<&>]/g, "");
  const stackLabel =
    opts.kind === "django" ? "Django 5 (Python)" : "FastAPI (Python)";
  const runCmd =
    opts.kind === "django"
      ? "python manage.py migrate &amp;&amp; python manage.py runserver 0.0.0.0:8000"
      : "uvicorn main:app --reload --port 8000";
  const fileListHtml = fileNames.length
    ? `<ul>${fileNames
        .map(
          (n) =>
            `<li><code>${n.replace(/[<&>]/g, (c) =>
              c === "<" ? "&lt;" : c === ">" ? "&gt;" : "&amp;",
            )}</code></li>`,
        )
        .join("")}</ul>`
    : `<p><em>El bundle está vacío.</em></p>`;
  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${safeTitle}</title>
  <style>
    :root { color-scheme: dark; }
    html,body { margin:0; min-height:100vh; background:#0b1020; color:#e5e7eb; font-family:ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif; }
    .wrap { max-width: 720px; margin: 0 auto; padding: 48px 24px; }
    .badge { display:inline-block; padding:4px 10px; border-radius:9999px; background:#1f2937; color:#a78bfa; font-size:12px; letter-spacing:.04em; text-transform:uppercase; }
    h1 { font-size: 32px; margin: 16px 0 8px; }
    .lede { color:#9ca3af; line-height:1.5; }
    .card { background:#111827; border:1px solid #1f2937; border-radius:12px; padding:20px 24px; margin-top:24px; }
    .card h2 { margin: 0 0 12px; font-size:18px; }
    code { background:#0b1020; padding:2px 6px; border-radius:4px; font-size: 13px; }
    pre { background:#0b1020; padding:12px 16px; border-radius:8px; overflow:auto; font-size: 13px; line-height:1.5; }
    ul { padding-left: 20px; }
    li { margin: 4px 0; }
    .grid { display:grid; gap:12px; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); margin-top: 16px; }
    .step { background:#0f172a; border:1px solid #1f2937; border-radius:8px; padding:12px 14px; }
    .step b { color:#a78bfa; }
  </style>
</head>
<body>
  <div class="wrap">
    <span class="badge">${stackLabel}</span>
    <h1>${safeTitle}</h1>
    <p class="lede">Esta app está escrita en Python — no se puede previsualizar dentro del navegador como una app de React. Aquí tienes cómo correrla en local o desplegarla.</p>

    <div class="card">
      <h2>Correr en tu máquina</h2>
      <pre>pip install -r requirements.txt
${runCmd}</pre>
    </div>

    <div class="card">
      <h2>Cómo desplegarla</h2>
      <div class="grid">
        <div class="step"><b>1. ZIP</b><br/>Descarga el código como ZIP desde el botón "Exportar" del panel.</div>
        <div class="step"><b>2. GitHub</b><br/>Sube a un repo con un clic; cada actualización en Maris hace push automático.</div>
        <div class="step"><b>3. Vercel</b><br/>Pulsa "Desplegar a Vercel" y Maris configura runtime Python automáticamente.</div>
      </div>
    </div>

    <div class="card">
      <h2>Archivos generados (${fileNames.length})</h2>
      ${fileListHtml}
    </div>
  </div>
</body>
</html>`;
}
