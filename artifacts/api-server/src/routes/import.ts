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

// ── Multer: accept zip/rar up to 50MB (MongoDB tiene límite de 16MB por documento) ─
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB máximo para evitar timeout de MongoDB
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

const TEXT_EXTS = new Set([
  ".html", ".htm", ".css", ".js", ".ts", ".tsx", ".jsx",
  ".json", ".md", ".txt", ".xml", ".svg", ".yaml", ".yml",
  ".env", ".sh", ".py", ".rb", ".php", ".rs",
]);

function isTextFile(filename: string): boolean {
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
  const MAX_UNCOMPRESSED_BYTES = 200 * 1024 * 1024; // 200MB
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
 * de Astro, no con una suposición nuestra. Ver detectUnbuildableFramework
 * para los casos que sí son imposibles sin excepción (Next.js SSR).
 */
function needsAstroBuild(files: Record<string, string>, allPaths: string[]): boolean {
  const hasAstroConfig = allPaths.some((p) => /(^|\/)astro\.config\.(mjs|ts|js)$/.test(p));
  const hasAstroFiles = allPaths.some((p) => p.endsWith(".astro"));
  return hasAstroConfig || hasAstroFiles;
}

/**
 * Frameworks que NO tienen forma posible de funcionar con el modelo de
 * preview de Maris AI (bundle estático servido al navegador), sin importar
 * cuánta infraestructura se añada -- a diferencia de Astro (que SÍ se
 * puede compilar a estático), Next.js con App Router depende de un
 * servidor Node.js corriendo de forma continua (Server Components,
 * Server Actions, rutas API server-side) para funcionar, no de un build
 * único que produzca archivos estáticos servibles.
 */
function detectUnbuildableFramework(allPaths: string[]): string | null {
  const hasNextConfig = allPaths.some((p) => /(^|\/)next\.config\.(js|mjs|ts)$/.test(p));
  if (hasNextConfig) {
    return (
      "Este proyecto es de Next.js con renderizado en servidor y no se puede importar " +
      "directamente en Maris AI (que trabaja con un bundle de frontend + backend Express, " +
      "no con un servidor Node.js seguido de renderizado dinámico como Next.js). Describe " +
      "la funcionalidad en un prompt para que los agentes la recreen desde cero."
    );
  }
  return null;
}

// ── POST /api/import-app ─────────────────────────────────────────────────
router.post("/import-app", requireAuth, upload.single("file"), async (req: any, res: any) => {
  try {
    await connectDB();

    if (!req.file) {
      return res.status(400).json({ error: "No se recibió ningún archivo." });
    }

    const buffer = req.file.buffer;
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

    if (extracted.allPaths.length === 0) {
      return res.status(400).json({ error: "El archivo está vacío o no se pudo extraer." });
    }

    const unbuildableReason = detectUnbuildableFramework(extracted.allPaths);
    if (unbuildableReason) {
      logger.info({ userId, filename: req.file.originalname }, "Import rechazado: framework sin build estático posible");
      return res.status(400).json({ error: unbuildableReason });
    }

    let filesForBundle = extracted.files;
    let allPathsForBundle = extracted.allPaths;

    if (needsAstroBuild(extracted.files, extracted.allPaths)) {
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
    const techStack = needsAstroBuild(extracted.files, extracted.allPaths)
      ? [...detectTechStack(filesForBundle, allPathsForBundle), "Astro (compilado)"]
      : detectTechStack(filesForBundle, allPathsForBundle);
    let frontendCode = buildFrontendCode(filesForBundle, allPathsForBundle);

    // MongoDB tiene límite de 16MB por documento. Truncar si es necesario.
    const MAX_CODE_BYTES = 12 * 1024 * 1024; // 12MB para dejar margen
    if (Buffer.byteLength(frontendCode, 'utf8') > MAX_CODE_BYTES) {
      logger.warn({ userId, title, frontendCodeLen: frontendCode.length }, "frontendCode demasiado grande, truncando a 12MB");
      frontendCode = frontendCode.slice(0, MAX_CODE_BYTES / 2) + "\n\n// [TRUNCADO: proyecto demasiado grande para almacenar completo. Usa archivos más pequeños o divide el proyecto.]";
    }

    logger.info({ userId, title, files: extracted.allPaths.length, frontendCodeLen: frontendCode.length }, "Proyecto extraído correctamente");

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
    });

    res.status(201).json({
      id: String(app._id),
      title,
      description,
      techStack,
      filesImported: extracted.allPaths.length,
      message: `Proyecto "${title}" importado con éxito (${extracted.allPaths.length} archivos).`,
    });
  } catch (err) {
    logger.error({ err }, "POST /api/import-app error");
    // Always return JSON, never HTML
    if (!res.headersSent) {
      res.status(500).json({ error: err instanceof Error ? err.message : "Error al importar el proyecto." });
    }
  }
});

export default router;
