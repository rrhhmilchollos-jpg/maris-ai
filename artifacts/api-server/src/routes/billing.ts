import { Router, type IRouter, type Request, type Response } from "express";
import { connectDB } from "../lib/db";
import { requireAuth } from "../lib/auth";
import { User, CreditTransaction } from "@workspace/db/schema";
import {
  CREDIT_PACKAGES,
  SUBSCRIPTION_PLANS,
  findPackageByPriceId,
  getPlanByStripePriceId,
  getStripe,
  KIND_COSTS,
} from "../lib/stripe";
import { creditPurchase } from "../lib/credits";

const router: IRouter = Router();

// ─────────────────────────────────────────────────────────────────────────────
// GET /billing/packages — packs de créditos (top-ups)
// ─────────────────────────────────────────────────────────────────────────────
router.get("/billing/packages", (_req: Request, res: Response) => {
  res.json(CREDIT_PACKAGES.map((p) => ({ ...p })));
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /billing/plans — planes de suscripción mensual
// ─────────────────────────────────────────────────────────────────────────────
router.get("/billing/plans", (_req: Request, res: Response) => {
  res.json(SUBSCRIPTION_PLANS.map((p) => ({ ...p })));
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /billing/transactions
// ─────────────────────────────────────────────────────────────────────────────
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

// ─────────────────────────────────────────────────────────────────────────────
// POST /billing/custom-checkout — comprar monto personalizado de créditos
// ─────────────────────────────────────────────────────────────────────────────
router.post(
  "/billing/custom-checkout",
  requireAuth,
  async (req: Request, res: Response) => {
    const amountEur = req.body?.amountEur;
    if (typeof amountEur !== "number" || amountEur < 20) {
      res.status(400).json({ error: "El monto mínimo es 20€." });
      return;
    }

    const stripe = await getStripe();
    if (!stripe) {
      res.status(503).json({
        error: "Los pagos aún no están conectados. Configura STRIPE_SECRET_KEY en las variables de entorno.",
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

    // 1 crédito = 0.01 EUR → 100 créditos por euro
    const credits = Math.floor(amountEur * 100);
    const amountCents = Math.floor(amountEur * 100);

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      customer: customerId,
      locale: "es",
      success_url: successUrl,
      cancel_url: cancelUrl,
      line_items: [
        {
          price_data: {
            currency: "eur",
            unit_amount: amountCents,
            product_data: {
              name: `Pack ${credits} créditos Maris AI`,
              description: `Compra personalizada de ${credits} créditos`,
            },
          },
          quantity: 1,
        },
      ],
      metadata: {
        clerkUserId: req.userId!,
        credits: String(credits),
        type: "topup-custom",
      },
    });

    if (!session.url) {
      res.status(500).json({ error: "Stripe did not return a session URL" });
      return;
    }

    res.json({ url: session.url, sessionId: session.id });
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// POST /billing/checkout — comprar un pack de créditos (pago único)
// ─────────────────────────────────────────────────────────────────────────────
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
        error: "Los pagos aún no están conectados. Configura STRIPE_SECRET_KEY en las variables de entorno.",
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
              // Solo se incluye description si no está vacío
              ...(pkg.description ? { description: pkg.description } : {}),
            },
          },
          quantity: 1,
        },
      ],
      metadata: {
        clerkUserId: req.userId!,
        priceId: pkg.priceId,
        credits: String(pkg.credits),
        type: "topup",
      },
    });

    if (!session.url) {
      res.status(500).json({ error: "Stripe did not return a session URL" });
      return;
    }

    res.json({ url: session.url, sessionId: session.id });
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// POST /billing/subscribe — suscribirse a un plan mensual
// ─────────────────────────────────────────────────────────────────────────────
router.post(
  "/billing/subscribe",
  requireAuth,
  async (req: Request, res: Response) => {
    const planId = req.body?.planId as string;
    const plan = SUBSCRIPTION_PLANS.find((p) => p.id === planId);

    if (!plan || plan.id === "free") {
      res.status(400).json({ error: "Plan no válido para suscripción" });
      return;
    }

    if (!plan.stripePriceId) {
      res.status(503).json({
        error: `El plan ${plan.name} no tiene precio de Stripe configurado. Añade STRIPE_PRICE_${planId.toUpperCase()} a las variables de entorno.`,
      });
      return;
    }

    const stripe = await getStripe();
    if (!stripe) {
      res.status(503).json({ error: "Los pagos aún no están conectados." });
      return;
    }

    const origin = originFromReq(req);
    const basePath = process.env.FRONTEND_BASE_PATH ?? "";
    const successUrl = `${origin}${basePath}/billing/success?session_id={CHECKOUT_SESSION_ID}&plan=${planId}`;
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
      mode: "subscription",
      customer: customerId,
      locale: "es",
      success_url: successUrl,
      cancel_url: cancelUrl,
      line_items: [
        {
          price: plan.stripePriceId,
          quantity: 1,
        },
      ],
      metadata: {
        clerkUserId: req.userId!,
        planId: plan.id,
        creditsPerMonth: String(plan.creditsPerMonth),
        type: "subscription",
      },
      subscription_data: {
        metadata: {
          clerkUserId: req.userId!,
          planId: plan.id,
          creditsPerMonth: String(plan.creditsPerMonth),
        },
      },
    });

    if (!session.url) {
      res.status(500).json({ error: "Stripe did not return a session URL" });
      return;
    }

    res.json({ url: session.url, sessionId: session.id });
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// POST /billing/cancel-subscription — cancelar suscripción al final del ciclo
// ─────────────────────────────────────────────────────────────────────────────
router.post(
  "/billing/cancel-subscription",
  requireAuth,
  async (req: Request, res: Response) => {
    await connectDB();
    const user = req.dbUser!;

    if (!user.stripeSubscriptionId) {
      res.status(400).json({ error: "No tienes una suscripción activa." });
      return;
    }

    const stripe = await getStripe();
    if (!stripe) {
      res.status(503).json({ error: "Los pagos aún no están conectados." });
      return;
    }

    await stripe.subscriptions.update(user.stripeSubscriptionId, {
      cancel_at_period_end: true,
    });

    res.json({
      ok: true,
      message: "Tu suscripción se cancelará al final del período actual. Seguirás teniendo acceso hasta entonces.",
    });
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// POST /billing/confirm — confirmar pago único tras checkout (top-up)
// ─────────────────────────────────────────────────────────────────────────────
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

    if (session.metadata?.type === "topup" || session.metadata?.type === "topup-custom" || !session.metadata?.type) {
      const credits = Number(session.metadata?.credits ?? "0");
      if (!Number.isFinite(credits) || credits <= 0) {
        res.status(400).json({ error: "Invalid credits in session metadata" });
        return;
      }

      const result = await creditPurchase({
        userId: req.userId!,
        amount: credits,
        stripeSessionId: session.id,
        description: `Top-up de ${credits} créditos`,
      });

      res.json(result);
      return;
    }

    res.json({
      creditsAdded: 0,
      newBalance: req.dbUser!.credits,
      alreadyProcessed: false,
      message: "Suscripción activada. Los créditos se cargarán en breve.",
    });
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// GET /billing/status — estado del plan actual del usuario
// ─────────────────────────────────────────────────────────────────────────────
router.get(
  "/billing/status",
  requireAuth,
  async (req: Request, res: Response) => {
    await connectDB();
    const user = req.dbUser!;
    const plan = SUBSCRIPTION_PLANS.find((p) => p.id === (user.plan ?? "free")) ?? SUBSCRIPTION_PLANS[0];

    res.json({
      plan: user.plan ?? "free",
      planName: plan.name,
      planCreditsPerMonth: plan.creditsPerMonth,
      planExpiresAt: user.planExpiresAt?.toISOString() ?? null,
      credits: user.credits,
      hasActiveSubscription: !!user.stripeSubscriptionId && !!user.planExpiresAt && new Date(user.planExpiresAt) > new Date(),
    });
  },
);

export default router;
