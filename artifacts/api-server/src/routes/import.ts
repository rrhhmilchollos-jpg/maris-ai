import { Router } from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import { createWriteStream } from "fs";
import { pipeline } from "stream/promises";
import { createRequire } from "module";
const _require = createRequire(import.meta.url);
import { requireAuth } from "../lib/auth";
import { logger } from "../lib/logger";
import { GeneratedApp, connectDB } from "@workspace/db";
import { makeSlug } from "../lib/deployBundle";

const router = Router();

// ── Multer: acepta zip/rar hasta 1.5GB.
//
// IMPORTANTE — cambio de memoryStorage() a diskStorage(): con archivos de
// hasta 1.5GB, guardarlos enteros en RAM (como hacía antes) es peligroso
// de verdad — 3-4 usuarios importando a la vez podrían agotar la memoria
// del servidor y tirar el api-server para TODOS los usuarios, no solo
// para quien está importando. Con diskStorage, el archivo se escribe
// directamente a disco (streaming) sin pasar por la RAM del proceso.
// El archivo temporal se borra siempre al terminar (ver finally más abajo).
const UPLOAD_TMP_DIR = process.env.IMPORT_TMP_DIR || "/tmp/maris-ai-imports";
if (!fs.existsSync(UPLOAD_TMP_DIR)) {
  fs.mkdirSync(UPLOAD_TMP_DIR, { recursive: true });
}
const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, UPLOAD_TMP_DIR),
    filename: (_req, file, cb) => cb(null, `${Date.now()}-${Math.round(Math.random() * 1e9)}${path.extname(file.originalname)}`),
  }),
  limits: { fileSize: 1.5 * 1024 * 1024 * 1024 }, // 1.5GB máximo de subida
  fileFilter: (_req, file, cb) => {
    const allowed = [
      "application/zip",
      "application/x-zip-compressed",
      "application/x-rar-compressed",
      "application/vnd.rar",
      "application/octet-stream",
    ];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(file.mimetype) || ext === ".zip" || ext === ".rar") {
      cb(null, true);
    } else {
      cb(new Error("Solo se aceptan archivos .zip o .rar"));
    }
  },
});

// ── Helpers ───────────────────────────────────────────────────────────────

// BUG REAL encontrado (causa de "proyectos que no se suben enteros"):
// esta lista se usa para decidir qué archivos del ZIP se leen como texto
// y se incluyen en el proyecto importado. Faltaban extensiones de uso
// muy común — sobre todo ".astro" (el propio framework Astro) y ".mjs"
// (así se llaman casi siempre astro.config.mjs, tailwind.config.mjs,
// postcss.config.mjs) — así que en cualquier proyecto Astro real, las
// páginas .astro Y sus archivos de configuración se descartaban en
// silencio ANTES de intentar compilar nada. buildAstroProjectInE2B()
// recibe únicamente lo que sobrevive a este filtro (ver import.ts más
// abajo), así que sin este arreglo el build fallaría por archivos
// faltantes incluso si E2B funcionara perfectamente.
const TEXT_EXTS = new Set([
  ".html", ".htm", ".css", ".scss", ".sass", ".less",
  ".js", ".mjs", ".cjs", ".ts", ".mts", ".cts", ".tsx", ".jsx",
  ".astro", ".vue", ".svelte",
  ".json", ".md", ".mdx", ".txt", ".xml", ".svg", ".yaml", ".yml", ".toml",
  ".env", ".sh", ".py", ".rb", ".php", ".rs",
]);

// Archivos de configuración habituales que no tienen "extensión" real
// según path.extname (p.ej. path.extname(".npmrc") === "" en Node) —
// sin este caso especial también se descartaban en silencio.
const TEXT_DOTFILES = new Set([
  ".npmrc", ".gitignore", ".env", ".env.example", ".eslintrc",
  ".prettierrc", ".editorconfig", ".nvmrc",
]);

function isTextFile(filename: string): boolean {
  const base = path.basename(filename).toLowerCase();
  if (TEXT_DOTFILES.has(base)) return true;
  return TEXT_EXTS.has(path.extname(filename).toLowerCase());
}

async function extractZipToBundle(buffer: Buffer): Promise<{ files: Record<string, string>; allPaths: string[] }> {
  // Dynamic import of unzipper (install if needed) or use built-in
  // We'll use the 'archiver' pattern with a different approach: fflate via dynamic require
  // Since we only have archiver (compress), we use a simple zip parser
  const AdmZip = await importAdmZip();
  const zip = new AdmZip(buffer);
  const entries = zip.getEntries();
  const files: Record<string, string> = {};
  const allPaths: string[] = [];

  // ── Anti zip-bomb: comprobar el tamaño descomprimido total declarado ──────
  // antes de leer ningún contenido. Un ZIP de pocos KB puede declarar
  // gigabytes de contenido descomprimido y agotar la memoria del servidor.
  const MAX_UNCOMPRESSED_BYTES = 3 * 1024 * 1024 * 1024; // 3GB (deja margen razonable sobre el límite de subida de 1.5GB)
  const totalUncompressed = entries.reduce((sum: number, e: any) => sum + (e.header?.size ?? 0), 0);
  if (totalUncompressed > MAX_UNCOMPRESSED_BYTES) {
    throw new Error(
      `El archivo ZIP contiene ${Math.round(totalUncompressed / 1024 / 1024)}MB descomprimidos, ` +
      `supera el límite de ${MAX_UNCOMPRESSED_BYTES / 1024 / 1024}MB.`,
    );
  }

  for (const entry of entries) {
    if (entry.isDirectory) continue;
    const name = entry.entryName;
    // Defensa en profundidad contra path traversal (zip slip) — aunque solo
    // usamos entryName como clave de objeto (no se escribe a disco), se
    // descarta cualquier entrada con .. o ruta absoluta por seguridad.
    if (name.includes("..") || path.isAbsolute(name)) continue;
    allPaths.push(name);
    if (isTextFile(name)) {
      try {
        files[name] = entry.getData().toString("utf-8");
      } catch {
        // binary file — skip text content
      }
    }
  }
  return { files, allPaths };
}

async function importAdmZip(): Promise<any> {
  // Try multiple possible paths for adm-zip across pnpm versions
  const candidates = [
    "adm-zip",
    "/app/node_modules/.pnpm/adm-zip@0.5.17/node_modules/adm-zip",
    "/app/node_modules/.pnpm/adm-zip@0.5.16/node_modules/adm-zip",
    "/app/node_modules/adm-zip",
  ];
  for (const p of candidates) {
    try { return _require(p); } catch {}
  }
  throw new Error("No se pudo cargar adm-zip. Reinicia el servicio e inténtalo de nuevo.");
}

/**
 * ENCONTRADO A PETICION DEL USUARIO (caso real: import de un ZIP de GitHub
 * fallando con "npm ERR! enoent ... no such file or directory, open
 * '.../astro-import/package.json'" pese a que el ZIP SÍ contenía un
 * package.json): los ZIPs generados por GitHub ("Download ZIP"), y muchos
 * exportadores similares, envuelven TODO el contenido dentro de una única
 * carpeta raíz con el nombre del repo/rama (ej. "FANTASYWEB-main/package.json"
 * en vez de "package.json" a secas). extractZipToBundle/extractRarToBundle
 * conservaban esa carpeta tal cual en las claves de `files`, así que al
 * escribir esos archivos dentro del sandbox de build (astroImportBuilder.ts
 * o startSSRServerInE2B) el package.json terminaba un nivel más profundo de
 * lo que el comando `npm install` (ejecutado en la raíz del sandbox)
 * esperaba encontrarlo.
 *
 * FIX: si TODAS las rutas comparten un único primer segmento de carpeta,
 * se elimina ese segmento de todas las claves antes de devolver el bundle
 * -- así el resto del pipeline (Astro build, SSR, importación normal) sigue
 * funcionando exactamente igual tanto si el ZIP viene con carpeta
 * envolvente como si no.
 */
function stripCommonRootFolder(
  files: Record<string, string>,
  allPaths: string[],
): { files: Record<string, string>; allPaths: string[] } {
  if (allPaths.length === 0) return { files, allPaths };

  const firstSegments = allPaths.map((p) => p.split("/")[0]);
  const uniqueFirstSegments = new Set(firstSegments);

  // Solo se quita el prefijo si TODOS los archivos están dentro de la MISMA
  // única carpeta raíz, y esa carpeta no es el archivo entero (es decir,
  // hay al menos un "/" en cada ruta -- si no, no hay nada que envuelva).
  const allNested = allPaths.every((p) => p.includes("/"));
  if (uniqueFirstSegments.size !== 1 || !allNested) {
    return { files, allPaths };
  }

  const prefix = `${firstSegments[0]}/`;
  const newFiles: Record<string, string> = {};
  for (const [p, content] of Object.entries(files)) {
    const strippedKey = p.startsWith(prefix) ? p.slice(prefix.length) : p;
    newFiles[strippedKey] = content;
  }
  const newAllPaths = allPaths.map((p) => (p.startsWith(prefix) ? p.slice(prefix.length) : p));

  return { files: newFiles, allPaths: newAllPaths };
}

async function extractRarToBundle(buffer: Buffer): Promise<{ files: Record<string, string>; allPaths: string[] }> {
  // Write buffer to tmp, extract with node-unrar-js or system unrar
  const tmpRar = `/tmp/import_${Date.now()}.rar`;
  const tmpDir = `/tmp/import_extract_${Date.now()}`;
  fs.writeFileSync(tmpRar, buffer);
  fs.mkdirSync(tmpDir, { recursive: true });

  const files: Record<string, string> = {};
  const allPaths: string[] = [];

  try {
    const { execSync } = _require("child_process");
    // Try system unrar
    execSync(`unrar x -y "${tmpRar}" "${tmpDir}/" 2>/dev/null || true`);

    const walk = (dir: string, base: string) => {
      for (const entry of fs.readdirSync(dir)) {
        const full = path.join(dir, entry);
        const rel = path.join(base, entry);
        // Defensa en profundidad: descartar cualquier ruta que escape de tmpDir
        if (rel.includes("..") || path.isAbsolute(rel)) continue;
        const stat = fs.statSync(full);
        if (stat.isDirectory()) {
          walk(full, rel);
        } else {
          allPaths.push(rel);
          if (isTextFile(entry)) {
            try {
              files[rel] = fs.readFileSync(full, "utf-8");
            } catch {}
          }
        }
      }
    };
    walk(tmpDir, "");
  } finally {
    try { fs.unlinkSync(tmpRar); } catch {}
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  }

  return { files, allPaths };
}

function buildFrontendCode(files: Record<string, string>, allPaths: string[]): string {
  const parts: string[] = [];

  // Order: index.html first, then css, then js, then rest
  const ordered = [
    ...allPaths.filter(p => p.endsWith("index.html")),
    ...allPaths.filter(p => !p.endsWith("index.html") && p.endsWith(".html")),
    ...allPaths.filter(p => p.endsWith(".css")),
    ...allPaths.filter(p => p.endsWith(".js") || p.endsWith(".ts") || p.endsWith(".tsx") || p.endsWith(".jsx")),
    ...allPaths.filter(p => isTextFile(p) && !p.match(/\.(html|css|js|ts|tsx|jsx)$/)),
  ];

  const seen = new Set<string>();
  for (const filePath of ordered) {
    if (seen.has(filePath)) continue;
    seen.add(filePath);
    if (files[filePath] !== undefined) {
      parts.push(`// === FILE: ${filePath} ===\n${files[filePath]}`);
    }
  }

  return parts.join("\n\n");
}

function detectProjectTitle(files: Record<string, string>): string {
  // Try index.html <title>
  const indexHtml = files["index.html"] || Object.values(files).find((_, k) => String(k).endsWith("index.html")) || "";
  const titleMatch = indexHtml.match(/<title[^>]*>([^<]+)<\/title>/i);
  if (titleMatch) return titleMatch[1].trim().slice(0, 100);

  // Try README.md first line
  const readme = files["README.md"] || files["readme.md"] || "";
  const readmeTitle = readme.match(/^#\s+(.+)/m);
  if (readmeTitle) return readmeTitle[1].trim().slice(0, 100);

  return "Proyecto Importado";
}

function detectDescription(files: Record<string, string>): string {
  const readme = files["README.md"] || files["readme.md"] || "";
  if (readme) {
    const lines = readme.split("\n").filter(l => l.trim() && !l.startsWith("#")).slice(0, 2);
    if (lines.length) return lines.join(" ").trim().slice(0, 300);
  }
  const indexHtml = files["index.html"] || Object.values(files).find((_, k) => String(k).endsWith("index.html")) || "";
  const descMatch = indexHtml.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i);
  if (descMatch) return descMatch[1].trim().slice(0, 300);
  return "Proyecto importado desde archivo ZIP/RAR";
}

function detectTechStack(files: Record<string, string>, allPaths: string[]): string[] {
  const stack = new Set<string>();
  const allContent = Object.values(files).join(" ");

  if (allPaths.some(p => p.endsWith(".tsx") || p.endsWith(".jsx"))) stack.add("React");
  if (allPaths.some(p => p.endsWith(".ts") || p.endsWith(".tsx"))) stack.add("TypeScript");
  if (allContent.includes("tailwind")) stack.add("Tailwind CSS");
  if (allContent.includes("bootstrap")) stack.add("Bootstrap");
  if (allPaths.some(p => p.endsWith(".html"))) stack.add("HTML");
  if (allPaths.some(p => p.endsWith(".css"))) stack.add("CSS");
  if (allPaths.some(p => p.endsWith(".js"))) stack.add("JavaScript");
  if (allContent.includes("express") || allContent.includes("node")) stack.add("Node.js");
  if (allContent.includes("stripe")) stack.add("Stripe");
  if (allContent.includes("firebase")) stack.add("Firebase");

  return Array.from(stack).slice(0, 8);
}

/**
 * ENCONTRADO A PETICIÓN DEL USUARIO: el importador construye el bundle
 * concatenando TODOS los archivos de texto en uno solo (buildFrontendCode),
 * asumiendo un proyecto simple (HTML/CSS/JS o React+Vite ya empaquetado)
 * -- el mismo formato que generan los propios agentes de Maris AI. Un
 * proyecto Astro (con o sin Wix) rompe esa suposición: no tiene un
 * index.html con <script>, usa archivos .astro (sintaxis propia, no JSX)
 * y enrutado por archivos, no un bundle único.
 *
 * SOLUCIÓN (a petición explícita del usuario, tras confirmar que no
 * necesita que los servicios de Wix funcionen, solo que el proyecto se
 * ABRA correctamente): en vez de intentar parsear .astro nosotros mismos,
 * se compila el proyecto DE VERDAD en un sandbox E2B (ver
 * astroImportBuilder.ts) y se usa el resultado ya compilado (HTML/CSS/JS
 * estándar en dist/) como bundle -- exactamente lo que el resto del
 * sistema de preview de Maris AI ya sabe mostrar sin cambios.
 *
 * Esto NO es una promesa de que todo proyecto Astro compilará: si usa
 * integraciones @wix/astro que requieren el servicio de build en la nube
 * de Wix, el build fallará igualmente -- pero fallará con el error REAL
 * de Astro, no con una suposición nuestra. Ver needsSSRServer para el
 * caso de Next.js, que ahora se intenta con un servidor en vivo en vez
 * de rechazarse de entrada.
 */
function needsAstroBuild(files: Record<string, string>, allPaths: string[]): boolean {
  const hasAstroConfig = allPaths.some((p) => /(^|\/)astro\.config\.(mjs|ts|js)$/.test(p));
  const hasAstroFiles = allPaths.some((p) => p.endsWith(".astro"));
  return hasAstroConfig || hasAstroFiles;
}

/**
 * Proyectos que necesitan un servidor real corriendo (no un build estático)
 * para funcionar de verdad: Next.js con App Router es el caso más común
 * (Server Components, Server Actions, rutas API dinámicas). Antes esto se
 * rechazaba de entrada por considerarse imposible -- a petición explícita
 * del usuario, ahora se intenta de verdad arrancando un servidor persistente
 * en un sandbox E2B (ver ssrImportBuilder.ts) y sirviendo su URL en vivo,
 * en vez de un bundle estático guardado.
 */
function needsSSRServer(allPaths: string[]): boolean {
  return allPaths.some((p) => /(^|\/)next\.config\.(js|mjs|ts)$/.test(p));
}

// ── POST /api/import-app ─────────────────────────────────────────────────
router.post("/import-app", requireAuth, upload.single("file"), async (req: any, res: any) => {
  try {
    await connectDB();

    if (!req.file) {
      return res.status(400).json({ error: "No se recibió ningún archivo." });
    }

    // Con diskStorage, multer ya no da req.file.buffer -- el archivo está
    // escrito en disco en req.file.path. Lo leemos aquí una sola vez; el
    // resto de la función sigue exactamente igual que antes (recibe el
    // mismo Buffer que recibía con memoryStorage).
    const buffer = fs.readFileSync(req.file.path);
    const originalName = req.file.originalname.toLowerCase();
    const isRar = originalName.endsWith(".rar");
    const userId = req.userId as string;

    logger.info({ userId, filename: req.file.originalname, size: buffer.length }, "Importando proyecto desde archivo");

    let extracted: { files: Record<string, string>; allPaths: string[] };

    if (isRar) {
      extracted = await extractRarToBundle(buffer);
    } else {
      extracted = await extractZipToBundle(buffer);
    }
    extracted = stripCommonRootFolder(extracted.files, extracted.allPaths);

    if (extracted.allPaths.length === 0) {
      return res.status(400).json({ error: "El archivo está vacío o no se pudo extraer." });
    }

    let filesForBundle = extracted.files;
    let allPathsForBundle = extracted.allPaths;
    let ssrLiveResult: { liveUrl: string; sandboxId: string; expiresAt: Date } | null = null;

    if (needsSSRServer(extracted.allPaths)) {
      logger.info({ userId, filename: req.file.originalname }, "Import: proyecto con SSR (Next.js) detectado — arrancando servidor en vivo en E2B");
      const { startSSRServerInE2B } = await import("../lib/ssrImportBuilder");
      const ssrResult = await startSSRServerInE2B(extracted.files);
      if (!ssrResult.ok || !ssrResult.liveUrl || !ssrResult.sandboxId || !ssrResult.expiresAt) {
        logger.warn({ userId, reason: ssrResult.reason }, "Import: arranque de servidor SSR falló");
        return res.status(422).json({
          error: ssrResult.reason || "No se pudo arrancar el servidor del proyecto.",
          buildLog: ssrResult.buildLog?.slice(0, 4000),
          installLog: ssrResult.installLog?.slice(0, 2000),
        });
      }
      ssrLiveResult = { liveUrl: ssrResult.liveUrl, sandboxId: ssrResult.sandboxId, expiresAt: ssrResult.expiresAt };
      logger.info({ userId, liveUrl: ssrLiveResult.liveUrl, expiresAt: ssrLiveResult.expiresAt }, "Import: servidor SSR en vivo listo");
    } else if (needsAstroBuild(extracted.files, extracted.allPaths)) {
      logger.info({ userId, filename: req.file.originalname }, "Import: proyecto Astro detectado — compilando en sandbox E2B");
      const { buildAstroProjectInE2B } = await import("../lib/astroImportBuilder");
      const astroResult = await buildAstroProjectInE2B(extracted.files);
      if (!astroResult.ok || !astroResult.files) {
        logger.warn({ userId, reason: astroResult.reason }, "Import: build de Astro falló");
        return res.status(422).json({
          error: astroResult.reason || "No se pudo compilar el proyecto Astro.",
          buildLog: astroResult.buildLog?.slice(0, 4000),
          installLog: astroResult.installLog?.slice(0, 2000),
        });
      }
      // Sustituir: ya no usamos el código fuente .astro sin compilar, sino
      // el resultado real de la compilación (HTML/CSS/JS estándar) —
      // exactamente lo que el resto del sistema de preview ya sabe mostrar.
      filesForBundle = astroResult.files;
      allPathsForBundle = Object.keys(astroResult.files);
      logger.info({ userId, compiledFileCount: allPathsForBundle.length }, "Import: proyecto Astro compilado correctamente, usando dist/ real");
    }

    const title = detectProjectTitle(filesForBundle);
    const description = detectDescription(filesForBundle);
    const extraTechTag = ssrLiveResult ? "Next.js (servidor en vivo)" : needsAstroBuild(extracted.files, extracted.allPaths) ? "Astro (compilado)" : null;
    const techStack = extraTechTag
      ? [...detectTechStack(filesForBundle, allPathsForBundle), extraTechTag]
      : detectTechStack(filesForBundle, allPathsForBundle);
    // Con SSR en vivo no hay bundle que guardar -- el "contenido" de la app
    // es el servidor corriendo en el sandbox, no código almacenado.
    let frontendCode = ssrLiveResult
      ? "// Este proyecto usa un servidor en vivo (SSR) — ver GeneratedApp.livePreviewUrl. No hay bundle estático almacenado."
      : buildFrontendCode(filesForBundle, allPathsForBundle);

    // MongoDB tiene límite de 16MB por documento. Truncar si es necesario.
    const MAX_CODE_BYTES = 12 * 1024 * 1024; // 12MB para dejar margen
    if (Buffer.byteLength(frontendCode, 'utf8') > MAX_CODE_BYTES) {
      logger.warn({ userId, title, frontendCodeLen: frontendCode.length }, "frontendCode demasiado grande, truncando a 12MB");
      frontendCode = frontendCode.slice(0, MAX_CODE_BYTES / 2) + "\n\n// [TRUNCADO: proyecto demasiado grande para almacenar completo. Usa archivos más pequeños o divide el proyecto.]";
    }

    logger.info({ userId, title, files: extracted.allPaths.length, frontendCodeLen: frontendCode.length }, "Proyecto extraído correctamente");

    // Para SSR en vivo, además del placeholder en frontendCode, guardamos
    // el proyecto ORIGINAL completo (antes del build) — es lo único que
    // permite reconstruir el servidor cuando el sandbox muera. Mismo
    // límite de tamaño que frontendCode, con su propio aviso si no cabe
    // (en cuyo caso el reinicio automático no será posible más adelante,
    // pero se avisa ahora en vez de fallar en silencio meses después).
    let importedSourceFilesJson: string | undefined;
    if (ssrLiveResult) {
      const rawJson = JSON.stringify(extracted.files);
      if (Buffer.byteLength(rawJson, "utf8") > MAX_CODE_BYTES) {
        logger.warn({ userId, title }, "Proyecto SSR demasiado grande para guardar el original — el reinicio automático no funcionará si el sandbox muere");
      } else {
        importedSourceFilesJson = rawJson;
      }
    }

    const app = await GeneratedApp.create({
      userId,
      title,
      prompt: `[IMPORTADO] ${title} — importado desde ${req.file.originalname}`,
      description,
      techStack,
      frontendCode,
      backendCode: "// Proyecto importado desde archivo. Backend no incluido.",
      language: techStack.includes("TypeScript") ? "typescript" : "javascript",
      kind: "landing",
      status: "ready",
      publicSlug: makeSlug(),
      plannedPages: [],
      requiredEnvVars: [],
      ...(ssrLiveResult
        ? {
            renderMode: "ssr-live",
            livePreviewUrl: ssrLiveResult.liveUrl,
            livePreviewSandboxId: ssrLiveResult.sandboxId,
            livePreviewExpiresAt: ssrLiveResult.expiresAt,
            importedSourceFilesJson,
          }
        : {}),
    });

    res.status(201).json({
      id: String(app._id),
      title,
      description,
      techStack,
      filesImported: extracted.allPaths.length,
      message: ssrLiveResult
        ? `Proyecto "${title}" importado con éxito — servidor en vivo activo durante 30 minutos.`
        : `Proyecto "${title}" importado con éxito (${extracted.allPaths.length} archivos).`,
      ...(ssrLiveResult ? { renderMode: "ssr-live", livePreviewUrl: ssrLiveResult.liveUrl, livePreviewExpiresAt: ssrLiveResult.expiresAt } : {}),
    });
  } catch (err) {
    logger.error({ err }, "POST /api/import-app error");
    // Always return JSON, never HTML
    if (!res.headersSent) {
      res.status(500).json({ error: err instanceof Error ? err.message : "Error al importar el proyecto." });
    }
  } finally {
    // Limpieza garantizada del archivo temporal en disco -- se ejecuta
    // tanto si el import tuvo éxito como si falló en cualquier punto.
    // Sin esto, con diskStorage el /tmp del servidor se llenaría con
    // cada importación (antes, con memoryStorage, esto no hacía falta
    // porque el buffer solo vivía en RAM y se liberaba solo).
    if (req.file?.path) {
      fs.unlink(req.file.path, (unlinkErr) => {
        if (unlinkErr) logger.warn({ unlinkErr, path: req.file.path }, "No se pudo borrar el archivo temporal de importación");
      });
    }
  }
});

export default router;
