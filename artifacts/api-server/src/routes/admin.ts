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
      registrationIp: u.registrationIp,
      isSuspended: u.isSuspended ?? false,
      suspendedAt: u.suspendedAt?.toISOString(),
      suspendReason: u.suspendReason,
      isBanned: u.isBanned ?? false,
      bannedAt: u.bannedAt?.toISOString(),
      banReason: u.banReason,
      blockedIps: u.blockedIps ?? [],
    })),
  );
});

// ─── Suspend / Unsuspend user ─────────────────────────────────────────────────
router.post("/admin/users/:id/suspend", async (req: any, res: any): Promise<void> => {
  await connectDB();
  const { reason } = req.body;
  const user = await User.findByIdAndUpdate(
    req.params.id,
    { isSuspended: true, suspendedAt: new Date(), suspendReason: reason || "Suspendido por el administrador" },
    { new: true }
  ).lean();
  if (!user) { res.status(404).json({ error: "Usuario no encontrado" }); return; }
  res.json({ ok: true, isSuspended: true });
});

router.post("/admin/users/:id/unsuspend", async (req: any, res: any): Promise<void> => {
  await connectDB();
  const user = await User.findByIdAndUpdate(
    req.params.id,
    { isSuspended: false, $unset: { suspendedAt: 1, suspendReason: 1 } },
    { new: true }
  ).lean();
  if (!user) { res.status(404).json({ error: "Usuario no encontrado" }); return; }
  res.json({ ok: true, isSuspended: false });
});

// ─── Ban / Unban user ─────────────────────────────────────────────────────────
router.post("/admin/users/:id/ban", async (req: any, res: any): Promise<void> => {
  await connectDB();
  const { reason } = req.body;
  const user = await User.findByIdAndUpdate(
    req.params.id,
    { isBanned: true, bannedAt: new Date(), banReason: reason || "Baneado por el administrador", isSuspended: true },
    { new: true }
  ).lean();
  if (!user) { res.status(404).json({ error: "Usuario no encontrado" }); return; }
  res.json({ ok: true, isBanned: true });
});

router.post("/admin/users/:id/unban", async (req: any, res: any): Promise<void> => {
  await connectDB();
  const user = await User.findByIdAndUpdate(
    req.params.id,
    { isBanned: false, isSuspended: false, $unset: { bannedAt: 1, banReason: 1 } },
    { new: true }
  ).lean();
  if (!user) { res.status(404).json({ error: "Usuario no encontrado" }); return; }
  res.json({ ok: true, isBanned: false });
});

// ─── Block / Unblock IP ───────────────────────────────────────────────────────
router.post("/admin/users/:id/block-ip", async (req: any, res: any): Promise<void> => {
  await connectDB();
  const { ip } = req.body;
  if (!ip) { res.status(400).json({ error: "IP requerida" }); return; }
  const user = await User.findByIdAndUpdate(
    req.params.id,
    { $addToSet: { blockedIps: ip } },
    { new: true }
  ).lean();
  if (!user) { res.status(404).json({ error: "Usuario no encontrado" }); return; }
  res.json({ ok: true, blockedIps: user.blockedIps });
});

router.delete("/admin/users/:id/block-ip/:ip", async (req: any, res: any): Promise<void> => {
  await connectDB();
  const user = await User.findByIdAndUpdate(
    req.params.id,
    { $pull: { blockedIps: req.params.ip } },
    { new: true }
  ).lean();
  if (!user) { res.status(404).json({ error: "Usuario no encontrado" }); return; }
  res.json({ ok: true, blockedIps: user.blockedIps });
});

// ─── Get user credit transactions ─────────────────────────────────────────────
router.get("/admin/users/:id/transactions", async (req: any, res: any): Promise<void> => {
  await connectDB();
  const txns = await CreditTransaction.find({ userId: req.params.id }).sort({ createdAt: -1 }).limit(50).lean();
  res.json(txns.map(t => ({
    id: t._id,
    kind: t.kind,
    amount: t.amount,
    description: t.description,
    createdAt: t.createdAt.toISOString(),
  })));
});

// ─── Get user apps ────────────────────────────────────────────────────────────
router.get("/admin/users/:id/apps", async (req: any, res: any): Promise<void> => {
  await connectDB();
  const apps = await GeneratedApp.find({ userId: req.params.id }).sort({ createdAt: -1 }).lean();
  res.json(apps.map(a => ({
    id: a._id,
    title: a.title,
    status: a.status,
    techStack: a.techStack,
    createdAt: a.createdAt.toISOString(),
  })));
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

// ─── Email de compensación al cliente ────────────────────────────────────────
router.post("/admin/users/:id/send-compensation-email", async (req: any, res: any): Promise<void> => {
  await connectDB();
  const targetId = req.params.id;
  const { subject, message, creditsAdded } = req.body;

  const user = await User.findById(targetId).lean();
  if (!user) {
    res.status(404).json({ error: "Usuario no encontrado" });
    return;
  }

  const recipientEmail = user.email;
  const recipientName = (user as any).fullName || recipientEmail?.split('@')[0] || 'Usuario';
  const firstName = recipientName.split(' ')[0];

  const emailSubject = subject || `Compensación por el inconveniente — Maris AI`;
  const emailMessage = message || 'Hemos detectado un error en tu generación reciente y lo hemos solucionado. Sentimos las molestias causadas.';

  const htmlBody = `
    <!DOCTYPE html>
    <html>
    <head><meta charset="utf-8"></head>
    <body style="margin:0;padding:0;background:#0a0a0f;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
      <div style="max-width:600px;margin:0 auto;padding:40px 24px;">
        <div style="text-align:center;margin-bottom:32px;">
          <div style="display:inline-block;background:linear-gradient(135deg,#7c3aed,#6366f1);border-radius:16px;padding:12px 24px;">
            <span style="color:#fff;font-size:20px;font-weight:900;letter-spacing:-0.5px;">Maris AI</span>
          </div>
        </div>
        <div style="background:#16161e;border:1px solid rgba(255,255,255,0.1);border-radius:16px;padding:32px;">
          <p style="color:#fff;font-size:16px;margin:0 0 16px;">Hola ${firstName},</p>
          <p style="color:rgba(255,255,255,0.7);font-size:15px;line-height:1.7;margin:0 0 24px;">${emailMessage}</p>
          ${creditsAdded ? `
          <div style="background:linear-gradient(135deg,rgba(124,58,237,0.2),rgba(99,102,241,0.1));border:1px solid rgba(124,58,237,0.4);border-radius:12px;padding:24px;text-align:center;margin-bottom:24px;">
            <p style="color:rgba(255,255,255,0.5);font-size:13px;margin:0 0 8px;">Como compensación, hemos añadido a tu cuenta:</p>
            <p style="color:#7c3aed;font-size:40px;font-weight:900;margin:0;">+${creditsAdded}</p>
            <p style="color:rgba(255,255,255,0.4);font-size:12px;margin:8px 0 0;">créditos ya disponibles en tu cuenta</p>
          </div>
          ` : ''}
          <div style="text-align:center;">
            <a href="https://www.marisai.es/dashboard" style="display:inline-block;background:#7c3aed;color:#fff;text-decoration:none;padding:14px 32px;border-radius:10px;font-weight:700;font-size:14px;">Ir a mi panel &rarr;</a>
          </div>
        </div>
        <p style="color:rgba(255,255,255,0.3);font-size:12px;text-align:center;margin-top:24px;">El equipo de Maris AI — <a href="mailto:soporte@marisai.es" style="color:#7c3aed;">soporte@marisai.es</a></p>
      </div>
    </body>
    </html>
  `;

  // Try to send via Resend if API key is configured
  const resendApiKey = process.env.RESEND_API_KEY;
  let emailSent = false;
  let emailError: string | null = null;

  if (resendApiKey) {
    try {
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${resendApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: 'Maris AI <soporte@marisai.es>',
          to: [recipientEmail],
          subject: emailSubject,
          html: htmlBody,
        }),
      });
      if (response.ok) {
        emailSent = true;
        logger.info({ to: recipientEmail, subject: emailSubject }, 'Compensation email sent via Resend');
      } else {
        const errBody = await response.text();
        emailError = `Resend error ${response.status}: ${errBody}`;
        logger.warn({ emailError }, 'Failed to send via Resend');
      }
    } catch (err: any) {
      emailError = err.message;
      logger.warn({ err }, 'Exception sending via Resend');
    }
  } else {
    emailError = 'RESEND_API_KEY not configured';
    logger.info({ to: recipientEmail, subject: emailSubject, message: emailMessage }, '📬 email_pending — compensation email logged (no provider)');
  }

  res.json({
    ok: true,
    emailSent,
    emailError,
    recipient: recipientEmail,
    note: emailSent
      ? 'Email enviado correctamente'
      : `Email no enviado: ${emailError}. Contenido registrado en logs.`,
  });
});

export default router;
