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

const PREVIEW_INDEX_HTML = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Preview</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <style>
      body { margin: 0; font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
    </style>
  </head>
  <body>
    <div id="root"></div>
  </body>
</html>`;

const PREVIEW_INDEX_TSX = `import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

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
  "tailwind.config.ts",
  "tailwind.config.js",
  "tailwind.config.cjs",
  "postcss.config.js",
  "postcss.config.cjs",
  ".gitignore",
  "README.md",
  "index.html",
]);

function normalizeForSandpack(path: string): string | null {
  if (SKIP_PATHS.has(path)) return null;
  let p = path;
  if (p.startsWith("./")) p = p.slice(2);
  if (p.startsWith("src/")) p = p.slice(4);
  if (!p.startsWith("/")) p = "/" + p;
  // Don't allow nested vite/cra config files at any level either
  if (p.endsWith("/vite.config.ts") || p.endsWith("/package.json")) return null;
  return p;
}

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

  // Sandpack's react-ts template entry is /index.tsx. If the model produced
  // /main.tsx (vite convention), promote it. Otherwise, install our default
  // wrapper so the App component still mounts.
  if (!files["/index.tsx"] && !files["/index.jsx"]) {
    if (files["/main.tsx"]) {
      files["/index.tsx"] = files["/main.tsx"];
      delete files["/main.tsx"];
    } else if (files["/main.jsx"]) {
      files["/index.jsx"] = files["/main.jsx"];
      delete files["/main.jsx"];
    } else {
      files["/index.tsx"] = PREVIEW_INDEX_TSX;
    }
  }

  // Preserve generated CSS (often includes @tailwind directives + custom rules).
  // Tailwind directives are no-ops at runtime in Sandpack; the CDN script in
  // index.html actually applies utilities. Custom CSS rules still take effect.
  if (!files["/index.css"]) {
    files["/index.css"] = PREVIEW_INDEX_CSS;
  }

  // Always inject the tailwind CDN via our preview index.html (Sandpack cannot
  // run a real postcss/tailwind build pipeline).
  files["/public/index.html"] = PREVIEW_INDEX_HTML;
  return files;
}
