import express, { Router, type IRouter, type Request, type Response } from "express";
import { getStripe, getPlanByStripePriceId, SUBSCRIPTION_PLANS } from "../lib/stripe";
import { creditPurchase } from "../lib/credits";
import { connectDB } from "../lib/db";
import { User, CreditTransaction } from "@workspace/db/schema";

export const stripeWebhookRouter: IRouter = Router();

/**
 * Dar créditos del plan al usuario al inicio o renovación de suscripción.
 * Los créditos del plan caducan al final del ciclo (se resetean en cada renovación).
 * Los créditos comprados (top-up) NO se tocan.
 */
async function grantPlanCredits(opts: {
  clerkUserId: string;
  planId: string;
  creditsPerMonth: number;
  periodEnd: number; // timestamp Unix
  stripeSubscriptionId: string;
}): Promise<void> {
  await connectDB();
  const { clerkUserId, planId, creditsPerMonth, periodEnd, stripeSubscriptionId } = opts;

  const planExpiresAt = new Date(periodEnd * 1000);

  // 1. Obtener créditos actuales del usuario con reintentos
  let user;
  let retries = 3;
  while (retries > 0) {
    try {
      user = await User.findById(clerkUserId, { credits: 1, plan: 1, planCredits: 1 }).lean();
      if (user) break;
    } catch (err) {
      retries--;
      if (retries === 0) throw err;
      await new Promise(r => setTimeout(r, 500));
    }
  }
  if (!user) return;

  // 2. Calcular créditos a añadir:
  //    - Resetear los créditos del plan anterior (que habrán caducado)
  //    - Mantener los créditos top-up (no caducan)
  const topUpCredits = Math.max(0, (user.credits ?? 0) - (user.planCredits ?? 0));
  const newTotalCredits = topUpCredits + creditsPerMonth;

  // 3. Actualizar usuario con el nuevo plan y créditos (con reintentos)
  retries = 3;
  while (retries > 0) {
    try {
      await User.findByIdAndUpdate(clerkUserId, {
        $set: {
          plan: planId,
          planCredits: creditsPerMonth,
          credits: newTotalCredits,
          planExpiresAt,
          stripeSubscriptionId,
        },
      });
      break;
    } catch (err) {
      retries--;
      if (retries === 0) throw err;
      await new Promise(r => setTimeout(r, 500));
    }
  }

  // 4. Registrar la transacción
  await CreditTransaction.create({
    userId: clerkUserId,
    kind: "subscription",
    amount: creditsPerMonth,
    description: `Renovación plan ${planId}: ${creditsPerMonth} créditos (válidos hasta ${planExpiresAt.toLocaleDateString("es-ES")})`,
  }).catch(() => { /* best-effort */ });
}

stripeWebhookRouter.post(
  "/",
  express.raw({ type: "application/json" }),
  async (req: Request, res: Response) => {
    const stripe = await getStripe();
    const signature = req.headers["stripe-signature"];
    const secret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!stripe || !signature || !secret) {
      res.status(200).json({ received: true, ignored: true });
      return;
    }

    let event;
    try {
      event = stripe.webhooks.constructEvent(req.body, signature, secret);
    } catch (err) {
      req.log.error({ err }, "Stripe webhook signature verification failed");
      res.status(400).send("Invalid signature");
      return;
    }

    try {
      // ─── Pago único completado (top-up de créditos) ───────────────────────
      if (event.type === "checkout.session.completed") {
        const session = event.data.object as import("stripe").Stripe.Checkout.Session;
        const clerkUserId = session.metadata?.clerkUserId;
        const type = session.metadata?.type;

        // Top-up de créditos
        if (type === "topup" || (!type && session.mode === "payment")) {
          const credits = Number(session.metadata?.credits ?? "0");
          if (clerkUserId && credits > 0 && session.payment_status === "paid") {
            await creditPurchase({
              userId: clerkUserId,
              amount: credits,
              stripeSessionId: session.id,
              description: `Top-up de ${credits} créditos`,
            });
            // ✅ Marcar primer pago — desbloquea generación de proyectos complejos
            await connectDB();
            await User.findByIdAndUpdate(clerkUserId, {
              $set: { hasEverPaid: true },
              $setOnInsert: { firstPaidAt: new Date() },
            });
            req.log.info({ clerkUserId, credits }, "Top-up confirmado — hasEverPaid=true, acceso completo desbloqueado");
          }
        }

        // Suscripción nueva — los créditos se dan en invoice.payment_succeeded
        // (que llega justo después), así evitamos doble crédito.
      }

      // ─── Suscripción creada o renovada ────────────────────────────────────
      if (event.type === "invoice.payment_succeeded") {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const invoice = event.data.object as any;

        // Solo procesar facturas de suscripción (no one-time)
        if (!invoice.subscription) {
          res.json({ received: true });
          return;
        }

        const subscriptionId = typeof invoice.subscription === "string"
          ? invoice.subscription
          : invoice.subscription.id;

        const subscription = await stripe.subscriptions.retrieve(subscriptionId);
        const clerkUserId = subscription.metadata?.clerkUserId;
        const planId = subscription.metadata?.planId;
        const creditsPerMonth = Number(subscription.metadata?.creditsPerMonth ?? "0");
        const periodEnd = (subscription as any).current_period_end ?? 0;

        if (!clerkUserId || !planId || !creditsPerMonth) {
          req.log.warn({ subscriptionId }, "Subscription missing metadata — skipping credit grant");
          res.json({ received: true });
          return;
        }

        await grantPlanCredits({
          clerkUserId,
          planId,
          creditsPerMonth,
          periodEnd,
          stripeSubscriptionId: subscriptionId,
        });

        // ✅ Seguimiento 1: Marcar isPremium=true para desbloquear dominio personalizado
        // ✅ Seguimiento 2: Marcar hasEverPaid=true para desbloquear proyectos complejos
        await connectDB();
        await User.findByIdAndUpdate(clerkUserId, {
          $set: { isPremium: true, hasEverPaid: true },
          $setOnInsert: { firstPaidAt: new Date() },
        });

        req.log.info(
          { clerkUserId, planId, creditsPerMonth, periodEnd },
          "Plan credits granted on subscription payment — isPremium=true",
        );
      }

      // ─── Suscripción cancelada ────────────────────────────────────────────
      if (event.type === "customer.subscription.deleted") {
        const subscription = event.data.object as import("stripe").Stripe.Subscription;
        const clerkUserId = subscription.metadata?.clerkUserId;

        if (clerkUserId) {
          await connectDB();

          // Volver al plan free y quitar los créditos del plan (mantener top-ups)
          const user = await User.findById(clerkUserId, { credits: 1, planCredits: 1 }).lean();
          const topUpCredits = Math.max(0, (user?.credits ?? 0) - (user?.planCredits ?? 0));

          // Dar los 10 créditos gratuitos del plan free
          const freeCredits = 10;

          await User.findByIdAndUpdate(clerkUserId, {
            $set: {
              plan: "free",
              planCredits: freeCredits,
              credits: topUpCredits + freeCredits,
              planExpiresAt: null,
              stripeSubscriptionId: null,
              isPremium: false, // ✅ Seguimiento 1: Revocar acceso a dominio personalizado
            },
          });

          await CreditTransaction.create({
            userId: clerkUserId,
            kind: "subscription",
            amount: freeCredits,
            description: "Vuelta al plan gratuito: 10 créditos mensuales",
          }).catch(() => {});

          req.log.info({ clerkUserId }, "Subscription cancelled — reverted to free plan");
        }
      }

      // ─── Pago de suscripción fallido ──────────────────────────────────────
      if (event.type === "invoice.payment_failed") {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const invoice = event.data.object as any;
        if (invoice.subscription) {
          const subscriptionId = typeof invoice.subscription === "string"
            ? invoice.subscription
            : invoice.subscription.id;
          const subscription = await stripe.subscriptions.retrieve(subscriptionId);
          const clerkUserId = subscription.metadata?.clerkUserId;

          if (clerkUserId) {
            req.log.warn({ clerkUserId, subscriptionId }, "Subscription payment failed");
            // No quitamos créditos — Stripe reintentará el pago automáticamente
          }
        }
      }

    } catch (err) {
      req.log.error({ err, eventType: event.type }, "Error processing Stripe webhook");
      res.status(500).json({ error: "internal" });
      return;
    }

    res.json({ received: true });
  },
);
