import { Router, type IRouter } from "express";
import { connectDB } from "../lib/db";
import { requireAuth, requireAdmin, isAdminEmail } from "../lib/auth";
import { adminRateLimiter } from "../middlewares/rateLimit";
import {
  User,
  GeneratedApp,
  GenerationJob,
  CreditTransaction,
  AgentMemory,
  JobLog,
  UserNotification,
  AppMessage,
} from "@workspace/db/schema";
import { reenqueueGenerateJob, enqueueGenerateJob, isQueueReady } from "../lib/jobQueue";
import { refundCredits } from "../lib/credits";
import { bulkCreateProjectSeeds } from "../lib/projectSeeds";
import { seedSeguxatProject } from "../scripts/seedSeguxatProject";
import { IProjectSeed } from "@workspace/db/schema";
import { logger } from "../lib/logger";
import { getMetricsSnapshot } from "../lib/metrics";
import { isE2BEnabled, e2bSmokeTest } from "../lib/e2bValidator";
import { getE2BGateEnabled, setE2BGateEnabled } from "../lib/e2bGate";
import { pingRedis, getRedisStatus } from "../lib/redisHealth";
import mongoose from "mongoose";
import { makeSlug } from "../lib/deployBundle";
import { MarisId, generateAppId } from "../lib/universalId";

const router: IRouter = Router();

// ─── Preview público — ANTES del middleware de auth ───────────────────────────
// Esta ruta no requiere autenticación para poder abrirla directamente en el navegador
router.get("/admin/apps/:id/preview", async (req: any, res: any): Promise<void> => {
  await connectDB();
  const app = await GeneratedApp.findById(req.params.id).select("frontendCode title").lean() as any;
  if (!app?.frontendCode) { res.status(404).send("App no encontrada o sin código generado"); return; }

  res.setHeader("Content-Security-Policy", "frame-ancestors *");
  res.setHeader("X-Frame-Options", "ALLOWALL");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Content-Type", "text/html; charset=utf-8");

  const files: Record<string, string> = {};
  const parts = (app.frontendCode as string).split(/\/\/ === FILE: /);
  for (const part of parts) {
    if (!part.trim()) continue;
    const nl = part.indexOf("\n");
    if (nl === -1) continue;
    const p = part.slice(0, nl).trim().replace(/ ===$/, "");
    if (p) files[p] = part.slice(nl + 1);
  }

  const rawHtml = files["index.html"] || files["public/index.html"];
  if (rawHtml && (rawHtml.includes("<html") || rawHtml.includes("<!DOCTYPE"))) {
    res.send(rawHtml); return;
  }

  try {
    const { buildDeployHtml } = await import("../lib/deployBundle");
    const html = await buildDeployHtml({ bundle: app.frontendCode, title: app.title || "Preview" });
    res.send(html); return;
  } catch (err) {
    logger.warn({ err, appId: req.params.id }, "deployBundle failed for preview");
  }

  // Fallback: lista de archivos generados
  const cssContent = files["src/index.css"] || files["src/App.css"] || "";
  res.send(`<!DOCTYPE html><html lang="es"><head>
    <meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
    <title>${(app.title || "Preview").replace(/[<>]/g, "")}</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <style>${cssContent}</style>
  </head><body style="background:#0a0a0f;color:white;font-family:system-ui;padding:32px">
    <h1 style="color:#7c3aed;font-size:24px;margin-bottom:8px">📦 ${(app.title || "App").replace(/[<>]/g, "")}</h1>
    <p style="color:#9ca3af;margin-bottom:20px">${Math.round(app.frontendCode.length / 1024)} KB generados — ${Object.keys(files).length} archivos</p>
    <div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:24px">
      ${Object.keys(files).map(f => `<span style="background:#1a1a2e;color:#7c3aed;padding:2px 8px;border-radius:4px;font-size:11px;font-family:monospace">${f}</span>`).join("")}
    </div>
    <p style="color:#6b7280;font-size:12px">Para ver la app completa, despliégala desde el panel.</p>
  </body></html>`);
});


router.use("/admin", requireAuth, requireAdmin, adminRateLimiter);

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
      id: String(u._id),
      email: u.email,
      fullName: u.fullName,
      imageUrl: u.imageUrl,
      credits: u.credits,
      appsGenerated: countMap.get(String(u._id)) ?? 0,
      isAdmin: isAdminEmail(u.email),
      createdAt: u.createdAt.toISOString(),
      registrationIp: u.registrationIp,
      lastLoginIp: (u as any).lastLoginIp ?? null,
      lastLoginAt: (u as any).lastLoginAt?.toISOString() ?? null,
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

// ─── Admin: logs de cualquier job ────────────────────────────────────────────
// GET /api/admin/jobs/:id/logs
router.get("/admin/jobs/:id/logs", async (req: any, res: any): Promise<void> => {
  await connectDB();
  const limit = Math.min(200, Number(req.query.limit) || 100);
  const logs = await JobLog.find({ jobId: req.params.id })
    .sort({ _id: -1 })
    .limit(limit)
    .lean();
  res.json({
    logs: logs.map((l: any) => ({
      id: String(l._id),
      jobId: l.jobId,
      agent: l.agent,
      level: l.level,
      message: l.message,
      createdAt: l.createdAt,
    })),
  });
});

// ─── Search user by email ─────────────────────────────────────────────────────
// GET /api/admin/users/search?email=xxx
router.get("/admin/users/search", async (req: any, res: any): Promise<void> => {
  await connectDB();
  const email = (req.query.email as string || "").trim().toLowerCase();
  if (!email) { res.status(400).json({ error: "Email requerido" }); return; }
  // Búsqueda exacta por email con timeout de 5s
  const user = await User.findOne({ email }).maxTimeMS(5000).lean() as any;
  if (!user) { res.status(404).json({ error: "Usuario no encontrado" }); return; }
  const userId = String(user._id);
  res.json({ id: userId, email: user.email, plan: user.plan, credits: user.credits });
});

// ─── Ban / Unban user ─────────────────────────────────────────────────────────

// DELETE /api/admin/users/:id — eliminar usuario y todos sus datos
router.delete("/admin/users/:id", async (req: any, res: any): Promise<void> => {
  await connectDB();
  const { id } = req.params;

  try {
    const user = await User.findById(id).lean() as any;
    if (!user) { res.status(404).json({ error: "Usuario no encontrado" }); return; }

    if (isAdminEmail(user.email)) {
      res.status(403).json({ error: "No se puede eliminar una cuenta de administrador" });
      return;
    }

    // Eliminar en orden: jobs → apps → transacciones → usuario
    const jobs = await GenerationJob.find({ userId: id }).select("appId").lean();
    const appIds = [...new Set(jobs.map((j: any) => j.appId).filter(Boolean))];

    await GenerationJob.deleteMany({ userId: id });
    if (appIds.length > 0) await GeneratedApp.deleteMany({ _id: { $in: appIds } });
    await CreditTransaction.deleteMany({ userId: id });
    await User.findByIdAndDelete(id);

    logger.info({ userId: id, email: user.email, appsDeleted: appIds.length }, "Admin: usuario eliminado permanentemente");
    res.json({ ok: true, email: user.email, appsDeleted: appIds.length, jobsDeleted: jobs.length });
  } catch (err) {
    logger.error({ err, userId: id }, "Admin: error eliminando usuario");
    res.status(500).json({ error: String(err) });
  }
});

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
    id: String(t._id),
    kind: t.kind,
    amount: t.amount,
    description: t.description,
    stripeSessionId: t.stripeSessionId ?? null,
    createdAt: t.createdAt.toISOString(),
  })));
});

// ─── Get user apps ────────────────────────────────────────────────────────────
router.get("/admin/users/:id/apps", async (req: any, res: any): Promise<void> => {
  try {
  await connectDB();
  const limit = Math.min(Number(req.query.limit) || 20, 50);
  const id = req.params.id;
  const emailHint = (req.query.email as string || "").trim().toLowerCase();

  // Buscar apps directamente por userId (Clerk ID = User._id)
  let apps = await GeneratedApp.find({ userId: id }).sort({ createdAt: -1 }).limit(limit).maxTimeMS(8000).lean();

  // Fallback 1: buscar por email del usuario si se proporcionó
  if (apps.length === 0 && emailHint) {
    const userByEmail = await User.findOne({ email: emailHint }).select("_id").lean() as any;
    if (userByEmail) {
      apps = await GeneratedApp.find({ userId: String(userByEmail._id) }).sort({ createdAt: -1 }).limit(limit).maxTimeMS(8000).lean();
    }
  }

  // Fallback 2: buscar via jobs del usuario → appIds
  if (apps.length === 0) {
    const jobAppIds = await GenerationJob
      .find({ userId: id, appId: { $exists: true, $ne: null } })
      .sort({ createdAt: -1 }).limit(50).select("appId").maxTimeMS(8000).lean();
    const appIds = [...new Set(jobAppIds.map((j: any) => String(j.appId)).filter(Boolean))];
    if (appIds.length > 0) {
      apps = await GeneratedApp.find({ _id: { $in: appIds } }).sort({ createdAt: -1 }).limit(limit).maxTimeMS(8000).lean();
    }
  }

  res.json({
    apps: apps.map((a: any) => ({
      id: String(a._id),
      _id: String(a._id),
      title: a.title,
      prompt: a.prompt,
      status: a.status,
      techStack: a.techStack,
      frontendCode: a.frontendCode,
      createdAt: a.createdAt?.toISOString?.() ?? "",
    }))
  });
  } catch (err: any) {
    logger.error({ err: err?.message, userId: req.params.id }, "admin/users/:id/apps error");
    res.status(500).json({ error: err?.message || "Error interno" });
  }
});


// POST /api/admin/users/:id/set-paid — marcar usuario como paid/free
router.post("/admin/users/:id/set-paid", async (req: any, res: any): Promise<void> => {
  await connectDB();
  const { hasEverPaid = true, isPremium = true, plan = "paid" } = req.body ?? {};
  const user = await User.findByIdAndUpdate(
    req.params.id,
    { $set: { hasEverPaid, isPremium, plan } },
    { new: true }
  ).lean() as any;
  if (!user) { res.status(404).json({ error: "Usuario no encontrado" }); return; }
  logger.info({ userId: req.params.id, hasEverPaid, isPremium }, "Admin: usuario marcado como paid");
  res.json({ ok: true, userId: req.params.id, hasEverPaid, isPremium, plan });
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
    id: String(user._id),
    email: user.email,
    fullName: user.fullName,
    imageUrl: user.imageUrl,
    credits: newBalance,
    appsGenerated,
    isAdmin: isAdminEmail(user.email),
    createdAt: new Date(user.createdAt).toISOString(),
  });
});

// ─── Stripe card refund (real money back to card) ───────────────────────────
router.post("/admin/users/:id/stripe-refund", async (req: any, res: any): Promise<void> => {
  await connectDB();
  const targetId = req.params.id;
  const { stripeSessionId, amountCents, reason } = req.body;

  if (!stripeSessionId) {
    res.status(400).json({ error: "stripeSessionId es obligatorio" });
    return;
  }

  try {
    const { getStripe } = await import("../lib/stripe");
    const stripe = await getStripe();
    if (!stripe) {
      res.status(503).json({ error: "Stripe no está configurado en este servidor" });
      return;
    }

    // Retrieve the checkout session to get the payment intent
    const session = await stripe.checkout.sessions.retrieve(stripeSessionId);
    if (!session.payment_intent) {
      res.status(400).json({ error: "La sesión no tiene payment_intent asociado" });
      return;
    }

    const paymentIntentId = typeof session.payment_intent === "string"
      ? session.payment_intent
      : session.payment_intent.id;

    // Create the refund
    const refundParams: any = {
      payment_intent: paymentIntentId,
      reason: "requested_by_customer",
    };
    if (amountCents && amountCents > 0) {
      refundParams.amount = amountCents; // in cents
    }

    const refund = await stripe.refunds.create(refundParams);

    // Log the refund in credit transactions
    await CreditTransaction.create({
      userId: targetId,
      kind: "admin_stripe_refund",
      amount: 0, // no credit change, just a record
      description: reason || `Reembolso Stripe ${refund.id} · ${(refund.amount / 100).toFixed(2)}€`,
      stripeSessionId,
    });

    logger.info({ userId: targetId, refundId: refund.id, amount: refund.amount }, "Stripe refund created");
    res.json({ ok: true, refundId: refund.id, amount: refund.amount, status: refund.status });
  } catch (err: any) {
    logger.error({ err, userId: targetId }, "Error creating Stripe refund");
    res.status(500).json({ error: err?.message ?? "Error al procesar el reembolso Stripe" });
  }
});

// ─── Admin notes on user ─────────────────────────────────────────────────────
router.post("/admin/users/:id/notes", async (req: any, res: any): Promise<void> => {
  await connectDB();
  const targetId = req.params.id;
  const { note } = req.body;
  if (!note?.trim()) {
    res.status(400).json({ error: "La nota no puede estar vacía" });
    return;
  }
  try {
    await User.findByIdAndUpdate(targetId, {
      $push: { adminNotes: { text: note.trim(), createdAt: new Date() } },
    });
    res.json({ ok: true });
  } catch (err) {
    logger.error({ err, userId: targetId }, "Error adding admin note");
    res.status(500).json({ error: "Error al guardar la nota" });
  }
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
    const targetUser = await User.findById(targetId).lean();
    if (!targetUser) {
      res.status(404).json({ error: "Usuario no encontrado" });
      return;
    }

    await refundCredits({
      userId: targetId,
      isAdmin: isAdminEmail(targetUser.email),
      amount,
      description: reason || "Reembolso administrativo",
    });

    const updated = await User.findById(targetId).select("credits").lean();
    res.json({ ok: true, newBalance: updated?.credits ?? null });
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
      id: String(r._id),
      userId: r.userId,
      userEmail: emailMap.get(r.userId) ?? null,
      title: r.title,
      description: r.description,
      techStack: Array.isArray(r.techStack) ? r.techStack : [],
      status: r.status,
      createdAt: r.createdAt instanceof Date ? r.createdAt.toISOString() : (r.createdAt ?? null),
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
      id: String(r._id),
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
  const force = req.body?.force === true || req.query?.force === "true";

  const job = await GenerationJob.findById(id).lean();
  if (!job) {
    res.status(404).json({ error: "Job no encontrado" });
    return;
  }

  const ageMs = Date.now() - new Date(job.updatedAt).getTime();
  const STALE_MS = 15 * 60 * 1000;
  const retryable =
    force ||
    job.status === "failed" ||
    (job.status === "running" && ageMs > STALE_MS) ||
    (job.status === "queued" && ageMs > STALE_MS);

  if (!retryable) {
    res.status(409).json({ error: `Job en estado '${job.status}' no es reintentable ahora. Usa force=true para forzar.` });
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
    id: String(updated._id),
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
      id: String(r._id),
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

// GET /api/admin/clerk-users — recuento de usuarios en Clerk vs MongoDB
router.get("/admin/clerk-users", async (_req, res): Promise<void> => {
  try {
    await connectDB();
    const { clerkClient } = await import("@clerk/express");

    // Usar getCount() — más rápido que paginar
    const clerkTotal = await clerkClient.users.getCount();
    const mongoTotal = await User.countDocuments();
    const diff = Math.max(0, clerkTotal - mongoTotal);

    res.json({
      clerkTotal,
      mongoTotal,
      diff,
      message: diff > 0
        ? `Hay ${diff} usuario(s) en Clerk que aún no han interactuado con la app`
        : "MongoDB está sincronizado con Clerk"
    });
  } catch (err) {
    logger.error({ err }, "admin/clerk-users error");
    res.status(500).json({ error: String(err) });
  }
});

// POST /api/admin/sync-clerk-users — sincronizar todos los usuarios de Clerk a MongoDB
router.post("/admin/sync-clerk-users", async (_req, res): Promise<void> => {
  try {
    await connectDB();
    const { clerkClient } = await import("@clerk/express");

    let synced = 0, skipped = 0, errors = 0;
    let offset = 0;
    const limit = 100;

    while (true) {
      const page = await clerkClient.users.getUserList({ limit, offset });
      if (page.data.length === 0) break;

      for (const cu of page.data) {
        try {
          const email = cu.emailAddresses?.[0]?.emailAddress ?? "";
          if (!email) { skipped++; continue; }

          const existing = await User.findOne({ $or: [{ _id: cu.id }, { email }] }).lean();
          if (existing) { skipped++; continue; }

          const isAdmin = isAdminEmail(email);
          await User.create({
            _id: cu.id,
            email,
            fullName: [cu.firstName, cu.lastName].filter(Boolean).join(" ") || undefined,
            imageUrl: cu.imageUrl ?? undefined,
            credits: isAdmin ? 999999999 : 50,
            planCredits: isAdmin ? 0 : 50,
            freeCreditsUsed: !isAdmin,
            plan: "free",
            createdAt: new Date(cu.createdAt),
          });
          synced++;
        } catch (userErr: any) {
          // Ignorar duplicados de email (índice único)
          if (userErr?.code === 11000) { skipped++; }
          else { errors++; logger.warn({ userErr, clerkId: cu.id }, "sync-clerk-users: error creando usuario"); }
        }
      }

      if (page.data.length < limit) break;
      offset += limit;
      if (offset > 10000) break;
    }

    logger.info({ synced, skipped, errors }, "admin/sync-clerk-users: sync completado");
    res.json({ ok: true, synced, skipped, errors,
      message: `Sincronizados ${synced} usuarios nuevos. ${skipped} ya existían. ${errors} errores.` });
  } catch (err) {
    logger.error({ err }, "admin/sync-clerk-users error");
    res.status(500).json({ error: String(err) });
  }
});

router.get("/admin/metrics", async (_req, res) => {
  await connectDB();
  const now = new Date();
  const day = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const week = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  const [jobs24h, failingPhases, creditsToday, creditsMonth, topUsers,
    publishedTotal, publishedToday, queueByStatusRaw, jobs7dByDay, credits7dByDay, newUsers7d, totalUsers, totalApps] = await Promise.all([
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
    // 7-day jobs histogram by day
    GenerationJob.aggregate([
      { $match: { createdAt: { $gte: week } } },
      { $group: {
        _id: {
          date: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } },
          status: "$status",
        },
        count: { $sum: 1 },
      }},
      { $sort: { "_id.date": 1 } },
    ]),
    // 7-day credits usage histogram by day
    CreditTransaction.aggregate([
      { $match: { kind: "usage", createdAt: { $gte: week } } },
      { $group: {
        _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } },
        total: { $sum: { $abs: "$amount" } },
      }},
      { $sort: { _id: 1 } },
    ]),
    // new users in last 7 days
    User.countDocuments({ createdAt: { $gte: week } }),
    User.countDocuments(),
    GeneratedApp.countDocuments(),
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

  // Build 7-day jobs histogram: { date, succeeded, failed, total }[]
  const jobsByDayMap: Record<string, { date: string; succeeded: number; failed: number; total: number }> = {};
  for (const row of jobs7dByDay as any[]) {
    const d = row._id.date;
    if (!jobsByDayMap[d]) jobsByDayMap[d] = { date: d, succeeded: 0, failed: 0, total: 0 };
    jobsByDayMap[d].total += row.count;
    if (row._id.status === "succeeded") jobsByDayMap[d].succeeded += row.count;
    if (row._id.status === "failed") jobsByDayMap[d].failed += row.count;
  }
  const jobs7dChart = Object.values(jobsByDayMap).sort((a, b) => a.date.localeCompare(b.date));

  // Build 7-day credits histogram: { date, credits }[]
  const credits7dChart = (credits7dByDay as any[]).map((r) => ({ date: r._id, credits: r.total }));

  res.json({
    generatedAt: now.toISOString(),
    overview: {
      totalUsers,
      totalApps,
      newUsers7d,
    },
    jobs24h: {
      total: jobsTotal,
      succeeded: jobsSuccess,
      failed: jobsFailed,
      successRate: jobsTotal > 0 ? Math.round((jobsSuccess / jobsTotal) * 100) : null,
      avgDurationMs: avgDurationCount > 0 ? Math.round(avgDurationMsAccum / avgDurationCount) : 0,
    },
    jobs7dChart,
    credits7dChart,
    topFailingPhases: failingPhases.map((p: { _id: string; total: number }) => ({
      phase: p._id,
      count: p.total,
    })),
    credits: {
      today: creditsToday[0]?.total ?? 0,
      month: Math.min(creditsMonth[0]?.total ?? 0, 999_999_999), // cap para evitar overflow display
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

// ─── Admin: Resetear créditos corruptos del mes ───────────────────────────────
router.post("/admin/metrics/reset-monthly-credits", async (_req, res) => {
  await connectDB();
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  // Encontrar transacciones con valores absurdamente grandes (overflow)
  const corrupt = await CreditTransaction.find({
    kind: "usage",
    createdAt: { $gte: monthStart },
    $or: [
      { amount: { $lt: -100_000 } },  // cargo mayor de 100k créditos = corrupto
      { amount: { $gt: 100_000 } },   // ingreso mayor de 100k = corrupto
    ],
  }).lean();

  if (corrupt.length === 0) {
    res.json({ ok: true, deleted: 0, message: "No se encontraron transacciones corruptas." });
    return;
  }

  const ids = corrupt.map((t: any) => t._id);
  await CreditTransaction.deleteMany({ _id: { $in: ids } });

  logger.info({ deleted: corrupt.length }, "Admin: deleted corrupt credit transactions");
  res.json({ ok: true, deleted: corrupt.length, message: `${corrupt.length} transacción(es) corrupta(s) eliminada(s).` });
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
          from: process.env.RESEND_FROM_EMAIL || 'Maris AI <onboarding@resend.dev>',
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

// ─── Admin Private Projects (seguxat.es and other admin-owned projects) ─────
// GET: list all projects owned by the admin
router.get("/admin/my-projects", async (req: any, res: any): Promise<void> => {
  await connectDB();
  const apps = await GeneratedApp.find({ userId: req.dbUser._id.toString() })
    .sort({ updatedAt: -1 })
    .select("_id title description prompt status kind publicSlug vercelDeployUrl marisaiSubdomain customDomain customDomainVerified deploymentStatus createdAt updatedAt hasWatermark");
  res.json({ apps });
});

// POST: register an external project (like seguxat.es) in the admin dashboard
router.post("/admin/my-projects", async (req: any, res: any): Promise<void> => {
  await connectDB();
  const { title, description, url, notes } = req.body;
  if (!title) { res.status(400).json({ error: "title required" }); return; }
  const app = await GeneratedApp.create({
    userId: req.dbUser._id.toString(),
    title,
    description: description || "",
    prompt: notes || `Proyecto externo: ${url || title}`,
    techStack: ["external"],
    frontendCode: `// External project: ${url || title}`,
    backendCode: "",
    status: "external",
    kind: "external",
    customDomain: url || undefined,
    customDomainVerified: !!url,
    hasWatermark: false,
  });
  res.json({ ok: true, app });
});

// ─── Admin: Test de notificación por email ────────────────────────────────────
router.post("/admin/test-email-alert", async (req: any, res: any): Promise<void> => {
  await connectDB();
  try {
    // Buscar un job fallido reciente real para usar datos reales
    const recentFailedJob = await GenerationJob.findOne({ status: "failed" })
      .sort({ updatedAt: -1 }).lean() as any;

    let testUserEmail = "test@marisai.es";
    let testUserId = "test-user-id";
    let testJobId = "test-job-" + Date.now();
    let testAppId: string | undefined;
    let testPrompt = "TEST: Email de prueba del sistema de alertas de Maris AI";
    let testError = "Este es un error de prueba — el sistema de alertas funciona ✅";
    let testRetry = 3;

    if (recentFailedJob) {
      // Buscar email del usuario
      const dbUser = await User.findById(recentFailedJob.userId).lean() as any;
      testUserEmail = dbUser?.email || recentFailedJob.userId;
      testUserId = recentFailedJob.userId;
      testJobId = String(recentFailedJob._id);
      testAppId = recentFailedJob.appId || undefined;
      testPrompt = recentFailedJob.prompt || testPrompt;
      testError = recentFailedJob.errorMessage || testError;
      testRetry = Math.max((recentFailedJob.retryCount || 0), 1);
    }

    const { notifyAdminJobFailed } = await import("../lib/notify");
    await notifyAdminJobFailed({
      userEmail: testUserEmail,
      userId: testUserId,
      jobId: testJobId,
      appId: testAppId,
      prompt: `[EMAIL DE PRUEBA] ${testPrompt}`,
      errorMessage: testError,
      retryCount: testRetry,
    });
    res.json({
      ok: true,
      message: `Email enviado a ${["soportemarisai@gmail.com", "rrhh.milchollos@gmail.com"].join(" y ")} con datos ${recentFailedJob ? "reales del último job fallido" : "de prueba"}`,
      usedRealJob: !!recentFailedJob,
      userEmail: testUserEmail,
      jobId: testJobId,
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err instanceof Error ? err.message : "Error desconocido" });
  }
});
router.delete("/admin/users/:id/jobs", async (req: any, res: any): Promise<void> => {
  await connectDB();
  const { statuses, olderThanHours } = req.body ?? {};

  const query: any = { userId: req.params.id };

  // Por defecto borrar solo failed/reviewing/succeeded — nunca running/queued activos
  const safeStatuses = Array.isArray(statuses)
    ? statuses.filter((s: string) => ["failed", "reviewing", "succeeded"].includes(s))
    : ["failed", "reviewing"];
  query.status = { $in: safeStatuses };

  if (olderThanHours) {
    query.createdAt = { $lt: new Date(Date.now() - olderThanHours * 3600_000) };
  }

  const result = await GenerationJob.deleteMany(query);
  // Borrar también los logs de esos jobs
  await JobLog.deleteMany({ jobId: { $in: (await GenerationJob.find(query).select("_id")).map((j: any) => String(j._id)) } });

  logger.info({ userId: req.params.id, deleted: result.deletedCount, statuses: safeStatuses }, "Admin: bulk deleted jobs");
  res.json({ ok: true, deleted: result.deletedCount });
});

// ─── Admin: Borrar jobs concretos por IDs ────────────────────────────────────
router.delete("/admin/jobs/bulk", async (req: any, res: any): Promise<void> => {
  await connectDB();
  const { jobIds } = req.body ?? {};
  if (!Array.isArray(jobIds) || jobIds.length === 0) {
    res.status(400).json({ error: "jobIds requerido" }); return;
  }
  // Solo borrar jobs no activos
  const result = await GenerationJob.deleteMany({
    _id: { $in: jobIds },
    status: { $in: ["failed", "reviewing", "succeeded"] },
  });
  logger.info({ deleted: result.deletedCount }, "Admin: bulk deleted jobs by ids");
  res.json({ ok: true, deleted: result.deletedCount });
});

// ─── Admin: Limpiar reviewing huérfanos (jobs atascados en reviewing) ─────────
router.post("/admin/jobs/cleanup-reviewing", async (req: any, res: any): Promise<void> => {
  await connectDB();
  // Jobs en reviewing más de 2 horas = huérfanos, marcarlos como failed
  const twoHoursAgo = new Date(Date.now() - 2 * 3600_000);
  const result = await GenerationJob.updateMany(
    { status: "reviewing", updatedAt: { $lt: twoHoursAgo } },
    { $set: { status: "failed", errorMessage: "Job cancelado por el equipo de soporte." } },
  );
  logger.info({ updated: result.modifiedCount }, "Admin: cleaned up orphaned reviewing jobs");
  res.json({ ok: true, cleaned: result.modifiedCount });
});

// ─── Admin: Corregir jobs failed·done (completaron pero status mal guardado) ──
// ─── Admin: Diagnóstico de IDs de apps de un usuario ─────────────────────────
router.get("/admin/users/:id/apps-debug", async (req: any, res: any): Promise<void> => {
  await connectDB();
  const id = req.params.id;
  const user = await User.findById(id).lean() as any;

  // Buscar apps con distintos criterios para ver cuál funciona
  const byUserId = await GeneratedApp.countDocuments({ userId: id });
  const byEmail = user?.email ? await GeneratedApp.countDocuments({ "userEmail": user.email }) : 0;

  // Ver los últimos jobs del usuario y sus appIds
  const jobs = await (mongoose.model("GenerationJob") as any)
    .find({ userId: id }).sort({ createdAt: -1 }).limit(5).select("appId status prompt").lean();

  // Ver una muestra de apps con su userId real
  const sampleApps = await GeneratedApp.find({}).sort({ createdAt: -1 }).limit(3).select("userId title").lean();

  res.json({
    searchedUserId: id,
    userFound: !!user,
    userEmail: user?.email,
    appsByUserId: byUserId,
    appsByEmail: byEmail,
    recentJobs: jobs.map((j: any) => ({ appId: j.appId, status: j.status, prompt: j.prompt?.slice(0, 50) })),
    sampleAppsInDB: sampleApps.map((a: any) => ({ userId: a.userId, title: a.title })),
  });
});

// POST /api/admin/apps/patch-by-slug — parchear app por slug público

// POST /api/admin/apps/patch-all — parchear todas las apps que contengan un texto
router.post("/admin/apps/patch-all", async (req: any, res: any): Promise<void> => {
  await connectDB();
  const { search, replace } = req.body ?? {};
  if (!search) { res.status(400).json({ error: "search requerido" }); return; }

  const apps = await GeneratedApp.find({
    frontendCode: { $regex: search, $options: "i" }
  }).select("_id title").lean();

  let patched = 0;
  for (const app of apps) {
    const full = await GeneratedApp.findById(app._id).select("frontendCode").lean() as any;
    if (!full?.frontendCode) continue;
    const newCode = full.frontendCode.split(search).join(replace ?? "");
    await GeneratedApp.findByIdAndUpdate(app._id, { $set: { frontendCode: newCode } });
    patched++;
  }

  res.json({ ok: true, patched, total: apps.length,
    message: `Parcheadas ${patched} apps que contenían el texto` });
});

router.post("/admin/apps/patch-by-slug", async (req: any, res: any): Promise<void> => {
  await connectDB();
  const { slug, search, replace } = req.body ?? {};
  if (!slug || !search) { res.status(400).json({ error: "slug y search requeridos" }); return; }

  // Buscar por publicSlug o por vercelDeployUrl que contenga el slug
  const app = await GeneratedApp.findOne({
    $or: [
      { publicSlug: slug },
      { vercelDeployUrl: { $regex: slug, $options: "i" } },
      { marisaiSubdomain: { $regex: slug, $options: "i" } }
    ]
  }).lean() as any;

  if (!app) { res.status(404).json({ error: "App no encontrada con ese slug" }); return; }

  const original = app.frontendCode || "";
  const replaceWith = replace ?? "";
  const patched = original.split(search).join(replaceWith);
  const count = original.split(search).length - 1;

  if (count === 0) {
    res.json({ ok: false, appId: String(app._id), message: "Texto no encontrado en el código", occurrences: 0 });
    return;
  }

  await GeneratedApp.findByIdAndUpdate(app._id, { $set: { frontendCode: patched } });
  logger.info({ appId: String(app._id), slug, search, occurrences: count }, "Admin: patched app by slug");
  res.json({ ok: true, appId: String(app._id), occurrences: count, message: `Eliminado ${count} vez/veces correctamente` });
});


// POST /api/admin/apps/:id/replace-bundle — reemplazar bundle completo de una app
router.post("/admin/apps/:id/replace-bundle", async (req: any, res: any): Promise<void> => {
  await connectDB();
  const { frontendCode, title } = req.body ?? {};
  if (!frontendCode) { res.status(400).json({ error: "frontendCode requerido" }); return; }

  const app = await GeneratedApp.findById(req.params.id).lean() as any;
  if (!app) { res.status(404).json({ error: "App no encontrada" }); return; }

  const update: any = { frontendCode };
  if (title) update.title = title;

  await GeneratedApp.findByIdAndUpdate(req.params.id, { $set: update });
  logger.info({ appId: req.params.id, size: frontendCode.length, title }, "Admin: bundle reemplazado completamente");
  res.json({ ok: true, appId: req.params.id, size: frontendCode.length, message: "Bundle reemplazado correctamente" });
});

router.post("/admin/apps/:id/patch-code", async (req: any, res: any): Promise<void> => {
  await connectDB();
  const { search, replace } = req.body ?? {};
  if (!search) { res.status(400).json({ error: "search requerido" }); return; }

  const app = await GeneratedApp.findById(req.params.id).lean() as any;
  if (!app) { res.status(404).json({ error: "App no encontrada" }); return; }

  const original = app.frontendCode || "";
  const patched = original.split(search).join(replace ?? "");
  const count = original.split(search).length - 1;

  if (count === 0) {
    res.json({ ok: false, message: "Texto no encontrado en el código", occurrences: 0 });
    return;
  }

  await GeneratedApp.findByIdAndUpdate(req.params.id, { $set: { frontendCode: patched } });
  logger.info({ appId: req.params.id, search, occurrences: count }, "Admin: patched app frontend code");
  res.json({ ok: true, occurrences: count, message: `Reemplazado ${count} vez/veces correctamente` });
});

// POST /api/admin/users/:id/regenerate-and-apologize
// Regenera la última app fallida del usuario, envía email de disculpas y añade créditos de compensación
router.post("/admin/users/:id/regenerate-and-apologize", async (req: any, res: any): Promise<void> => {
  await connectDB();
  const { id } = req.params;
  const { compensationCredits = 10, customPrompt } = req.body ?? {};

  const user = await User.findById(id).lean() as any;
  if (!user) { res.status(404).json({ error: "Usuario no encontrado" }); return; }

  // Buscar el último job del usuario (fallido o el más reciente)
  const lastJob = await GenerationJob.findOne({ userId: id })
    .sort({ createdAt: -1 })
    .lean() as any;

  if (!lastJob && !customPrompt) {
    res.status(404).json({ error: "No se encontró ningún job para este usuario. Proporciona un prompt personalizado." });
    return;
  }

  const promptToUse = customPrompt || lastJob?.prompt || "";
  const kindToUse = lastJob?.kind || "fullstack";

  // Crear nuevo job de regeneración
  const jobId = new mongoose.Types.ObjectId().toString();
  await GenerationJob.create({
    _id: jobId,
    userId: id,
    prompt: promptToUse,
    coderModel: "claude-sonnet-4-6",
    language: "typescript",
    kind: kindToUse,
    status: "queued",
    phase: "queued",
    progress: 0,
    isAdmin: false,
    hasEverPaid: !!(user.isPremium || (user.plan && user.plan !== "free")),
  });

  const { enqueueGenerateJob } = await import("../lib/jobQueue");
  const { runJobById } = await import("./apps");
  await enqueueGenerateJob(jobId);
  runJobById(jobId).catch((err: any) => logger.error({ err, jobId }, "Admin regen job error"));

  // Añadir créditos de compensación
  if (compensationCredits > 0) {
    await User.findByIdAndUpdate(id, { $inc: { credits: compensationCredits } });
    await CreditTransaction.create({
      userId: id,
      kind: "bonus",
      amount: compensationCredits,
      description: `Compensación por inconveniences — ${compensationCredits} créditos de disculpa`,
    });
  }

  // Enviar email de disculpas
  let emailSent = false;
  try {
    const { sendApologyEmail } = await import("../lib/notify");
    emailSent = await sendApologyEmail({
      userEmail: user.email,
      userName: user.fullName || user.firstName,
      appTitle: lastJob?.prompt?.slice(0, 50) || "tu app",
      dashboardUrl: "https://www.marisai.es/dashboard",
    });
  } catch (emailErr) {
    logger.warn({ emailErr }, "Admin regen: email de disculpas falló");
  }

  logger.info({ userId: id, jobId, compensationCredits, emailSent }, "Admin: regenerate-and-apologize completado");
  res.json({
    ok: true,
    jobId,
    compensationCredits,
    emailSent,
    prompt: promptToUse.slice(0, 100),
    message: `Job ${jobId} creado. ${compensationCredits} créditos añadidos. Email ${emailSent ? "enviado ✅" : "falló ❌"}.`
  });
});

router.post("/admin/jobs/:id/send-apology", async (req: any, res: any): Promise<void> => {
  await connectDB();
  const job = await GenerationJob.findById(req.params.id).lean() as any;
  if (!job) { res.status(404).json({ error: "Job no encontrado" }); return; }

  const dbUser = await User.findById(job.userId).lean() as any;
  // Permitir override del destinatario — cuando el admin trabajó en el job pero el cliente es otro
  const userEmail = req.body?.recipientEmail || dbUser?.email;
  if (!userEmail) { res.status(400).json({ error: "Usuario sin email" }); return; }

  const app = job.appId
    ? await GeneratedApp.findById(job.appId).select("title").lean() as any
    : null;

  const { sendApologyEmail } = await import("../lib/notify");
  const sent = await sendApologyEmail({
    userEmail,
    userName: dbUser?.name || dbUser?.firstName,
    appTitle: app?.title || req.body?.appTitle,
    dashboardUrl: "https://www.marisai.es/dashboard",
  });

  logger.info({ jobId: req.params.id, userEmail, sent }, "Admin: sent apology email");
  res.json({ ok: sent, userEmail, message: sent ? `Email de disculpas enviado a ${userEmail} ✅` : "Fallo al enviar — revisa RESEND_API_KEY" });
});

router.post("/admin/jobs/fix-false-failed", async (req: any, res: any): Promise<void> => {
  await connectDB();
  // Jobs con status=failed pero phase=done son jobs que completaron correctamente
  const result = await GenerationJob.updateMany(
    { status: "failed", phase: "done" },
    { $set: { status: "succeeded", updatedAt: new Date() } },
  );
  logger.info({ fixed: result.modifiedCount }, "Admin: fixed false-failed jobs");
  res.json({ ok: true, fixed: result.modifiedCount, message: `${result.modifiedCount} job(s) corregidos de failed·done → succeeded` });
});
router.delete("/admin/my-projects/:id", async (req: any, res: any): Promise<void> => {
  await connectDB();
  const app = await GeneratedApp.findOne({ _id: req.params.id, userId: req.dbUser._id.toString() });
  if (!app) { res.status(404).json({ error: "Not found" }); return; }
  await app.deleteOne();
  res.json({ ok: true });
});

// ─── Admin: Seed Seguxat Project (alarma-negocio-xativa) ────────────────────
// POST /api/admin/seed-seguxat — requiere autenticación admin (middleware /admin)
router.post("/admin/seed-seguxat", async (req: any, res: any): Promise<void> => {
  const targetEmail = (req.query.email as string) || req.body?.email || "rrhh.milchollos@gmail.com";
  try {
    const result = await seedSeguxatProject(targetEmail);
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, message: String(err) });
  }
});

// ─── Admin: Recuperar job fallido y continuar desde el código parcial ────────
// POST /api/admin/jobs/:id/recover
router.post("/admin/jobs/:id/recover", async (req: any, res: any): Promise<void> => {
  await connectDB();
  const rawId = req.params.id;
  logger.info({ rawId }, "Admin recover: received request");

  // Intentar limpiar el ID por si viene como [object Object]
  let jobId = rawId;
  if (!jobId || jobId === "undefined" || jobId === "null" || jobId === "[object Object]") {
    logger.error({ rawId }, "Admin recover: invalid job ID");
    res.status(400).json({ error: `ID de job inválido: "${rawId}". Refresca el panel e inténtalo de nuevo.` });
    return;
  }

  const failedJob = await GenerationJob.findById(jobId).lean() as any;
  if (!failedJob) {
    logger.error({ jobId }, "Admin recover: job not found in DB");
    res.status(404).json({ error: `Job ${jobId} no encontrado en la base de datos.` });
    return;
  }

  const cleanPrompt = (failedJob.prompt || "").replace(/\[MARIS AI REQUEST LOCALE\][^\n]*\n?/, "").trim();

  // 1. Código parcial directo en el job fallido
  let partialCode = failedJob.partialFrontendCode || "";
  let baseAppId = failedJob.appId || failedJob.editAppId || null;

  // 2. Buscar en TODOS los jobs del mismo usuario con código parcial o app creada
  if (!partialCode && !baseAppId) {
    const relatedJobs = await GenerationJob.find({
      userId: failedJob.userId,
      _id: { $ne: failedJob._id },
      $or: [
        { partialFrontendCode: { $exists: true, $ne: "" } },
        { appId: { $exists: true, $ne: null } },
      ],
    }).sort({ updatedAt: -1 }).limit(10).lean() as any[];

    // Priorizar jobs que tienen app creada
    for (const j of relatedJobs) {
      if (j.appId) { baseAppId = j.appId; break; }
    }
    // Si no, tomar el código parcial más grande
    if (!baseAppId) {
      let bestPartial = "";
      for (const j of relatedJobs) {
        if ((j.partialFrontendCode || "").length > bestPartial.length) {
          bestPartial = j.partialFrontendCode;
        }
      }
      if (bestPartial.length > 500) partialCode = bestPartial;
    }
  }

  // 3. App existente — continuar editándola
  if (baseAppId) {
    const existingApp = await GeneratedApp.findById(baseAppId).lean() as any;
    if (existingApp?.frontendCode && existingApp.frontendCode.length > 500) {
      const recoverPrompt = `[ADMIN RECOVERY] Continúa y completa esta app que quedó incompleta. Revisa el código existente, identifica qué falta (páginas sin implementar, componentes vacíos, imports rotos) y completa TODO lo que falta para que sea completamente funcional. NO rehagas lo que ya funciona. Prompt original: ${cleanPrompt.slice(0, 300)}`;
      const newJobId = new mongoose.Types.ObjectId().toString();
      await GenerationJob.create({
        _id: newJobId, userId: failedJob.userId,
        prompt: `[MARIS AI REQUEST LOCALE] uiLanguage=es; locale=es-ES; country=ES; source=admin-recovery. ${recoverPrompt}`,
        editAppId: String(baseAppId), coderModel: "claude-sonnet-4-6",
        language: failedJob.language || "typescript", kind: "edit",
        status: "queued", phase: "queued", progress: 0, isAdmin: true, hasEverPaid: true,
      });
      await enqueueGenerateJob(newJobId);
      res.status(201).json({ ok: true, jobId: newJobId, strategy: "edit-existing", message: `Continuando desde la app existente (${Math.round(existingApp.frontendCode.length / 1000)} KB). El cliente verá el progreso en tiempo real.` });
      return;
    }
  }

  // 4. Código parcial — crear app temporal y completarla
  if (partialCode && partialCode.length > 500) {
    try {
      const owner = await User.findById(failedJob.userId).lean() as any;
      const userMarisId = owner?.marisId ?? MarisId.user();
      const appTitle = cleanPrompt.slice(0, 40).trim() || "App recuperada";
      const recoveredApp = await GeneratedApp.create({
        userId: failedJob.userId, title: appTitle, prompt: failedJob.prompt,
        description: "App recuperada desde código parcial — completándose ahora",
        techStack: ["React", "TypeScript", "Tailwind"],
        frontendCode: partialCode, backendCode: "",
        plannedPages: [], requiredEnvVars: [],
        language: failedJob.language || "typescript", kind: failedJob.kind || "fullstack",
        status: "ready", publicSlug: makeSlug(),
        marisId: await generateAppId(userMarisId).catch(() => MarisId.project(userMarisId)),
      });
      await GenerationJob.findByIdAndUpdate(failedJob._id, { $set: { appId: String(recoveredApp._id) } });
      const recoverPrompt = `[ADMIN RECOVERY] Completa esta app que quedó incompleta por un timeout. Tienes ${Math.round(partialCode.length / 1000)}KB de código como base. Completa todo lo que falta sin rehacer lo que ya funciona. Prompt original: ${cleanPrompt.slice(0, 300)}`;
      const newJobId = new mongoose.Types.ObjectId().toString();
      await GenerationJob.create({
        _id: newJobId, userId: failedJob.userId,
        prompt: `[MARIS AI REQUEST LOCALE] uiLanguage=es; locale=es-ES; country=ES; source=admin-recovery. ${recoverPrompt}`,
        editAppId: String(recoveredApp._id), coderModel: "claude-sonnet-4-6",
        language: failedJob.language || "typescript", kind: "edit",
        status: "queued", phase: "queued", progress: 0, isAdmin: true, hasEverPaid: true,
      });
      await enqueueGenerateJob(newJobId);
      res.status(201).json({ ok: true, jobId: newJobId, appId: String(recoveredApp._id), strategy: "partial-code", message: `App creada desde ${Math.round(partialCode.length / 1000)} KB de código parcial. Completando lo que falta.` });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : "Error creando app de recuperación" });
    }
    return;
  }

  // 5. Sin código parcial — generar desde el prompt original con Sonnet completo
  // Esto es mejor que el 404: al menos le damos algo al cliente
  logger.warn({ jobId: req.params.id }, "Admin recovery: no partial code found, generating fresh with full Sonnet");
  try {
    const newJobId = new mongoose.Types.ObjectId().toString();
    await GenerationJob.create({
      _id: newJobId, userId: failedJob.userId,
      prompt: failedJob.prompt || `[MARIS AI REQUEST LOCALE] uiLanguage=es; locale=es-ES; country=ES; source=admin-recovery. ${cleanPrompt}`,
      coderModel: "claude-sonnet-4-6",
      language: failedJob.language || "typescript",
      kind: failedJob.kind || "fullstack",
      status: "queued", phase: "queued", progress: 0, isAdmin: true, hasEverPaid: true,
    });
    await enqueueGenerateJob(newJobId);
    res.status(201).json({ ok: true, jobId: newJobId, strategy: "fresh-generation", message: "Sin código parcial disponible — generando de nuevo con máxima calidad. El cliente verá el progreso." });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Error lanzando generación de recuperación" });
  }
});

// ─── Admin: Recuperar por email — busca el último job fallido del usuario ──────
// POST /api/admin/recover-by-email  { email: "..." }
router.post("/admin/recover-by-email", async (req: any, res: any): Promise<void> => {
  await connectDB();
  const { email } = req.body ?? {};
  if (!email) { res.status(400).json({ error: "email requerido" }); return; }

  // Buscar usuario por email
  const user = await User.findOne({ email: email.trim().toLowerCase() }).lean() as any;
  if (!user) { res.status(404).json({ error: `Usuario ${email} no encontrado` }); return; }

  // Buscar el último job fallido del usuario — sin límite de tiempo
  const lastFailedJob = await GenerationJob.findOne({
    userId: String(user._id),
    status: { $in: ["failed", "reviewing"] },
  }).sort({ updatedAt: -1 }).lean() as any;

  if (!lastFailedJob) {
    // No hay jobs fallidos — lanzar generación nueva desde cero
    logger.info({ email }, "Admin recover-by-email: no failed jobs, launching fresh generation");
    const newJobId = new mongoose.Types.ObjectId().toString();
    await GenerationJob.create({
      _id: newJobId,
      userId: String(user._id),
      prompt: `[MARIS AI REQUEST LOCALE] uiLanguage=es; locale=es-ES; country=ES; source=admin-recovery. Crea una app web completa para gestión de alquileres de salones de eventos`,
      coderModel: "claude-sonnet-4-6",
      language: "typescript",
      kind: "fullstack",
      status: "queued", phase: "queued", progress: 0,
      isAdmin: true, hasEverPaid: true,
    });
    await enqueueGenerateJob(newJobId);
    res.status(201).json({ ok: true, jobId: newJobId, strategy: "fresh-generation", message: `Generando app nueva para ${email}` });
    return;
  }

  // Redirigir al endpoint de recover con el ID del job encontrado
  req.params.id = String(lastFailedJob._id);
  logger.info({ email, jobId: String(lastFailedJob._id) }, "Admin recover-by-email: found job");

  // Ejecutar la misma lógica de recover
  const jobId = String(lastFailedJob._id);
  const failedJob = lastFailedJob;
  const cleanPrompt = (failedJob.prompt || "").replace(/\[MARIS AI REQUEST LOCALE\][^\n]*\n?/, "").trim();

  let partialCode = failedJob.partialFrontendCode || "";
  let baseAppId = failedJob.appId || failedJob.editAppId || null;

  if (!partialCode && !baseAppId) {
    const relatedJobs = await GenerationJob.find({
      userId: failedJob.userId,
      _id: { $ne: failedJob._id },
      $or: [
        { partialFrontendCode: { $exists: true, $ne: "" } },
        { appId: { $exists: true, $ne: null } },
      ],
    }).sort({ updatedAt: -1 }).limit(20).lean() as any[];

    for (const j of relatedJobs) {
      if (j.appId) { baseAppId = j.appId; break; }
    }
    if (!baseAppId) {
      let bestPartial = "";
      for (const j of relatedJobs) {
        if ((j.partialFrontendCode || "").length > bestPartial.length) bestPartial = j.partialFrontendCode;
      }
      if (bestPartial.length > 500) partialCode = bestPartial;
    }
  }

  // También buscar en GeneratedApp directamente
  if (!baseAppId) {
    const latestApp = await GeneratedApp.findOne({ userId: failedJob.userId }).sort({ createdAt: -1 }).lean() as any;
    if (latestApp?._id) baseAppId = String(latestApp._id);
  }

  if (baseAppId) {
    const existingApp = await GeneratedApp.findById(baseAppId).lean() as any;
    if (existingApp?.frontendCode && existingApp.frontendCode.length > 500) {
      const recoverPrompt = `[ADMIN RECOVERY] Continúa y completa esta app que quedó incompleta. Revisa el código existente, identifica qué falta y completa TODO para que sea funcional. NO rehagas lo que ya funciona. Prompt original: ${cleanPrompt.slice(0, 300)}`;
      const newJobId = new mongoose.Types.ObjectId().toString();
      await GenerationJob.create({
        _id: newJobId, userId: failedJob.userId,
        prompt: `[MARIS AI REQUEST LOCALE] uiLanguage=es; locale=es-ES; country=ES; source=admin-recovery. ${recoverPrompt}`,
        editAppId: String(baseAppId), coderModel: "claude-sonnet-4-6",
        language: failedJob.language || "typescript", kind: "edit",
        status: "queued", phase: "queued", progress: 0, isAdmin: true, hasEverPaid: true,
      });
      await enqueueGenerateJob(newJobId);
      res.status(201).json({ ok: true, jobId: newJobId, strategy: "edit-existing", email, message: `Continuando desde la app existente de ${email} (${Math.round(existingApp.frontendCode.length / 1000)} KB).` });
      return;
    }
  }

  // Sin app — generar desde el prompt original
  const newJobId = new mongoose.Types.ObjectId().toString();
  await GenerationJob.create({
    _id: newJobId, userId: failedJob.userId,
    prompt: failedJob.prompt || `[MARIS AI REQUEST LOCALE] uiLanguage=es; locale=es-ES; country=ES; source=admin-recovery. ${cleanPrompt}`,
    coderModel: "claude-sonnet-4-6",
    language: failedJob.language || "typescript", kind: failedJob.kind || "fullstack",
    status: "queued", phase: "queued", progress: 0, isAdmin: true, hasEverPaid: true,
  });
  await enqueueGenerateJob(newJobId);
  res.status(201).json({ ok: true, jobId: newJobId, strategy: "fresh-generation", email, message: `Generando de nuevo para ${email} con máxima calidad.` });
});
// POST /api/admin/jobs/:id/cancel
// Cancela el job silenciosamente y muestra mensaje amigable al cliente
router.post("/admin/jobs/:id/cancel", async (req: any, res: any): Promise<void> => {
  await connectDB();
  const { message } = req.body ?? {};

  const job = await GenerationJob.findById(req.params.id).lean();
  if (!job) { res.status(404).json({ error: "Job no encontrado" }); return; }

  const friendlyMessage = message ||
    "Nuestro equipo está revisando tu solicitud para ofrecerte el mejor resultado. En breve tendrás tu app lista. ✨";

  await GenerationJob.findByIdAndUpdate(req.params.id, {
    $set: {
      status: "reviewing",
      phase: "reviewing",
      errorMessage: friendlyMessage,
      updatedAt: new Date(),
    },
  });

  // Log visible en el panel admin pero NO en los logs del cliente
  logger.info({ jobId: req.params.id }, "Admin cancelled job with friendly message");

  res.json({ ok: true, message: "Job cancelado — cliente ve mensaje amigable." });
});

// ─── Admin: Cancelar jobs duplicados — deja solo el más reciente corriendo ────
router.post("/admin/users/:id/kill-duplicates", async (req: any, res: any): Promise<void> => {
  await connectDB();
  // Buscar todos los jobs running del usuario
  const runningJobs = await GenerationJob.find({
    userId: req.params.id,
    status: { $in: ["running", "queued"] },
  }).sort({ createdAt: -1 }).lean() as any[];

  if (runningJobs.length <= 1) {
    res.json({ ok: true, killed: 0, message: "Sin duplicados — solo hay 1 job activo." });
    return;
  }

  // Mantener el más reciente (primero), cancelar el resto silenciosamente
  const toKill = runningJobs.slice(1);
  const ids = toKill.map((j: any) => j._id);

  await GenerationJob.updateMany(
    { _id: { $in: ids } },
    { $set: { status: "failed", phase: "failed", errorMessage: "Job cancelado — se estaba ejecutando en paralelo con otro job del mismo usuario.", updatedAt: new Date() } },
  );

  logger.info({ userId: req.params.id, killed: toKill.length }, "Admin: killed duplicate running jobs");
  res.json({ ok: true, killed: toKill.length, kept: String(runningJobs[0]._id), message: `${toKill.length} job(s) duplicado(s) cancelados. Se mantiene el más reciente.` });
});
// ─── Admin: Lanzar proyecto completo para usuario (fullstack, Sonnet) ──────────
router.post("/admin/users/:id/launch-project", async (req: any, res: any): Promise<void> => {
  await connectDB();
  const { prompt, kind = "fullstack" } = req.body ?? {};
  if (!prompt) { res.status(400).json({ error: "prompt requerido" }); return; }

  const user = await User.findById(req.params.id, { email: 1 }).lean() as any;
  if (!user) { res.status(404).json({ error: "Usuario no encontrado" }); return; }

  const jobId = new mongoose.Types.ObjectId().toString();
  await GenerationJob.create({
    _id: jobId,
    userId: req.params.id,
    prompt: `[MARIS AI REQUEST LOCALE] uiLanguage=es; locale=es-ES; country=ES; source=admin-launch. ${prompt}`,
    coderModel: "claude-sonnet-4-6",
    language: "typescript",
    kind,
    status: "queued",
    phase: "queued",
    progress: 0,
    isAdmin: true,
    hasEverPaid: true,
  });
  await enqueueGenerateJob(jobId);
  logger.info({ jobId, userId: req.params.id }, "Admin launched full project");
  res.status(201).json({ ok: true, jobId, message: `Proyecto en cola para ${user.email}` });
});
// Body: { prompt?: string }
// Genera una landing page funcional en la cuenta del usuario especificado.
router.post("/admin/users/:id/generate-app", async (req: any, res: any): Promise<void> => {
  await connectDB();
  const targetId = req.params.id;
  const rawPrompt = req.body?.prompt || "";
  const isRepair = rawPrompt.startsWith("[ADMIN REPAIR]") || rawPrompt.startsWith("[ADMIN RECOVERY]");
  const defaultPrompt = "Crea una landing page profesional moderna para un emprendedor en España. Hero con titular impactante y CTA, sección de 3 beneficios con iconos, cómo funciona en 3 pasos, FAQ con 3 preguntas y footer. Diseño limpio en español. Sin backend.";
  const prompt = rawPrompt || defaultPrompt;

  const user = await User.findById(targetId, { email: 1 }).lean();
  if (!user) {
    res.status(404).json({ error: "Usuario no encontrado" });
    return;
  }

  try {
    // Si es una reparación (no regeneración desde 0), buscar la app más reciente del usuario
    // y usar editAppId para que el resultado se guarde SOBRE la app existente
    let editAppId: string | null = null;
    let existingAppTitle = "";
    if (isRepair) {
      const latestApp = await GeneratedApp.findOne(
        { userId: targetId },
        { _id: 1, title: 1, frontendCode: 1 }
      ).sort({ updatedAt: -1 }).lean() as any;
      if (latestApp?._id) {
        editAppId = String(latestApp._id);
        existingAppTitle = latestApp.title || "";
      }
    }

    const jobId = new mongoose.Types.ObjectId().toString();
    const source = isRepair ? "admin-repair" : "admin-inject";
    const generationPrompt = `[MARIS AI REQUEST LOCALE] uiLanguage=es; locale=es-ES; country=ES; source=${source}. ${prompt}`;

    await GenerationJob.create({
      _id: jobId,
      userId: targetId,
      prompt: generationPrompt,
      ...(editAppId ? { editAppId, kind: "edit" } : { kind: "fullstack" }),
      coderModel: "claude-sonnet-4-6",
      language: "typescript",
      status: "queued",
      phase: "queued",
      progress: 0,
      isAdmin: true,
      hasEverPaid: true,
    });

    await enqueueGenerateJob(jobId);
    logger.info({ jobId, targetId, editAppId, email: (user as any).email }, "Admin generate-app for user");

    const desc = editAppId
      ? `Corrección aplicada sobre "${existingAppTitle}" — el cliente verá el resultado en su panel en cuanto termine.`
      : `Nueva app en cola para ${(user as any).email}. Estará lista en breve.`;

    res.status(201).json({ ok: true, jobId, editAppId, message: desc });
  } catch (err) {
    logger.error({ err, targetId }, "Admin generate-app error");
    res.status(500).json({ error: err instanceof Error ? err.message : "Error interno" });
  }
});

// ─── Admin: Generate app by email (shortcut) ────────────────────────────────
// POST /api/admin/generate-for-email
// Body: { email: string, prompt?: string }
router.post("/admin/generate-for-email", async (req: any, res: any): Promise<void> => {
  await connectDB();
  const { email, prompt } = req.body ?? {};
  if (!email) { res.status(400).json({ error: "Email requerido" }); return; }

  const user = await User.findOne({ email: { $regex: new RegExp(`^${email}$`, "i") } }, { _id: 1, email: 1 }).lean();
  if (!user) { res.status(404).json({ error: `No existe cuenta con email ${email}` }); return; }

  const targetId = String((user as any)._id);
  const generationPrompt = `[MARIS AI REQUEST LOCALE] uiLanguage=es; locale=es-ES; country=ES; source=admin-inject. ${prompt || "Crea una app web para la gestión de alquileres de salones de eventos. Incluye: listado de salones disponibles con filtros de fecha y capacidad, formulario de reserva, panel de gestión de reservas y página de inicio atractiva. Diseño moderno en español. Sin backend."}`;

  try {
    const jobId = new mongoose.Types.ObjectId().toString();
    await GenerationJob.create({
      _id: jobId,
      userId: targetId,
      prompt: generationPrompt,
      coderModel: "claude-sonnet-4-6",
      language: "typescript",
      kind: "landing",
      status: "queued",
      phase: "queued",
      progress: 0,
      isAdmin: true,
    });
    await enqueueGenerateJob(jobId);
    logger.info({ jobId, targetId, email: (user as any).email }, "Admin generate-for-email");
    res.status(201).json({ ok: true, jobId, message: `App en cola para ${(user as any).email}. Lista en menos de 2 minutos.` });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Error interno" });
  }
});


// ─── Admin: Eliminar una app concreta ────────────────────────────────────────
// DELETE /api/admin/apps/:id
router.delete("/admin/apps/:id", async (req: any, res: any): Promise<void> => {
  await connectDB();
  const appId = req.params.id;
  const app = await GeneratedApp.findById(appId).lean() as any;
  if (!app) { res.status(404).json({ error: "App no encontrada" }); return; }

  await GeneratedApp.findByIdAndDelete(appId);
  await AppMessage.deleteMany({ appId });
  // Limpiar jobs asociados
  await GenerationJob.updateMany(
    { appId, status: { $in: ["failed", "reviewing"] } },
    { $set: { status: "failed" } }
  );
  logger.info({ appId, userId: app.userId }, "Admin: app eliminada");
  res.json({ ok: true, message: `App "${app.title}" eliminada` });
});

// ─── Admin: Operaciones de limpieza de apps por usuario ──────────────────────
// POST /api/admin/apps/cleanup
// Body: { userEmail: string, keepAppId: string, newTitle: string }
// - Renombra la app keepAppId al newTitle
// - Elimina TODAS las demás apps del usuario
// - Limpia jobs failed/reviewing huérfanos del usuario
// - Aplica a nivel general: cualquier admin puede usar esto para cualquier usuario
router.post("/admin/apps/cleanup", async (req: any, res: any): Promise<void> => {
  await connectDB();
  const { userEmail, keepAppId, newTitle } = req.body ?? {};
  if (!userEmail || !keepAppId || !newTitle) {
    res.status(400).json({ error: "userEmail, keepAppId y newTitle son requeridos" });
    return;
  }

  // Buscar usuario
  const user = await User.findOne({ email: userEmail.trim().toLowerCase() }).lean() as any;
  if (!user) {
    res.status(404).json({ error: `Usuario ${userEmail} no encontrado` });
    return;
  }
  const userId = String(user._id);

  // Verificar que la app a conservar existe y pertenece al usuario
  const keepApp = await GeneratedApp.findOne({ _id: keepAppId, userId }).lean() as any;
  if (!keepApp) {
    res.status(404).json({ error: `App ${keepAppId} no encontrada para el usuario ${userEmail}` });
    return;
  }

  // 1. Renombrar la app a conservar
  await GeneratedApp.findByIdAndUpdate(keepAppId, {
    $set: { title: newTitle.trim(), updatedAt: new Date() },
  });

  // 2. Eliminar TODAS las demás apps del usuario (excepto la que conservamos)
  const otherApps = await GeneratedApp.find(
    { userId, _id: { $ne: keepAppId } },
    { _id: 1, title: 1 }
  ).lean() as any[];

  const otherAppIds = otherApps.map((a: any) => String(a._id));

  if (otherAppIds.length > 0) {
    await GeneratedApp.deleteMany({ _id: { $in: otherAppIds } });
    // Limpiar mensajes y logs de las apps eliminadas
    await AppMessage.deleteMany({ appId: { $in: otherAppIds } });
    logger.info({ userId, userEmail, deleted: otherAppIds.length }, "Admin cleanup: apps eliminadas");
  }

  // 3. Limpiar jobs fallidos/reviewing del usuario (no tocar los activos/succeeded)
  const cleanedJobs = await GenerationJob.deleteMany({
    userId,
    status: { $in: ["failed", "reviewing"] },
  });

  logger.info(
    { userId, userEmail, keepAppId, newTitle, deletedApps: otherAppIds.length, cleanedJobs: cleanedJobs.deletedCount },
    "Admin cleanup: operación completada"
  );

  res.json({
    ok: true,
    keptApp: { id: keepAppId, title: newTitle },
    deletedApps: otherAppIds.length,
    deletedJobs: cleanedJobs.deletedCount,
    message: `✅ Listo: "${newTitle}" conservada, ${otherAppIds.length} app(s) eliminada(s), ${cleanedJobs.deletedCount} job(s) limpiado(s).`,
  });
});

export default router;
