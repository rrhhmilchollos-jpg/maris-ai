import { Router, type IRouter } from "express";
import { connectDB } from "../lib/db";
import { requireAuth, isAdminEmail } from "../lib/auth";
import {
  GeneratedApp,
  CreditTransaction,
  AgentNote,
} from "@workspace/db/schema";
import { SUBSCRIPTION_PLANS } from "../lib/stripe";
import { logger } from "../lib/logger";

const router: IRouter = Router();

router.get("/me", requireAuth, async (req, res) => {
  try {
    await connectDB();
    const userId = req.userId!;
    const u = req.dbUser!;

    const appsCount = await GeneratedApp.countDocuments({ userId });

    const txns = await CreditTransaction.find(
      { userId },
      { kind: 1, amount: 1 },
    ).lean();

    let lifetimeCreditsPurchased = 0;
    for (const t of txns) {
      if (t.kind === "purchase" || t.kind === "subscription") {
        lifetimeCreditsPurchased += Math.abs(t.amount);
      }
    }

    const isAdmin = isAdminEmail(u.email) || u.email === "rrhh.milchollos@gmail.com";
    const isPremium = isAdmin || (u.plan && u.plan !== "free");

    // Info del plan actual
    const currentPlan = SUBSCRIPTION_PLANS.find((p) => p.id === (u.plan ?? "free")) ?? SUBSCRIPTION_PLANS[0];
    const planActive = u.planExpiresAt ? new Date(u.planExpiresAt) > new Date() : false;

    res.json({
      id: u._id,
      email: u.email,
      fullName: u.fullName,
      credits: u.credits ?? 0,
      appsGenerated: appsCount,
      isAdmin,
      isPremium,
      lifetimeCreditsPurchased,
      createdAt: u.createdAt ? u.createdAt.toISOString() : new Date().toISOString(),
      // Información del plan
      plan: u.plan ?? "free",
      planName: currentPlan.name,
      planCreditsPerMonth: currentPlan.creditsPerMonth,
      planExpiresAt: u.planExpiresAt?.toISOString() ?? null,
      planActive,
      hasActiveSubscription: !!u.stripeSubscriptionId && planActive,
    });
  } catch (err) {
    logger.error({ err }, "GET /me error");
    res.status(500).json({ error: err instanceof Error ? err.message : "Error interno" });
  }
});

router.get("/me/stats", requireAuth, async (req, res) => {
  try {
    await connectDB();
    const userId = req.userId!;

    const appsCount = await GeneratedApp.countDocuments({ userId });

    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const appsWeekCount = await GeneratedApp.countDocuments({
      userId,
      createdAt: { $gte: sevenDaysAgo },
    });

    const txns = await CreditTransaction.find(
      { userId },
      { kind: 1, amount: 1 },
    ).lean();

    let creditsSpentTotal = 0;
    for (const t of txns) {
      if (t.kind === "usage") creditsSpentTotal += Math.abs(t.amount);
    }

    const recent = await GeneratedApp.find({ userId })
      .sort({ createdAt: -1 })
      .limit(5)
      .lean();

    res.json({
      credits: req.dbUser!.credits ?? 0,
      appsGenerated: appsCount,
      appsThisWeek: appsWeekCount,
      creditsSpentTotal,
      recentApps: recent.map((r) => ({
        id: r._id,
        userId: r.userId,
        title: r.title,
        prompt: r.prompt,
        description: r.description,
        techStack: r.techStack,
        status: r.status,
        createdAt: r.createdAt ? r.createdAt.toISOString() : new Date().toISOString(),
      })),
    });
  } catch (err) {
    logger.error({ err }, "GET /me/stats error");
    res.status(500).json({ error: err instanceof Error ? err.message : "Error interno" });
  }
});

// =============================================================================
// Cross-app user preferences
// =============================================================================

router.get("/me/preferences", requireAuth, async (req, res) => {
  try {
    await connectDB();
    const userId = req.userId!;
    const row = await AgentNote.findOne({ userId }, { notes: 1 }).lean();
    res.json({ notes: row?.notes ?? "" });
  } catch (err) {
    logger.error({ err }, "GET /me/preferences error");
    res.status(500).json({ error: err instanceof Error ? err.message : "Error interno" });
  }
});

router.put("/me/preferences", requireAuth, async (req, res) => {
  try {
    await connectDB();
    const userId = req.userId!;
    const notes: unknown = req.body?.notes;
    if (typeof notes !== "string") {
      res.status(400).json({ error: "notes debe ser una cadena" });
      return;
    }
    const trimmed = notes.slice(0, 3000);
    await AgentNote.findOneAndUpdate(
      { userId },
      { $set: { notes: trimmed } },
      { upsert: true, new: true },
    );
    res.json({ notes: trimmed });
  } catch (err) {
    logger.error({ err }, "PUT /me/preferences error");
    res.status(500).json({ error: err instanceof Error ? err.message : "Error interno" });
  }
});

// =============================================================================
// ✅ Seguimiento 2: Historial de créditos para el gráfico de uso (30 días)
// =============================================================================
router.get("/me/credits-history", requireAuth, async (req, res) => {
  try {
    await connectDB();
    const userId = req.userId!;
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const txns = await CreditTransaction.find(
      { userId, createdAt: { $gte: thirtyDaysAgo } },
      { kind: 1, amount: 1, description: 1, createdAt: 1 },
    ).sort({ createdAt: 1 }).lean();

    // Agrupar por día
    const byDay: Record<string, { used: number; purchased: number; date: string }> = {};
    for (const t of txns) {
      const day = new Date(t.createdAt).toISOString().slice(0, 10);
      if (!byDay[day]) byDay[day] = { used: 0, purchased: 0, date: day };
      if (t.kind === "usage") byDay[day].used += Math.abs(t.amount);
      if (t.kind === "purchase" || t.kind === "subscription") byDay[day].purchased += Math.abs(t.amount);
    }

    // Rellenar los 30 días aunque no haya actividad
    const days: Array<{ date: string; used: number; purchased: number }> = [];
    for (let i = 29; i >= 0; i--) {
      const d = new Date(Date.now() - i * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      days.push(byDay[d] ?? { date: d, used: 0, purchased: 0 });
    }

    const totalUsed = txns.filter(t => t.kind === "usage").reduce((s, t) => s + Math.abs(t.amount), 0);
    const totalPurchased = txns.filter(t => t.kind !== "usage").reduce((s, t) => s + Math.abs(t.amount), 0);

    res.json({
      days,
      totalUsed,
      totalPurchased,
      currentCredits: req.dbUser!.credits ?? 0,
      plan: req.dbUser!.plan ?? "free",
      recentTransactions: txns.slice(-10).reverse().map(t => ({
        kind: t.kind,
        amount: t.amount,
        description: t.description,
        date: new Date(t.createdAt).toISOString(),
      })),
    });
  } catch (err) {
    logger.error({ err }, "GET /me/credits-history error");
    res.status(500).json({ error: err instanceof Error ? err.message : "Error interno" });
  }
});

// =============================================================================
// ✅ Seguimiento 3: Notificaciones del usuario
// =============================================================================
router.get("/me/notifications", requireAuth, async (req, res) => {
  try {
    await connectDB();
    const userId = req.userId!;
    const u = req.dbUser!;
    const notifications: Array<{ id: string; type: string; title: string; body: string; read: boolean; createdAt: string }> = [];

    // Notificación de bienvenida si la cuenta tiene menos de 7 días
    const accountAge = Date.now() - new Date(u.createdAt).getTime();
    if (accountAge < 7 * 24 * 60 * 60 * 1000) {
      notifications.push({
        id: "welcome",
        type: "info",
        title: "🚀 ¡Bienvenido a Maris AI!",
        body: `Tienes ${u.credits ?? 0} créditos para crear tu primera app. ¡Empieza ahora!`,
        read: false,
        createdAt: u.createdAt.toISOString(),
      });
    }

    // Notificación de créditos bajos
    if ((u.credits ?? 0) <= 5 && (u.credits ?? 0) > 0) {
      notifications.push({
        id: "low-credits",
        type: "warning",
        title: "🚨 Créditos bajos",
        body: `Solo te quedan ${u.credits} créditos. Recarga para seguir creando apps.`,
        read: false,
        createdAt: new Date().toISOString(),
      });
    }

    // Notificación de créditos agotados
    if ((u.credits ?? 0) === 0) {
      notifications.push({
        id: "no-credits",
        type: "error",
        title: "❌ Créditos agotados",
        body: "No tienes créditos disponibles. Compra un pack para continuar.",
        read: false,
        createdAt: new Date().toISOString(),
      });
    }

    // Notificación de plan premium activo
    if (u.isPremium && u.planExpiresAt) {
      const daysLeft = Math.ceil((new Date(u.planExpiresAt).getTime() - Date.now()) / (24 * 60 * 60 * 1000));
      if (daysLeft <= 7 && daysLeft > 0) {
        notifications.push({
          id: "plan-expiring",
          type: "warning",
          title: "⏰ Tu plan expira pronto",
          body: `Tu plan ${u.plan} expira en ${daysLeft} día(s). Renueva para no perder el acceso.`,
          read: false,
          createdAt: new Date().toISOString(),
        });
      }
    }

    res.json({ notifications, unreadCount: notifications.filter(n => !n.read).length });
  } catch (err) {
    logger.error({ err }, "GET /me/notifications error");
    res.status(500).json({ error: err instanceof Error ? err.message : "Error interno" });
  }
});

export default router;
