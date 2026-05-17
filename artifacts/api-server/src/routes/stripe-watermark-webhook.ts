import { Router, Request, Response } from "express";
import Stripe from "stripe";
import { db } from "../lib/db";
import { generatedApps } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { logger } from "../lib/logger";
import { raw } from "express";

const router = Router();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || "", {
  apiVersion: "2024-06-20",
});

const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET || "";

/**
 * POST /api/stripe/watermark-webhook
 * Webhook de Stripe para procesar pagos de eliminación de marca de agua
 */
router.post(
  "/stripe/watermark-webhook",
  raw({ type: "application/json" }),
  async (req: Request, res: Response) => {
    const signature = req.headers["stripe-signature"] as string;

    if (!signature) {
      logger.warn("Webhook sin firma de Stripe");
      return res.status(400).json({ error: "No Stripe signature" });
    }

    let event: Stripe.Event;

    try {
      event = stripe.webhooks.constructEvent(
        req.body,
        signature,
        webhookSecret,
      );
    } catch (err) {
      logger.error("Error verificando firma de webhook:", err);
      return res.status(400).json({ error: "Invalid signature" });
    }

    try {
      // Procesar diferentes tipos de eventos
      switch (event.type) {
        case "checkout.session.completed": {
          const session = event.data.object as Stripe.Checkout.Session;

          // Verificar si es un pago de eliminación de marca de agua
          if (session.metadata?.type === "watermark_removal") {
            const appId = session.metadata.appId;
            const userId = session.metadata.userId;

            if (appId && userId) {
              // Actualizar la app para eliminar la marca de agua
              await db
                .update(generatedApps)
                .set({
                  hasWatermark: false,
                  watermarkRemovalStripeSessionId: null,
                })
                .where(eq(generatedApps.id, parseInt(appId)));

              logger.info(
                `Marca de agua eliminada para app ${appId} del usuario ${userId}`,
              );
            }
          }
          break;
        }

        case "checkout.session.expired": {
          const session = event.data.object as Stripe.Checkout.Session;

          if (session.metadata?.type === "watermark_removal") {
            const appId = session.metadata.appId;

            if (appId) {
              // Limpiar el ID de sesión si expiró
              await db
                .update(generatedApps)
                .set({ watermarkRemovalStripeSessionId: null })
                .where(eq(generatedApps.id, parseInt(appId)));

              logger.info(`Sesión de pago expirada para app ${appId}`);
            }
          }
          break;
        }

        case "payment_intent.payment_failed": {
          const paymentIntent = event.data.object as Stripe.PaymentIntent;
          logger.warn(
            `Pago fallido: ${paymentIntent.id}`,
            paymentIntent.last_payment_error,
          );
          break;
        }

        default:
          logger.debug(`Evento de Stripe no procesado: ${event.type}`);
      }

      return res.json({ received: true });
    } catch (error) {
      logger.error("Error procesando webhook de Stripe:", error);
      return res.status(500).json({ error: "Internal server error" });
    }
  },
);

export default router;
