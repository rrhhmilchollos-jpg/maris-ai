import { Router, type IRouter, type Request, type Response } from "express";
import { connectDB } from "../lib/db";
import { requireAuth } from "../lib/auth";
import { User } from "@workspace/db/schema";
import { SUBSCRIPTION_PLANS } from "../lib/payments";

const router: IRouter = Router();

/**
 * GET /billing/credits-live — obtener estado de créditos en tiempo real
 * Incluye desglose de créditos del plan vs top-ups y porcentaje de consumo
 */
router.get(
  "/billing/credits-live",
  requireAuth,
  async (req: Request, res: Response) => {
    await connectDB();
    const userId = req.userId!;

    const user = await User.findById(userId, {
      credits: 1,
      planCredits: 1,
      plan: 1,
      planExpiresAt: 1,
      stripeSubscriptionId: 1,
    }).lean();

    if (!user) {
      res.status(404).json({ error: "Usuario no encontrado" });
      return;
    }

    const plan = SUBSCRIPTION_PLANS.find((p) => p.id === (user.plan ?? "free")) ?? SUBSCRIPTION_PLANS[0];
    const planCredits = user.planCredits ?? 0;
    const topUpCredits = Math.max(0, (user.credits ?? 0) - planCredits);
    const totalCredits = user.credits ?? 0;

    // Calcular porcentaje de consumo del plan mensual
    const planUsagePercent = planCredits > 0 ? Math.round(((planCredits - topUpCredits) / planCredits) * 100) : 0;
    const isOutOfCredits = totalCredits <= 0;

    res.json({
      credits: totalCredits,
      planCredits,
      topUpCredits,
      planName: plan.name,
      planExpiresAt: user.planExpiresAt?.toISOString() ?? null,
      planUsagePercent,
      isOutOfCredits,
      hasActiveSubscription: !!user.stripeSubscriptionId && !!user.planExpiresAt && new Date(user.planExpiresAt) > new Date(),
      timestamp: new Date().toISOString(),
    });
  },
);

export default router;
