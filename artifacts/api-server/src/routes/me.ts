import { Router, type IRouter } from "express";
import { connectDB } from "../lib/db";
import { requireAuth, isAdminEmail } from "../lib/auth";
import {
  GeneratedApp,
  CreditTransaction,
  AgentNote,
} from "@workspace/db/schema";
 
const router: IRouter = Router();
 
router.get("/me", requireAuth, async (req, res) => {
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
    if (t.kind === "purchase") lifetimeCreditsPurchased += Math.abs(t.amount);
  }
 
  const isAdmin = isAdminEmail(u.email);
  const isPremium = isAdmin || lifetimeCreditsPurchased >= 200;
 
  res.json({
    id: u._id,
    email: u.email,
    fullName: u.fullName,
    credits: u.credits,
    appsGenerated: appsCount,
    isAdmin,
    isPremium,
    lifetimeCreditsPurchased,
    createdAt: u.createdAt.toISOString(),
  });
});
 
router.get("/me/stats", requireAuth, async (req, res) => {
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
    credits: req.dbUser!.credits,
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
      frontendCode: r.frontendCode,
      backendCode: r.backendCode,
      status: r.status,
      createdAt: r.createdAt.toISOString(),
    })),
  });
});
 
// =============================================================================
// Cross-app user preferences (memory layer #3).
// Usamos AgentNote con userId único como sustituto de userPreferences.
// =============================================================================
 
router.get("/me/preferences", requireAuth, async (req, res) => {
  await connectDB();
  const userId = req.userId!;
  const row = await AgentNote.findOne({ userId }, { notes: 1 }).lean();
  res.json({ notes: row?.notes ?? "" });
});
 
router.put("/me/preferences", requireAuth, async (req, res) => {
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
});
 
export default router;
 
