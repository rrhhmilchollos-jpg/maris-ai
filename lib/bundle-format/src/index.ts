/**
 * Núcleo ÚNICO de análisis del formato de bundle "// === FILE: <ruta> ==="
 * que usa todo Maris AI para representar un proyecto completo como un solo
 * string de texto.
 *
 * ENCONTRADO A PETICIÓN DEL USUARIO (auditoría de duplicados/código
 * obsoleto, julio 2026): este mismo formato se usa en 24 archivos del
 * proyecto, pero la lógica para INTERPRETARLO estaba reimplementada por
 * separado en al menos 3 sitios sin compartir código:
 *   1. artifacts/api-server/src/lib/exportZip.ts (bundleToFiles)
 *   2. artifacts/api-server/src/lib/validate.ts (parseBundleToVFS)
 *   3. artifacts/appforge/src/lib/parseBundle.ts (editor de código, frontend)
 *
 * Esta triplicación fue la causa raíz real de varios bugs encontrados en
 * sesiones anteriores: arreglar algo (p. ej. reconocer un HTML estático sin
 * punto de entrada React) en un sitio dejaba los otros dos desincronizados,
 * dando falsos positivos/negativos según qué código se hubiera tocado.
 *
 * Este paquete es puro TypeScript sin dependencias de Node.js ni del DOM --
 * funciona igual de bien compilado para el backend (Express) que para el
 * frontend (Vite/navegador), así que ambos proyectos lo importan como
 * @workspace/bundle-format en vez de mantener su propia copia.
 */

const FILE_MARKER = /\/\/\s*===\s*FILE:\s*(.+?)\s*===/g;

export interface ParsedFile {
  path: string;
  content: string;
}

/**
 * Extrae los pares ruta/contenido en bruto de un bundle, con protección
 * contra rutas maliciosas (path traversal). Cada archivo del resultado
 * termina en un único "\n" final (formato pensado para poder escribirse
 * directamente a disco/zip sin más procesado).
 *
 * Esta es la única función que de verdad interpreta el formato -- todo lo
 * demás en este paquete o en los consumidores es filtrado adicional
 * aplicado ENCIMA de este resultado común.
 */
export function parseFileMarkers(bundle: string): Record<string, string> {
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
    // Quitar cualquier "./" o "/" inicial para que nunca haya rutas
    // absolutas en el resultado.
    if (p.startsWith("./")) p = p.slice(2);
    if (p.startsWith("/")) p = p.slice(1);
    // Defensa contra path traversal en rutas generadas por el modelo.
    if (p.includes("..")) continue;
    out[p] = bundle.slice(start, safeEnd).replace(/^\n+/, "").trimEnd() + "\n";
  }
  return out;
}

/**
 * Construye un bundle a partir de un mapa de archivos, en el mismo orden
 * en que se pasen las claves del objeto. Útil para reconstruir un bundle
 * tras editar/filtrar archivos individuales.
 */
export function filesToBundle(files: Record<string, string>): string {
  return Object.entries(files)
    .map(([path, content]) => `// === FILE: ${path} ===\n${content}`)
    .join("\n\n");
}

/**
 * Detecta si un bundle es un proyecto HTML estático puro (sin ningún
 * punto de entrada React conocido) -- mismo criterio usado por
 * deployAppToVercel (el despliegue real) para no exigir un punto de
 * entrada React donde no hace falta. Antes de esta unificación, cada
 * consumidor tenía su propia versión de esta comprobación, y no todas
 * estaban sincronizadas entre sí -- causa real de varios falsos avisos
 * de "no entry file found" en proyectos HTML estáticos importados.
 */
export function isStaticHtmlBundle(files: Record<string, string>): boolean {
  const hasReactEntry =
    files["src/main.tsx"] || files["src/main.jsx"] || files["src/main.ts"] || files["src/main.js"] ||
    files["apps/web/src/main.tsx"] || files["apps/web/src/main.ts"];
  return !hasReactEntry && files["index.html"] != null;
}
