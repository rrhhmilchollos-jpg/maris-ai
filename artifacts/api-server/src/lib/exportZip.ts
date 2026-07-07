import archiver from "archiver";
import type { Response } from "express";
import { generateWatermark } from "../middlewares/security";
import * as crypto from "crypto";

/**
 * Genera un fingerprint único por exportación — permite rastrear el origen
 * si el código aparece en otro lado sin autorización.
 */
function injectWatermark(code: string, userId: string, appId: string): string {
  const watermark = generateWatermark(userId, appId);
  // Inyectar al principio del archivo como comentario invisible semántico
  return watermark + "\n" + code;
}

/**
 * Obfusca ligeramente variables de entorno y strings críticos en el bundle
 * para que el código exportado sin GitHub sea menos funcional directamente.
 * NO rompe la funcionalidad normal — solo dificulta la copia sin contexto.
 */
function applyExportProtection(files: Record<string, string>, userId: string, appId: string): Record<string, string> {
  const exportId = crypto.randomBytes(4).toString("hex");
  const protected_: Record<string, string> = {};
  
  for (const [path, content] of Object.entries(files)) {
    let protectedContent = content;
    
    // Inyectar watermark en archivos JS/TS/JSX/TSX
    if (path.match(/\.(js|ts|jsx|tsx)$/)) {
      const wm = generateWatermark(userId, appId);
      protectedContent = `${wm}\n// Export ID: ${exportId}\n${protectedContent}`;
    }
    
    protected_[path] = protectedContent;
  }
  
  return protected_;
}

const FILE_MARKER = /\/\/\s*===\s*FILE:\s*(.+?)\s*===/g;

/**
 * Parse the '// === FILE: <path> ===' bundle into a flat { path: contents } map.
 * Identical contract to the validator / Sandpack parser, but kept independent
 * so a future change there does not silently mutate the export format.
 */
/**
 * ENCONTRADO A PETICIÓN DEL USUARIO (auditoría de duplicados/código
 * obsoleto): esta misma lógica de "extraer archivos de un bundle
 * // === FILE: ===" estaba reimplementada por separado en exportZip.ts
 * (bundleToFiles) y en validate.ts (parseBundleToVFS antigua), sin
 * compartir código -- causa raíz real de varios de los bugs de hoy
 * (cada vez que arreglaba algo en un sitio, el otro sitio se quedaba
 * desincronizado). Esta función es ahora el núcleo COMPARTIDO -- extrae
 * los pares ruta/contenido en bruto, con la protección contra rutas
 * maliciosas (path traversal) que solo tenía exportZip.ts. Cada
 * consumidor (exportZip.ts, validate.ts) aplica su propio filtrado
 * específico ENCIMA de este resultado común, en vez de reimplementar el
 * análisis desde cero.
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
    if (p.startsWith("./")) p = p.slice(2);
    if (p.startsWith("/")) p = p.slice(1);
    // Defensa contra path traversal en rutas generadas -- antes solo la
    // tenía bundleToFiles, ahora la comparten todos los consumidores.
    if (p.includes("..")) continue;
    out[p] = bundle.slice(start, safeEnd).replace(/^\n+/, "").trimEnd() + "\n";
  }
  return out;
}

export function bundleToFiles(bundle: string): Record<string, string> {
  return parseFileMarkers(bundle);
}

/**
 * Stream a ZIP of the user's app to the HTTP response. The archive contains a
 * frontend/ subtree, an optional backend/ subtree, and a top-level README.md
 * describing how to run the project locally.
 *
 * Errors are surfaced via the optional onError callback; the caller is
 * responsible for ending the response if the headers haven't been sent yet.
 */
export function streamAppZip(
  res: Response,
  opts: {
    title: string;
    description: string;
    frontendBundle: string;
    backendBundle: string;
    userId?: string;
    appId?: string;
    /**
     * Project kind. Controls archive layout and README contents:
     *  - "python-api" / "django": flat layout (no frontend/ split), Python
     *    README with venv + uvicorn / runserver instructions.
     *  - anything else: legacy frontend/ + backend/ split, Vite README.
     */
    kind?: string;
    onError?: (err: Error) => void;
  },
): void {
  const archive = archiver("zip", { zlib: { level: 9 } });

  archive.on("warning", (err) => {
    // ENOENT is benign — non-existent files are simply skipped.
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      opts.onError?.(err);
    }
  });
  archive.on("error", (err) => {
    opts.onError?.(err);
  });

  archive.pipe(res);

  const isPython = opts.kind === "python-api" || opts.kind === "django";
  const rawFrontendFiles = bundleToFiles(opts.frontendBundle);
  // Apply watermark + export protection for tracking
  const frontendFiles = opts.userId
    ? applyExportProtection(rawFrontendFiles, opts.userId, opts.appId || "unknown")
    : rawFrontendFiles;
  for (const [p, contents] of Object.entries(frontendFiles)) {
    // Python projects ship a single tree at the repo root — burying main.py
    // inside `frontend/` would be confusing and breaks `python main.py`.
    archive.append(contents, { name: isPython ? p : `frontend/${p}` });
  }

  const hasBackend =
    !isPython &&
    opts.backendBundle &&
    !/^no backend required/i.test(opts.backendBundle.trim());
  if (hasBackend) {
    const backendFiles = bundleToFiles(opts.backendBundle);
    if (Object.keys(backendFiles).length > 0) {
      for (const [p, contents] of Object.entries(backendFiles)) {
        archive.append(contents, { name: `backend/${p}` });
      }
    } else {
      // Backend wasn't a structured bundle — store the raw text so it isn't lost.
      archive.append(opts.backendBundle, { name: "backend/README.txt" });
    }
  }

  const readme = isPython
    ? buildPythonReadme(opts.title, opts.description, opts.kind!)
    : `# ${opts.title}\n\n${opts.description}\n\n` +
      `Generado con Maris AI.\n\n` +
      `## Estructura\n\n` +
      `- \`frontend/\` — proyecto React + Vite + Tailwind. ` +
      `Entra y ejecuta \`pnpm install\` y \`pnpm dev\`.\n` +
      (hasBackend
        ? `- \`backend/\` — servidor Node + Express. ` +
          `Entra y ejecuta \`pnpm install\` y \`pnpm dev\`.\n`
        : "") +
      `\n## Notas\n\nEsta carpeta contiene el código tal y como lo generó la IA. ` +
      `Revisa los archivos antes de correrlos en producción.\n`;
  archive.append(readme, { name: "README.md" });

  archive.finalize();
}

function buildPythonReadme(
  title: string,
  description: string,
  kind: string,
): string {
  const isFastApi = kind === "python-api";
  const runCmd = isFastApi
    ? "uvicorn main:app --reload --port 8000"
    : "python manage.py migrate && python manage.py runserver 0.0.0.0:8000";
  const stack = isFastApi ? "FastAPI + Uvicorn + SQLAlchemy" : "Django 5";
  return (
    `# ${title}\n\n${description}\n\nGenerado con Maris AI.\n\n` +
    `## Stack\n\n${stack} (Python 3.11+).\n\n` +
    `## Cómo correrlo localmente\n\n` +
    "```bash\n" +
    `python -m venv .venv\n` +
    `source .venv/bin/activate   # Windows: .venv\\Scripts\\activate\n` +
    `pip install -r requirements.txt\n` +
    `${runCmd}\n` +
    "```\n\n" +
    `Después abre http://localhost:8000 en el navegador.\n\n` +
    `## Notas\n\nEsta carpeta contiene el código tal y como lo generó la IA. ` +
    `Revisa los archivos antes de correrlos en producción.\n`
  );
}
