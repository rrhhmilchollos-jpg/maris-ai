import type { Request, Response } from "express";
import Stripe from "stripe";
import { User } from "@workspace/db/schema";
import { creditPurchase } from "../lib/credits";
import { findPackageById } from "../lib/payments";
import { logger } from "../lib/logger";

function getStripeClient(): Stripe | null {
  const secret = process.env.STRIPE_SECRET_KEY;
  return secret ? new Stripe(secret) : null;
}

async function creditCompletedCheckout(session: Stripe.Checkout.Session) {
  if (session.payment_status !== "paid") return { processed: false, reason: "payment_not_paid" };
  const metadata = session.metadata ?? {};
  if (metadata.kind !== "credit_topup") return { processed: false, reason: "not_credit_topup" };

  const userId = metadata.userId;
  const packageId = metadata.packageId;
  if (!userId || !packageId) throw new Error("Stripe Checkout sin metadatos obligatorios de crédito");
  const pkg = findPackageById(packageId);
  if (!pkg) throw new Error("Stripe Checkout referencia un paquete de créditos inexistente");
  if (session.currency !== pkg.currency || session.amount_total !== pkg.priceCents) {
    throw new Error("El importe o moneda de Stripe Checkout no coincide con el paquete solicitado");
  }

  try {
    const result = await creditPurchase({
      userId,
      amount: pkg.credits,
      stripeSessionId: session.id,
      description: `Top-up de ${pkg.credits} créditos (Stripe Checkout verificado)`,
      priceCents: pkg.priceCents,
      gateway: "stripe",
      cardLast4: typeof session.payment_intent === "string" ? undefined : undefined,
    });
    if (!result.alreadyProcessed) {
      await User.findByIdAndUpdate(userId, {
        $set: { hasEverPaid: true },
        $setOnInsert: { firstPaidAt: new Date() },
      });
    }
    return { processed: true, ...result };
  } catch (error: any) {
    // El índice único de stripeSessionId es la última barrera frente a reintentos simultáneos de Stripe.
    if (error?.code === 11000) return { processed: true, alreadyProcessed: true };
    throw error;
  }
}

/** Se monta con express.raw() antes de express.json() en app.ts. */
export async function stripeCreditsWebhookHandler(req: Request, res: Response) {
  const stripe = getStripeClient();
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!stripe || !webhookSecret) {
    logger.warn("Webhook Stripe recibido sin configuración de Stripe activa");
    res.status(503).json({ error: "Stripe no está configurado" });
    return;
  }
  const signature = req.header("stripe-signature");
  if (!signature || !Buffer.isBuffer(req.body)) {
    res.status(400).json({ error: "Firma o cuerpo Stripe inválidos" });
    return;
  }

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(req.body, signature, webhookSecret);
  } catch (error: any) {
    logger.warn({ error: error?.message }, "Firma Stripe rechazada");
    res.status(400).json({ error: "Firma Stripe inválida" });
    return;
  }

  try {
    if (event.type === "checkout.session.completed" || event.type === "checkout.session.async_payment_succeeded") {
      const outcome = await creditCompletedCheckout(event.data.object as Stripe.Checkout.Session);
      logger.info({ eventId: event.id, outcome }, "Webhook Stripe de créditos procesado");
    }
    // Otros eventos no acreditan créditos y se aceptan para no provocar reintentos inútiles.
    res.json({ received: true });
  } catch (error) {
    logger.error({ error, eventId: event.id, type: event.type }, "Webhook Stripe no pudo acreditar créditos");
    res.status(500).json({ error: "No se pudo procesar el evento Stripe" });
  }
}
