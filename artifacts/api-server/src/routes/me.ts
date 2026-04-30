import { Router, type IRouter } from "express";
import { eq, count, gte, desc, and } from "drizzle-orm";
import { db } from "../lib/db";
import { requireAuth, isAdminEmail } from "../lib/auth";
import {
  generatedApps,
  creditTransactions,
  userPreferences,
} from "@workspace/db/schema";

const router: IRouter = Router();

router.get("/me", requireAuth, async (req, res) => {
  const userId = req.userId!;
  const u = req.dbUser!;
  const [appsCount] = await db
    .select({ total: count() })
    .from(generatedApps)
    .where(eq(generatedApps.userId, userId));

  // Lifetime spend → unlocks "Ultra Rápidos" (premium models). Sum of all
  // purchase txns. Stripe stores amounts as positive integers in our table.
  const txns = await db
    .select()
    .from(creditTransactions)
    .where(eq(creditTransactions.userId, userId));
  let lifetimeCreditsPurchased = 0;
  for (const t of txns) {
    if (t.kind === "purchase") lifetimeCreditsPurchased += Math.abs(t.amount);
  }
  // Premium tier kicks in at >= 200 lifetime credits purchased. Admins always
  // count as premium.
  const isAdmin = isAdminEmail(u.email);
  const isPremium = isAdmin || lifetimeCreditsPurchased >= 200;

  res.json({
    id: u.id,
    email: u.email,
    fullName: u.fullName,
    credits: u.credits,
    appsGenerated: appsCount?.total ?? 0,
    isAdmin,
    isPremium,
    lifetimeCreditsPurchased,
    createdAt: u.createdAt.toISOString(),
  });
});

router.get("/me/stats", requireAuth, async (req, res) => {
  const userId = req.userId!;

  const [appsCount] = await db
    .select({ total: count() })
    .from(generatedApps)
    .where(eq(generatedApps.userId, userId));

  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const [appsWeekCount] = await db
    .select({ total: count() })
    .from(generatedApps)
    .where(
      and(
        eq(generatedApps.userId, userId),
        gte(generatedApps.createdAt, sevenDaysAgo),
      ),
    );

  const txns = await db
    .select()
    .from(creditTransactions)
    .where(eq(creditTransactions.userId, userId));

  let creditsSpentTotal = 0;
  for (const t of txns) {
    if (t.kind === "usage") creditsSpentTotal += Math.abs(t.amount);
  }

  const recent = await db
    .select()
    .from(generatedApps)
    .where(eq(generatedApps.userId, userId))
    .orderBy(desc(generatedApps.createdAt))
    .limit(5);

  res.json({
    credits: req.dbUser!.credits,
    appsGenerated: appsCount?.total ?? 0,
    appsThisWeek: appsWeekCount?.total ?? 0,
    creditsSpentTotal,
    recentApps: recent.map((r) => ({
      id: r.id,
      userId: r.userId,
      title: r.title,
      prompt: r.prompt,
      description: r.description,
      techStack: r.techStack,
      frontendCode: r.frontendCode,
      backendCode: r.backendCode,
      status: r.status,
      createdAt: r.createdAt.toISOString(),
    })),
  });
});

// =============================================================================
// Cross-app user preferences (memory layer #3). Same shape as per-app notes
// but applies to ALL of the user's future generations.
// =============================================================================

router.get("/me/preferences", requireAuth, async (req, res) => {
  const userId = req.userId!;
  const [row] = await db
    .select()
    .from(userPreferences)
    .where(eq(userPreferences.userId, userId))
    .limit(1);
  res.json({ notes: row?.notes ?? "" });
});

router.put("/me/preferences", requireAuth, async (req, res) => {
  const userId = req.userId!;
  const notes: unknown = req.body?.notes;
  if (typeof notes !== "string") {
    res.status(400).json({ error: "notes debe ser una cadena" });
    return;
  }
  const trimmed = notes.slice(0, 3000);
  const [existing] = await db
    .select({ userId: userPreferences.userId })
    .from(userPreferences)
    .where(eq(userPreferences.userId, userId))
    .limit(1);
  if (existing) {
    await db
      .update(userPreferences)
      .set({ notes: trimmed, updatedAt: new Date() })
      .where(eq(userPreferences.userId, userId));
  } else {
    await db.insert(userPreferences).values({ userId, notes: trimmed });
  }
  res.json({ notes: trimmed });
});

export default router;
