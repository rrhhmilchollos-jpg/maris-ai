import { Router, type Request, type Response } from "express";
import Stripe from "stripe";
import { GeneratedApp } from "@workspace/db/schema";
import { requireAuth } from "../lib/auth";
import { logger } from "../lib/logger";

const router = Router();

/**
 * GET /api/watermark/:appId/status
 * Obtener el estado de la marca de agua de una app
 */
router.get("/watermark/:appId/status", requireAuth, async (req: Request, res: Response) => {
  try {
    const { appId } = req.params;
    const userId = (req as any).auth?.userId;
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
 * Crear una sesión de Stripe para eliminar la marca de agua
 */
router.post("/watermark/:appId/remove", requireAuth, async (req: Request, res: Response) => {
  try {
    const { appId } = req.params;
    const userId = (req as any).auth?.userId;
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

    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || "", {
      apiVersion: "2026-04-22.dahlia" as any,
    });

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],
      line_items: [
        {
          price_data: {
            currency: "usd",
            product_data: {
              name: `Eliminar Marca de Agua - ${(appData as any).title}`,
              description: "Elimina la marca de agua de Maris AI de tu aplicación generada",
              images: ["https://marisai.es/logo.svg"],
            },
            unit_amount: Math.round(((appData as any).watermarkRemovalPrice ?? 9.99) * 100),
          },
          quantity: 1,
        },
      ],
      success_url: `${process.env.MARIS_AI_PUBLIC_URL}/app/${appId}?watermark_removed=true&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.MARIS_AI_PUBLIC_URL}/app/${appId}?watermark_cancelled=true`,
      metadata: {
        appId: appId.toString(),
        userId,
        type: "watermark_removal",
      },
    });

    await GeneratedApp.updateOne({ _id: appId }, { watermarkRemovalStripeSessionId: session.id });

    return res.json({
      sessionId: session.id,
      sessionUrl: session.url,
      price: (appData as any).watermarkRemovalPrice ?? 9.99,
    });
  } catch (error) {
    logger.error({ err: error }, "Error creating watermark removal session:");
    return res.status(500).json({ error: "Error interno del servidor" });
  }
});

/**
 * POST /api/watermark/:appId/verify-removal
 * Verificar si la marca de agua ha sido eliminada (después del pago)
 */
router.post("/watermark/:appId/verify-removal", requireAuth, async (req: Request, res: Response) => {
  try {
    const { appId } = req.params;
    const userId = (req as any).auth?.userId;
    const { sessionId } = req.body;

    if (!userId) {
      return res.status(401).json({ error: "No autenticado" });
    }
    if (!sessionId) {
      return res.status(400).json({ error: "sessionId es requerido" });
    }

    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || "", {
      apiVersion: "2026-04-22.dahlia" as any,
    });

    const session = await stripe.checkout.sessions.retrieve(sessionId);

    if (session.payment_status === "paid") {
      await GeneratedApp.updateOne(
        { _id: appId, userId },
        { hasWatermark: false, watermarkRemovalStripeSessionId: null },
      );
      return res.json({
        success: true,
        message: "Marca de agua eliminada exitosamente",
        hasWatermark: false,
      });
    } else {
      return res.status(400).json({
        success: false,
        message: "El pago no ha sido procesado",
        paymentStatus: session.payment_status,
      });
    }
  } catch (error) {
    logger.error({ err: error }, "Error verifying watermark removal:");
    return res.status(500).json({ error: "Error interno del servidor" });
  }
});

export default router;
