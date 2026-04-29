import type { SandpackFiles } from "@codesandbox/sandpack-react";

const FILE_MARKER = /\/\/\s*===\s*FILE:\s*(.+?)\s*===/g;

export function parseBundle(bundle: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!bundle) return out;
  const matches: { path: string; index: number }[] = [];
  let m: RegExpExecArray | null;
  FILE_MARKER.lastIndex = 0;
  while ((m = FILE_MARKER.exec(bundle)) !== null) {
    matches.push({ path: m[1].trim(), index: m.index + m[0].length });
  }
  if (matches.length === 0) {
    out["src/App.tsx"] = bundle;
    return out;
  }
  for (let i = 0; i < matches.length; i++) {
    const start = matches[i].index;
    const end = i + 1 < matches.length
      ? bundle.lastIndexOf("// === FILE:", matches[i + 1].index)
      : bundle.length;
    const safeEnd = end > start ? end : bundle.length;
    out[matches[i].path] = bundle.slice(start, safeEnd).replace(/^\n+/, "").trimEnd();
  }
  return out;
}

// IMPORTANT: Sandpack's `react-ts` template is Vite-based and reads /index.html
// from the project root (NOT /public/index.html, that's the CRA convention).
// The script tag must point at /index.tsx as a module so the React entry runs.
// Without injecting Tailwind via CDN here, every utility class (flex, grid,
// w-full, p-4, …) silently no-ops and the preview looks like raw browser
// defaults — links underlined in purple, blocks stacked, no layout.
const PREVIEW_INDEX_HTML = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Preview</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <style>
      html, body, #root { margin: 0; min-height: 100%; width: 100%; }
      body { font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
    </style>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/index.tsx"></script>
  </body>
</html>`;

// Sandpack's react-ts template ships a minimal index.html that we cannot
// reliably override (different versions look at /index.html vs
// /public/index.html, and the classic bundler regenerates parts of it). The
// only place we fully control is the React entry — so inject the Tailwind
// Play CDN script at runtime, before mounting the app, and reset the body so
// the app actually fills the viewport. Without this every utility class is a
// no-op and the preview renders with default browser styles (links underlined
// in purple, blocks stacked, no layout).
// __EXTRA_CSS_IMPORTS__ is a placeholder we substitute at runtime with one
// `import "./styles/<file>.css";` line per custom CSS file the model emitted.
// Without this, files like src/styles/animations.css are silently dropped (the
// generated main.tsx imports them but we replace main.tsx with this entry),
// which leaves classes like `animate-slideUp` undefined. Some templates pair
// that class with `opacity:0` keyframes from the same file, so the elements
// inside the wrapper never become visible and the user sees a blank page
// below the navbar / hero.
const PREVIEW_INDEX_TSX = `import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
__EXTRA_CSS_IMPORTS__

// DEBUG: surface iframe runtime errors to parent window so the host page can
// log them. Wallaclone-style apps with deep component trees can throw inside
// useEffect / hooks and React renders nothing, leaving a black iframe with no
// signal. This bridge is a no-op in production but invaluable while diagnosing.
if (typeof window !== "undefined") {
  const send = (kind, msg, stack) => {
    try { window.parent && window.parent.postMessage({ __appforgeDebug: true, kind: kind, msg: String(msg).slice(0, 800), stack: stack ? String(stack).slice(0, 1500) : "" }, "*"); } catch {}
  };
  window.addEventListener("error", (e) => send("error", (e && e.error && e.error.message) || e.message, e && e.error && e.error.stack));
  window.addEventListener("unhandledrejection", (e) => send("rejection", (e && e.reason && e.reason.message) || String(e.reason), e && e.reason && e.reason.stack));
  const origErr = console.error;
  console.error = function() {
    try { send("console.error", Array.from(arguments).map((a) => (typeof a === "string" ? a : (a && a.message) || JSON.stringify(a))).join(" "), ""); } catch {}
    return origErr.apply(console, arguments);
  };
}

if (typeof document !== "undefined") {
  const html = document.documentElement;
  const body = document.body;
  if (html) { html.style.margin = "0"; html.style.height = "100%"; html.style.width = "100%"; }
  if (body) {
    body.style.margin = "0";
    body.style.minHeight = "100%";
    body.style.width = "100%";
    body.style.fontFamily = "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";
  }
  if (!document.querySelector('script[data-tw-cdn]')) {
    const s = document.createElement("script");
    s.src = "https://cdn.tailwindcss.com";
    s.setAttribute("data-tw-cdn", "1");
    document.head.appendChild(s);
  }
  let root = document.getElementById("root");
  if (!root) {
    root = document.createElement("div");
    root.id = "root";
    root.style.minHeight = "100vh";
    root.style.width = "100%";
    document.body.appendChild(root);
  } else {
    root.style.minHeight = "100vh";
    root.style.width = "100%";
  }
}

const container = document.getElementById("root");
if (container) {
  createRoot(container).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
}
`;

const PREVIEW_INDEX_CSS = `/* Tailwind injected via CDN in index.html for preview. */
`;

const FALLBACK_APP = `export default function App() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-100 text-slate-700">
      <div className="text-center px-6">
        <p className="text-lg font-semibold">No hay vista previa disponible</p>
        <p className="text-sm text-slate-500 mt-2">El código generado no incluye un componente App reconocible.</p>
      </div>
    </div>
  );
}
`;

const SKIP_PATHS = new Set([
  "package.json",
  "package-lock.json",
  "tsconfig.json",
  "tsconfig.node.json",
  "vite.config.ts",
  "vite.config.js",
  "vitest.config.ts",
  "vitest.config.js",
  "playwright.config.ts",
  "playwright.config.js",
  "tailwind.config.ts",
  "tailwind.config.js",
  "tailwind.config.cjs",
  "postcss.config.js",
  "postcss.config.cjs",
  ".gitignore",
  "README.md",
  "SETUP.md",
  "index.html",
]);

// Folders whose files must not be shipped to Sandpack: tests, e2e, docs.
const SKIP_PREFIXES = ["tests/", "e2e/", "__tests__/", "test/"];

function normalizeForSandpack(path: string): string | null {
  if (SKIP_PATHS.has(path)) return null;
  if (SKIP_PREFIXES.some((p) => path.startsWith(p))) return null;
  // Skip *.test.* and *.spec.* files anywhere in the tree.
  if (/\.(test|spec)\.[tj]sx?$/.test(path)) return null;
  // Skip markdown docs anywhere.
  if (/\.md$/.test(path)) return null;
  let p = path;
  if (p.startsWith("./")) p = p.slice(2);
  if (p.startsWith("src/")) p = p.slice(4);
  if (!p.startsWith("/")) p = "/" + p;
  // Don't allow nested vite/cra config files at any level either
  if (p.endsWith("/vite.config.ts") || p.endsWith("/package.json")) return null;
  return p;
}

/**
 * Common npm packages the generator is allowed to import. Sandpack starts from
 * the `react-ts` template which only ships react/react-dom, so anything else
 * (router, icons, util libs) needs to be declared up front or the preview
 * crashes with "Could not find dependency". We pin compatible versions that
 * match what the coder prompt instructs the model to use.
 *
 * NOTE: `wouter` is intentionally NOT in this list. wouter@3.x is pure ESM with
 * `"main": null` and `"module": null`, which Sandpack v2's bundler cannot
 * resolve — it hangs forever in `installing-dependencies` (downloads 11/12 and
 * never finishes the 12th). Instead we ship a tiny v3-compatible shim as a
 * virtual file at `/lib/wouter.tsx` (see WOUTER_SHIM below) and rewrite every
 * `from "wouter"` import in the generated bundle to `from "/lib/wouter"`.
 *
 * Exported so app-detail.tsx can pass it as `customSetup.dependencies` to
 * SandpackProvider.
 */
export const SANDPACK_DEPENDENCIES: Record<string, string> = {
  "lucide-react": "^0.460.0",
  clsx: "^2.1.1",
  "tailwind-merge": "^2.5.4",
  "date-fns": "^4.1.0",
  zod: "^3.23.8",
};

// Hand-rolled wouter v3-compatible shim. Covers everything the generator emits:
// useLocation, useParams, useRoute, Route (component / children / fn-children),
// Switch (first match), Link (renders as <a>, intercepts left-click for SPA
// navigation), Redirect, Router. Intentionally tiny — wouter v3 itself is
// ~1.5KB minified, this shim is ~120 lines and avoids the Sandpack ESM
// resolution hang entirely. Tested against Wallaclone (app id 6) which uses
// every API listed.
const WOUTER_SHIM = `import * as React from "react";

// Internal in-app location, completely independent of window.location.
// Critical: inside Sandpack's iframe the real pathname is something like
// "/csb_invalidate/<hash>" which would never match user routes ("/", "/comprar"
// etc.) and Switch would render null → blank preview. We start at "/" and
// only mutate it when Link / setLocation is called. We DO sync history so
// the back/forward buttons inside the iframe still work.
let currentPath = "/";
const subscribers = new Set();
const notify = () => subscribers.forEach((fn) => fn());

if (typeof window !== "undefined") {
  window.addEventListener("popstate", (e) => {
    const next = (e.state && e.state.__wouter) || "/";
    currentPath = next;
    notify();
  });
}

export function useLocation() {
  const [, setTick] = React.useState(0);
  React.useEffect(() => {
    const update = () => setTick((t) => t + 1);
    subscribers.add(update);
    return () => { subscribers.delete(update); };
  }, []);
  const setLocation = React.useCallback((to) => {
    currentPath = to;
    try { window.history.pushState({ __wouter: to }, "", to); } catch {}
    notify();
  }, []);
  return [currentPath, setLocation];
}

const cache = new Map();
function compile(pattern) {
  const keys = [];
  const regex = new RegExp(
    "^" +
      pattern
        .replace(/\\/$/, "")
        .replace(/:([A-Za-z_][A-Za-z0-9_]*)/g, (_, k) => {
          keys.push(k);
          return "([^/]+)";
        }) +
      "/?$"
  );
  return { regex, keys };
}
function match(pattern, path) {
  if (!cache.has(pattern)) cache.set(pattern, compile(pattern));
  const { regex, keys } = cache.get(pattern);
  const m = regex.exec(path);
  if (!m) return [false, null];
  const params = {};
  keys.forEach((k, i) => { try { params[k] = decodeURIComponent(m[i + 1] || ""); } catch { params[k] = m[i + 1] || ""; } });
  return [true, params];
}

export function useRoute(pattern) {
  const [location] = useLocation();
  const [matched, params] = match(pattern, location);
  return [matched, params];
}

const ParamsContext = React.createContext({});
export function useParams() {
  return React.useContext(ParamsContext);
}

export function Route({ path, component: Comp, children }) {
  const [location] = useLocation();
  if (!path) {
    if (Comp) return React.createElement(Comp);
    if (typeof children === "function") return children({});
    return React.createElement(React.Fragment, null, children);
  }
  const [matched, params] = match(path, location);
  if (!matched) return null;
  const inner = Comp
    ? React.createElement(Comp, params)
    : typeof children === "function"
    ? children(params)
    : React.createElement(React.Fragment, null, children);
  return React.createElement(ParamsContext.Provider, { value: params }, inner);
}

export function Switch({ children }) {
  const [location] = useLocation();
  const arr = React.Children.toArray(children);
  for (const child of arr) {
    if (!React.isValidElement(child)) continue;
    const path = child.props.path;
    if (!path) return child;
    const [matched] = match(path, location);
    if (matched) return child;
  }
  return null;
}

export const Link = React.forwardRef(function Link({ href, to, onClick, children, ...rest }, ref) {
  const target = to != null ? to : href;
  const [, setLocation] = useLocation();
  const handle = (e) => {
    if (onClick) onClick(e);
    if (e.defaultPrevented) return;
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    if (rest.target && rest.target !== "_self") return;
    e.preventDefault();
    setLocation(target);
  };
  return React.createElement("a", { ref, href: target, onClick: handle, ...rest }, children);
});

export function Redirect({ to, href }) {
  const [, setLocation] = useLocation();
  const target = to != null ? to : href != null ? href : "/";
  React.useEffect(() => { setLocation(target); }, [target]);
  return null;
}

export function Router({ children }) {
  return React.createElement(React.Fragment, null, children);
}
`;

/**
 * Build a Sandpack files map from a parsed bundle. Strategy: drop build configs,
 * map src/* → /*, prefer the generated entry/css when present (so providers,
 * routers and custom styles survive), fallback to safe defaults only when absent.
 * Always force tailwind via CDN in index.html since Sandpack cannot run postcss.
 */
export function buildSandpackFiles(parsed: Record<string, string>): SandpackFiles {
  const files: SandpackFiles = {};
  for (const [path, content] of Object.entries(parsed)) {
    const norm = normalizeForSandpack(path);
    if (!norm) continue;
    // Rewrite every `from "wouter"` import to point at our virtual shim file.
    // wouter@3.x is pure ESM (`main: null`, `module: null`) which Sandpack v2's
    // bundler hangs on indefinitely (we measured: 11/12 deps download, the
    // 12th — wouter — never resolves and the iframe stays at "Starting"
    // forever, blank). Routing the bare specifier to a local shim sidesteps
    // npm resolution entirely. Only touches text-y source files.
    if (/\.(tsx?|jsx?|mjs|cjs)$/.test(norm)) {
      // Rewrite to extension-explicit absolute path so Sandpack's resolver
      // doesn't have to guess. Empirically, omitting the extension caused
      // resolution to silently hang in deep projects (Wallaclone, 40 files).
      files[norm] = content.replace(
        /from\s+(["'])wouter\1/g,
        'from "/wouter.js"',
      );
    } else {
      files[norm] = content;
    }
  }
  if (!files["/App.tsx"] && !files["/App.jsx"]) {
    files["/App.tsx"] = FALLBACK_APP;
  }

  // Inject the wouter shim at the virtual root with `.js` extension. We
  // intentionally avoid `.tsx` (Sandpack's resolver in some templates fails
  // to dual-resolve `.tsx` for absolute paths) and avoid nested directories
  // (which were observed to never resolve in 40-file deep trees). The shim
  // is written in plain JS — no JSX, only React.createElement — so it loads
  // without needing the TS/JSX transform pipeline.
  files["/wouter.js"] = WOUTER_SHIM;
  // DIAG: also expose under alt names to test resolver behavior
  files["/wouter-min.js"] = `import * as React from "react";
export function useLocation(){ const [p,setP]=React.useState("/"); return [p,setP]; }
export function useRoute(){ return [false,{}]; }
export function useParams(){ return {}; }
export function Route({component:C,children}){ return C?React.createElement(C):React.createElement(React.Fragment,null,children); }
export function Switch({children}){ const a=React.Children.toArray(children); return a[0]||null; }
export const Link=React.forwardRef(function L({href,to,children,...rest},ref){ return React.createElement("a",{ref,href:to||href,...rest},children); });
export function Redirect(){ return null; }
export function Router({children}){ return React.createElement(React.Fragment,null,children); }
`;

  // Sandpack's react-ts template entry is /index.tsx. We ALWAYS install our
  // own wrapper so we can guarantee Tailwind CDN injection + body reset. If
  // the model also produced its own /main.tsx or /index.tsx, we drop them and
  // import App.tsx (which is what the model actually wrote).  Tested: this
  // plays nicely with both the JS and TS variants since App.tsx/.jsx are
  // resolved without an extension.
  delete files["/main.tsx"];
  delete files["/main.jsx"];
  delete files["/index.jsx"];

  // Wire any custom CSS files the model emitted (commonly src/styles/*.css for
  // animations or component-scoped styles). The original main.tsx imports them
  // but we replace main.tsx with our own wrapper, so without this step those
  // files are bundled-but-unloaded. The visible symptom is whole sections of
  // the page rendering with classes that have no matching @keyframes / rules
  // (e.g. animate-slideUp wraps content that stays at opacity:0 or height:0)
  // — i.e. the "blank below the fold" preview bug. We pull every .css file
  // outside the entry (already covered) into a list of side-effect imports.
  const extraCssImports = Object.keys(files)
    .filter((p) => p.endsWith(".css") && p !== "/index.css")
    .sort()
    .map((p) => `import ".${p}";`)
    .join("\n");
  files["/index.tsx"] = PREVIEW_INDEX_TSX.replace("__EXTRA_CSS_IMPORTS__", extraCssImports);

  // Preserve generated CSS (often includes @tailwind directives + custom rules).
  // Tailwind directives are no-ops at runtime in Sandpack; the CDN script in
  // index.html actually applies utilities. Custom CSS rules still take effect.
  if (!files["/index.css"]) {
    files["/index.css"] = PREVIEW_INDEX_CSS;
  }

  // Always inject the tailwind CDN via our preview index.html (Sandpack cannot
  // run a real postcss/tailwind build pipeline). The Vite-based react-ts
  // template uses /index.html at the root — writing /public/index.html is a
  // no-op there. We write both paths defensively in case Sandpack ever
  // switches templates.
  files["/index.html"] = PREVIEW_INDEX_HTML;
  files["/public/index.html"] = PREVIEW_INDEX_HTML;
  return files;
}
