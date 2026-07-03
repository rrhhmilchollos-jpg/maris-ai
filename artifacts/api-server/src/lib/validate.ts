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

/**
 * esbuild's `packages: "external"` (necesario para validar solo el código del
 * usuario, no si los paquetes npm existen) significa que esbuild NUNCA puede
 * detectar "esta función no existe en este paquete real" — solo valida
 * sintaxis. CASO REAL ENCONTRADO EN PRODUCCIÓN (app "MesaYa"): un archivo
 * importaba `useNavigate` de "wouter" (existe en react-router-dom, no en
 * wouter) — esbuild lo validaba como sintácticamente correcto, todos los
 * ciclos de reparación automática lo daban por bueno, y la app crasheaba en
 * el navegador real con "module does not provide an export named...". El
 * error pasó completamente desapercibido por todas las validaciones
 * automáticas durante DOS reparaciones distintas, hasta que un humano abrió
 * el preview real.
 *
 * Esta función mantiene una lista corta y de mantenimiento bajo de
 * confusiones conocidas y confirmadas entre paquetes similares — no intenta
 * resolver tipos reales de cada paquete (sería mucho más caro y complejo),
 * solo atrapa los patrones específicos que YA hemos visto romper apps reales.
 */
const KNOWN_BAD_PACKAGE_IMPORTS: Array<{ pattern: RegExp; message: string }> = [
  {
    pattern: /import\s*\{[^}]*\buseNavigate\b[^}]*\}\s*from\s*["']wouter["']/,
    message: "useNavigate does not exist in \"wouter\" (it's from react-router-dom). Use: const [, setLocation] = useLocation(); then setLocation(\"/path\") instead of navigate(\"/path\").",
  },
  {
    pattern: /import\s*\{[^}]*\buseHistory\b[^}]*\}\s*from\s*["']wouter["']/,
    message: "useHistory does not exist in \"wouter\" (it's from react-router-dom v5). Use: const [, setLocation] = useLocation(); then setLocation(\"/path\") to navigate.",
  },
  {
    pattern: /import\s*\{[^}]*\buseParams\b[^}]*\}\s*from\s*["']wouter["']/,
    message: "useParams does not exist in \"wouter\" (it's from react-router-dom). Use: const [match, params] = useRoute(\"/path/:id\"); then params.id.",
  },
];

function detectKnownBadPackageImports(
  vfs: Record<string, string>,
): BuildIssue[] {
  const issues: BuildIssue[] = [];
  for (const [file, contents] of Object.entries(vfs)) {
    if (!/\.(t|j)sx?$/.test(file)) continue;
    for (const { pattern, message } of KNOWN_BAD_PACKAGE_IMPORTS) {
      const m = pattern.exec(contents);
      if (m) {
        const line = contents.slice(0, m.index).split("\n").length;
        issues.push({ file, line, message });
      }
    }
    if (issues.length > 10) return issues;
  }
  return issues;
}

/**
 * DETECCIÓN DE ROUTER CATCH-ALL MAL POSICIONADO (causa raíz #1 de 404 en apps generadas).
 * Detecta cuando una ruta catch-all (<Route path="*"> o <Route> sin path, que renderiza
 * NotFound/404) está ANTES de las rutas reales dentro de un <Switch>. En wouter (y
 * react-router), el primer match gana — si el catch-all está primero, TODAS las rutas
 * muestran 404.
 *
 * ENCONTRADO EN PRODUCCIÓN: app "Clínica Dental" (pepepepe00089@gmail.com) — pasó
 * esbuild + testing + QA sin issues, pero el evaluador visual detectó 404 en todas
 * las rutas. La causa era exactamente este patrón: <Route component={NotFound}/>
 * colocado como primer hijo de <Switch>.
 */
function detectCatchAllBeforeRoutes(vfs: Record<string, string>): BuildIssue[] {
  const issues: BuildIssue[] = [];
  for (const [file, contents] of Object.entries(vfs)) {
    if (!/\.(t|j)sx$/.test(file)) continue;
    // Soportar tanto <Switch> (wouter) como <Routes> (react-router-dom v6)
    const hasSwitch = /<Switch/.test(contents);
    const hasRoutes = /<Routes/.test(contents);
    if (!hasSwitch && !hasRoutes) continue;

    // Extraer cada bloque <Switch>...</Switch> o <Routes>...</Routes>
    const containerTag = hasSwitch ? "Switch" : "Routes";
    const containerRegex = new RegExp(`<${containerTag}[^>]*>([\\s\\S]*?)<\\/${containerTag}>`, "g");
    let switchMatch: RegExpExecArray | null;
    while ((switchMatch = containerRegex.exec(contents)) !== null) {
      const switchBody = switchMatch[1];
      // Encontrar todas las <Route ...> dentro del Switch/Routes
      const routeRegex = /<Route\b([^>]*?)(?:\/>|>)/g;
      const routes: Array<{ props: string; index: number; isCatchAll: boolean }> = [];
      let routeMatch: RegExpExecArray | null;
      while ((routeMatch = routeRegex.exec(switchBody)) !== null) {
        const props = routeMatch[1];
        // Un catch-all es: path="*" O sin atributo path (solo component={NotFound})
        const hasStar = /path\s*=\s*["'][*]["']/.test(props);
        const hasNoPath = !/path\s*=/.test(props);
        const looksLike404 = /NotFound|not-found|Error404|Page404|NoMatch/i.test(props);
        const isCatchAll = hasStar || (hasNoPath && looksLike404);
        routes.push({ props, index: routeMatch.index, isCatchAll });
      }
      // Si hay un catch-all Y no es el último, es un bug
      const catchAllIndices = routes.map((r, i) => r.isCatchAll ? i : -1).filter(i => i !== -1);
      for (const idx of catchAllIndices) {
        if (idx < routes.length - 1) {
          // Hay rutas DESPUÉS del catch-all — bug confirmado
          const line = contents.slice(0, switchMatch.index + routes[idx].index).split("\n").length;
          issues.push({
            file,
            line,
            message: `Catch-all/404 route is NOT the last child of <${containerTag}>. This causes ALL routes to show 404. Move <Route path="*"> to the LAST position inside <${containerTag}>.`,
          });
          break; // Un issue por container es suficiente
        }
      }
    }
  }
  return issues;
}

/**
 * DETECCIÓN DE RUTA RAÍZ AUSENTE O VACÍA.
 * Si el archivo de router (App.tsx o equivalente) tiene un <Switch>/<Routes> pero NO
 * tiene una <Route path="/"> que renderice algo, la app mostrará 404 o
 * pantalla en blanco en la URL base.
 */
function detectMissingRootRoute(vfs: Record<string, string>): BuildIssue[] {
  const issues: BuildIssue[] = [];
  // Solo verificar en archivos que parezcan ser el router principal
  const routerFiles = Object.entries(vfs).filter(([file, contents]) =>
    /\.(t|j)sx$/.test(file) &&
    (/<Switch/.test(contents) || /<Routes/.test(contents)) &&
    (file.includes("App") || file.includes("Router") || file.includes("router") || file.includes("routes"))
  );
  for (const [file, contents] of routerFiles) {
    const containerTag = /<Switch/.test(contents) ? "Switch" : "Routes";
    // Verificar si hay una ruta para "/"
    // react-router-dom v6 usa path="/" o index (sin path explícito pero con prop index)
    const hasRootRoute = /<Route\b[^>]*path\s*=\s*["']\/["'][^>]*/.test(contents) ||
                         /<Route\b[^>]*path\s*=\s*\{\s*["']\/["']\s*\}[^>]*/.test(contents) ||
                         /<Route\b[^>]*\bindex\b[^>]*/.test(contents);
    if (!hasRootRoute) {
      const containerPos = contents.indexOf(`<${containerTag}`);
      const containerLine = containerPos >= 0 ? contents.slice(0, containerPos).split("\n").length : 1;
      issues.push({
        file,
        line: containerLine,
        message: `No <Route path="/"> found inside <${containerTag}>. The app will show 404 or blank page at the root URL. Add a route for path="/" that renders the main/home component.`,
      });
    }
  }
  return issues;
}

/**
 * DETECCIÓN DE EXPORTS/IMPORTS INCONSISTENTES.
 * Cuando un archivo importa `import X from "./Component"` pero el archivo
 * destino solo tiene `export function X` (named, no default), o viceversa,
 * React recibe `undefined` como componente y no renderiza nada — sin error
 * de build porque esbuild con packages:external no valida esto.
 */
function detectExportImportMismatch(vfs: Record<string, string>): BuildIssue[] {
  const issues: BuildIssue[] = [];
  // Mapear qué tipo de export tiene cada archivo
  const exportInfo = new Map<string, { hasDefault: boolean; namedExports: string[] }>();
  for (const [file, contents] of Object.entries(vfs)) {
    if (!/\.(t|j)sx?$/.test(file)) continue;
    const hasDefault = /export\s+default\b/.test(contents);
    const namedExports: string[] = [];
    const namedRe = /export\s+(?:function|const|class|let|var|type|interface)\s+(\w+)/g;
    let nm: RegExpExecArray | null;
    while ((nm = namedRe.exec(contents)) !== null) {
      namedExports.push(nm[1]);
    }
    exportInfo.set(file, { hasDefault, namedExports });
  }

  // Verificar imports default que apuntan a archivos sin export default
  for (const [file, contents] of Object.entries(vfs)) {
    if (!/\.(t|j)sx?$/.test(file)) continue;
    // import Something from "./path"
    const defaultImportRe = /import\s+(\w+)\s+from\s+["'](\.[\/][^"']+)["']/g;
    let dim: RegExpExecArray | null;
    while ((dim = defaultImportRe.exec(contents)) !== null) {
      const importedName = dim[1];
      const specifier = dim[2];
      const resolved = resolveInVFS(file, specifier, vfs);
      if (!resolved) continue; // Cannot resolve — already caught by esbuild
      const info = exportInfo.get(resolved);
      if (info && !info.hasDefault) {
        // El archivo no tiene export default pero se importa como default
        const line = contents.slice(0, dim.index).split("\n").length;
        issues.push({
          file,
          line,
          message: `Default import "${importedName}" from "${specifier}" but "${resolved}" has NO export default. Use named import: import { ${importedName} } from "${specifier}" — or add "export default" to the target file.`,
        });
        if (issues.length > 8) return issues;
      }
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
export function parseBundleToVFS(bundle: string): Record<string, string> {
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
  logger.info("VALIDATOR: Iniciando validación de bundle...");
  const vfs = parseBundleToVFS(bundle);
  const filesAnalyzed = Object.keys(vfs).length;
  logger.info({ filesAnalyzed }, "VALIDATOR: Bundle parseado.");

  if (filesAnalyzed === 0) {
    // Mensaje mejorado que ayuda al usuario a entender qué salió mal
    const diagnosticMsg = bundle.length === 0
      ? "Empty bundle: no code was provided."
      : bundle.includes("// === FILE:")
        ? "Bundle has FILE markers but no valid files were extracted. Check the format of separators."
        : "No FILE markers found. Expected format: '// === FILE: <path> ===' followed by code.";
    
    return {
      ok: false,
      issues: [{ file: "(bundle)", message: `Empty or unparseable bundle. ${diagnosticMsg}` }],
      filesAnalyzed: 0,
      durationMs: Date.now() - started,
    };
  }

  // Find a sensible entry: prefer src/main.{tsx,ts}, then src/App.{tsx,ts}.
  // Candidatos de entrada para apps SPA estándar Y monorepos (apps/web/src/...)
  const ENTRY_CANDIDATES = [
    "src/main.tsx", "src/main.ts", "src/main.jsx", "src/main.js",
    "src/index.tsx", "src/index.ts",
    "src/App.tsx", "src/App.ts", "src/App.jsx", "src/App.js",
    // Monorepo paths (CoreOrchestrator milestone apps)
    "apps/web/src/main.tsx", "apps/web/src/main.ts",
    "apps/web/src/App.tsx", "apps/web/src/App.ts",
    "apps/web/src/index.tsx", "apps/web/src/index.ts",
  ];
  let entry = ENTRY_CANDIDATES.find((p) => vfs[p]);
  if (!entry) {
    // Para monorepos con rutas no estándar, usar el primer archivo .tsx/.ts
    // que contenga "export default function" como fallback en vez de rechazar
    const fallbackEntry = Object.keys(vfs).find(p =>
      (p.endsWith('.tsx') || p.endsWith('.ts') || p.endsWith('.jsx')) &&
      vfs[p].includes('export default function')
    );
    if (!fallbackEntry) {
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
    // Usar el archivo de fallback (monorepo o ruta no estándar) — copiar su
    // contenido a src/App.tsx Y apuntar 'entry' ahí. Antes solo se hacía lo
    // primero: 'entry' (const) nunca se reasignaba, así que esbuild recibía
    // entryPoints: [undefined] y fallaba de todas formas.
    vfs["src/App.tsx"] = vfs[fallbackEntry];
    entry = "src/App.tsx";
  }

  const NAMESPACE = "appforge-vfs";

  try {
    logger.info({ entry: entry || "src/App.tsx (fallback)" }, "VALIDATOR: Ejecutando esbuild.build...");
    const result = await esbuild.build({
      entryPoints: [entry],
      bundle: true,
      write: false,
      // outdir is required as soon as the bundle imports any non-JS asset
      // (.css, .svg, …) — even with `write: false` and an "empty" loader,
      // esbuild needs an output path to compute relative URLs for the asset
      // chunks. We never write to it because of `write: false`, but without
      // it esbuild fails with "Cannot import X into a JavaScript file without
      // an output path configured" the moment the user adds `import "./x.css"`.
      outdir: "/tmp/appforge-validate-out",
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
    // Same idea, different failure mode: imports that exist in a similar,
    // more popular package (react-router-dom) but NOT in the package this
    // bundle actually uses (wouter) — esbuild's packages:"external" means it
    // never resolves real exports, so this slips through silently and only
    // surfaces as a runtime crash in the real browser.
    issues.push(...detectKnownBadPackageImports(vfs));
    // Validaciones estructurales de router — detectan 404/blank page ANTES
    // de que el evaluador visual tenga que hacerlo (ahorra un ciclo completo
    // de evaluación + auto-fix que antes era necesario para cada app con
    // este bug).
    issues.push(...detectCatchAllBeforeRoutes(vfs));
    issues.push(...detectMissingRootRoute(vfs));
    // Detección de export/import mismatch — causa raíz de componentes que
    // "no renderizan" sin error visible.
    issues.push(...detectExportImportMismatch(vfs));

    const ok = issues.length === 0;
    logger.info({ ok, issuesCount: issues.length, duration: Date.now() - started }, "VALIDATOR: Finalizado con éxito.");
    return {
      ok,
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
