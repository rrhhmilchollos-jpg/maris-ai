import { Router, type Request, type Response } from "express";
import Stripe from "stripe";
import { CreditTransaction } from "@workspace/db/schema";
import { requireAuth } from "../lib/auth";
import { connectDB } from "../lib/db";
import { CREDIT_PACKAGES, findPackageById } from "../lib/payments";
import { logger } from "../lib/logger";

const router = Router();

function stripeClient(): Stripe | null {
  const key = process.env.STRIPE_SECRET_KEY;
  return key ? new Stripe(key) : null;
}
function frontendUrl() { return process.env.FRONTEND_URL || "https://www.marisai.es"; }
function stripeReady() { return Boolean(process.env.STRIPE_SECRET_KEY && process.env.STRIPE_WEBHOOK_SECRET); }

router.get("/billing/provider", (_req, res) => {
  res.json({ provider: "stripe", checkoutEnabled: stripeReady(), automaticRefunds: false, creditsGrantedBy: "verified_stripe_webhook" });
});

router.post("/billing/checkout", requireAuth, async (req: Request, res: Response) => {
  const packageId = req.body?.packageId ?? req.body?.priceId;
  const pkg = typeof packageId === "string" ? findPackageById(packageId) : undefined;
  if (!pkg) return res.status(400).json({ error: "Selecciona un paquete de créditos válido." });
  const stripe = stripeClient();
  if (!stripe || !process.env.STRIPE_WEBHOOK_SECRET) {
    return res.status(503).json({ error: "La compra de créditos con Stripe todavía no está activada." });
  }
  try {
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],
      customer_email: req.dbUser?.email,
      client_reference_id: req.userId!,
      metadata: { kind: "credit_topup", userId: req.userId!, packageId: pkg.id, credits: String(pkg.credits) },
      line_items: [{
        quantity: 1,
        price_data: {
          currency: pkg.currency,
          unit_amount: pkg.priceCents,
          product_data: { name: `${pkg.name} · Maris AI`, description: `${pkg.credits} créditos para generaciones de Maris AI` },
        },
      }],
      success_url: `${frontendUrl()}/billing/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${frontendUrl()}/billing?canceled=1`,
    });
    if (!session.url) throw new Error("Stripe no devolvió URL de Checkout");
    res.json({ url: session.url, sessionId: session.id, provider: "stripe" });
  } catch (error) {
    logger.error({ error, packageId }, "No se pudo crear Stripe Checkout de créditos");
    res.status(502).json({ error: "No se pudo abrir Stripe Checkout. Inténtalo más tarde." });
  }
});

// Evita importes manipulables y elimina definitivamente el checkout directo de Viva.
router.post("/billing/custom-checkout", requireAuth, (_req, res) => {
  res.status(400).json({ error: "La compra personalizada no está disponible. Selecciona uno de los paquetes de créditos publicados." });
});

router.post("/billing/subscribe", requireAuth, (_req, res) => {
  res.status(400).json({ error: "Las suscripciones no están activas. La compra de créditos se realiza mediante paquetes Stripe de pago único." });
});

router.post("/billing/confirm", requireAuth, async (req: Request, res: Response) => {
  const sessionId = req.body?.sessionId;
  if (typeof sessionId !== "string" || !sessionId.startsWith("cs_")) return res.status(400).json({ error: "Falta una sesión válida de Stripe Checkout." });
  const stripe = stripeClient();
  if (!stripe) return res.status(503).json({ error: "Stripe todavía no está activo." });
  try {
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    if (session.client_reference_id !== req.userId || session.metadata?.kind !== "credit_topup") return res.status(403).json({ error: "Esta sesión no corresponde a tu cuenta." });
    await connectDB();
    const tx = await CreditTransaction.findOne({ stripeSessionId: session.id }, { amount: 1, priceCents: 1 }).lean();
    const user = req.dbUser!;
    res.json({
      paid: session.payment_status === "paid",
      credited: Boolean(tx),
      creditsAdded: tx?.amount ?? 0,
      priceCents: (tx as any)?.priceCents ?? null,
      newBalance: user.credits,
      message: tx ? "Pago verificado y créditos acreditados." : "Pago recibido. Los créditos se añadirán al confirmarse el webhook de Stripe.",
    });
  } catch (error) {
    logger.error({ error, sessionId }, "No se pudo consultar Stripe Checkout");
    res.status(502).json({ error: "No se pudo verificar Stripe Checkout." });
  }
});

export default router;
