import * as esbuild from "esbuild";
import path from "node:path";

import { parseFileMarkers, isStaticHtmlBundle, ensureReactEntrypoint, ensureLocalStyleFiles, REACT_ENTRY_CANDIDATES } from "@workspace/bundle-format";
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

// Un bundle puede compilar y aun así entregar una pantalla temporal en vez de
// una aplicación. Este patrón coincide exclusivamente con los placeholders
// internos conocidos; no bloquea copy legítimo como una página de mantenimiento
// solicitada explícitamente por el usuario.
export function hasVisibleDeliveryPlaceholder(bundle: string): boolean {
  return /(?:<p[^>]*>\s*(?:Módulo en construcción|Este módulo se está generando)\.?\s*<\/p>|<h1[^>]*>\s*(?:App|Home|Component)\s*<\/h1>\s*<p[^>]*>\s*Módulo en construcción|Cargando\s+[A-Za-z_$][\w$.-]*\.\.\.\s*<\/h1>\s*<p[^>]*>\s*Este módulo se está generando)/i.test(bundle);
}

function detectEmptySourceFiles(vfs: Record<string, string>): BuildIssue[] {
  const issues: BuildIssue[] = [];
  for (const [file, contents] of Object.entries(vfs)) {
    if (!/\.(t|j)sx?$/.test(file)) continue;
    if (contents.trim().length === 0) {
      issues.push({ file, message: "Empty source file. A deliverable bundle cannot contain blank TS/JS source files." });
    }
  }
  return issues;
}

function detectNonRenderableReactEntry(
  entry: string,
  vfs: Record<string, string>,
  recoveredRootSource?: string,
): BuildIssue[] {
  const entrySource = vfs[entry] || "";
  if (!/\.(t|j)sx?$/.test(entry)) return [];
  // React permite compilar `return null` y fragmentos vacíos, pero ambos dejan
  // la preview sin interfaz. En Vite el entry suele ser main.tsx (solo monta
  // <App />), por lo que inspeccionamos también el archivo raíz App.*.
  const rootCandidates = [
    { file: entry, source: entrySource },
    ...Object.entries(vfs)
      .filter(([file]) => /(^|\/)App\.(t|j)sx?$/.test(file) && file !== entry)
      .map(([file, source]) => ({ file, source })),
    ...(recoveredRootSource && recoveredRootSource !== entry && vfs[recoveredRootSource]
      ? [{ file: recoveredRootSource, source: vfs[recoveredRootSource] }]
      : []),
  ];
  for (const candidate of rootCandidates) {
    const returnsNull = /return\s*(?:\([^)]*\)\s*)?null\s*;?/.test(candidate.source);
    const returnsEmptyFragment = /return\s*\(\s*<>\s*<\/>\s*\)/.test(candidate.source);
    if (returnsNull || returnsEmptyFragment) {
      return [{
        file: candidate.file,
        message: "React root returns no visible interface. Refusing to deliver a blank application.",
      }];
    }
  }
  // Un wrapper técnico de recuperación puede limitarse a reexportar el
  // componente. En ese caso la interfaz verificable está en la fuente raíz
  // recuperada, no en el wrapper; se validan ambas sin relajar el control.
  const rendersJsx = rootCandidates.some(({ source }) =>
    /return\s*\(\s*<[A-Za-z]|return\s+<[A-Za-z]|=>\s*\(\s*<[A-Za-z]|=>\s*<[A-Za-z]/.test(source),
  );
  // `src/main.tsx` de Vite no retorna JSX: monta <App /> con createRoot.
  // Es una entrada válida y no debe confundirse con una pantalla en blanco.
  const mountsReactTree = rootCandidates.some(({ source }) =>
    /createRoot[\s\S]{0,240}?\.render\s*\(\s*<|ReactDOM\.render\s*\(\s*</.test(source),
  );
  if (!rendersJsx && !mountsReactTree) {
    return [{
      file: entry,
      message: "React entry does not contain a renderable JSX interface. Refusing to deliver a blank or non-visual application.",
    }];
  }
  return [];
}

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
    // wouter v3 only exposes named exports. esbuild treats packages as
    // external during VFS validation, so it otherwise cannot see this until
    // the browser throws: "module does not provide an export named default".
    pattern: /import\s+(?!type\b)[A-Za-z_$][\w$]*\s*(?:,\s*\{[^}]*\})?\s+from\s*["']wouter["']/,
    message: "wouter does not provide a default export. Replace the default import with the named symbols used by this file, for example: import { Link, Route, Switch, useLocation } from \"wouter\";.",
  },
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
  // ENCONTRADO EN PRODUCCIÓN (app "La Taberna del Mar", importada por el
  // usuario y revisada manualmente): las 3 reglas de arriba solo atrapan
  // "hook de react-router-dom importado por error DESDE wouter" -- no
  // atrapan el caso de que un archivo importe DIRECTAMENTE el paquete real
  // "react-router-dom" (BrowserRouter, Routes, Route, Navigate...), que es
  // una importación 100% válida en sí misma, solo que del paquete
  // equivocado para un proyecto que en el resto de archivos usa wouter.
  // Este patrón es aún más peligroso que los 3 anteriores porque esbuild
  // lo valida sin ningún problema (react-router-dom si es una dependencia
  // real instalada) y ni siquiera lanza el error de "export no encontrado"
  // en el navegador -- simplemente crea DOS sistemas de rutas
  // incompatibles conviviendo en la misma app, con la navegación real rota
  // de forma silenciosa (los <Link> de wouter no funcionan dentro de un
  // <BrowserRouter> de react-router-dom, y viceversa).
  {
    pattern: /import\s*\{[^}]*\}\s*from\s*["']react-router-dom["']/,
    message: "This project uses \"wouter\" for routing, not react-router-dom — importing directly from \"react-router-dom\" creates two incompatible routing systems in the same app (navigation will silently break even though the code compiles). Convert EVERY react-router-dom API in this file to its wouter equivalent, following this exact mapping:\n" +
      "  import { BrowserRouter, Routes, Route, Navigate, useNavigate, useParams, useLocation as useLocationRRD } from 'react-router-dom';\n" +
      "  →\n" +
      "  import { Router, Switch, Route, Redirect, useLocation, useRoute } from 'wouter';\n" +
      "  <BrowserRouter> → <Router> (or remove entirely if there's no hash/base config — wouter works without a wrapper)\n" +
      "  <Routes> → <Switch>\n" +
      "  <Route path=\"/x\" element={<Y/>} /> → <Route path=\"/x\" component={Y} /> (extract the component reference from inside element={}, do NOT keep the element prop)\n" +
      "  <Navigate to=\"/x\" replace /> → <Redirect to=\"/x\" />\n" +
      "  const navigate = useNavigate(); ...; navigate(\"/x\") → const [, setLocation] = useLocation(); ...; setLocation(\"/x\")\n" +
      "  const { id } = useParams(); (inside a component rendered at e.g. path=\"/item/:id\") → const [match, params] = useRoute(\"/item/:id\"); const id = params?.id; — IMPORTANT: you must find the actual :param route this component is rendered under (check the parent <Route path=...>) and use that exact same path string in useRoute, otherwise params will always be undefined.\n" +
      "  After converting, remove the react-router-dom import completely — there must be zero references to \"react-router-dom\" left in this file.",
  },
  // Mismo problema de fondo, otras 3 formas de escribir el import que la
  // regla de arriba (con llaves) no cazaba: namespace, por defecto, y
  // dinámico. A petición explícita del usuario tras confirmar que la
  // primera regla dejaba estos huecos.
  {
    pattern: /import\s*\*\s*as\s+\w+\s*from\s*["']react-router-dom["']/,
    message: "This project uses \"wouter\" for routing, not react-router-dom (namespace import detected: import * as X from \"react-router-dom\"). Remove it and use wouter's equivalents instead.",
  },
  {
    pattern: /import\s+\w+\s*from\s*["']react-router-dom["']/,
    message: "This project uses \"wouter\" for routing, not react-router-dom (default import detected). Remove it and use wouter's equivalents instead.",
  },
  {
    pattern: /import\(\s*["']react-router-dom["']\s*\)/,
    message: "This project uses \"wouter\" for routing, not react-router-dom (dynamic import detected). Remove it and use wouter's equivalents instead.",
  },
];

/**
 * esbuild no considera error que JSX use una variable global inexistente. En
 * producción eso dejó previews en blanco, por ejemplo `useEffect(...)` sin
 * `import { useEffect } from "react"`. Detectamos cada hook estándar llamado
 * de forma directa y exigimos su import nombrado antes de entregar el bundle.
 */
function detectMissingReactHookImports(vfs: Record<string, string>): BuildIssue[] {
  const issues: BuildIssue[] = [];
  const hooks = ["useState", "useEffect", "useMemo", "useCallback", "useRef", "useContext", "useReducer", "useLayoutEffect"];
  for (const [file, contents] of Object.entries(vfs)) {
    if (!/\.(t|j)sx$/.test(file)) continue;
    const reactImports = Array.from(contents.matchAll(/import\s*(?:[\w$*]+\s*,?\s*)?\{([\s\S]*?)\}\s*from\s*["']react["']/g))
      .flatMap((match) => match[1].split(",").map((part) => part.trim().split(/\s+as\s+/)[0].trim()));
    for (const hook of hooks) {
      const directCall = new RegExp(`(?<![.$\\w])${hook}\\s*\\(`).exec(contents);
      if (directCall && !reactImports.includes(hook)) {
        const line = contents.slice(0, directCall.index).split("\n").length;
        issues.push({ file, line, message: `${hook} is called but is not imported from "react". Add it to the named React import, for example: import { ${hook} } from "react";.` });
      }
    }
  }
  return issues;
}

/**
 * React solo permite llamar hooks durante el render de un componente o hook
 * personalizado. Esbuild acepta `const [x] = useState()` a nivel de módulo,
 * pero React falla en el navegador con `useState` nulo. Rechazamos ese patrón
 * antes de reemplazar una versión sana por una vista previa que no puede montar.
 */
function detectTopLevelReactHookCalls(vfs: Record<string, string>): BuildIssue[] {
  const issues: BuildIssue[] = [];
  const hooks = ["useState", "useEffect", "useMemo", "useCallback", "useRef", "useContext", "useReducer", "useLayoutEffect"];

  for (const [file, contents] of Object.entries(vfs)) {
    if (!/\.(t|j)sx$/.test(file)) continue;

    const firstComponent = contents.search(/(?:export\s+default\s+)?function\s+[A-Z][\w$]*\s*\(|(?:const|let|var)\s+[A-Z][\w$]*\s*=\s*(?:async\s*)?(?:\([^)]*\)|[\w$]+)\s*=>/);
    const moduleScopeEnd = firstComponent >= 0 ? firstComponent : contents.length;

    for (const hook of hooks) {
      const call = new RegExp(`(?<![.$\\w])${hook}\\s*\\(`).exec(contents);
      if (!call || call.index >= moduleScopeEnd) continue;
      const line = contents.slice(0, call.index).split("\n").length;
      issues.push({
        file,
        line,
        message: `${hook} is called at module scope. Move the hook inside a React component or a custom hook before delivering this preview.`,
      });
    }
  }

  return issues;
}

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
  // Núcleo de análisis compartido con exportZip.ts (ver parseFileMarkers)
  // -- antes esta función tenía su propia copia completa del bucle de
  // extracción, ahora solo aplica su filtrado específico (excluir tests,
  // configs, .md) encima del resultado común.
  const raw = parseFileMarkers(bundle);
  const out: Record<string, string> = {};
  for (const [p, content] of Object.entries(raw)) {
    if (SKIP_EXACT.has(p)) continue;
    if (SKIP_PREFIXES.some((pre) => p.startsWith(pre))) continue;
    if (/\.(test|spec)\.[tj]sx?$/.test(p)) continue;
    if (/\.md$/.test(p)) continue;
    // parseFileMarkers añade un "\n" final (pensado para exportar a zip);
    // aquí se quita para mantener el comportamiento exacto de antes.
    out[p] = content.replace(/\n$/, "");
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
  // CAUSA RAÍZ REAL del bucle infinito "1 problema(s)" del Testing Agent
  // (encontrada con los logs de producción del proyecto "Club Paladium",
  // filesAnalyzed: 0 con bundleLength: 44172): parseBundleToVFS DESCARTA
  // "index.html" vía SKIP_EXACT (correcto para proyectos React, donde es
  // boilerplate), pero para un proyecto HTML estático de UN SOLO archivo
  // index.html eso deja el VFS COMPLETAMENTE VACÍO. Entonces:
  //   1. isStaticHtmlBundle(vfs) daba false (¡index.html ya no estaba!)
  //   2. filesAnalyzed === 0 → issue "Empty or unparseable bundle"
  //   3. el Testing Agent mandaba ese falso error al patcher LLM, que
  //      regeneraba el HTML (intacto), se volvía a descartar, y así en
  //      bucle hasta agotar todos los ciclos — minutos de LLM quemados en
  //      "reparar" un proyecto que estaba perfecto.
  // FIX: comprobar isStaticHtmlBundle sobre los archivos CRUDOS del bundle
  // (antes de cualquier filtrado), igual que hace deployAppToVercel — el
  // despliegue real, que por eso nunca fallaba con estos proyectos.
  const rawFiles = parseFileMarkers(bundle);
  if (isStaticHtmlBundle(rawFiles)) {
    if (hasVisibleDeliveryPlaceholder(bundle)) {
      return {
        ok: false,
        issues: [{ file: "index.html", message: "Static bundle contains a delivery placeholder instead of a functional interface." }],
        filesAnalyzed: Object.keys(rawFiles).length,
        durationMs: Date.now() - started,
      };
    }
    logger.info("VALIDATOR: bundle es un proyecto HTML estático (detectado sobre archivos crudos) -- válido sin punto de entrada React");
    return { ok: true, issues: [], filesAnalyzed: Object.keys(rawFiles).length, durationMs: Date.now() - started };
  }

  // ENCONTRADO A PETICION DEL USUARIO (caso real: "Pre-Deployment Health
  // Check" marcando 2 incidencias falsas -- "no entry file" y "no FILE
  // markers" -- en un proyecto importado que es HTML estatico puro, sin
  // React en absoluto). Esta funcion se disenó para validar codigo React
  // generado por IA durante el ciclo de reparacion (tester.ts) -- nunca
  // tuvo en cuenta que un bundle valido puede ser simplemente un
  // index.html autocontenido, sin ningun punto de entrada React que
  // buscar. deployAppToVercel (el codigo que SI hace el despliegue real)
  // ya reconoce esto correctamente (variable isStaticHtml) -- esta
  // funcion de validacion, usada tambien como "chequeo previo" separado
  // del despliegue real, no lo reconocia, dando una falsa alarma que
  // asustaba sin motivo aunque el deploy fuera a funcionar bien.
  // ENCONTRADO A PETICION DEL USUARIO (caso real: tras el primer fix, el
  // Health Check bajó de 2 a 1 incidencia -- la del backend se arregló,
  // pero la del frontend seguía apareciendo). CAUSA: mi comprobación
  // anterior exigía que el bundle tuviera EXACTAMENTE un único archivo
  // (index.html a solas) -- demasiado estricta. Un proyecto estático real
  // suele tener MÁS archivos (CSS aparte, imágenes, etc.), y esa
  // comprobación nunca coincidía para esos casos. Corregido para usar
  // EXACTAMENTE la misma lógica que ya usa deployAppToVercel (la función
  // que hace el despliegue real) -- "isStaticHtml": no hay ningún archivo
  // de entrada React conocido Y existe un index.html, sin importar
  // cuántos otros archivos acompañen. Ahora importada de
  // @workspace/bundle-format, para que los dos sitios NUNCA puedan volver
  // a desincronizarse entre sí.
  if (isStaticHtmlBundle(vfs)) {
    if (hasVisibleDeliveryPlaceholder(bundle)) {
      return {
        ok: false,
        issues: [{ file: "index.html", message: "Static bundle contains a delivery placeholder instead of a functional interface." }],
        filesAnalyzed,
        durationMs: Date.now() - started,
      };
    }
    logger.info("VALIDATOR: bundle es un proyecto HTML estático (con o sin CSS/JS aparte) -- válido sin punto de entrada React");
    return { ok: true, issues: [], filesAnalyzed, durationMs: Date.now() - started };
  }

  // Los modelos pueden mantener un import local de CSS después de que una
  // edición haya consolidado estilos en index.css. Materializamos un CSS vacío
  // en memoria: el componente sigue compilando y el bundle original no se toca.
  const restoredStyleFiles = ensureLocalStyleFiles(vfs);
  if (restoredStyleFiles.length > 0) {
    logger.info({ files: restoredStyleFiles }, "VALIDATOR: imports CSS locales recuperados en memoria");
  }

  if (filesAnalyzed === 0) {
    // Mensaje mejorado que ayuda al usuario a entender qué salió mal
    const diagnosticMsg = bundle.length === 0
      ? "Empty bundle: no code was provided."
      : bundle.includes("// === FILE:")
        ? "Bundle has FILE markers but no valid files were extracted. Check the format of separators."
        : "No FILE markers found. Expected format: '// === FILE: <path> ===' followed by code.";

    // ENCONTRADO A PETICION DEL USUARIO: este caso concreto (marcadores
    // presentes pero extracción fallida) se investigó a fondo sin poder
    // reproducirlo -- probado el archivo real, la extracción del ZIP, y
    // el análisis del bundle, los tres funcionan correctamente de forma
    // aislada. En vez de seguir adivinando, se incluye ahora un adelanto
    // real del contenido del bundle (primeros y últimos 300 caracteres)
    // en el propio mensaje de error -- la próxima vez que esto ocurra,
    // habrá datos reales que ver en vez de tener que reproducirlo a ciegas.
    const preview = bundle.length > 700
      ? `${bundle.slice(0, 300)}\n...[${bundle.length - 600} caracteres omitidos]...\n${bundle.slice(-300)}`
      : bundle;
    logger.warn({ bundleLength: bundle.length, bundlePreview: preview }, "VALIDATOR: bundle vacío/sin parsear -- contenido real para diagnóstico");

    return {
      ok: false,
      issues: [{ file: "(bundle)", message: `Empty or unparseable bundle. ${diagnosticMsg} [Longitud real: ${bundle.length} caracteres]` }],
      filesAnalyzed: 0,
      durationMs: Date.now() - started,
    };
  }

  // Resolver único para validación, preview y despliegue. Primero reconoce
  // las rutas Vite/CRA conocidas; si la IA dejó una raíz React válida bajo una
  // ruta no estándar, la envuelve en memoria sin sobrescribir archivos reales.
  const entrypoint = ensureReactEntrypoint(vfs);
  if (!entrypoint) {
    return {
      ok: false,
      issues: [{
        file: "(bundle)",
        message: `No React entry or recoverable root component found. Expected a conventional entry such as: ${REACT_ENTRY_CANDIDATES.join(", ")}`,
      }],
      filesAnalyzed,
      durationMs: Date.now() - started,
    };
  }
  const entry = entrypoint.entry;
  if (entrypoint.recovered) {
    logger.info({ entry, source: entrypoint.source }, "VALIDATOR: entrada React recuperada en memoria");
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
    issues.push(...detectMissingReactHookImports(vfs));
    issues.push(...detectTopLevelReactHookCalls(vfs));
    // Validaciones estructurales de router — detectan 404/blank page ANTES
    // de que el evaluador visual tenga que hacerlo (ahorra un ciclo completo
    // de evaluación + auto-fix que antes era necesario para cada app con
    // este bug).
    issues.push(...detectCatchAllBeforeRoutes(vfs));
    issues.push(...detectMissingRootRoute(vfs));
    // Detección de export/import mismatch — causa raíz de componentes que
    // "no renderizan" sin error visible.
    issues.push(...detectExportImportMismatch(vfs));
    // Barreras de entrega: esbuild no falla por un archivo no importado vacío ni
    // por `return null`, pero ambos producen una app incompleta para el cliente.
    issues.push(...detectEmptySourceFiles(vfs));
    issues.push(...detectNonRenderableReactEntry(entry, vfs, entrypoint.source));
    if (hasVisibleDeliveryPlaceholder(bundle)) {
      issues.push({ file: "(bundle)", message: "Visible internal placeholder detected. Deliver a functional UI, never a temporary screen." });
    }

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
