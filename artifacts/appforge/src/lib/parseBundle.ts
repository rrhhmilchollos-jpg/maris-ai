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
const PREVIEW_INDEX_TSX = `import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

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

// --- Runtime error surface -------------------------------------------------
// Sandpack hides JS exceptions silently and the app simply renders blank below
// the failing component. We catch them in three places (React render errors,
// window.onerror, unhandledrejection) and paint a red banner at the bottom of
// the iframe so the user can see WHY the preview died. Without this, debugging
// a generated app means staring at a white screen. The banner is dismissible.
function __showPreviewError(title: string, message: string, stack?: string) {
  if (typeof document === "undefined") return;
  let host = document.getElementById("__preview_err__");
  if (!host) {
    host = document.createElement("div");
    host.id = "__preview_err__";
    host.style.cssText = "position:fixed;left:0;right:0;bottom:0;z-index:2147483647;background:#7f1d1d;color:#fff;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;line-height:1.4;border-top:2px solid #f87171;max-height:25vh;overflow:auto;box-shadow:0 -4px 12px rgba(0,0,0,0.25)";
    document.body.appendChild(host);
  }
  const safeMsg = String(message || "").slice(0, 800);
  const safeStack = stack ? String(stack).slice(0, 1500) : "";
  // Build via DOM nodes + textContent so error text from generated apps cannot
  // inject HTML into the preview iframe (defense-in-depth even though the
  // iframe is sandboxed).
  while (host.firstChild) host.removeChild(host.firstChild);
  const row = document.createElement("div");
  row.style.cssText = "display:flex;align-items:flex-start;justify-content:space-between;gap:8px;padding:10px 12px;";
  const main = document.createElement("div");
  main.style.cssText = "flex:1;min-width:0;";
  const titleEl = document.createElement("div");
  titleEl.style.cssText = "font-weight:700;color:#fecaca;margin-bottom:4px;";
  titleEl.textContent = title;
  const msgEl = document.createElement("div");
  msgEl.style.cssText = "white-space:pre-wrap;word-break:break-word;";
  msgEl.textContent = safeMsg;
  main.appendChild(titleEl);
  main.appendChild(msgEl);
  if (safeStack) {
    const det = document.createElement("details");
    det.style.cssText = "margin-top:6px;color:#fca5a5;";
    const sum = document.createElement("summary");
    sum.style.cssText = "cursor:pointer;";
    sum.textContent = "Ver stack";
    const pre = document.createElement("pre");
    pre.style.cssText = "white-space:pre-wrap;word-break:break-word;margin:6px 0 0;";
    pre.textContent = safeStack;
    det.appendChild(sum);
    det.appendChild(pre);
    main.appendChild(det);
  }
  const btn = document.createElement("button");
  btn.style.cssText = "background:transparent;border:1px solid #fca5a5;color:#fff;border-radius:4px;padding:2px 8px;cursor:pointer;font-size:11px;flex-shrink:0;";
  btn.textContent = "Cerrar";
  btn.onclick = function() { if (host) host.style.display = "none"; };
  row.appendChild(main);
  row.appendChild(btn);
  host.appendChild(row);
}

if (typeof window !== "undefined") {
  window.addEventListener("error", function(ev) {
    const e = ev as ErrorEvent;
    __showPreviewError("Error en tiempo de ejecución", e.message || "Error desconocido", e.error && e.error.stack);
  });
  window.addEventListener("unhandledrejection", function(ev) {
    const e = ev as PromiseRejectionEvent;
    const reason: any = e.reason;
    const msg = reason && reason.message ? reason.message : String(reason);
    const stk = reason && reason.stack ? reason.stack : undefined;
    __showPreviewError("Promesa rechazada", msg, stk);
  });
}

class PreviewBoundary extends React.Component<{ children: React.ReactNode }, { err: Error | null }> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { err: null };
  }
  static getDerivedStateFromError(err: Error) { return { err }; }
  componentDidCatch(err: Error, info: { componentStack?: string }) {
    __showPreviewError(
      "El componente lanzó un error",
      err.message || String(err),
      (err.stack || "") + (info && info.componentStack ? "\\n\\nComponent stack:" + info.componentStack : "")
    );
  }
  render() {
    if (this.state.err) {
      return React.createElement(
        "div",
        { style: { minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: "24px", background: "#fef2f2", color: "#991b1b", fontFamily: "ui-sans-serif, system-ui, sans-serif" } },
        React.createElement(
          "div",
          { style: { maxWidth: "560px", textAlign: "center" } },
          React.createElement("div", { style: { fontSize: "20px", fontWeight: 700, marginBottom: "8px" } }, "La aplicación generada no se pudo renderizar"),
          React.createElement("div", { style: { fontSize: "14px", opacity: 0.85 } }, "Mira el detalle del error en la barra inferior. Pídele al asistente que lo corrija.")
        )
      );
    }
    return this.props.children as any;
  }
}

const container = document.getElementById("root");
if (container) {
  createRoot(container).render(
    <PreviewBoundary>
      <App />
    </PreviewBoundary>
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
 * Exported so app-detail.tsx can pass it as `customSetup.dependencies` to
 * SandpackProvider.
 */
export const SANDPACK_DEPENDENCIES: Record<string, string> = {
  wouter: "^3.3.5",
  "lucide-react": "^0.460.0",
  clsx: "^2.1.1",
  "tailwind-merge": "^2.5.4",
  "date-fns": "^4.1.0",
  zod: "^3.23.8",
};

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
    files[norm] = content;
  }
  if (!files["/App.tsx"] && !files["/App.jsx"]) {
    files["/App.tsx"] = FALLBACK_APP;
  }

  // Sandpack's react-ts template entry is /index.tsx. We ALWAYS install our
  // own wrapper so we can guarantee Tailwind CDN injection + body reset. If
  // the model also produced its own /main.tsx or /index.tsx, we drop them and
  // import App.tsx (which is what the model actually wrote).  Tested: this
  // plays nicely with both the JS and TS variants since App.tsx/.jsx are
  // resolved without an extension.
  delete files["/main.tsx"];
  delete files["/main.jsx"];
  delete files["/index.jsx"];
  files["/index.tsx"] = PREVIEW_INDEX_TSX;

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
