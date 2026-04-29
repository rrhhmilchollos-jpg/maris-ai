import { Router, type Request, type Response, type NextFunction } from "express";
import multer from "multer";
import { and, eq, sql } from "drizzle-orm";
import { db } from "../lib/db";
import { chatAttachments } from "@workspace/db";
import { requireAuth } from "../lib/auth";

const router: Router = Router();

/**
 * Allow-list of MIME types we accept from chat uploads. This is conservative
 * on purpose: files we don't know how to feed the LLM (videos, archives,
 * binaries) just inflate storage without helping the user. Add to this list
 * deliberately as new modalities are wired into the prompt builder.
 *
 * SECURITY: SVG and HTML are intentionally NOT in this list — they can carry
 * inline JavaScript and would be a stored-XSS vector if rendered same-origin.
 */
const ALLOWED_MIMES = new Set<string>([
  // images (raster only — SVG excluded on purpose)
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/webp",
  "image/gif",
  // text-shaped (HTML/XML excluded on purpose)
  "text/plain",
  "text/markdown",
  "text/csv",
  "text/tab-separated-values",
  "application/json",
  // docs
  "application/pdf",
]);

/**
 * MIME types we're willing to render inline in the browser (e.g. as <img src>
 * thumbnails for chat). Anything else gets a `Content-Disposition: attachment`
 * header so it downloads instead of executing in the page context — even if a
 * future code change accidentally widened the allow-list above.
 */
const SAFE_INLINE_MIMES = new Set<string>([
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/webp",
  "image/gif",
]);

const MAX_BYTES = 8 * 1024 * 1024; // 8 MB hard cap per file
/**
 * Per-user soft quota in bytes. Once a user accumulates this much in
 * `chat_attachments` rows we refuse new uploads with HTTP 413 and ask them
 * to delete old ones. Picked to be much larger than any realistic single
 * conversation while still capping the worst-case DB bloat from one bad actor.
 */
const PER_USER_QUOTA_BYTES = 256 * 1024 * 1024; // 256 MB

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_BYTES, files: 1 },
  fileFilter: (_req, file, cb) => {
    // We accept the upload here even if the mime is unknown — we only block
    // *after* checking the allow-list so the API returns a clean JSON 415
    // error instead of multer's terse "MulterError: ..." text.
    cb(null, true);
  },
});

/**
 * Wrapper that turns multer errors into JSON responses with the right HTTP
 * status, instead of letting them bubble out as 500s with a stack trace.
 */
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
  // Defensive — multer's limit should already enforce this, but a buggy proxy
  // could in principle hand us a larger buffer.
  if (file.size > MAX_BYTES) {
    res.status(413).json({ error: "El archivo supera el límite de 8 MB." });
    return;
  }
  // Per-user storage quota — cheap aggregate over rows we already index by
  // userId. Stops a single authenticated user from filling the database with
  // 8MB blobs.
  const [{ used }] = await db
    .select({ used: sql<number>`coalesce(sum(${chatAttachments.sizeBytes}), 0)::bigint` })
    .from(chatAttachments)
    .where(eq(chatAttachments.userId, userId));
  const usedNum = Number(used ?? 0);
  if (usedNum + file.size > PER_USER_QUOTA_BYTES) {
    res.status(413).json({
      error:
        "Has alcanzado el límite de almacenamiento de adjuntos (256 MB). Borra archivos antiguos para subir más.",
    });
    return;
  }
  const safeName = (file.originalname || "archivo").slice(0, 200);
  const dataBase64 = file.buffer.toString("base64");
  const [row] = await db
    .insert(chatAttachments)
    .values({
      userId,
      filename: safeName,
      mimeType: mime,
      sizeBytes: file.size,
      dataBase64,
    })
    .returning({
      id: chatAttachments.id,
      filename: chatAttachments.filename,
      mimeType: chatAttachments.mimeType,
      sizeBytes: chatAttachments.sizeBytes,
      createdAt: chatAttachments.createdAt,
    });
  res.status(201).json({
    id: row.id,
    filename: row.filename,
    mimeType: row.mimeType,
    sizeBytes: row.sizeBytes,
    isImage: row.mimeType.startsWith("image/"),
    createdAt: row.createdAt.toISOString(),
  });
});

/**
 * Stream the attachment back as binary. Owner-only — we never serve another
 * user's upload. This is what the chat bubble's <img src="..."> hits to render
 * a thumbnail of an image the user just attached.
 */
router.get("/uploads/:id", requireAuth, async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: "Invalid attachment id" });
    return;
  }
  const userId = req.userId!;
  const [row] = await db
    .select()
    .from(chatAttachments)
    .where(and(eq(chatAttachments.id, id), eq(chatAttachments.userId, userId)))
    .limit(1);
  if (!row) {
    res.status(404).json({ error: "Attachment not found" });
    return;
  }
  const buf = Buffer.from(row.dataBase64, "base64");
  res.setHeader("Content-Type", row.mimeType);
  res.setHeader("Content-Length", String(buf.length));
  // Browsers cache aggressively because the bytes are immutable for the row's
  // lifetime — we never overwrite an attachment in place.
  res.setHeader("Cache-Control", "private, max-age=86400, immutable");
  // Stop the browser from MIME-sniffing a text file into HTML and executing
  // it. Critical defence-in-depth alongside the upload allow-list.
  res.setHeader("X-Content-Type-Options", "nosniff");
  // Only render a tight set of well-known image MIME types inline. Everything
  // else (PDFs, text/csv/json, future additions) downloads — that way an
  // accidental allow-list widening can't turn into stored-XSS.
  const disposition = SAFE_INLINE_MIMES.has(row.mimeType) ? "inline" : "attachment";
  res.setHeader(
    "Content-Disposition",
    `${disposition}; filename="${encodeURIComponent(row.filename)}"`,
  );
  res.end(buf);
});

export default router;
