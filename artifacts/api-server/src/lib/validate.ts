import * as esbuild from "esbuild";
import path from "node:path";

import { logger } from "./logger";

export interface BuildIssue {
  file: string;
  line?: number;
  column?: number;
  message: string;
}

export interface ValidationReport {
  ok: boolean;
  issues: BuildIssue[];
  filesAnalyzed: number;
  durationMs: number;
}

const FILE_MARKER = /\/\/\s*===\s*FILE:\s*(.+?)\s*===/g;

/**
 * Walk the VFS looking for `<Link …>` followed (eventually) by a child `<a …>`.
 * Wouter v3's Link IS the anchor, so nesting <a> creates invalid <a><a> markup
 * that breaks React reconciliation. We report each occurrence as a build issue
 * with file + line so the patcher can fix it on the next pass.
 */
function detectWouterAnchorNesting(
  vfs: Record<string, string>,
): BuildIssue[] {
  const issues: BuildIssue[] = [];
  for (const [file, contents] of Object.entries(vfs)) {
    if (!/\.(t|j)sx$/.test(file)) continue;
    if (!/<Link\b/.test(contents)) continue;
    // Match <Link …>  …  <a … where the gap between them is short AND contains
    // no `</Link>` (which would mean the <a> is a sibling, not a child).
    // Capped at 240 chars to keep the regex predictable on large files.
    const re =
      /<Link\b[^>]*>(?:(?!<\/Link>)[\s\S]){0,240}?<a\b/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(contents)) !== null) {
      const line = contents.slice(0, m.index).split("\n").length;
      issues.push({
        file,
        line,
        message:
          "Nested <a> inside <Link> (wouter v3). Flatten: move className/onClick onto <Link> and remove the inner <a>.",
      });
      if (issues.length > 10) return issues;
    }
  }
  return issues;
}

const SKIP_PREFIXES = ["tests/", "e2e/", "__tests__/", "test/"];
const SKIP_EXACT = new Set([
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

/**
 * Parse the '// === FILE: <path> ===' bundle into a virtual filesystem map.
 * Drops build configs, tests, e2e and markdown — same rules as the Sandpack parser.
 */
function parseBundleToVFS(bundle: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!bundle) return out;
  const matches: { path: string; index: number }[] = [];
  let m: RegExpExecArray | null;
  FILE_MARKER.lastIndex = 0;
  while ((m = FILE_MARKER.exec(bundle)) !== null) {
    matches.push({ path: m[1].trim(), index: m.index + m[0].length });
  }
  if (matches.length === 0) return out;
  for (let i = 0; i < matches.length; i++) {
    const start = matches[i].index;
    const end = i + 1 < matches.length
      ? bundle.lastIndexOf("// === FILE:", matches[i + 1].index)
      : bundle.length;
    const safeEnd = end > start ? end : bundle.length;
    let p = matches[i].path;
    if (p.startsWith("./")) p = p.slice(2);
    if (SKIP_EXACT.has(p)) continue;
    if (SKIP_PREFIXES.some((pre) => p.startsWith(pre))) continue;
    if (/\.(test|spec)\.[tj]sx?$/.test(p)) continue;
    if (/\.md$/.test(p)) continue;
    out[p] = bundle.slice(start, safeEnd).replace(/^\n+/, "").trimEnd();
  }
  return out;
}

/**
 * Resolve an import specifier inside the virtual filesystem.
 * Returns the matching VFS key or null.
 */
function resolveInVFS(
  importer: string,
  spec: string,
  vfs: Record<string, string>,
): string | null {
  // Absolute-from-root imports like "/src/App" → strip leading slash so they
  // line up with our VFS keys ("src/App.tsx"). Without this, valid imports
  // would be reported as "cannot resolve" and trigger pointless patches.
  let target: string;
  if (spec.startsWith("/")) {
    target = path.posix.normalize(spec.replace(/^\/+/, ""));
  } else {
    const baseDir = path.posix.dirname(importer);
    target = path.posix.normalize(path.posix.join(baseDir, spec));
  }
  const candidates: string[] = [];
  // Try exact + extensions + index variants.
  const exts = ["", ".tsx", ".ts", ".jsx", ".js"];
  for (const ext of exts) candidates.push(target + ext);
  for (const ext of exts.filter(Boolean)) candidates.push(`${target}/index${ext}`);
  for (const c of candidates) {
    if (vfs[c]) return c;
  }
  return null;
}

const CODE_LOADERS: Record<string, esbuild.Loader> = {
  ".tsx": "tsx",
  ".ts": "ts",
  ".jsx": "jsx",
  ".mjs": "js",
  ".cjs": "js",
  ".js": "js",
};
const EMPTY_LOADER_EXTS = new Set([
  ".css", ".scss", ".sass", ".less",
  ".svg", ".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico",
  ".json", ".woff", ".woff2", ".ttf", ".eot",
]);

/**
 * Build the bundle in memory using esbuild. Real, third-party packages are
 * marked external so we don't need them installed — we only check the user's
 * own code. Returns a structured list of build issues.
 *
 * This is the equivalent of "ejecutar el código" in the autonomous loop:
 * if it builds clean, the React app will run. If it doesn't, we have real
 * errors to feed back to the patcher.
 */
export async function validateBundle(bundle: string): Promise<ValidationReport> {
  const started = Date.now();
  const vfs = parseBundleToVFS(bundle);
  const filesAnalyzed = Object.keys(vfs).length;

  if (filesAnalyzed === 0) {
    return {
      ok: false,
      issues: [{ file: "(bundle)", message: "Empty or unparseable bundle." }],
      filesAnalyzed: 0,
      durationMs: Date.now() - started,
    };
  }

  // Find a sensible entry: prefer src/main.{tsx,ts}, then src/App.{tsx,ts}.
  const ENTRY_CANDIDATES = [
    "src/main.tsx", "src/main.ts", "src/main.jsx", "src/main.js",
    "src/index.tsx", "src/index.ts",
    "src/App.tsx", "src/App.ts", "src/App.jsx", "src/App.js",
  ];
  const entry = ENTRY_CANDIDATES.find((p) => vfs[p]);
  if (!entry) {
    return {
      ok: false,
      issues: [{
        file: "(bundle)",
        message: `No entry file found. Expected one of: ${ENTRY_CANDIDATES.join(", ")}`,
      }],
      filesAnalyzed,
      durationMs: Date.now() - started,
    };
  }

  const NAMESPACE = "appforge-vfs";

  try {
    const result = await esbuild.build({
      entryPoints: [entry],
      bundle: true,
      write: false,
      format: "esm",
      target: "es2020",
      jsx: "automatic",
      logLevel: "silent",
      // Treat all bare specifiers (npm packages) as external — we only validate
      // the user's own code structure, not third-party availability.
      packages: "external",
      loader: {
        ".ts": "ts",
        ".tsx": "tsx",
        ".js": "js",
        ".jsx": "jsx",
        ".mjs": "js",
        ".cjs": "js",
        ".css": "empty",
        ".scss": "empty",
        ".sass": "empty",
        ".less": "empty",
        ".svg": "empty",
        ".png": "empty",
        ".jpg": "empty",
        ".jpeg": "empty",
        ".gif": "empty",
        ".webp": "empty",
        ".ico": "empty",
        ".json": "empty",
      },
      plugins: [
        {
          name: "appforge-vfs",
          setup(build) {
            build.onResolve({ filter: /.*/ }, (args) => {
              // External packages handled by `packages: "external"`.
              if (args.kind === "entry-point") {
                return { path: args.path, namespace: NAMESPACE };
              }
              // Only relative/absolute imports go through the VFS.
              if (!args.path.startsWith(".") && !args.path.startsWith("/")) {
                return { external: true };
              }
              const resolved = resolveInVFS(args.importer, args.path, vfs);
              if (resolved) return { path: resolved, namespace: NAMESPACE };
              return {
                errors: [{
                  text: `Cannot resolve "${args.path}" from "${args.importer}"`,
                }],
              };
            });
            build.onLoad({ filter: /.*/, namespace: NAMESPACE }, (args) => {
              const ext = path.posix.extname(args.path).toLowerCase();
              // CSS / asset / font / json — never parse as JS, return empty so
              // imports like `./index.css` (Tailwind directives etc.) don't
              // generate spurious syntax errors that drive useless patches.
              if (EMPTY_LOADER_EXTS.has(ext)) {
                return { contents: "", loader: "empty" };
              }
              const contents = vfs[args.path];
              if (contents == null) {
                return {
                  errors: [{ text: `File "${args.path}" not in virtual FS` }],
                };
              }
              const loader = CODE_LOADERS[ext] ?? "ts";
              return { contents, loader };
            });
          },
        },
      ],
    });

    const issues: BuildIssue[] = result.errors.map((e) => ({
      file: e.location?.file ?? "(unknown)",
      line: e.location?.line,
      column: e.location?.column,
      message: e.text,
    }));

    // esbuild compiles cleanly even when JSX nests an <a> inside <Link>, but
    // wouter v3 renders <Link> AS the anchor — nested <a> blows up at runtime
    // with "Failed to execute 'removeChild' on 'Node'" and silently empties
    // the page. Catch the pattern statically so the patcher can fix it.
    issues.push(...detectWouterAnchorNesting(vfs));

    return {
      ok: issues.length === 0,
      issues,
      filesAnalyzed,
      durationMs: Date.now() - started,
    };
  } catch (err) {
    const buildErrors = (err as { errors?: esbuild.Message[] }).errors;
    if (Array.isArray(buildErrors) && buildErrors.length > 0) {
      const issues: BuildIssue[] = buildErrors.slice(0, 10).map((e) => ({
        file: e.location?.file ?? "(unknown)",
        line: e.location?.line,
        column: e.location?.column,
        message: e.text,
      }));
      return {
        ok: false,
        issues,
        filesAnalyzed,
        durationMs: Date.now() - started,
      };
    }
    logger.warn({ err }, "validateBundle: unexpected esbuild failure");
    return {
      ok: false,
      issues: [{ file: "(bundle)", message: (err as Error).message }],
      filesAnalyzed,
      durationMs: Date.now() - started,
    };
  }
}
