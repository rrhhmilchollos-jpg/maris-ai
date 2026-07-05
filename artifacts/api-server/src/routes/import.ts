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
 * asumiendo un proyecto simple (HTML/CSS/JS o React+Vite ya empaquetado
 * como bundle único) -- el mismo formato que generan los propios agentes
 * de Maris AI. Un proyecto de Astro exportado desde Wix rompe esta
 * suposición de raíz:
 *   1. Astro no tiene un index.html con <script> — renderiza páginas
 *      server-side desde archivos .astro (sintaxis propia, no JSX), así
 *      que concatenarlo todo produce basura no ejecutable.
 *   2. El proyecto depende de los SDK de @wix/* (data, bookings, stores,
 *      members...), que llaman a APIs internas de la infraestructura de
 *      Wix. Esto NO tiene arreglo posible desde Maris AI: aunque
 *      supiéramos parsear Astro perfectamente, el código seguiría sin
 *      funcionar fuera de Wix porque depende de servicios que Wix no
 *      expone a terceros -- es su propio vendor lock-in.
 * En vez de generar en silencio un bundle roto sin explicar por qué, se
 * detecta esto ANTES de construir el bundle y se devuelve un error claro.
 */
function detectIncompatibleFramework(files: Record<string, string>, allPaths: string[]): string | null {
  const hasWixConfig = allPaths.some((p) => /(^|\/)wix\.config\.json$/.test(p));
  const hasAstroConfig = allPaths.some((p) => /(^|\/)astro\.config\.(mjs|ts|js)$/.test(p));
  const hasAstroFiles = allPaths.some((p) => p.endsWith(".astro"));
  const packageJsonEntry = allPaths.find((p) => /(^|\/)package\.json$/.test(p));
  const packageJsonContent = packageJsonEntry ? files[packageJsonEntry] || "" : "";
  const usesWixSdk = /"@wix\//.test(packageJsonContent) || allPaths.some((p) => p.includes("wix.config"));

  if (hasWixConfig || hasAstroConfig || hasAstroFiles || usesWixSdk) {
    return (
      "Este proyecto es de Wix (Astro + SDK de Wix) y no se puede importar en Maris AI. " +
      "Depende de servicios internos de Wix (@wix/data, @wix/bookings, @wix/stores, etc.) " +
      "que solo funcionan dentro de la infraestructura de Wix — ni siquiera copiando el código " +
      "perfectamente funcionaría fuera de su plataforma. Si quieres recrear este proyecto en " +
      "Maris AI, la forma correcta es describir en un prompt qué hace la web (secciones, " +
      "funcionalidades, diseño) para que los agentes la generen desde cero con tecnología " +
      "100% exportable (React + Express + MongoDB), en vez de importar el código de Wix directamente."
    );
  }

  // Otro caso frecuente: proyectos Next.js con App Router (server components,
  // rutas API server-side) -- tampoco encajan en el modelo de bundle único
  // de Maris AI, mismo motivo de fondo que Astro.
  const hasNextConfig = allPaths.some((p) => /(^|\/)next\.config\.(js|mjs|ts)$/.test(p));
  if (hasNextConfig) {
    return (
      "Este proyecto es de Next.js con renderizado en servidor y no se puede importar " +
      "directamente en Maris AI (que trabaja con un bundle de frontend + backend Express, " +
      "no con el modelo de servidor de Next.js). Describe la funcionalidad en un prompt " +
      "para que los agentes la recreen desde cero."
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

    const incompatibilityReason = detectIncompatibleFramework(extracted.files, extracted.allPaths);
    if (incompatibilityReason) {
      logger.info({ userId, filename: req.file.originalname }, "Import rechazado: framework incompatible detectado");
      return res.status(400).json({ error: incompatibilityReason });
    }

    const title = detectProjectTitle(extracted.files);
    const description = detectDescription(extracted.files);
    const techStack = detectTechStack(extracted.files, extracted.allPaths);
    let frontendCode = buildFrontendCode(extracted.files, extracted.allPaths);

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
