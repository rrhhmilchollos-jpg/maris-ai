import type { SandpackFiles } from "@codesandbox/sandpack-react";
import { parseFileMarkers } from "@workspace/bundle-format";

/**
 * ENCONTRADO A PETICIÓN DEL USUARIO (auditoría de duplicados/código
 * obsoleto): esta función tenía su propia copia completa del bucle de
 * extracción del formato "// === FILE: ===", por separado de las dos
 * versiones del backend (exportZip.ts, validate.ts) -- 3 implementaciones
 * de la misma lógica sin compartir código, causa real de varios bugs de
 * sesiones anteriores. Ahora reutiliza el núcleo compartido
 * (@workspace/bundle-format), y solo mantiene AQUÍ el comportamiento que
 * es genuinamente específico de este consumidor: si no hay ningún
 * marcador, el preview de Sandpack necesita ALGO que mostrar aunque sea
 * el bundle entero volcado en un único archivo -- el backend, en cambio,
 * prefiere saber explícitamente que no se extrajo nada (bundle vacío),
 * así que esa parte no se movió al paquete compartido.
 */
export function parseBundle(bundle: string): Record<string, string> {
  const out = parseFileMarkers(bundle);
  if (Object.keys(out).length === 0 && bundle) {
    out["src/App.tsx"] = bundle;
  }
  return out;
}

/**
 * Inversa exacta de parseBundle. Usada por el editor de código manual
 * (solo cuentas admin/propietario) para reconstruir el string plano que
 * espera guardarse en GeneratedApp.frontendCode a partir del mapa de
 * archivos editados en Sandpack. Mantiene el mismo formato de separador
 * ('// === FILE: <path> ===') que produce el propio modelo al generar,
 * de modo que parseBundle, el validador E2B, el export a GitHub y el
 * ZIP de descarga sigan leyendo el resultado sin errores.
 */
export function serializeBundle(files: Record<string, string>): string {
  return Object.entries(files)
    .map(([path, content]) => `// === FILE: ${path} ===\n${content.trimEnd()}`)
    .join("\n\n");
}

// IMPORTANT: Sandpack's `vite-react-ts` template reads /index.html from the
// project root. The script tag must point at /index.tsx as a module so the
// React entry runs. La vista previa usa una base local de utilidades comunes
// y no carga el compilador Tailwind desde un CDN remoto.
const PREVIEW_INDEX_HTML = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Preview</title>
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

// The vite-react-ts template uses /index.html at the root. La entrada propia
// garantiza que la app llena el viewport y aplica los estilos locales incluidos
// en la vista previa, sin cargar compiladores CSS de terceros en tiempo real.
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

const PREVIEW_INDEX_CSS = `/* Base local para previews: no descarga Tailwind CDN ni ejecuta compilación remota. */
*,::before,::after{box-sizing:border-box}html,body,#root{min-height:100%;width:100%;margin:0}body{font-family:ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:#0f172a;background:#fff}button,input,select,textarea{font:inherit}.min-h-screen{min-height:100vh}.h-full{height:100%}.w-full{width:100%}.max-w-7xl{max-width:80rem}.max-w-4xl{max-width:56rem}.mx-auto{margin-left:auto;margin-right:auto}.flex{display:flex}.grid{display:grid}.block{display:block}.hidden{display:none}.flex-1{flex:1 1 0%}.flex-col{flex-direction:column}.flex-wrap{flex-wrap:wrap}.items-center{align-items:center}.items-end{align-items:flex-end}.justify-center{justify-content:center}.justify-between{justify-content:space-between}.gap-1{gap:.25rem}.gap-2{gap:.5rem}.gap-3{gap:.75rem}.gap-4{gap:1rem}.gap-5{gap:1.25rem}.gap-6{gap:1.5rem}.gap-8{gap:2rem}.p-3{padding:.75rem}.p-4{padding:1rem}.p-5{padding:1.25rem}.p-6{padding:1.5rem}.p-7{padding:1.75rem}.p-8{padding:2rem}.px-3{padding-left:.75rem;padding-right:.75rem}.px-4{padding-left:1rem;padding-right:1rem}.px-5{padding-left:1.25rem;padding-right:1.25rem}.py-1{padding-top:.25rem;padding-bottom:.25rem}.py-2{padding-top:.5rem;padding-bottom:.5rem}.py-3{padding-top:.75rem;padding-bottom:.75rem}.py-4{padding-top:1rem;padding-bottom:1rem}.mt-1{margin-top:.25rem}.mt-2{margin-top:.5rem}.mt-3{margin-top:.75rem}.mt-4{margin-top:1rem}.mt-5{margin-top:1.25rem}.mt-6{margin-top:1.5rem}.mt-8{margin-top:2rem}.mb-2{margin-bottom:.5rem}.mb-4{margin-bottom:1rem}.rounded-lg{border-radius:.5rem}.rounded-xl{border-radius:.75rem}.rounded-2xl{border-radius:1rem}.rounded-3xl{border-radius:1.5rem}.rounded-full{border-radius:9999px}.border{border:1px solid #e2e8f0}.border-b{border-bottom:1px solid #e2e8f0}.border-slate-200{border-color:#e2e8f0}.bg-white{background:#fff}.bg-slate-50{background:#f8fafc}.bg-slate-100{background:#f1f5f9}.bg-slate-950{background:#020617}.bg-blue-600{background:#2563eb}.bg-emerald-50{background:#ecfdf5}.text-white{color:#fff}.text-slate-500{color:#64748b}.text-slate-600{color:#475569}.text-slate-900{color:#0f172a}.text-blue-600{color:#2563eb}.text-emerald-700{color:#047857}.text-sm{font-size:.875rem}.text-xs{font-size:.75rem}.text-xl{font-size:1.25rem}.text-2xl{font-size:1.5rem}.text-3xl{font-size:1.875rem}.text-4xl{font-size:2.25rem}.font-medium{font-weight:500}.font-semibold{font-weight:600}.font-bold{font-weight:700}.font-black{font-weight:900}.shadow-sm{box-shadow:0 1px 2px rgba(15,23,42,.08)}.shadow-xl{box-shadow:0 20px 25px -5px rgba(15,23,42,.15)}.overflow-hidden{overflow:hidden}.object-cover{object-fit:cover}.sticky{position:sticky}.top-0{top:0}.z-20{z-index:20}.transition{transition:all .2s ease}.hover\\:bg-blue-700:hover{background:#1d4ed8}.hover\\:shadow-lg:hover{box-shadow:0 10px 15px -3px rgba(15,23,42,.14)}@media(min-width:768px){.md\\:grid-cols-2{grid-template-columns:repeat(2,minmax(0,1fr))}.md\\:grid-cols-4{grid-template-columns:repeat(4,minmax(0,1fr))}}@media(min-width:1024px){.lg\\:grid-cols-\\[220px_1fr\\]{grid-template-columns:220px minmax(0,1fr)}.lg\\:grid-cols-\\[260px_1fr\\]{grid-template-columns:260px minmax(0,1fr)}}
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
 * NOTE on wouter: we pin v2.x because Sandpack v2's in-browser bundler cannot
 * resolve wouter@3.x (it's pure ESM with `main: null` and `module: null`,
 * which leaves Sandpack stuck at `installing-dependencies`).
 *
 * Exported so app-detail.tsx can pass it as `customSetup.dependencies` to
 * SandpackProvider.
 */
export const SANDPACK_DEPENDENCIES: Record<string, string> = {
  // ── Core React ────────────────────────────────────────────────────────────
  // React is already in the vite-react-ts template but we pin it explicitly
  // so customSetup.dependencies doesn't accidentally override with an older version.
  react: "^18.3.1",
  "react-dom": "^18.3.1",

  // ── Routing ───────────────────────────────────────────────────────────────
  // wouter@2.x is pinned because it ships CommonJS (`main: "cjs/index.js"`).
  // wouter@3.x is pure ESM (`main: null, module: null`) which Sandpack v2's
  // bundler hangs on indefinitely. v2 has the SAME public API for what the
  // generator emits: useLocation/useRoute/Route/Switch/Link/Redirect.
  wouter: "^2.12.1",

  // ── Icons & UI primitives ─────────────────────────────────────────────────
  "lucide-react": "^0.460.0",
  "react-icons": "^5.3.0",

  // ── Utility CSS ───────────────────────────────────────────────────────────
  clsx: "^2.1.1",
  "tailwind-merge": "^2.5.4",
  "class-variance-authority": "^0.7.1",

  // ── Date & validation ─────────────────────────────────────────────────────
  "date-fns": "^3.6.0",
  zod: "^3.23.8",

  // ── Radix UI (todos los primitivos usados por shadcn/ui) ─────────────────
  "@radix-ui/react-accordion": "^1.2.0",
  "@radix-ui/react-alert-dialog": "^1.1.0",
  "@radix-ui/react-aspect-ratio": "^1.1.0",
  "@radix-ui/react-avatar": "^1.1.0",
  "@radix-ui/react-checkbox": "^1.1.0",
  "@radix-ui/react-collapsible": "^1.1.0",
  "@radix-ui/react-context-menu": "^2.2.0",
  "@radix-ui/react-dialog": "^1.1.0",
  "@radix-ui/react-dropdown-menu": "^2.1.0",
  "@radix-ui/react-hover-card": "^1.1.0",
  "@radix-ui/react-label": "^2.1.0",
  "@radix-ui/react-menubar": "^1.1.0",
  "@radix-ui/react-navigation-menu": "^1.2.0",
  "@radix-ui/react-popover": "^1.1.0",
  "@radix-ui/react-progress": "^1.1.0",
  "@radix-ui/react-radio-group": "^1.2.0",
  "@radix-ui/react-scroll-area": "^1.2.0",
  "@radix-ui/react-select": "^2.1.0",
  "@radix-ui/react-separator": "^1.1.0",
  "@radix-ui/react-slider": "^1.2.0",
  "@radix-ui/react-slot": "^1.1.0",
  "@radix-ui/react-switch": "^1.1.0",
  "@radix-ui/react-tabs": "^1.1.0",
  "@radix-ui/react-toast": "^1.2.0",
  "@radix-ui/react-toggle": "^1.1.0",
  "@radix-ui/react-toggle-group": "^1.1.0",
  "@radix-ui/react-tooltip": "^1.1.0",

  // ── Charts & data visualization ───────────────────────────────────────────
  recharts: "^2.13.0",

  // ── Animation ─────────────────────────────────────────────────────────────
  "framer-motion": "^11.3.0",

  // ── Forms ─────────────────────────────────────────────────────────────────
  "react-hook-form": "^7.53.0",
  "@hookform/resolvers": "^3.9.0",

  // ── Notifications & toasts ────────────────────────────────────────────────
  sonner: "^1.5.0",

  // ── Data fetching ─────────────────────────────────────────────────────────
  "@tanstack/react-query": "^5.56.0",

  // ── Carousel ─────────────────────────────────────────────────────────────
  "embla-carousel-react": "^8.3.0",

  // ── Date picker ───────────────────────────────────────────────────────────
  "react-day-picker": "^8.10.1",

  // ── Drawer / Sheet ────────────────────────────────────────────────────────
  vaul: "^0.9.9",

  // ── OTP input ─────────────────────────────────────────────────────────────
  "input-otp": "^1.2.4",

  // ── Resizable panels ──────────────────────────────────────────────────────
  "react-resizable-panels": "^2.1.3",

  // ── Command palette ───────────────────────────────────────────────────────
  cmdk: "^1.0.0",

  // ── Theme ─────────────────────────────────────────────────────────────────
  "next-themes": "^0.3.0",
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

  // Inyectamos el HTML y la base CSS locales. El preview no descarga Tailwind
  // ni otro compilador CSS remoto; las apps desplegadas conservan su pipeline
  // de estilos de producción propio.
  files["/index.html"] = PREVIEW_INDEX_HTML;
  files["/public/index.html"] = PREVIEW_INDEX_HTML;
  // Ensure vite.config.ts is NOT included (it was already in SKIP_PATHS but
  // some generators emit it under different paths). Sandpack's vite-react-ts
  // template ships its own vite config; a user-supplied one can break the build.
  delete files["/vite.config.ts"];
  delete files["/vite.config.js"];
  return files;
}
