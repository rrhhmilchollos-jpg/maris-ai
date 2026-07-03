import { Router, type Request, type Response, type NextFunction } from "express";
import multer from "multer";
import { ChatAttachment, connectDB } from "@workspace/db";
import { requireAuth } from "../lib/auth";
import { logger } from "../lib/logger";
import { createClaudeMessageWithFallback } from "../lib/shared-agents";

const router: Router = Router();

// ── Tipos permitidos — todo lo que tiene sentido para un generador de apps ────
const ALLOWED_MIMES = new Set<string>([
  // Imágenes
  "image/png", "image/jpeg", "image/jpg", "image/webp", "image/gif",
  "image/svg+xml", "image/bmp", "image/tiff", "image/heic", "image/heif",
  // Vídeo (referencia visual para los agentes)
  "video/mp4", "video/webm", "video/ogg", "video/quicktime", "video/x-msvideo",
  // Texto y código
  "text/plain", "text/markdown", "text/csv", "text/html", "text/css",
  "text/javascript", "text/typescript", "text/tab-separated-values",
  "text/x-python", "text/x-java-source", "text/x-c",
  // Datos y docs
  "application/json", "application/xml", "application/pdf",
  "application/zip", "application/x-zip-compressed",
  // Office
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/msword", "application/vnd.ms-excel",
]);

// MIME types que se sirven inline (no como descarga)
const SAFE_INLINE_MIMES = new Set<string>([
  "image/png", "image/jpeg", "image/jpg", "image/webp", "image/gif",
  "image/svg+xml", "application/pdf", "text/plain", "text/html",
]);

// Extensiones SIEMPRE bloqueadas — ejecutables y vectores de ataque conocidos
const BLOCKED_EXTENSIONS = new Set([
  ".exe", ".bat", ".cmd", ".com", ".msi", ".dll", ".so", ".dylib",
  ".sh", ".bash", ".ps1", ".vbs", ".vbe", ".js.map",
  ".php", ".asp", ".aspx", ".jsp", ".py.bak",
  ".jar", ".class", ".war",
  ".scr", ".pif", ".reg", ".inf",
  ".hta", ".wsf", ".wsh",
]);

const MAX_BYTES = 25 * 1024 * 1024;        // 25 MB (subido de 8MB para vídeos)
const MAX_VIDEO_BYTES = 50 * 1024 * 1024;  // 50 MB para vídeos
const PER_USER_QUOTA_BYTES = 512 * 1024 * 1024; // 512 MB cuota total

// ── Antivirus IA — analiza el archivo antes de guardarlo ──────────────────────
async function scanWithAI(filename: string, mimeType: string, buffer: Buffer): Promise<{
  safe: boolean;
  reason?: string;
}> {
  try {
    // Para archivos de texto/código: análisis de contenido
    const isText = mimeType.startsWith("text/") || mimeType === "application/json";
    const isExec = mimeType === "application/x-executable" || mimeType === "application/x-msdownload";

    if (isExec) return { safe: false, reason: "Tipo de archivo ejecutable bloqueado" };

    // Magia de bytes — detectar ejecutables disfrazados
    const header = buffer.slice(0, 8);
    const headerHex = header.toString("hex");

    // MZ (Windows PE), ELF (Linux), Mach-O (macOS), JAR/ZIP con ejecutable
    if (headerHex.startsWith("4d5a") || headerHex.startsWith("7f454c46")) {
      return { safe: false, reason: "Archivo ejecutable detectado (firma de bytes)" };
    }

    if (isText && buffer.length < 200_000) {
      // Análisis IA para archivos de texto — busca código malicioso
      const textSample = buffer.toString("utf8", 0, Math.min(buffer.length, 3000));

      // Heurísticas rápidas sin IA para patrones obvios
      const dangerousPatterns = [
        /eval\s*\(\s*(?:atob|unescape|String\.fromCharCode)/i,
        /document\.write\s*\(\s*unescape/i,
        /<script[^>]*>[\s\S]*?(eval|atob|fromCharCode)[\s\S]*?<\/script>/i,
        /powershell.*-encodedcommand/i,
        /cmd\.exe.*\/c/i,
        /wget\s+https?:\/\/[^\s]+\s*\|\s*(?:bash|sh|python)/i,
        /curl\s+https?:\/\/[^\s]+\s*\|\s*(?:bash|sh|python)/i,
        /nc\s+-[el]/i, // netcat reverse shell
        /base64_decode\s*\(/i,
      ];

      for (const pattern of dangerousPatterns) {
        if (pattern.test(textSample)) {
          return { safe: false, reason: "Contenido potencialmente malicioso detectado" };
        }
      }

      // Análisis IA para casos ambiguos (solo si el archivo es sospechoso)
      const suspiciousKeywords = ["eval", "exec", "system(", "shell_exec", "passthru", "popen"];
      const suspiciousCount = suspiciousKeywords.filter(k => textSample.includes(k)).length;

      if (suspiciousCount >= 2) {
        try {
          const result = await createClaudeMessageWithFallback("image-analysis", "claude-haiku-4-5-20251001", {
            max_tokens: 200,
            system: 'Eres un antivirus. Analiza el fragmento de código/texto y responde SOLO JSON: {"malicious": true/false, "reason": "motivo breve en español"}. Es malicioso si contiene: inyección de código, reverse shells, exfiltración de datos, exploits, o código ofuscado para evadir detección.',
            messages: [{ role: "user", content: `Archivo: ${filename} (${mimeType})

Contenido:
${textSample}` }],
          });
          const raw = (result.content[0] as any).text ?? "";
          const f = raw.indexOf("{"); const l = raw.lastIndexOf("}");
          if (f !== -1) {
            const parsed = JSON.parse(raw.slice(f, l + 1));
            if (parsed.malicious) return { safe: false, reason: parsed.reason || "Contenido malicioso detectado por IA" };
          }
        } catch { /* si la IA falla, confiar en las heurísticas */ }
      }
    }

    return { safe: true };
  } catch (err) {
    logger.warn({ err, filename }, "Antivirus scan error — aprobando por defecto");
    return { safe: true }; // Fail open para no bloquear uploads legítimos
  }
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_VIDEO_BYTES, files: 1 },
  fileFilter: (_req, file, cb) => { cb(null, true); },
});

function handleMulter(req: Request, res: Response, next: NextFunction): void {
  upload.single("file")(req, res, (err) => {
    if (!err) { next(); return; }
    if (err instanceof multer.MulterError) {
      if (err.code === "LIMIT_FILE_SIZE") {
        res.status(413).json({ error: "El archivo supera el límite de 50 MB." }); return;
      }
      res.status(400).json({ error: `Carga inválida: ${err.message}` }); return;
    }
    next(err);
  });
}

router.post("/uploads", requireAuth, handleMulter, async (req: Request, res: Response) => {
  try {
    await connectDB();
    const userId = req.userId!;
    const file = req.file;
    if (!file) { res.status(400).json({ error: "Falta el archivo (campo 'file')." }); return; }

    // Extensión — bloquear ejecutables disfrazados
    const ext = ("." + (file.originalname || "").split(".").pop() || "").toLowerCase();
    if (BLOCKED_EXTENSIONS.has(ext)) {
      res.status(415).json({ error: `Extensión ${ext} no permitida por seguridad.` }); return;
    }

    const mime = (file.mimetype || "application/octet-stream").toLowerCase();

    // Verificar MIME permitido
    if (!ALLOWED_MIMES.has(mime)) {
      res.status(415).json({
        error: `Tipo de archivo no admitido: ${mime}. Sube imágenes, vídeos, PDFs, documentos o archivos de texto/código.`,
      }); return;
    }

    // Límite por tipo
    const isVideo = mime.startsWith("video/");
    const limit = isVideo ? MAX_VIDEO_BYTES : MAX_BYTES;
    if (file.size > limit) {
      res.status(413).json({ error: `El archivo supera el límite de ${isVideo ? "50" : "25"} MB.` }); return;
    }

    // ── ANTIVIRUS IA ──────────────────────────────────────────────────────────
    const scan = await scanWithAI(file.originalname || "archivo", mime, file.buffer);
    if (!scan.safe) {
      logger.warn({ userId, filename: file.originalname, reason: scan.reason }, "Upload bloqueado por antivirus");
      res.status(422).json({
        error: `Archivo bloqueado por el sistema de seguridad: ${scan.reason}`,
      }); return;
    }

    // Cuota por usuario
    const stats = await ChatAttachment.aggregate([
      { $match: { userId } },
      { $group: { _id: null, total: { $sum: "$sizeBytes" } } }
    ]);
    const usedNum = stats.length > 0 ? stats[0].total : 0;
    if (usedNum + file.size > PER_USER_QUOTA_BYTES) {
      res.status(413).json({ error: "Has alcanzado el límite de almacenamiento (512 MB). Borra archivos antiguos." }); return;
    }

    const safeName = (file.originalname || "archivo").slice(0, 200);
    const dataBase64 = file.buffer.toString("base64");

    const row = await ChatAttachment.create({
      userId, filename: safeName, mimeType: mime,
      sizeBytes: file.size, dataBase64,
    });

    logger.info({ userId, filename: safeName, mime, sizeBytes: file.size }, "Upload OK");

    res.status(201).json({
      id: row._id, filename: row.filename, mimeType: row.mimeType,
      sizeBytes: row.sizeBytes, isImage: row.mimeType.startsWith("image/"),
      isVideo: row.mimeType.startsWith("video/"),
      createdAt: row.createdAt,
    });
  } catch (err) {
    logger.error({ err }, "POST /api/uploads error");
    res.status(500).json({ error: "Error interno al subir archivo" });
  }
});

router.get("/uploads/:id", requireAuth, async (req: Request, res: Response) => {
  try {
    await connectDB();
    const id = req.params.id;
    const userId = req.userId!;
    const row = await ChatAttachment.findOne({ _id: id, userId });
    if (!row) { res.status(404).json({ error: "Attachment not found" }); return; }

    const buf = Buffer.from(row.dataBase64, "base64");
    res.setHeader("Content-Type", row.mimeType);
    res.setHeader("Content-Length", String(buf.length));
    res.setHeader("Cache-Control", "private, max-age=86400, immutable");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");

    const disposition = SAFE_INLINE_MIMES.has(row.mimeType) ? "inline" : "attachment";
    res.setHeader("Content-Disposition", `${disposition}; filename="${encodeURIComponent(row.filename)}"`);
    res.end(buf);
  } catch (err) {
    logger.error({ err, id: req.params.id }, "GET /api/uploads/:id error");
    res.status(500).json({ error: "Error interno al obtener archivo" });
  }
});

export default router;
