import express, { Router, type IRouter, type Request, type Response } from "express";
import { getStripe } from "../lib/stripe";
import { creditPurchase } from "../lib/credits";

export const stripeWebhookRouter: IRouter = Router();

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

    if (event.type === "checkout.session.completed") {
      const session = event.data
        .object as import("stripe").Stripe.Checkout.Session;
      const clerkUserId = session.metadata?.clerkUserId;
      const credits = Number(session.metadata?.credits ?? "0");
      if (
        clerkUserId &&
        credits > 0 &&
        session.payment_status === "paid"
      ) {
        // Idempotent — see creditPurchase docs. Racing with /billing/confirm
        // is fine, only one INSERT wins thanks to the unique index on
        // (user_id, stripe_session_id).
        try {
          await creditPurchase({
            userId: clerkUserId,
            amount: credits,
            stripeSessionId: session.id,
            description: `Purchased ${credits} credits`,
          });
        } catch (err) {
          // Surface a 5xx so Stripe retries this webhook (they back off and
          // try again for ~3 days). Swallowing it would silently drop credits
          // on transient DB blips. The retry is safe because the operation
          // is idempotent on (user_id, stripe_session_id).
          req.log.error(
            { err, sessionId: session.id, clerkUserId },
            "creditPurchase failed in webhook — returning 500 so Stripe retries",
          );
          res.status(500).json({ error: "internal" });
          return;
        }
      }
    }

    res.json({ received: true });
  },
);
