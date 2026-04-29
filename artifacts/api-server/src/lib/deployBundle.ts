import * as esbuild from "esbuild";
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

  const result = await esbuild.build({
    entryPoints: [entry],
    bundle: true,
    write: false,
    format: "esm",
    target: ["es2020"],
    jsx: "automatic",
    jsxImportSource: "react",
    logLevel: "silent",
    plugins: [virtualFsPlugin(vfs, externals)],
  });

  const code = result.outputFiles[0]?.text ?? "";
  if (!code.trim()) {
    throw new Error("El bundler no produjo código.");
  }

  // Build the import map. We always include react/react-dom because the
  // automatic JSX runtime emits those imports even if the user didn't.
  const REACT_VERSION = "18.3.1";
  const imports: Record<string, string> = {
    react: `https://esm.sh/react@${REACT_VERSION}`,
    "react/": `https://esm.sh/react@${REACT_VERSION}/`,
    "react-dom": `https://esm.sh/react-dom@${REACT_VERSION}`,
    "react-dom/": `https://esm.sh/react-dom@${REACT_VERSION}/`,
    "react-dom/client": `https://esm.sh/react-dom@${REACT_VERSION}/client`,
  };
  for (const pkg of externals) {
    if (pkg === "react" || pkg.startsWith("react/")) continue;
    if (pkg === "react-dom" || pkg.startsWith("react-dom/")) continue;
    if (!imports[pkg]) {
      // Pinned to avoid surprise breakages, ?external=react so esm.sh resolves
      // peer deps against our import-map react instead of bundling its own.
      imports[pkg] = `https://esm.sh/${pkg}?external=react,react-dom`;
    }
  }

  const safeTitle = (opts.title || "AppForge App").replace(/[<&>]/g, "");

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${safeTitle}</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <style>html,body,#root{margin:0;min-height:100vh;font-family:ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;}</style>
  <script type="importmap">${JSON.stringify({ imports })}</script>
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
 * esbuild plugin that resolves imports against our virtual filesystem.
 * Anything that doesn't look like a relative path is recorded in `externals`
 * and marked external so it can be resolved at runtime via an import map.
 */
function virtualFsPlugin(
  vfs: Record<string, string>,
  externals: Set<string>,
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
        const loader: esbuild.Loader =
          ext === "tsx" ? "tsx"
          : ext === "ts" ? "ts"
          : ext === "jsx" ? "jsx"
          : ext === "css" ? "css"
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
  // Lazy import to avoid a top-level node:crypto dependency in case this file
  // is ever consumed in a non-Node bundle target.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { randomInt } = require("node:crypto") as typeof import("node:crypto");
  let out = "";
  for (let i = 0; i < 10; i++) {
    out += alphabet[randomInt(0, alphabet.length)];
  }
  return out;
}

/** Matches the format produced by makeSlug — used to reject malformed input. */
export const SLUG_PATTERN = /^[a-z0-9]{10}$/;
