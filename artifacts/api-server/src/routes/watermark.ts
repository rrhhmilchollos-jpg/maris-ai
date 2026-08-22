import { Router, type Request, type Response } from "express";
import { GeneratedApp } from "@workspace/db/schema";
import { requireAuth } from "../lib/auth";
import { logger } from "../lib/logger";

/**
 * La retirada de marca permanece desactivada hasta que exista un checkout
 * Stripe verificado y revisado. No se mantienen rutas ni credenciales de
 * proveedores de pago heredados.
 */
const router = Router();

router.get("/watermark/:appId/status", requireAuth, async (req: Request, res: Response) => {
  try {
    const appData = await GeneratedApp.findOne({ _id: req.params.appId, userId: req.userId }).lean();
    if (!appData) return res.status(404).json({ error: "App no encontrada" });
    return res.json({
      appId: String((appData as any)._id),
      hasWatermark: (appData as any).hasWatermark ?? true,
      watermarkRemovalAvailable: false,
      paymentProvider: "stripe",
    });
  } catch (error) {
    logger.error({ error }, "No se pudo consultar el estado de marca de agua");
    return res.status(500).json({ error: "No se pudo consultar el estado de marca de agua" });
  }
});

router.use("/watermark", requireAuth, (_req: Request, res: Response) => {
  return res.status(410).json({
    error: "La retirada de marca de agua no está disponible actualmente. Maris AI solo habilita pagos mediante Stripe Checkout verificado.",
    code: "WATERMARK_CHECKOUT_DISABLED",
  });
});

export default router;
