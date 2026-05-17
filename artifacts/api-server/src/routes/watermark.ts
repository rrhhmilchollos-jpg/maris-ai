import { Router, Request, Response } from "express";
import { requireAuth } from "../middlewares/auth";
import { db } from "../lib/db";
import { generatedApps } from "@workspace/db/schema";
import { eq, and } from "drizzle-orm";
import Stripe from "stripe";
import { logger } from "../lib/logger";

const router = Router();

/**
 * GET /api/watermark/:appId
 * Obtener el estado de la marca de agua de una app
 */
router.get("/watermark/:appId", requireAuth, async (req: Request, res: Response) => {
  try {
    const { appId } = req.params;
    const userId = req.auth?.userId;

    if (!userId) {
      return res.status(401).json({ error: "No autenticado" });
    }

    // Obtener la app desde la base de datos
    const app = await db
      .select()
      .from(generatedApps)
      .where(and(eq(generatedApps.id, parseInt(appId)), eq(generatedApps.userId, userId)))
      .limit(1);

    if (app.length === 0) {
      return res.status(404).json({ error: "App no encontrada" });
    }

    const appData = app[0];

    return res.json({
      appId: appData.id,
      hasWatermark: appData.hasWatermark ?? true,
      watermarkRemovalPrice: appData.watermarkRemovalPrice ?? 9.99,
      watermarkRemovalStripeSessionId: appData.watermarkRemovalStripeSessionId || null,
    });
  } catch (error) {
    logger.error("Error fetching watermark status:", error);
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
    const userId = req.auth?.userId;

    if (!userId) {
      return res.status(401).json({ error: "No autenticado" });
    }

    // Obtener la app desde la base de datos
    const app = await db
      .select()
      .from(generatedApps)
      .where(and(eq(generatedApps.id, parseInt(appId)), eq(generatedApps.userId, userId)))
      .limit(1);

    if (app.length === 0) {
      return res.status(404).json({ error: "App no encontrada" });
    }

    const appData = app[0];

    // Si ya no tiene marca de agua, retornar error
    if (!appData.hasWatermark) {
      return res.status(400).json({ error: "Esta app ya no tiene marca de agua" });
    }

    // Crear sesión de Stripe
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || "", {
      apiVersion: "2024-06-20",
    });

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],
      line_items: [
        {
          price_data: {
            currency: "usd",
            product_data: {
              name: `Eliminar Marca de Agua - ${appData.title}`,
              description: "Elimina la marca de agua de Maris AI de tu aplicación generada",
              images: ["https://maris-ai.com/logo.png"],
            },
            unit_amount: Math.round((appData.watermarkRemovalPrice ?? 9.99) * 100),
          },
          quantity: 1,
        },
      ],
      success_url: `${process.env.MARIS_AI_PUBLIC_URL}/app/${appId}?watermark_removed=true`,
      cancel_url: `${process.env.MARIS_AI_PUBLIC_URL}/app/${appId}?watermark_cancelled=true`,
      metadata: {
        appId: appId.toString(),
        userId: userId,
        type: "watermark_removal",
      },
    });

    // Guardar el ID de sesión en la base de datos
    await db
      .update(generatedApps)
      .set({ watermarkRemovalStripeSessionId: session.id })
      .where(eq(generatedApps.id, parseInt(appId)));

    return res.json({
      sessionId: session.id,
      sessionUrl: session.url,
      price: appData.watermarkRemovalPrice ?? 9.99,
    });
  } catch (error) {
    logger.error("Error creating watermark removal session:", error);
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
    const userId = req.auth?.userId;
    const { sessionId } = req.body;

    if (!userId) {
      return res.status(401).json({ error: "No autenticado" });
    }

    if (!sessionId) {
      return res.status(400).json({ error: "sessionId es requerido" });
    }

    // Verificar la sesión con Stripe
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || "", {
      apiVersion: "2024-06-20",
    });

    const session = await stripe.checkout.sessions.retrieve(sessionId);

    if (session.payment_status === "paid") {
      // Actualizar la app para eliminar la marca de agua
      await db
        .update(generatedApps)
        .set({ hasWatermark: false, watermarkRemovalStripeSessionId: null })
        .where(and(eq(generatedApps.id, parseInt(appId)), eq(generatedApps.userId, userId)));

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
    logger.error("Error verifying watermark removal:", error);
    return res.status(500).json({ error: "Error interno del servidor" });
  }
});

export default router;
