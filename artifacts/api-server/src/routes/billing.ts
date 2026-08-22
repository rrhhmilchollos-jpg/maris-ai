import { Router, type IRouter, type Request, type Response } from "express";
import { connectDB } from "../lib/db";
import { requireAuth } from "../lib/auth";
import { CreditTransaction } from "@workspace/db/schema";
import { CREDIT_PACKAGES, SUBSCRIPTION_PLANS } from "../lib/payments";

/**
 * Rutas de lectura compatibles de facturación.
 *
 * StripeBillingRouter se monta antes de este router y es el único responsable
 * de crear y confirmar Checkout. Este archivo no conserva clientes de pago,
 * órdenes ni verificaciones de proveedores heredados.
 */
const router: IRouter = Router();

router.get("/billing/packages", (_req: Request, res: Response) => {
  res.json(CREDIT_PACKAGES.map((pack) => ({ ...pack })));
});

router.get("/billing/plans", (_req: Request, res: Response) => {
  res.json(SUBSCRIPTION_PLANS.map((plan) => ({ ...plan })));
});

router.get("/billing/transactions", requireAuth, async (req: Request, res: Response) => {
  await connectDB();
  const rows = await CreditTransaction.find({ userId: req.userId! })
    .sort({ createdAt: -1 })
    .limit(100)
    .lean();
  res.json(rows.map((row) => ({
    id: row._id,
    userId: row.userId,
    amount: row.amount,
    kind: row.kind,
    description: row.description,
    createdAt: row.createdAt.toISOString(),
    priceCents: (row as any).priceCents ?? null,
    status: (row as any).status ?? "succeeded",
    gateway: (row as any).gateway ?? null,
    cardLast4: (row as any).cardLast4 ?? null,
    cardBrand: (row as any).cardBrand ?? null,
    refundedAt: (row as any).refundedAt ? (row as any).refundedAt.toISOString() : null,
  })));
});

router.use("/billing", requireAuth, (req: Request, res: Response) => {
  if (["POST", "PUT", "PATCH", "DELETE"].includes(req.method)) {
    return res.status(410).json({
      error: "Esta ruta de facturación heredada está desactivada. Las compras de créditos se procesan exclusivamente mediante Stripe Checkout verificado.",
      code: "LEGACY_BILLING_DISABLED",
    });
  }
  return res.status(404).json({ error: "Ruta de facturación no encontrada" });
});

export default router;
