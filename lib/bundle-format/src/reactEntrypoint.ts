export const REACT_ENTRY_CANDIDATES = [
  "src/main.tsx", "src/main.ts", "src/main.jsx", "src/main.js",
  "src/index.tsx", "src/index.ts", "src/index.jsx", "src/index.js",
  "src/App.tsx", "src/App.ts", "src/App.jsx", "src/App.js",
  "frontend/src/main.tsx", "frontend/src/main.ts", "frontend/src/main.jsx", "frontend/src/main.js",
  "frontend/src/index.tsx", "frontend/src/index.ts", "frontend/src/index.jsx", "frontend/src/index.js",
  "frontend/src/App.tsx", "frontend/src/App.ts", "frontend/src/App.jsx", "frontend/src/App.js",
  "apps/web/src/main.tsx", "apps/web/src/main.ts", "apps/web/src/main.jsx", "apps/web/src/main.js",
  "apps/web/src/index.tsx", "apps/web/src/index.ts", "apps/web/src/index.jsx", "apps/web/src/index.js",
  "apps/web/src/App.tsx", "apps/web/src/App.ts", "apps/web/src/App.jsx", "apps/web/src/App.js",
] as const;

const SOURCE_FILE = /\.(?:tsx|ts|jsx|js)$/i;
const JSX_SIGNAL = /(?:return\s*\(?\s*<|=>\s*\(?\s*<|createRoot\s*\(|ReactDOM\.render\s*\(|<[A-Z][A-Za-z0-9_.-]*(?:\s|\/>|>))/;
const DEFAULT_EXPORT = /export\s+default\b/;
const NAMED_COMPONENT_EXPORT = /export\s+(?:function|const|class)\s+([A-Z][A-Za-z0-9_$]*)\b/;
const MOUNT_SIGNAL = /createRoot\s*\([\s\S]{0,240}?\.render\s*\(|ReactDOM\.render\s*\(/;

export interface ReactEntrypoint {
  entry: string;
  recovered: boolean;
  source?: string;
}

function likelyReactSource(file: string, source: string): boolean {
  if (!SOURCE_FILE.test(file) || !source.trim()) return false;
  return JSX_SIGNAL.test(source) && (DEFAULT_EXPORT.test(source) || NAMED_COMPONENT_EXPORT.test(source) || MOUNT_SIGNAL.test(source));
}

function recoveryDirectory(file: string): string {
  if (file.startsWith("frontend/src/")) return "frontend/src";
  if (file.startsWith("apps/web/src/")) return "apps/web/src";
  return "src";
}

function relativeModulePath(fromDir: string, target: string): string {
  const from = fromDir.split("/").filter(Boolean);
  const to = target.split("/").filter(Boolean);
  while (from.length && to.length && from[0] === to[0]) {
    from.shift();
    to.shift();
  }
  const up = from.map(() => "..");
  const path = [...up, ...to].join("/");
  return path.startsWith(".") ? path : `./${path}`;
}

function scoreCandidate(file: string, source: string): number {
  const basename = file.split("/").pop()?.replace(/\.[^.]+$/, "") || "";
  let score = 0;
  if (/^(App|Root|Main)$/i.test(basename)) score += 140;
  else if (/^(Layout|Home|Dashboard)$/i.test(basename)) score += 80;
  if (DEFAULT_EXPORT.test(source)) score += 70;
  if (MOUNT_SIGNAL.test(source)) score += 120;
  if (/\b(?:Router|Routes|BrowserRouter|NavigationContainer)\b/.test(source)) score += 30;
  if (/\b(?:useState|useEffect|useMemo|useReducer)\b/.test(source)) score += 10;
  score += Math.min(20, Math.floor(source.length / 2500));
  return score;
}

/**
 * Finds a React entrypoint and, when a bundle omitted a conventional App/main
 * file, creates a tiny App wrapper around a credible root component. The wrapper
 * is deliberately generated only in memory; callers that wish to persist it can
 * serialize the returned file map after validation succeeds.
 */
export function ensureReactEntrypoint(files: Record<string, string>): ReactEntrypoint | null {
  const direct = REACT_ENTRY_CANDIDATES.find((candidate) => Boolean(files[candidate]));
  if (direct) return { entry: direct, recovered: false };

  const ranked = Object.entries(files)
    .filter(([file, source]) => likelyReactSource(file, source))
    .sort(([fileA, sourceA], [fileB, sourceB]) => scoreCandidate(fileB, sourceB) - scoreCandidate(fileA, sourceA));
  const match = ranked[0];
  if (!match) return null;

  const [sourcePath, source] = match;
  // A non-standard file that mounts React itself is a valid entry without a
  // wrapper. This preserves its explicit provider tree and bootstrap code.
  if (MOUNT_SIGNAL.test(source)) return { entry: sourcePath, recovered: true, source: sourcePath };

  const directory = recoveryDirectory(sourcePath);
  const wrapper = `${directory}/App.tsx`;
  const relative = relativeModulePath(directory, sourcePath);
  if (DEFAULT_EXPORT.test(source)) {
    files[wrapper] = `// Entrada recuperada automáticamente por Maris AI.\nexport { default } from "${relative}";\n`;
    return { entry: wrapper, recovered: true, source: sourcePath };
  }

  const named = NAMED_COMPONENT_EXPORT.exec(source)?.[1];
  if (named) {
    files[wrapper] = `// Entrada recuperada automáticamente por Maris AI.\nimport { ${named} as RecoveredApp } from "${relative}";\nexport default RecoveredApp;\n`;
    return { entry: wrapper, recovered: true, source: sourcePath };
  }
  return null;
}

/**
 * Static HTML must not be inferred solely from the absence of a conventional
 * main.tsx. A React component can live under a non-standard path after an edit.
 */
export function hasRecoverableReactSource(files: Record<string, string>): boolean {
  return Boolean(ensureReactEntrypoint({ ...files }));
}

const LOCAL_STYLE_IMPORT = /import\s+(?:[\s\S]*?\s+from\s+)?["']([^"']+\.(?:css|scss|sass|less)(?:[?#][^"']*)?)["']\s*;?/g;

function normalizeVirtualPath(raw: string): string | null {
  const parts = raw.replace(/[?#].*$/, "").split("/");
  const output: string[] = [];
  for (const part of parts) {
    if (!part || part === ".") continue;
    if (part === "..") {
      if (!output.length) return null;
      output.pop();
      continue;
    }
    output.push(part);
  }
  return output.join("/") || null;
}

function localStyleTarget(importer: string, specifier: string): string | null {
  const clean = specifier.replace(/[?#].*$/, "");
  if (clean.startsWith(".")) {
    const base = importer.split("/").slice(0, -1).join("/");
    return normalizeVirtualPath(`${base}/${clean}`);
  }
  if (clean.startsWith("/")) return normalizeVirtualPath(clean.slice(1));
  if (clean.startsWith("@/")) {
    const root = importer.startsWith("frontend/src/")
      ? "frontend/src"
      : importer.startsWith("apps/web/src/")
        ? "apps/web/src"
        : "src";
    return normalizeVirtualPath(`${root}/${clean.slice(2)}`);
  }
  return null;
}

/**
 * A missing local stylesheet should never make an otherwise valid interface
 * fail to build. Create an empty, explicitly labelled stylesheet in the VFS so
 * imports such as `import "./App.css"` remain valid. Bare package styles are
 * intentionally untouched because their package manager resolves them.
 */
export function ensureLocalStyleFiles(files: Record<string, string>): string[] {
  const added: string[] = [];
  for (const [importer, source] of Object.entries(files)) {
    if (!SOURCE_FILE.test(importer)) continue;
    LOCAL_STYLE_IMPORT.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = LOCAL_STYLE_IMPORT.exec(source)) !== null) {
      const target = localStyleTarget(importer, match[1]);
      if (!target || files[target] != null) continue;
      files[target] = "/* Hoja de estilos vacía creada automáticamente por Maris AI para preservar un import local válido. */\n";
      added.push(target);
    }
  }
  return added;
}
