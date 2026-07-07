import { Router, type Request, type Response } from "express";
import { GeneratedApp } from "@workspace/db/schema";
import { requireAuth } from "../lib/auth";
import { logger } from "../lib/logger";
import { createPaymentOrder, verifyTransaction, isTransactionPaid } from "../lib/vivaPayments";

const router = Router();

/**
 * GET /api/watermark/:appId/status
 * Obtener el estado de la marca de agua de una app
 */
router.get("/watermark/:appId/status", requireAuth, async (req: Request, res: Response) => {
  try {
    const { appId } = req.params;
    // ENCONTRADO A PETICIÓN DEL USUARIO (reporte real: "la marca de agua
    // no sale en ningún proyecto, ni nuevos ni viejos, y el botón de
    // quitarla está desactivado"): las 3 rutas de este archivo leían
    // (req as any).auth?.userId -- un campo que NO EXISTE en este
    // proyecto. requireAuth (lib/auth.ts) pone el ID del usuario en
    // req.userId directamente, patrón usado consistentemente en TODO el
    // resto del backend. Con el campo equivocado, userId era siempre
    // undefined, esta ruta devolvía 401 "no autenticado" en cada
    // llamada, y el frontend interpretaba ese fallo silencioso como "sin
    // marca de agua que quitar" -- explica los dos sintomas reportados a
    // la vez.
    const userId = (req as any).userId;
    if (!userId) {
      return res.status(401).json({ error: "No autenticado" });
    }

    const appData = await GeneratedApp.findOne({ _id: appId, userId }).lean();
    if (!appData) {
      return res.status(404).json({ error: "App no encontrada" });
    }

    return res.json({
      appId: (appData as any)._id,
      hasWatermark: (appData as any).hasWatermark ?? true,
      watermarkRemovalPrice: (appData as any).watermarkRemovalPrice ?? 9.99,
      watermarkRemovalStripeSessionId: (appData as any).watermarkRemovalStripeSessionId || null,
    });
  } catch (error) {
    logger.error({ err: error }, "Error fetching watermark status:");
    return res.status(500).json({ error: "Error interno del servidor" });
  }
});

/**
 * POST /api/watermark/:appId/remove
 * Migrado a Viva.com (pasarela real de Maris AI) — ver /remove-viva más
 * abajo. Este endpoint se mantiene como redirect de compatibilidad para
 * cualquier enlace antiguo que pudiera seguir apuntando aquí, en vez de
 * romper con un 404 silencioso.
 */
router.post("/watermark/:appId/remove", requireAuth, async (req: Request, res: Response) => {
  return res.status(410).json({
    error: "Este método de pago ha sido descontinuado. Usa /api/watermark/:appId/remove-viva.",
  });
});

/**
 * POST /api/watermark/:appId/verify-removal
 * Migrado a Viva.com — ver /verify-removal-viva más abajo. Redirect de
 * compatibilidad, mismo motivo que /remove arriba.
 */
router.post("/watermark/:appId/verify-removal", requireAuth, async (req: Request, res: Response) => {
  return res.status(410).json({
    error: "Este método de pago ha sido descontinuado. Usa /api/watermark/:appId/verify-removal-viva.",
  });
});

/**
 * POST /api/watermark/:appId/remove-viva
 * Crear una orden de pago en Viva.com para eliminar la marca de agua
 * (alternativa a Stripe, usando la cuenta de comercio real en España).
 */
router.post("/watermark/:appId/remove-viva", requireAuth, async (req: Request, res: Response) => {
  try {
    const { appId } = req.params;
    const userId = (req as any).userId;
    if (!userId) {
      return res.status(401).json({ error: "No autenticado" });
    }

    const appData = await GeneratedApp.findOne({ _id: appId, userId }).lean();
    if (!appData) {
      return res.status(404).json({ error: "App no encontrada" });
    }
    if (!(appData as any).hasWatermark) {
      return res.status(400).json({ error: "Esta app ya no tiene marca de agua" });
    }

    const priceEur = (appData as any).watermarkRemovalPrice ?? 9.99;
    const { orderCode, checkoutUrl } = await createPaymentOrder({
      amount: Math.round(priceEur * 100), // Viva espera céntimos
      customerTrns: `Eliminar Marca de Agua - ${(appData as any).title}`,
      merchantTrns: `watermark_removal:${appId}`,
      requestLang: "es-ES",
    });

    await GeneratedApp.updateOne({ _id: appId }, { watermarkRemovalVivaOrderCode: orderCode });

    return res.json({ orderCode, checkoutUrl, price: priceEur });
  } catch (error) {
    logger.error({ err: error }, "Error creating Viva payment order for watermark removal:");
    return res.status(500).json({ error: "Error interno del servidor" });
  }
});

/**
 * POST /api/watermark/:appId/verify-removal-viva
 * Verificar si la marca de agua ha sido eliminada tras un pago con Viva.com.
 * El frontend llama a esto al volver de Viva con el parámetro `t`
 * (transaction ID) que Viva añade a la Success URL.
 */
router.post("/watermark/:appId/verify-removal-viva", requireAuth, async (req: Request, res: Response) => {
  try {
    const { appId } = req.params;
    const userId = (req as any).userId;
    const { transactionId } = req.body;

    if (!userId) {
      return res.status(401).json({ error: "No autenticado" });
    }
    if (!transactionId) {
      return res.status(400).json({ error: "transactionId es requerido" });
    }

    const tx = await verifyTransaction(transactionId);
    if (!tx || !isTransactionPaid(tx)) {
      return res.status(400).json({
        success: false,
        message: "El pago no ha sido procesado",
        statusId: tx?.statusId ?? null,
      });
    }

    await GeneratedApp.updateOne(
      { _id: appId, userId },
      { hasWatermark: false, watermarkRemovalVivaOrderCode: null },
    );
    return res.json({
      success: true,
      message: "Marca de agua eliminada exitosamente",
      hasWatermark: false,
    });
  } catch (error) {
    logger.error({ err: error }, "Error verifying Viva watermark removal:");
    return res.status(500).json({ error: "Error interno del servidor" });
  }
});

export default router;
