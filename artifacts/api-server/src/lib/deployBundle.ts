import * as esbuild from "esbuild";
import { randomInt } from "node:crypto";
import { bundleToFiles } from "./exportZip";

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
}): Promise<string> {
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

  const result = await esbuild.build({
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

  const code = result.outputFiles[0]?.text ?? "";
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
  for (const pkg of externals) {
    if (pkg === "react" || pkg.startsWith("react/")) continue;
    if (pkg === "react-dom" || pkg.startsWith("react-dom/")) continue;
    if (imports[pkg]) continue;
    // Look up the version under the *package* name (e.g. `@react-three/fiber`),
    // not the full specifier which may include a subpath (`lucide-react/icons`).
    const name = packageName(pkg);
    const subpath = pkg.slice(name.length); // "" or "/sub/path"
    const version = resolveVersion(name, userVersions) ?? DEFAULT_VERSIONS[name];
    // The version goes between the package name and the subpath, never after
    // the subpath: esm.sh URLs are `name@version/subpath`, not
    // `name/subpath@version` (which 404s).
    const target = version ? `${name}@${version}${subpath}` : pkg;
    // ?external=react so esm.sh resolves peer deps against our import-map
    // react instead of bundling its own copy (which would break hooks).
    imports[pkg] = `https://esm.sh/${target}?external=react,react-dom`;
  }

  const safeTitle = (opts.title || "Maris AI App").replace(/[<&>]/g, "");

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

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${safeTitle}</title>
  <style>html,body,#root{margin:0;min-height:100vh;font-family:ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;}</style>${userStyleTag}
  <script src="https://cdn.tailwindcss.com"></script>
  <script type="importmap">${JSON.stringify({ imports })}</script>
  <script>${routerShim}</script>
</head>
<body>
  <div id="root"></div>
  <script type="module">
${code}
  </script>
</body>
</html>`;
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
          externals.add(args.path);
          return { path: args.path, external: true };
        }
        const resolved = resolveInVfs(vfs, args.path, args.importer);
        if (!resolved) {
          // Missing file → mark external rather than failing the build. Avoids
          // hard crashes on minor bundle issues.
          return { path: args.path, external: true };
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
