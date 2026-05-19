import { Router, type Request, type Response, type NextFunction } from "express";
import multer from "multer";
import { ChatAttachment, connectDB } from "@workspace/db";
import { requireAuth } from "../lib/auth";
import { logger } from "../lib/logger";

const router: Router = Router();

const ALLOWED_MIMES = new Set<string>([
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/webp",
  "image/gif",
  "text/plain",
  "text/markdown",
  "text/csv",
  "text/tab-separated-values",
  "application/json",
  "application/pdf",
]);

const SAFE_INLINE_MIMES = new Set<string>([
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/webp",
  "image/gif",
]);

const MAX_BYTES = 8 * 1024 * 1024; // 8 MB
const PER_USER_QUOTA_BYTES = 256 * 1024 * 1024; // 256 MB

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_BYTES, files: 1 },
  fileFilter: (_req, file, cb) => {
    cb(null, true);
  },
});

function handleMulter(req: Request, res: Response, next: NextFunction): void {
  upload.single("file")(req, res, (err) => {
    if (!err) {
      next();
      return;
    }
    if (err instanceof multer.MulterError) {
      if (err.code === "LIMIT_FILE_SIZE") {
        res.status(413).json({ error: "El archivo supera el límite de 8 MB." });
        return;
      }
      res.status(400).json({ error: `Carga inválida: ${err.message}` });
      return;
    }
    next(err);
  });
}

router.post("/uploads", requireAuth, handleMulter, async (req: Request, res: Response) => {
  try {
    await connectDB();
    const userId = req.userId!;
    const file = req.file;
    if (!file) {
      res.status(400).json({ error: "Falta el archivo (campo 'file')." });
      return;
    }

    const mime = (file.mimetype || "application/octet-stream").toLowerCase();
    if (!ALLOWED_MIMES.has(mime)) {
      res.status(415).json({
        error: `Tipo de archivo no admitido: ${mime}. Solo imágenes, PDF, texto, CSV o JSON.`,
      });
      return;
    }

    if (file.size > MAX_BYTES) {
      res.status(413).json({ error: "El archivo supera el límite de 8 MB." });
      return;
    }

    // Quota check
    const stats = await ChatAttachment.aggregate([
      { $match: { userId } },
      { $group: { _id: null, total: { $sum: "$sizeBytes" } } }
    ]);
    const usedNum = stats.length > 0 ? stats[0].total : 0;

    if (usedNum + file.size > PER_USER_QUOTA_BYTES) {
      res.status(413).json({
        error: "Has alcanzado el límite de almacenamiento de adjuntos (256 MB). Borra archivos antiguos para subir más.",
      });
      return;
    }

    const safeName = (file.originalname || "archivo").slice(0, 200);
    const dataBase64 = file.buffer.toString("base64");

    const row = await ChatAttachment.create({
      userId,
      filename: safeName,
      mimeType: mime,
      sizeBytes: file.size,
      dataBase64,
    });

    res.status(201).json({
      id: row._id,
      filename: row.filename,
      mimeType: row.mimeType,
      sizeBytes: row.sizeBytes,
      isImage: row.mimeType.startsWith("image/"),
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
    if (!row) {
      res.status(404).json({ error: "Attachment not found" });
      return;
    }

    const buf = Buffer.from(row.dataBase64, "base64");
    res.setHeader("Content-Type", row.mimeType);
    res.setHeader("Content-Length", String(buf.length));
    res.setHeader("Cache-Control", "private, max-age=86400, immutable");
    res.setHeader("X-Content-Type-Options", "nosniff");

    const disposition = SAFE_INLINE_MIMES.has(row.mimeType) ? "inline" : "attachment";
    res.setHeader(
      "Content-Disposition",
      `${disposition}; filename="${encodeURIComponent(row.filename)}"`
    );
    res.end(buf);
  } catch (err) {
    logger.error({ err, id: req.params.id }, "GET /api/uploads/:id error");
    res.status(500).json({ error: "Error interno al obtener archivo" });
  }
});

export default router;
