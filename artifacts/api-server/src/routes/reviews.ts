import { Router, type IRouter } from "express";
import { connectDB } from "../lib/db";
import { requireAuth, requireAdmin } from "../lib/auth";
import { Review, User } from "@workspace/db/schema";
import { logger } from "../lib/logger";
import { moderateReviewText } from "../lib/reviewModeration";

const router: IRouter = Router();

// ─── Crear reseña (usuario logueado, desde dashboard o invitación) ─────────
router.post("/reviews", requireAuth, async (req: any, res: any): Promise<void> => {
  await connectDB();
  const userId = req.userId;
  if (!userId) {
    return res.status(401).json({ error: "No autenticado" });
  }

  const { rating, title, body, source, relatedAppId } = req.body;
  const ratingNum = Number(rating);

  if (!ratingNum || ratingNum < 1 || ratingNum > 5) {
    return res.status(400).json({ error: "La valoración debe ser de 1 a 5" });
  }
  if (!body || String(body).trim().length < 10) {
    return res.status(400).json({ error: "La reseña debe tener al menos 10 caracteres" });
  }
  if (String(body).length > 2000) {
    return res.status(400).json({ error: "La reseña es demasiado larga (máx. 2000 caracteres)" });
  }

  try {
    const user = await User.findById(userId, { email: 1, fullName: 1 }).lean().catch(() => null) as any;

    // Moderación: título + cuerpo, cualquier match manda a revisión manual,
    // nunca se publica directo aunque pase el filtro (status siempre queda
    // "pending" para aprobación humana; el filtro solo distingue
    // "pending" normal de "flagged" prioritario).
    const combinedText = `${title || ""} ${body}`;
    const moderation = moderateReviewText(combinedText);

    const newReview = await Review.create({
      userId,
      authorName: user?.fullName || "Usuario de Maris AI",
      authorEmail: user?.email,
      rating: ratingNum,
      title: title ? String(title).slice(0, 150) : undefined,
      body: String(body).slice(0, 2000),
      status: moderation.flagged ? "flagged" : "pending",
      flaggedWords: moderation.matchedTerms,
      source: source ? String(source).slice(0, 50) : "dashboard",
      relatedAppId: relatedAppId ? String(relatedAppId) : undefined,
    });

    res.json({
      success: true,
      review: { id: newReview._id, status: newReview.status },
      message: "¡Gracias por tu reseña! Se publicará tras una breve revisión.",
    });
  } catch (err) {
    logger.error("Error creando reseña", { err });
    res.status(500).json({ error: "Error al guardar la reseña" });
  }
});

// ─── Listado público: solo reseñas publicadas + estadísticas agregadas ────
// Esto es lo que alimenta el aggregateRating del schema.org Product en el
// frontend estático — SOLO cuenta reseñas con status "published" (revisadas
// y aprobadas por un admin), nunca "pending" ni "flagged".
router.get("/reviews/public", async (_req: any, res: any): Promise<void> => {
  await connectDB();
  try {
    const reviews = await Review.find({ status: "published" }, {
      authorName: 1, rating: 1, title: 1, body: 1, createdAt: 1,
    }).sort({ createdAt: -1 }).limit(100).lean();

    const count = reviews.length;
    const avg = count > 0
      ? reviews.reduce((sum: number, r: any) => sum + r.rating, 0) / count
      : 0;

    res.json({
      reviews,
      aggregate: {
        ratingValue: Number(avg.toFixed(2)),
        reviewCount: count,
      },
    });
  } catch (err) {
    logger.error("Error listando reseñas públicas", { err });
    res.status(500).json({ error: "Error al obtener reseñas" });
  }
});

// ─── Admin: listar pendientes/flagged para moderar ─────────────────────────
router.get("/admin/reviews", requireAuth, requireAdmin, async (req: any, res: any): Promise<void> => {
  await connectDB();
  const status = (req.query.status as string) || "pending";
  try {
    const reviews = await Review.find({ status }).sort({ createdAt: -1 }).limit(200).lean();
    res.json({ reviews });
  } catch (err) {
    logger.error("Error listando reseñas admin", { err });
    res.status(500).json({ error: "Error al obtener reseñas" });
  }
});

// ─── Admin: aprobar / rechazar reseña ──────────────────────────────────────
router.post("/admin/reviews/:id/moderate", requireAuth, requireAdmin, async (req: any, res: any): Promise<void> => {
  await connectDB();
  const { id } = req.params;
  const { action } = req.body; // "approve" | "reject"

  if (!["approve", "reject"].includes(action)) {
    return res.status(400).json({ error: "Acción inválida" });
  }

  try {
    const review = await Review.findById(id);
    if (!review) {
      return res.status(404).json({ error: "Reseña no encontrada" });
    }
    review.status = action === "approve" ? "published" : "rejected";
    await review.save();
    res.json({ success: true, review: { id: review._id, status: review.status } });
  } catch (err) {
    logger.error("Error moderando reseña", { err });
    res.status(500).json({ error: "Error al moderar la reseña" });
  }
});

export default router;
