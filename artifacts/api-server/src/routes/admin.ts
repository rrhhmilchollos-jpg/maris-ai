import { Router, type IRouter } from "express";
import { connectDB } from "../lib/db";
import { requireAuth, requireAdmin, isAdminEmail } from "../lib/auth";
import {
  User,
  GeneratedApp,
  GenerationJob,
  CreditTransaction,
  AgentMemory,
} from "@workspace/db/schema";
import { reenqueueGenerateJob, isQueueReady } from "../lib/jobQueue";
import { refundCredits } from "../lib/credits";
import { bulkCreateProjectSeeds } from "../lib/projectSeeds";
import { IProjectSeed } from "@workspace/db/schema";
import { logger } from "../lib/logger";
import { getMetricsSnapshot } from "../lib/metrics";
import { isE2BEnabled, e2bSmokeTest } from "../lib/e2bValidator";
import { getE2BGateEnabled, setE2BGateEnabled } from "../lib/e2bGate";
import { pingRedis, getRedisStatus } from "../lib/redisHealth";

const router: IRouter = Router();

router.use("/admin", requireAuth, requireAdmin);

router.get("/admin/overview", async (_req, res) => {
  await connectDB();
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const [totalUsers, totalApps, appsWeek, allUsers] = await Promise.all([
    User.countDocuments(),
    GeneratedApp.countDocuments(),
    GeneratedApp.countDocuments({ createdAt: { $gte: sevenDaysAgo } }),
    User.find({}, { credits: 1, email: 1 }).lean(),
  ]);

  const nonAdminUsers = allUsers.filter(u => !isAdminEmail(u.email));
  const creditsOutstanding = nonAdminUsers.reduce((sum, u) => sum + (u.credits ?? 0), 0);

  const txns = await CreditTransaction.find({}, { kind: 1, amount: 1 }).lean();
  let creditsSpentTotal = 0;
  let creditsPurchasedTotal = 0;
  for (const t of txns) {
    if (t.kind === "usage") creditsSpentTotal += Math.abs(t.amount);
    if (t.kind === "purchase") creditsPurchasedTotal += t.amount;
  }

  res.json({
    totalUsers,
    totalApps,
    appsLast7Days: appsWeek,
    creditsOutstanding,
    creditsSpentTotal,
    creditsPurchasedTotal,
    revenueCentsTotal: 0,
  });
});

router.get("/admin/users", async (_req, res) => {
  await connectDB();
  const users = await User.find({}).sort({ createdAt: -1 }).lean();
  const appCounts = await GeneratedApp.aggregate([
    { $group: { _id: "$userId", count: { $sum: 1 } } },
  ]);
  const countMap = new Map(appCounts.map((a) => [a._id, a.count]));

  res.json(
    users.map((u) => ({
      id: u._id,
      email: u.email,
      fullName: u.fullName,
      imageUrl: u.imageUrl,
      credits: u.credits,
      appsGenerated: countMap.get(String(u._id)) ?? 0,
      isAdmin: isAdminEmail(u.email),
      createdAt: u.createdAt.toISOString(),
    })),
  );
});

router.post("/admin/users/:id/credits", async (req: any, res: any): Promise<void> => {
  await connectDB();
  const targetId = req.params.id;
  const body = req.body as { delta?: number; reason?: string };
  const delta = Number.isInteger(body?.delta) ? Number(body.delta) : 0;
  if (!delta) {
    res.status(400).json({ error: "El campo delta es obligatorio y distinto de cero" });
    return;
  }

  const user = await User.findById(targetId).lean();
  if (!user) {
    res.status(404).json({ error: "Usuario no encontrado" });
    return;
  }

  const newBalance = Math.max(0, user.credits + delta);
  const actualDelta = newBalance - user.credits;

  if (actualDelta !== 0) {
    await User.findByIdAndUpdate(targetId, { $set: { credits: newBalance } });
    await CreditTransaction.create({
      userId: targetId,
      amount: actualDelta,
      kind: actualDelta > 0 ? "bonus" : "usage",
      description: body.reason?.trim() || "Ajuste manual del administrador",
    });
  }

  const appsGenerated = await GeneratedApp.countDocuments({ userId: targetId });

  res.json({
    id: user._id,
    email: user.email,
    fullName: user.fullName,
    imageUrl: user.imageUrl,
    credits: newBalance,
    appsGenerated,
    isAdmin: isAdminEmail(user.email),
    createdAt: new Date(user.createdAt).toISOString(),
  });
});

router.post("/admin/users/:id/refund", async (req: any, res: any): Promise<void> => {
  await connectDB();
  const targetId = req.params.id;
  const { amount, reason } = req.body;

  if (!amount || amount <= 0) {
    res.status(400).json({ error: "Cantidad de reembolso inválida" });
    return;
  }

  try {
    const result = await refundCredits(targetId, amount, reason || "Reembolso administrativo");
    res.json({ ok: true, newBalance: result.credits });
  } catch (err) {
    logger.error({ err, userId: targetId }, "Error processing refund");
    res.status(500).json({ error: "Error al procesar el reembolso" });
  }
});

router.get("/admin/apps", async (_req, res) => {
  await connectDB();
  const apps = await GeneratedApp.find({})
    .sort({ createdAt: -1 })
    .limit(200)
    .lean();

  const userIds = [...new Set(apps.map((a) => a.userId))];
  const users = await User.find({ _id: { $in: userIds } }, { email: 1 }).lean();
  const emailMap = new Map(users.map((u) => [String(u._id), u.email]));

  res.json(
    apps.map((r) => ({
      id: r._id,
      userId: r.userId,
      userEmail: emailMap.get(r.userId) ?? null,
      title: r.title,
      description: r.description,
      techStack: Array.isArray(r.techStack) ? r.techStack : [],
      status: r.status,
      createdAt: r.createdAt.toISOString(),
    })),
  );
});

router.get("/admin/jobs", async (_req, res) => {
  await connectDB();
  const sinceDate = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const [jobs, queued, running, failed24, succ24] = await Promise.all([
    GenerationJob.find({}).sort({ createdAt: -1 }).limit(100).lean(),
    GenerationJob.countDocuments({ status: "queued" }),
    GenerationJob.countDocuments({ status: "running" }),
    GenerationJob.countDocuments({ status: "failed", updatedAt: { $gte: sinceDate } }),
    GenerationJob.countDocuments({ status: "succeeded", updatedAt: { $gte: sinceDate } }),
  ]);

  const userIds = [...new Set(jobs.map((j) => j.userId))];
  const users = await User.find({ _id: { $in: userIds } }, { email: 1 }).lean();
  const emailMap = new Map(users.map((u) => [String(u._id), u.email]));

  const now = Date.now();
  res.json({
    queued,
    running,
    failedLast24h: failed24,
    succeededLast24h: succ24,
    jobs: jobs.map((r) => ({
      id: r._id,
      userId: r.userId,
      userEmail: emailMap.get(r.userId) ?? null,
      appId: r.appId,
      editAppId: r.editAppId,
      prompt: r.prompt,
      status: r.status,
      phase: r.phase,
      progress: r.progress,
      coderModel: r.coderModel,
      language: r.language,
      retryCount: r.retryCount ?? 0,
      errorMessage: r.errorMessage,
      ageMs: now - new Date(r.updatedAt).getTime(),
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    })),
  });
});

router.post("/admin/jobs/:id/retry", async (req: any, res: any): Promise<void> => {
  // ... existing job retry route ...
});

router.post("/admin/project-seeds/bulk", requireAdmin, async (req: any, res: any): Promise<void> => {
  const seeds: Partial<IProjectSeed>[] = req.body;
  if (!Array.isArray(seeds)) {
    return res.status(400).json({ message: "Request body must be an array of project seeds." });
  }
  try {
    const createdSeeds = await bulkCreateProjectSeeds(seeds);
    res.status(201).json({ message: `Successfully created ${createdSeeds.length} project seeds.`, count: createdSeeds.length });
  } catch (err) {
    logger.error({ err }, "Error bulk creating project seeds");
    res.status(500).json({ message: "Error bulk creating project seeds" });
  }
});

router.post("/admin/jobs/:id/retry", async (req: any, res: any): Promise<void> => {
  await connectDB();
  const id = req.params.id;

  const job = await GenerationJob.findById(id).lean();
  if (!job) {
    res.status(404).json({ error: "Job no encontrado" });
    return;
  }

  const ageMs = Date.now() - new Date(job.updatedAt).getTime();
  const STALE_MS = 15 * 60 * 1000;
  const retryable =
    job.status === "failed" ||
    (job.status === "running" && ageMs > STALE_MS) ||
    (job.status === "queued" && ageMs > STALE_MS);

  if (!retryable) {
    res.status(409).json({ error: `Job en estado '${job.status}' no es reintentable ahora.` });
    return;
  }

  const updated = await GenerationJob.findByIdAndUpdate(
    id,
    {
      $set: {
        status: "queued",
        phase: "queued",
        progress: 0,
        errorMessage: null,
        retryCount: (job.retryCount ?? 0) + 1,
        updatedAt: new Date(),
      },
    },
    { new: true },
  ).lean();

  if (!updated) {
    res.status(409).json({ error: "El job cambió de estado mientras se procesaba." });
    return;
  }

  try {
    await reenqueueGenerateJob(String(id));
  } catch (err) {
    logger.error({ err, jobId: id }, "Manual retry: failed to re-enqueue — rolling back");
    await GenerationJob.findByIdAndUpdate(id, {
      $set: {
        status: job.status,
        phase: job.phase,
        progress: job.progress,
        errorMessage: job.errorMessage,
        retryCount: job.retryCount,
        updatedAt: job.updatedAt,
      },
    }).catch(() => {});
    res.status(500).json({ error: "No se pudo re-encolar el job." });
    return;
  }

  const user = await User.findById(updated.userId, { email: 1 }).lean();
  const ageMsAfter = Date.now() - new Date(updated.updatedAt).getTime();

  res.json({
    id: updated._id,
    userId: updated.userId,
    userEmail: user?.email ?? null,
    appId: updated.appId,
    editAppId: updated.editAppId,
    prompt: updated.prompt,
    status: updated.status,
    phase: updated.phase,
    progress: updated.progress,
    coderModel: updated.coderModel,
    language: updated.language,
    retryCount: updated.retryCount ?? 0,
    errorMessage: updated.errorMessage,
    ageMs: ageMsAfter,
    createdAt: updated.createdAt.toISOString(),
    updatedAt: updated.updatedAt.toISOString(),
  });
});

router.get("/admin/memory", async (req: any, res: any): Promise<void> => {
  await connectDB();
  const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50));
  const offset = Math.max(0, Number(req.query.offset) || 0);
  const q = (typeof req.query.q === "string" ? req.query.q : "").trim();

  const filter = q
    ? {
        $or: [
          { errorMessage: { $regex: q, $options: "i" } },
          { patch: { $regex: q, $options: "i" } },
        ],
      }
    : {};

  const [rows, total] = await Promise.all([
    AgentMemory.find(filter)
      .sort({ updatedAt: -1 })
      .skip(offset)
      .limit(limit)
      .lean(),
    AgentMemory.countDocuments(filter),
  ]);

  res.json({
    total,
    limit,
    offset,
    q,
    entries: rows.map((r) => ({
      id: r._id,
      errorMessage: r.errorMessage,
      errorContext: r.errorContext,
      patchPreview: r.patch.slice(0, 600),
      patchLength: r.patch.length,
      language: r.language,
      successCount: 1,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    })),
  });
});

router.delete("/admin/memory/:id", async (req: any, res: any): Promise<void> => {
  await connectDB();
  const deleted = await AgentMemory.findByIdAndDelete(req.params.id);
  if (!deleted) {
    res.status(404).json({ message: "no encontrado" });
    return;
  }
  res.json({ ok: true, id: req.params.id });
});

router.get("/admin/metrics", async (_req, res) => {
  await connectDB();
  const now = new Date();
  const day = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  const [jobs24h, failingPhases, creditsToday, creditsMonth, topUsers,
    publishedTotal, publishedToday, queueByStatusRaw] = await Promise.all([
    GenerationJob.aggregate([
      { $match: { createdAt: { $gte: day } } },
      { $group: {
        _id: "$status",
        total: { $sum: 1 },
        avgMs: { $avg: { $subtract: ["$updatedAt", "$createdAt"] } },
      }},
    ]),
    GenerationJob.aggregate([
      { $match: { status: "failed", createdAt: { $gte: day } } },
      { $group: { _id: "$phase", total: { $sum: 1 } } },
      { $sort: { total: -1 } },
      { $limit: 3 },
    ]),
    CreditTransaction.aggregate([
      { $match: { kind: "usage", createdAt: { $gte: todayStart } } },
      { $group: { _id: null, total: { $sum: { $abs: "$amount" } } } },
    ]),
    CreditTransaction.aggregate([
      { $match: { kind: "usage", createdAt: { $gte: monthStart } } },
      { $group: { _id: null, total: { $sum: { $abs: "$amount" } } } },
    ]),
    CreditTransaction.aggregate([
      { $match: { kind: "usage" } },
      { $group: { _id: "$userId", total: { $sum: { $abs: "$amount" } } } },
      { $sort: { total: -1 } },
      { $limit: 5 },
    ]),
    GeneratedApp.countDocuments({ publicSlug: { $exists: true, $ne: null } }),
    GeneratedApp.countDocuments({ publicSlug: { $exists: true, $ne: null }, createdAt: { $gte: todayStart } }),
    GenerationJob.aggregate([
      { $match: { createdAt: { $gte: day } } },
      { $group: { _id: "$status", total: { $sum: 1 } } },
    ]),
  ]);

  let jobsTotal = 0, jobsSuccess = 0, jobsFailed = 0;
  let avgDurationMsAccum = 0, avgDurationCount = 0;
  for (const row of jobs24h) {
    jobsTotal += row.total;
    if (row._id === "succeeded") jobsSuccess += row.total;
    if (row._id === "failed") jobsFailed += row.total;
    if (row.avgMs && (row._id === "succeeded" || row._id === "failed")) {
      avgDurationMsAccum += row.avgMs * row.total;
      avgDurationCount += row.total;
    }
  }

  const userIds = topUsers.map((u: { _id: string }) => u._id);
  const userDocs = await User.find({ _id: { $in: userIds } }, { email: 1 }).lean();
  const emailMap = new Map(userDocs.map((u) => [String(u._id), u.email]));

  const queueByStatus: Record<string, number> = {};
  for (const row of queueByStatusRaw) {
    queueByStatus[row._id] = row.total;
  }

  res.json({
    generatedAt: now.toISOString(),
    jobs24h: {
      total: jobsTotal,
      succeeded: jobsSuccess,
      failed: jobsFailed,
      successRate: jobsTotal > 0 ? Math.round((jobsSuccess / jobsTotal) * 100) : null,
      avgDurationMs: avgDurationCount > 0 ? Math.round(avgDurationMsAccum / avgDurationCount) : 0,
    },
    topFailingPhases: failingPhases.map((p: { _id: string; total: number }) => ({
      phase: p._id,
      count: p.total,
    })),
    credits: {
      today: creditsToday[0]?.total ?? 0,
      month: creditsMonth[0]?.total ?? 0,
    },
    topUsers: topUsers.map((u: { _id: string; total: number }) => ({
      userId: u._id,
      email: emailMap.get(u._id) ?? "(usuario eliminado)",
      creditsUsed: u.total,
    })),
    publishedApps: { today: publishedToday, total: publishedTotal },
    server: getMetricsSnapshot(),
    queue: { ready: isQueueReady(), jobs24hByStatus: queueByStatus },
    redis: getRedisStatus(),
    e2b: {
      configured: isE2BEnabled(),
      validateOnGenerate: getE2BGateEnabled(),
      effective: isE2BEnabled() && getE2BGateEnabled(),
    },
  });
});

router.post("/admin/redis-ping", async (_req, res) => {
  const result = await pingRedis();
  res.json(result);
});

router.post("/admin/e2b-smoke", async (_req, res) => {
  const result = await e2bSmokeTest();
  res.json(result);
});

router.post("/admin/e2b-toggle", (req, res) => {
  const enabled = Boolean(req.body?.enabled);
  const next = setE2BGateEnabled(enabled);
  req.log?.info({ enabled: next }, "E2B validateOnGenerate toggled");
  res.json({
    validateOnGenerate: next,
    configured: isE2BEnabled(),
    effective: isE2BEnabled() && next,
  });
});

export default router;
