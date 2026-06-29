import { Router, type IRouter, type Request, type Response } from "express";
import { connectDB } from "../lib/db";
import { requireAuth } from "../lib/auth";
import { User, CreditTransaction } from "@workspace/db/schema";
import {
  CREDIT_PACKAGES,
  SUBSCRIPTION_PLANS,
  findPackageById,
  getPlanById,
  KIND_COSTS,
} from "../lib/payments";
import { createPaymentOrder, verifyTransaction, isTransactionPaid } from "../lib/vivaPayments";
import { creditPurchase, grantPlanCredits } from "../lib/credits";
import { logger } from "../lib/logger";

const router: IRouter = Router();

router.get("/billing/packages", (_req: Request, res: Response) => {
  res.json(CREDIT_PACKAGES.map((p) => ({ ...p })));
});

router.get("/billing/plans", (_req: Request, res: Response) => {
  res.json(SUBSCRIPTION_PLANS.map((p) => ({ ...p })));
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
  return process.env.FRONTEND_URL || "https://www.marisai.es";
}

// POST /billing/custom-checkout — comprar monto personalizado de créditos
router.post(
  "/billing/custom-checkout",
  requireAuth,
  async (req: Request, res: Response) => {
    const amountEur = req.body?.amountEur;
    if (typeof amountEur !== "number" || amountEur < 20) {
      res.status(400).json({ error: "El monto mínimo es 20€." });
      return;
    }

    const merchantId = process.env.VIVA_MERCHANT_ID;
    if (!merchantId && !process.env.VIVA_SMART_CHECKOUT_CLIENT_ID) {
      res.status(503).json({
        error: "Los pagos aún no están conectados. Configura las credenciales de Viva.com en las variables de entorno.",
      });
      return;
    }

    const origin = originFromReq(req);
    const basePath = process.env.FRONTEND_BASE_PATH ?? "";

    // ✅ 1€ = 5 créditos → 20€ = 100 créditos
    const credits = Math.floor(amountEur * 5);
    const amountCents = Math.floor(amountEur * 100);

    try {
      const order = await createPaymentOrder({
        amount: amountCents,
        customerTrns: `Pack ${credits} créditos Maris AI — compra personalizada`,
        merchantTrns: `topup-custom:${req.userId}:${credits}`,
        customerEmail: req.dbUser!.email,
        customerFullName: req.dbUser!.fullName ?? undefined,
        requestLang: "es-ES",
      });

      // IMPORTANTE — confirmado contra la documentación oficial de Viva.com:
      // a diferencia de Stripe (success_url/cancel_url por sesión), la URL
      // de retorno de Viva Smart Checkout se configura UNA VEZ en el panel
      // de Viva (Menú → Ventas → Pagos Online → tu fuente de pago →
      // Success/Failure URL) — no se pasa por API en cada orden. El cliente
      // vuelve con "?t=<transactionId>&s=<orderCode>" añadido
      // automáticamente por Viva a esa URL fija. Acción manual pendiente:
      // configurar Success URL = https://www.marisai.es/billing/success y
      // Failure URL = https://www.marisai.es/billing?canceled=1 en ese panel.
      res.json({ url: order.checkoutUrl, orderCode: order.orderCode });
    } catch (err) {
      logger.error({ err }, "Viva custom-checkout failed");
      res.status(502).json({ error: "No se pudo crear la orden de pago con Viva.com." });
    }
  },
);

// POST /billing/checkout — comprar un pack de créditos (pago único)
router.post(
  "/billing/checkout",
  requireAuth,
  async (req: Request, res: Response) => {
    const packageId = req.body?.packageId ?? req.body?.priceId;
    if (typeof packageId !== "string") {
      res.status(400).json({ error: "Missing packageId" });
      return;
    }
    const pkg = findPackageById(packageId);
    if (!pkg) {
      res.status(404).json({ error: "Unknown package" });
      return;
    }

    const origin = originFromReq(req);
    const basePath = process.env.FRONTEND_BASE_PATH ?? "";

    try {
      const order = await createPaymentOrder({
        amount: pkg.priceCents,
        customerTrns: `Pack ${pkg.name} — ${pkg.credits} créditos Maris AI`,
        merchantTrns: `topup:${req.userId}:${pkg.id}:${pkg.credits}`,
        customerEmail: req.dbUser!.email,
        customerFullName: req.dbUser!.fullName ?? undefined,
        requestLang: "es-ES",
      });

      res.json({ url: order.checkoutUrl, orderCode: order.orderCode });
    } catch (err) {
      logger.error({ err, packageId }, "Viva checkout failed");
      res.status(502).json({ error: "No se pudo crear la orden de pago con Viva.com." });
    }
  },
);

// POST /billing/subscribe
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

    const origin = originFromReq(req);
    const basePath = process.env.FRONTEND_BASE_PATH ?? "";

    try {
      // allowRecurring=true — el cliente da su consentimiento explícito en
      // Smart Checkout para que se le cobre de nuevo cada mes sin estar
      // presente (ver chargeRecurringPayment en vivaPayments.ts, invocado
      // por el cron mensual una vez transcurrido el período). A diferencia
      // de Stripe, este primer pago NO crea ninguna suscripción aún — solo
      // habilita la recurrencia; el plan se activa de verdad en /confirm
      // o en el webhook, igual que un top-up normal.
      const order = await createPaymentOrder({
        amount: Math.round(plan.price * 100),
        customerTrns: `${plan.name} — ${plan.creditsPerMonth} créditos/mes`,
        merchantTrns: `subscription:${req.userId}:${plan.id}`,
        customerEmail: req.dbUser!.email,
        customerFullName: req.dbUser!.fullName ?? undefined,
        requestLang: "es-ES",
        allowRecurring: true,
      });

      res.json({ url: order.checkoutUrl, orderCode: order.orderCode });
    } catch (err) {
      logger.error({ err, planId }, "Viva subscribe failed");
      res.status(502).json({ error: "No se pudo crear la orden de pago con Viva.com." });
    }
  },
);

// POST /billing/cancel-subscription
router.post(
  "/billing/cancel-subscription",
  requireAuth,
  async (req: Request, res: Response) => {
    await connectDB();
    const user = req.dbUser!;

    // A diferencia de Stripe (que tiene un endpoint para marcar
    // cancel_at_period_end), con Viva la "cancelación" es simplemente NO
    // volver a referenciar el transactionId inicial en el próximo ciclo del
    // cron — no hay nada que cancelar en Viva mismo. Basta con borrar la
    // referencia local; el usuario sigue con acceso hasta planExpiresAt
    // (igual que el comportamiento original con Stripe).
    if (!user.vivaInitialTransactionId && !user.stripeSubscriptionId) {
      res.status(400).json({ error: "No tienes una suscripción activa." });
      return;
    }

    await User.findByIdAndUpdate(req.userId!, {
      $unset: { vivaInitialTransactionId: "", vivaSourceCode: "" },
    });

    res.json({
      ok: true,
      message: "Tu suscripción se cancelará al final del período actual. Seguirás teniendo acceso hasta entonces.",
    });
  },
);

// POST /billing/confirm
router.post(
  "/billing/confirm",
  requireAuth,
  async (req: Request, res: Response) => {
    const orderCode = req.body?.orderCode ?? req.body?.sessionId;
    const transactionId = req.body?.transactionId;
    if (typeof transactionId !== "string") {
      res.status(400).json({ error: "Missing transactionId" });
      return;
    }

    let tx;
    try {
      tx = await verifyTransaction(transactionId);
    } catch (err) {
      logger.error({ err, transactionId }, "Viva verifyTransaction failed in /billing/confirm");
      res.status(502).json({ error: "No se pudo verificar el pago con Viva.com." });
      return;
    }

    if (!tx || !isTransactionPaid(tx)) {
      res.json({
        creditsAdded: 0,
        newBalance: req.dbUser!.credits,
        alreadyProcessed: false,
      });
      return;
    }

    // El merchantTrns que nosotros mismos generamos al crear la orden es
    // la fuente de verdad de qué se está pagando — Viva nos lo devuelve tal
    // cual en la transacción verificada (ver vivaPayments.ts → VivaTransaction
    // — confirmar que el campo existe antes de depender de él en producción).
    const merchantTrns = tx.merchantTrns ?? "";

    const topupMatch = merchantTrns.match(/^topup(?:-custom)?:([^:]+):(?:[^:]+:)?(\d+)$/);
    if (topupMatch) {
      const [, ownerUserId, creditsStr] = topupMatch;
      if (ownerUserId !== req.userId) {
        res.status(403).json({ error: "Esta orden de pago no corresponde a tu usuario." });
        return;
      }
      const credits = Number(creditsStr);
      if (!Number.isFinite(credits) || credits <= 0) {
        res.status(400).json({ error: "Invalid credits in order reference" });
        return;
      }

      const result = await creditPurchase({
        userId: req.userId!,
        amount: credits,
        vivaOrderCode: String(tx.orderCode ?? orderCode ?? transactionId),
        description: `Top-up de ${credits} créditos (Viva.com)`,
      });

      if (!result.alreadyProcessed) {
        await connectDB();
        await User.findByIdAndUpdate(req.userId!, {
          $set: { hasEverPaid: true },
          $setOnInsert: { firstPaidAt: new Date() },
        });
      }

      res.json(result);
      return;
    }

    const subMatch = merchantTrns.match(/^subscription:([^:]+):([^:]+)$/);
    if (subMatch) {
      const [, ownerUserId, planId] = subMatch;
      if (ownerUserId !== req.userId) {
        res.status(403).json({ error: "Esta orden de pago no corresponde a tu usuario." });
        return;
      }
      const plan = getPlanById(planId);
      if (!plan) {
        res.status(400).json({ error: "Plan desconocido en la referencia de la orden." });
        return;
      }

      await connectDB();
      const currentUser = await User.findById(req.userId!, { vivaInitialTransactionId: 1, credits: 1 }).lean();

      if (currentUser?.vivaInitialTransactionId !== transactionId) {
        // Un mes de margen — el cron mensual cobrará de nuevo antes de que expire.
        const periodEnd = Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60;
        await grantPlanCredits({
          clerkUserId: req.userId!,
          planId: plan.id,
          creditsPerMonth: plan.creditsPerMonth,
          periodEnd,
          vivaInitialTransactionId: transactionId,
          vivaSourceCode: tx.sourceCode,
        });
        await User.findByIdAndUpdate(req.userId!, {
          $set: { isPremium: true, hasEverPaid: true },
          $setOnInsert: { firstPaidAt: new Date() },
        });

        const updatedUser = await User.findById(req.userId!, { credits: 1 }).lean();
        res.json({
          creditsAdded: plan.creditsPerMonth,
          newBalance: updatedUser?.credits ?? 0,
          alreadyProcessed: false,
          message: "Suscripción activada y créditos acreditados instantáneamente.",
        });
        return;
      } else {
        const updatedUser = await User.findById(req.userId!, { credits: 1 }).lean();
        res.json({
          creditsAdded: 0,
          newBalance: updatedUser?.credits ?? 0,
          alreadyProcessed: true,
          message: "Suscripción ya procesada.",
        });
        return;
      }
    }

    res.json({
      creditsAdded: 0,
      newBalance: req.dbUser!.credits,
      alreadyProcessed: false,
      message: "Pago verificado pero sin referencia reconocida.",
    });
  },
);

// GET /billing/status
router.get(
  "/billing/status",
  requireAuth,
  async (req: Request, res: Response) => {
    await connectDB();
    const user = req.dbUser!;
    const plan =
      SUBSCRIPTION_PLANS.find((p) => p.id === (user.plan ?? "free")) ??
      SUBSCRIPTION_PLANS[0];

    res.json({
      plan: user.plan ?? "free",
      planName: plan.name,
      planCreditsPerMonth: plan.creditsPerMonth,
      planExpiresAt: user.planExpiresAt?.toISOString() ?? null,
      credits: user.credits,
      hasActiveSubscription:
        !!(user.vivaInitialTransactionId || user.stripeSubscriptionId) &&
        !!user.planExpiresAt &&
        new Date(user.planExpiresAt) > new Date(),
    });
  },
);

export default router;
