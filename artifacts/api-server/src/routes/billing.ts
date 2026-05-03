import { Router, type IRouter, type Request, type Response } from "express";
import { connectDB } from "../lib/db";
import { requireAuth } from "../lib/auth";
import { User, CreditTransaction } from "@workspace/db/schema";
import {
  CREDIT_PACKAGES,
  findPackageByPriceId,
  getStripe,
} from "../lib/stripe";
import { creditPurchase } from "../lib/credits";

const router: IRouter = Router();

router.get("/billing/packages", (_req: Request, res: Response) => {
  res.json(CREDIT_PACKAGES.map((p) => ({ ...p })));
});

router.get(
  "/billing/transactions",
  requireAuth,
  async (req: Request, res: Response) => {
    await connectDB();
    const userId = req.userId!;
    const rows = await CreditTransaction.find({ userId })
      .sort({ createdAt: -1 })
      .limit(100)
      .lean();

    res.json(
      rows.map((r) => ({
        id: r._id,
        userId: r.userId,
        amount: r.amount,
        kind: r.kind,
        description: r.description,
        createdAt: r.createdAt.toISOString(),
      })),
    );
  },
);

function originFromReq(req: Request): string {
  const proto =
    (req.headers["x-forwarded-proto"] as string)?.split(",")[0] ?? "https";
  const host =
    (req.headers["x-forwarded-host"] as string) ?? req.headers.host;
  return `${proto}://${host}`;
}

router.post(
  "/billing/checkout",
  requireAuth,
  async (req: Request, res: Response) => {
    const priceId = req.body?.priceId;
    if (typeof priceId !== "string") {
      res.status(400).json({ error: "Missing priceId" });
      return;
    }
    const pkg = findPackageByPriceId(priceId);
    if (!pkg) {
      res.status(404).json({ error: "Unknown package" });
      return;
    }

    const stripe = await getStripe();
    if (!stripe) {
      res.status(503).json({
        error:
          "Los pagos aún no están conectados. Conecta tu cuenta de Stripe desde la pestaña de Integraciones para habilitar las compras.",
      });
      return;
    }

    const origin = originFromReq(req);
    const basePath = process.env.FRONTEND_BASE_PATH ?? "";
    const successUrl = `${origin}${basePath}/billing/success?session_id={CHECKOUT_SESSION_ID}`;
    const cancelUrl = `${origin}${basePath}/billing?canceled=1`;

    let customerId = req.dbUser!.stripeCustomerId ?? undefined;
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: req.dbUser!.email,
        name: req.dbUser!.fullName ?? undefined,
        metadata: { clerkUserId: req.userId! },
      });
      customerId = customer.id;
      await connectDB();
      await User.findByIdAndUpdate(req.userId!, {
        $set: { stripeCustomerId: customerId },
      });
    }

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      customer: customerId,
      locale: "es",
      success_url: successUrl,
      cancel_url: cancelUrl,
      line_items: [
        {
          price_data: {
            currency: pkg.currency,
            unit_amount: pkg.priceCents,
            product_data: {
              name: `Pack ${pkg.name} — ${pkg.credits} créditos Maris AI`,
              description: pkg.description,
            },
          },
          quantity: 1,
        },
      ],
      metadata: {
        clerkUserId: req.userId!,
        priceId: pkg.priceId,
        credits: String(pkg.credits),
      },
    });

    if (!session.url) {
      res.status(500).json({ error: "Stripe did not return a session URL" });
      return;
    }

    res.json({ url: session.url, sessionId: session.id });
  },
);

router.post(
  "/billing/confirm",
  requireAuth,
  async (req: Request, res: Response) => {
    const sessionId = req.body?.sessionId;
    if (typeof sessionId !== "string") {
      res.status(400).json({ error: "Missing sessionId" });
      return;
    }
    const stripe = await getStripe();
    if (!stripe) {
      res.status(503).json({ error: "Los pagos aún no están conectados." });
      return;
    }

    const session = await stripe.checkout.sessions.retrieve(sessionId);
    if (
      session.metadata?.clerkUserId !== req.userId ||
      session.payment_status !== "paid"
    ) {
      res.json({
        creditsAdded: 0,
        newBalance: req.dbUser!.credits,
        alreadyProcessed: false,
      });
      return;
    }

    const credits = Number(session.metadata?.credits ?? "0");
    if (!Number.isFinite(credits) || credits <= 0) {
      res.status(400).json({ error: "Invalid credits in session metadata" });
      return;
    }

    const result = await creditPurchase({
      userId: req.userId!,
      amount: credits,
      stripeSessionId: session.id,
      description: `Purchased ${credits} credits`,
    });

    res.json(result);
  },
);

export default router;
