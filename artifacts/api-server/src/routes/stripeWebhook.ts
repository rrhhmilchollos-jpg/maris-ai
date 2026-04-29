import express, { Router, type IRouter, type Request, type Response } from "express";
import { eq, and, sql } from "drizzle-orm";
import { db } from "../lib/db";
import { creditTransactions, users } from "@workspace/db/schema";
import { getStripe } from "../lib/stripe";

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
        const existing = await db
          .select()
          .from(creditTransactions)
          .where(
            and(
              eq(creditTransactions.userId, clerkUserId),
              eq(creditTransactions.stripeSessionId, session.id),
            ),
          )
          .limit(1);
        if (existing.length === 0) {
          await db.insert(creditTransactions).values({
            userId: clerkUserId,
            kind: "purchase",
            amount: credits,
            description: `Purchased ${credits} credits`,
            stripeSessionId: session.id,
          });
          await db
            .update(users)
            .set({
              credits: sql`${users.credits} + ${credits}`,
              updatedAt: new Date(),
            })
            .where(eq(users.id, clerkUserId));
        }
      }
    }

    res.json({ received: true });
  },
);
