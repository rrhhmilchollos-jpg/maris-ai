import { WebContainer, type FileSystemTree } from "@webcontainer/api";

/**
 * WebContainer is the StackBlitz in-browser Node.js runtime that powers the
 * "Live (real)" preview tab. Unlike Sandpack (which runs an esbuild-based
 * bundler simulation), WebContainer boots a real Node.js inside the browser,
 * runs `npm install` and `npm run dev` against the generated bundle, and
 * exposes a working dev server URL we can iframe.
 *
 * Critical constraints worth remembering before touching this file:
 *
 * 1) ONE container per tab. The library refuses to boot a second instance
 *    in the same page — it throws "WebContainer can only be created once".
 *    We expose a singleton via `getWebContainer()` and intentionally do NOT
 *    tear it down when the LivePreview component unmounts; the user can
 *    re-enter the tab and skip the multi-second boot.
 *
 * 2) Cross-origin isolation is required (SharedArrayBuffer). The vite config
 *    emits `Cross-Origin-Opener-Policy: same-origin` and
 *    `Cross-Origin-Embedder-Policy: require-corp` for both `server` and
 *    `preview`. Without those headers, `WebContainer.boot()` throws and
 *    `crossOriginIsolated` is false. We surface that early via
 *    `isWebContainerSupported()` so the UI can show a friendly fallback
 *    instead of a stack trace.
 *
 * 3) Chromium-only. Safari/Firefox lack the WebContainer runtime; the boot
 *    promise rejects with a descriptive error. The fallback path keeps
 *    Sandpack as the always-available preview.
 */

let bootPromise: Promise<WebContainer> | null = null;
let booted: WebContainer | null = null;

/**
 * Quick capability check used by the UI to decide whether to even try.
 * Returns false in: non-Chromium browsers, contexts without crossOriginIsolated
 * (missing COEP/COOP), and SSR. Cheap — just feature detection.
 */
export function isWebContainerSupported(): boolean {
  if (typeof window === "undefined") return false;
  if (typeof SharedArrayBuffer === "undefined") return false;
  // `crossOriginIsolated` is the standard signal that COOP+COEP are in effect.
  // Some embedded contexts (Replit dev iframe) may report false even when the
  // headers are present on this origin, so we still attempt boot when the
  // user explicitly clicks — this is a soft hint.
  return Boolean((window as unknown as { crossOriginIsolated?: boolean }).crossOriginIsolated);
}

/**
 * Lazily boot the singleton WebContainer. Subsequent calls return the same
 * instance (or wait on the in-flight boot if a second caller arrives during
 * the ~1-3s startup window).
 */
export async function getWebContainer(): Promise<WebContainer> {
  if (booted) return booted;
  if (!bootPromise) {
    bootPromise = WebContainer.boot().then((wc) => {
      booted = wc;
      return wc;
    }).catch((err) => {
      // Allow retrying after a transient boot failure.
      bootPromise = null;
      throw err;
    });
  }
  return bootPromise;
}

/**
 * Convert the flat `path -> contents` map produced by `parseBundle()` into
 * the nested `FileSystemTree` shape that `WebContainer#mount()` expects.
 *
 * Example input:
 *   { "src/App.tsx": "...", "package.json": "{...}" }
 * Example output:
 *   { src: { directory: { "App.tsx": { file: { contents: "..." } } } },
 *     "package.json": { file: { contents: "{...}" } } }
 */
export function buildFileTree(flat: Record<string, string>): FileSystemTree {
  const root: FileSystemTree = {};
  for (const [rawPath, contents] of Object.entries(flat)) {
    if (!rawPath || rawPath.startsWith("/")) continue;
    const parts = rawPath.split("/").filter(Boolean);
    if (parts.length === 0) continue;
    let cursor: FileSystemTree = root;
    for (let i = 0; i < parts.length - 1; i++) {
      const dirName = parts[i];
      const existing = cursor[dirName];
      if (
        existing &&
        typeof existing === "object" &&
        "directory" in existing &&
        existing.directory
      ) {
        cursor = existing.directory as FileSystemTree;
      } else {
        const fresh: FileSystemTree = {};
        cursor[dirName] = { directory: fresh };
        cursor = fresh;
      }
    }
    const fileName = parts[parts.length - 1];
    cursor[fileName] = { file: { contents } };
  }
  return root;
}

/**
 * Generated bundles MUST have a runnable `npm run dev` script for the live
 * preview to work. The Maris frontend prompt instructs the model to emit a
 * Vite-based package.json, but we can't trust that 100%, so we patch in
 * sensible defaults if anything is missing rather than failing the boot.
 *
 * Returns the (possibly patched) JSON string. Never throws — falls back to
 * a known-good minimal package.json if the input is unparseable.
 */
export function ensureDevScript(rawPackageJson: string | undefined): string {
  const FALLBACK = JSON.stringify(
    {
      name: "maris-live-preview",
      private: true,
      version: "0.0.0",
      type: "module",
      scripts: {
        dev: "vite --host 0.0.0.0 --port 5173",
        build: "vite build",
        preview: "vite preview",
      },
      dependencies: {
        react: "^19.1.0",
        "react-dom": "^19.1.0",
      },
      devDependencies: {
        "@vitejs/plugin-react": "^4.3.4",
        vite: "^6.0.7",
      },
    },
    null,
    2,
  );
  if (!rawPackageJson || !rawPackageJson.trim()) return FALLBACK;
  // Defensive normalization. The contract is "never throws" — anything we
  // can't safely turn into a plain object goes back as the fallback. That
  // covers `null`, arrays, primitives parsed from valid JSON, and any
  // unexpected runtime errors during the patch step.
  try {
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawPackageJson);
    } catch {
      return FALLBACK;
    }
    if (
      !parsed ||
      typeof parsed !== "object" ||
      Array.isArray(parsed)
    ) {
      return FALLBACK;
    }
    const obj = parsed as Record<string, unknown>;
    const scriptsRaw = obj.scripts;
    const scripts: Record<string, string> =
      scriptsRaw && typeof scriptsRaw === "object" && !Array.isArray(scriptsRaw)
        ? // Only keep string-valued entries — guards against pathological
          // shapes like `{ scripts: { dev: 123 } }` that would otherwise
          // produce an invalid package.json after re-serialization.
          Object.fromEntries(
            Object.entries(scriptsRaw as Record<string, unknown>).filter(
              ([, v]) => typeof v === "string",
            ),
          ) as Record<string, string>
        : {};
    // Force Vite to bind 0.0.0.0 inside the WebContainer; the default
    // `localhost` binding makes the dev server unreachable from the host
    // tab's iframe URL.
    if (!scripts.dev || !/--host/.test(scripts.dev)) {
      scripts.dev = "vite --host 0.0.0.0 --port 5173";
    }
    if (!scripts.build) scripts.build = "vite build";
    if (!scripts.preview) scripts.preview = "vite preview";
    obj.scripts = scripts;
    // Mark module type so plain `vite` ESM configs (vite.config.ts using ESM
    // syntax) load without warnings.
    if (obj.type !== "module" && obj.type !== "commonjs") {
      obj.type = "module";
    }
    return JSON.stringify(obj, null, 2);
  } catch {
    return FALLBACK;
  }
}
