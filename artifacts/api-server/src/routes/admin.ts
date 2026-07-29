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
  ProjectPlaybook,
  AgentNote,
  JobLog,
  UserNotification,
  AppMessage,
  AppRevision,
  type IUser,
  type IGeneratedApp,
  type ICreditTransaction,
  type IGenerationJob,
  type ITicket,
  type IAgentMemory,
} from "@workspace/db/schema";
import { restoreAppRevision } from "../lib/appRevisions";
import { diagnoseFromLogs } from "../lib/jobDiagnosis";
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
import { autoRepairBundle } from "../lib/autoRepairAgent";

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

// ─── Modo construcción ────────────────────────────────────────────────────────
// GET /api/site-status es PÚBLICO (está antes del prefijo /admin, el
// middleware de arriba no le aplica): el frontend lo consulta al arrancar
// para decidir si muestra la página "En construcción" a los visitantes.
// El interruptor POST /api/admin/maintenance sí exige admin.
router.get("/site-status", async (_req, res) => {
  try {
    await connectDB();
    const { SiteSetting } = await import("@workspace/db/schema");
    const doc = await SiteSetting.findOne({ key: "maintenance_mode" }).lean();
    res.json({ maintenance: doc?.value === "on" });
  } catch {
    // Fail-open: si la BD no responde, el sitio se muestra con normalidad —
    // un fallo de infraestructura nunca debe dejar fuera a los clientes.
    res.json({ maintenance: false });
  }
});

router.post("/admin/maintenance", async (req: any, res: any): Promise<void> => {
  await connectDB();
  const { enabled } = req.body as { enabled?: boolean };
  if (typeof enabled !== "boolean") {
    res.status(400).json({ ok: false, message: "Falta enabled (boolean)." });
    return;
  }
  const { SiteSetting } = await import("@workspace/db/schema");
  await SiteSetting.updateOne(
    { key: "maintenance_mode" },
    { $set: { value: enabled ? "on" : "off", updatedBy: String(req.userId ?? "") } },
    { upsert: true },
  );
  res.json({ ok: true, maintenance: enabled });
});

router.get("/admin/overview", async (_req, res) => {
  await connectDB();
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const [totalUsers, totalApps, appsWeek, allUsers] = await Promise.all([
    User.countDocuments(),
    GeneratedApp.countDocuments(),
    GeneratedApp.countDocuments({ createdAt: { $gte: sevenDaysAgo } }),
    User.find({}, { credits: 1, email: 1 }).lean(),
  ]);

  const nonAdminUsers = allUsers.filter((u) => !isAdminEmail(u.email));
  const creditsOutstanding = nonAdminUsers.reduce((sum: number, u: Pick<IUser, "email" | "credits">) => sum + (u.credits ?? 0), 0);

  const txns = await CreditTransaction.find({}, { kind: 1, amount: 1, priceCents: 1, status: 1 }).lean();
  let creditsSpentTotal = 0;
  let creditsPurchasedTotal = 0;
let revenueCentsTotal = 0;
  for (const t of txns) {
    if (t.kind === "usage") creditsSpentTotal += Math.abs(t.amount);
    if (t.kind === "purchase") {
    creditsPurchasedTotal += t.amount;
    // No contar como ingreso lo que ya se ha reembolsado.
    if ((t as any).priceCents && (t as any).status !== "refunded") revenueCentsTotal += (t as any).priceCents;
  }
  }

  res.json({
    totalUsers,
    totalApps,
    appsLast7Days: appsWeek,
    creditsOutstanding,
    creditsSpentTotal,
    creditsPurchasedTotal,
    revenueCentsTotal,
  });
});

router.get("/admin/users", async (_req, res) => {
  await connectDB();
  const users = await User.find({}).sort({ createdAt: -1 }).lean();
  const appCounts = await GeneratedApp.aggregate([
    { $group: { _id: "$userId", count: { $sum: 1 } } },
  ]);
  const countMap = new Map(appCounts.map((a: { _id: string; count: number }) => [a._id, a.count]));

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
      phoneNumber: (u as any).phoneNumber ?? null,
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

// ─── Diagnóstico real de un job roto ─────────────────────────────────────────
// GET /api/admin/jobs/:id/diagnosis
// A petición EXPLÍCITA del usuario, tras varias sesiones de hoy investigando
// manualmente (pegando logs en bruto uno por uno) por qué un proyecto
// concreto terminó roto — este endpoint automatiza esa misma investigación:
// agrega los JobLog ya guardados (warn/error) y produce un resumen directo
// al grano (archivo afectado si se pudo extraer, categoría del problema,
// y el sospechoso principal), sin inventar ningún dato nuevo — solo
// presenta mejor lo que el sistema ya registra hoy en cada generación.
router.get("/admin/jobs/:id/diagnosis", async (req: any, res: any): Promise<void> => {
  await connectDB();
  const job = await GenerationJob.findById(req.params.id).select("status errorMessage").lean() as any;
  if (!job) { res.status(404).json({ error: "Job no encontrado" }); return; }
  const logs = await JobLog.find({ jobId: req.params.id }).sort({ _id: 1 }).lean();
  const diagnosis = diagnoseFromLogs(
    req.params.id,
    logs.map((l: any) => ({ agent: l.agent, level: l.level, message: l.message, createdAt: l.createdAt })),
    job,
  );
  res.json(diagnosis);
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
  res.json(txns.map((t) => ({
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

  // Estrategia 1: userId directo
  let apps = await GeneratedApp.find({ userId: id }).sort({ createdAt: -1 }).limit(limit).lean();
  logger.info({ step: "s1_direct", id, emailHint, found: apps.length }, "admin/users/apps");

  // Estrategia 2: por email → MongoDB _id del usuario → userId en apps
  if (apps.length === 0 && emailHint) {
    const userByEmail = await User.findOne({ email: emailHint }).select("_id").lean() as any;
    logger.info({ step: "s2_email", userFound: !!userByEmail, dbId: String(userByEmail?._id ?? "") }, "admin/users/apps");
    if (userByEmail) {
      apps = await GeneratedApp.find({ userId: String(userByEmail._id) }).sort({ createdAt: -1 }).limit(limit).lean();
      logger.info({ step: "s2_result", found: apps.length }, "admin/users/apps");
    }
  }

  // Estrategia 3: jobs del usuario (userId directo) → appIds
  if (apps.length === 0) {
    const jobs3 = await GenerationJob.find({ userId: id }).sort({ createdAt: -1 }).limit(100).select("appId editAppId").lean();
    const ids3 = [...new Set([...jobs3.map((j: any) => j.appId), ...jobs3.map((j: any) => j.editAppId)].filter(Boolean).map(String))];
    logger.info({ step: "s3_jobs_direct", jobCount: jobs3.length, appIds: ids3 }, "admin/users/apps");
    if (ids3.length > 0) {
      apps = await GeneratedApp.find({ _id: { $in: ids3 } }).sort({ createdAt: -1 }).limit(limit).lean();
      logger.info({ step: "s3_result", found: apps.length }, "admin/users/apps");
    }
  }

  // Estrategia 4: todos los _id de MongoDB para ese email + jobs de todos ellos
  if (apps.length === 0 && emailHint) {
    const usersEmail = await User.find({ email: emailHint }).select("_id").lean() as any[];
    const allDbIds = [id, ...usersEmail.map((u: any) => String(u._id))];
    const jobs4 = await GenerationJob.find({ userId: { $in: allDbIds } }).sort({ createdAt: -1 }).limit(100).select("appId editAppId").lean();
    const ids4 = [...new Set([...jobs4.map((j: any) => j.appId), ...jobs4.map((j: any) => j.editAppId)].filter(Boolean).map(String))];
    logger.info({ step: "s4_alldbs", allDbIds, jobCount: jobs4.length, appIds: ids4 }, "admin/users/apps");
    if (ids4.length > 0) {
      apps = await GeneratedApp.find({ _id: { $in: ids4 } }).sort({ createdAt: -1 }).limit(limit).lean();
      logger.info({ step: "s4_result", found: apps.length, titles: apps.map((a: any) => a.title) }, "admin/users/apps");
    }
  }

  // Estrategia 5 (último recurso): búsqueda libre en GeneratedApp por email en campos de texto
  if (apps.length === 0 && emailHint) {
    const apps5 = await GeneratedApp.find({ prompt: { $regex: emailHint, $options: "i" } }).sort({ createdAt: -1 }).limit(5).lean();
    logger.warn({ step: "s5_prompt_search", emailHint, found: apps5.length }, "admin/users/apps — todas las estrategias fallaron, usando búsqueda por prompt");
    // Solo usar si el resultado es muy relevante (el email aparece en el prompt)
    if (apps5.length > 0) apps = apps5;
  }

  logger.info({ step: "final", id, emailHint, total: apps.length }, "admin/users/apps");

  res.json({
    apps: apps.map((a: any) => ({
      id: String(a._id),
      _id: String(a._id),
      title: a.title,
      prompt: a.prompt,
      status: a.status,
      techStack: a.techStack,
      frontendCode: a.frontendCode,
      // Estado de visibilidad para el cliente — permite mostrar en el panel de
      // soporte si la app está oculta (en revisión) y ofrecer el desbloqueo por ID.
      pendingAdminApproval: !!a.pendingAdminApproval,
      visibleToClient: !a.pendingAdminApproval,
      createdAt: a.createdAt?.toISOString?.() ?? "",
    }))
  });
  } catch (err: any) {
    logger.error({ err: err?.message, userId: req.params.id }, "admin/users/:id/apps error");
    res.status(500).json({ error: err?.message || "Error interno" });
  }
});

// ─── Historial unificado de créditos por cliente (auditoría) ────────────────
// A petición explícita del usuario (dueño de Maris AI): un único sitio para
// ver, por cliente, cuántos créditos tiene, en qué se los ha gastado (cada
// generación/edición, con su app asociada) y si está generando AHORA MISMO
// — para poder responder con datos reales si un cliente reclama por
// consumo de créditos. Cruza GenerationJob (gasto real por tarea, incluido
// el coste interno real vía internalApiCostCents) con CreditTransaction
// (compras/reembolsos/consumos registrados) en una sola línea de tiempo.
router.get("/admin/users/:id/credit-audit", async (req: any, res: any): Promise<void> => {
  try {
    await connectDB();
    const userId = req.params.id;
    const limit = Math.min(Number(req.query.limit) || 100, 300);

    const [user, jobs, transactions] = await Promise.all([
      User.findById(userId, { credits: 1, planCredits: 1, plan: 1, email: 1, fullName: 1 }).lean() as any,
      GenerationJob.find({ userId })
        .sort({ createdAt: -1 })
        .limit(limit)
        .select(
          "appId editAppId jobKind kind status phase creditsCost internalApiCostCents apiCallCount maxCreditsForJob stuckLoopDetected budgetExceeded isAdmin isDemo createdAt updatedAt errorMessage",
        )
        .lean(),
      CreditTransaction.find({ userId })
        .sort({ createdAt: -1 })
        .limit(limit)
        .select("kind amount description priceCents status gateway createdAt")
        .lean(),
    ]);

    if (!user) {
      res.status(404).json({ error: "Usuario no encontrado" });
      return;
    }

    // Apps referenciadas por los jobs, para poner el título junto a cada
    // línea de gasto en vez de solo un appId ilegible en el panel.
    const appIds = [...new Set(jobs.flatMap((j: any) => [j.appId, j.editAppId]).filter(Boolean).map(String))];
    const apps = appIds.length
      ? await GeneratedApp.find({ _id: { $in: appIds } }, { title: 1 }).lean()
      : [];
    const titleByAppId = new Map(apps.map((a: any) => [String(a._id), a.title as string]));

    const isGeneratingNow = jobs.some((j: any) => !["succeeded", "failed"].includes(j.status));

    res.json({
      user: {
        id: String(user._id),
        email: user.email,
        fullName: user.fullName,
        creditsRemaining: user.credits,
        planCredits: user.planCredits,
        plan: user.plan,
      },
      isGeneratingNow,
      jobs: jobs.map((j: any) => {
        const targetAppId = String(j.appId || j.editAppId || "");
        return {
          id: String(j._id),
          appId: targetAppId || null,
          appTitle: titleByAppId.get(targetAppId) ?? null,
          type: j.editAppId ? "edición" : j.jobKind === "deep_test" ? "revisión profunda" : "generación",
          status: j.status,
          phase: j.phase,
          creditsCost: j.creditsCost ?? 0,
          // Coste real interno (Zoco IA) — para comparar con creditsCost
          // y ver el margen real de esta tarea concreta.
          internalApiCostCents: j.internalApiCostCents ?? 0,
          apiCallCount: j.apiCallCount ?? 0,
          maxCreditsForJob: j.maxCreditsForJob ?? null,
          stuckLoopDetected: !!j.stuckLoopDetected,
          budgetExceeded: !!j.budgetExceeded,
          isAdmin: !!j.isAdmin,
          isDemo: !!j.isDemo,
          errorMessage: j.errorMessage ?? null,
          createdAt: j.createdAt?.toISOString?.() ?? null,
          updatedAt: j.updatedAt?.toISOString?.() ?? null,
        };
      }),
      transactions: transactions.map((t: any) => ({
        id: String(t._id),
        kind: t.kind,
        amount: t.amount,
        description: t.description,
        priceCents: t.priceCents ?? null,
        status: t.status ?? null,
        gateway: t.gateway ?? null,
        createdAt: t.createdAt?.toISOString?.() ?? null,
      })),
    });
  } catch (err: any) {
    logger.error({ err: err?.message, userId: req.params.id }, "admin/users/:id/credit-audit error");
    res.status(500).json({ error: err?.message || "Error interno" });
  }
});


// ─── Vista global: qué clientes están generando/editando AHORA MISMO ───────
router.get("/admin/generating-now", async (_req: any, res: any): Promise<void> => {
  try {
    await connectDB();
    const jobs = await GenerationJob.find({ status: { $nin: ["succeeded", "failed"] } })
      .sort({ updatedAt: -1 })
      .limit(200)
      .select("userId appId editAppId jobKind status phase progress currentAgent creditsCost internalApiCostCents createdAt updatedAt")
      .lean();

    if (jobs.length === 0) {
      res.json({ count: 0, jobs: [] });
      return;
    }

    const userIds = [...new Set(jobs.map((j: any) => String(j.userId)))];
    const appIds = [...new Set(jobs.flatMap((j: any) => [j.appId, j.editAppId]).filter(Boolean).map(String))];
    const [users, apps] = await Promise.all([
      User.find({ _id: { $in: userIds } }, { email: 1, fullName: 1 }).lean(),
      GeneratedApp.find({ _id: { $in: appIds } }, { title: 1 }).lean(),
    ]);
    const userById = new Map(users.map((u: any) => [String(u._id), u]));
    const titleByAppId = new Map(apps.map((a: any) => [String(a._id), a.title as string]));

    res.json({
      count: jobs.length,
      jobs: jobs.map((j: any) => {
        const targetAppId = String(j.appId || j.editAppId || "");
        const u = userById.get(String(j.userId));
        return {
          jobId: String(j._id),
          userId: String(j.userId),
          userEmail: u?.email ?? null,
          userFullName: u?.fullName ?? null,
          appId: targetAppId || null,
          appTitle: titleByAppId.get(targetAppId) ?? null,
          type: j.editAppId ? "edición" : j.jobKind === "deep_test" ? "revisión profunda" : "generación",
          status: j.status,
          phase: j.phase,
          progress: j.progress,
          currentAgent: j.currentAgent ?? null,
          creditsCost: j.creditsCost ?? 0,
          internalApiCostCents: j.internalApiCostCents ?? 0,
          createdAt: j.createdAt?.toISOString?.() ?? null,
          updatedAt: j.updatedAt?.toISOString?.() ?? null,
        };
      }),
    });
  } catch (err: any) {
    logger.error({ err: err?.message }, "admin/generating-now error");
    res.status(500).json({ error: err?.message || "Error interno" });
  }
});


// ─── Migración única: dar 30 días de plazo (desde HOY) al saldo de ────────
// recarga que los clientes ya tenían ANTES del cambio de política (antes
// "no caducan nunca"). A petición explícita del usuario — aplica también
// al saldo ya existente, no solo a compras nuevas (creditPurchase ya deja
// topUpCreditsExpiresAt puesto para compras futuras). Idempotente: solo
// toca usuarios que aún no tienen topUpCreditsExpiresAt, así que llamarla
// más de una vez no le quita tiempo a nadie que ya se le haya asignado.
router.post("/admin/migrations/backfill-topup-expiry", async (_req: any, res: any): Promise<void> => {
  try {
    await connectDB();
    const thirtyDaysFromNow = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    const result = await User.updateMany(
      {
        topUpCreditsExpiresAt: { $exists: false },
        $expr: { $gt: ["$credits", { $ifNull: ["$planCredits", 0] }] },
      },
      { $set: { topUpCreditsExpiresAt: thirtyDaysFromNow } },
    );
    logger.info({ matched: result.matchedCount, modified: result.modifiedCount }, "backfill-topup-expiry done");
    res.json({ ok: true, usersUpdated: result.modifiedCount, expiresAt: thirtyDaysFromNow.toISOString() });
  } catch (err: any) {
    logger.error({ err: err?.message }, "admin/migrations/backfill-topup-expiry error");
    res.status(500).json({ error: err?.message || "Error interno" });
  }
});


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
// DEPRECADO — Solo para reembolsar pagos LEGADOS hechos con Stripe antes de
// la migración a Viva.com. NO usar para pagos nuevos. Si STRIPE_SECRET_KEY no
// está configurada, responde 503. Se mantendrá hasta que todos los pagos
// legados hayan pasado su período de reembolso (90 días desde la migración).
router.post("/admin/users/:id/stripe-refund", async (req: any, res: any): Promise<void> => {
  await connectDB();
  const targetId = req.params.id;
  const { stripeSessionId, amountCents, reason } = req.body;

  if (!stripeSessionId) {
    res.status(400).json({ error: "stripeSessionId es obligatorio" });
    return;
  }

  try {
    const { getStripe } = await import("../lib/payments");
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

// GET /admin/apps/broken-bundles
// ENCONTRADO A PETICIÓN DEL USUARIO (caso real: app "Here are your
// Instructions" con contenido inválido guardado como si fuera una
// generación exitosa -- causa raíz ya corregida para generaciones
// NUEVAS, ver POST /apps y la validación antes de GeneratedApp.create()).
// Este endpoint aplica el MISMO criterio de validación a TODAS las apps
// YA EXISTENTES, para encontrar cuáles quedaron rotas de esta misma
// forma ANTES del arreglo -- da una lista real y accionable en vez de
// tener que revisar app por app a mano.
router.get("/admin/apps/broken-bundles", async (_req, res) => {
  await connectDB();
  const apps = await GeneratedApp.find(
    { status: { $in: ["ready", "succeeded"] } },
    { userId: 1, title: 1, createdAt: 1, frontendCode: 1, status: 1 },
  ).sort({ createdAt: -1 }).lean();

  const broken = apps.filter((a: any) => {
    const fc = a.frontendCode;
    return !(typeof fc === "string" && fc.includes("// === FILE:") && fc.length > 200);
  });

  const userIds = [...new Set(broken.map((a: any) => a.userId))];
  const users = await User.find({ _id: { $in: userIds } }, { email: 1 }).lean();
  const emailMap = new Map(users.map((u) => [String(u._id), u.email]));

  res.json({
    totalChecked: apps.length,
    totalBroken: broken.length,
    apps: broken.map((r: any) => ({
      id: String(r._id),
      userId: r.userId,
      userEmail: emailMap.get(r.userId) ?? null,
      title: r.title,
      status: r.status,
      frontendCodeLength: typeof r.frontendCode === "string" ? r.frontendCode.length : 0,
      createdAt: r.createdAt instanceof Date ? r.createdAt.toISOString() : (r.createdAt ?? null),
    })),
  });
});

// GET /admin/learning-systems
// ENCONTRADO A PETICIÓN DEL USUARIO ('dame un porcentaje... para saber
// todo lo que saben'): la valoración cualitativa de cada sistema de
// aprendizaje no sustituye a datos reales -- este endpoint cuenta
// cuántas entradas de verdad existen hoy en cada uno, para poder ver el
// progreso real con el tiempo, no solo una foto fija de hoy.
router.get("/admin/learning-systems", async (_req, res) => {
  await connectDB();
  const [
    agentMemoryCount,
    agentMemoryTotalReuses,
    playbookCount,
    playbookTotalReuses,
    playbooksByVertical,
    appNotesCount,
    userPrefsCount,
  ] = await Promise.all([
    AgentMemory.countDocuments({}),
    AgentMemory.aggregate([{ $group: { _id: null, total: { $sum: "$successCount" } } }]),
    ProjectPlaybook.countDocuments({}),
    ProjectPlaybook.aggregate([{ $group: { _id: null, total: { $sum: "$timesReused" } } }]),
    ProjectPlaybook.aggregate([{ $group: { _id: "$businessVertical", count: { $sum: 1 } } }, { $sort: { count: -1 } }]),
    AgentNote.countDocuments({ notes: { $exists: true, $ne: "" } }),
    AgentNote.countDocuments({}),
  ]);
  res.json({
    agentMemory: {
      description: "Recuerda arreglos de errores pasados (Testing Agent)",
      entriesGuardadas: agentMemoryCount,
      vecesReutilizadoEnTotal: (agentMemoryTotalReuses[0] as any)?.total ?? 0,
    },
    projectPlaybooks: {
      description: "Manuales de proyectos similares ya exitosos",
      entriesGuardadas: playbookCount,
      vecesReutilizadoEnTotal: (playbookTotalReuses[0] as any)?.total ?? 0,
      porSector: playbooksByVertical.map((v: any) => ({ sector: v._id, cantidad: v.count })),
    },
    integrationPlaybooks: {
      description: "Manuales de integraciones (Stripe, Supabase...) -- lista fija en código, no crece sola",
      entriesConfiguradas: "fijo, no cuenta con base de datos",
    },
    agentMemoryContext: {
      description: "Notas de proyecto (app_notes) y preferencias de usuario (user_preferences)",
      cuentasConNotasDeProyecto: appNotesCount,
      cuentasTotalesRegistradas: userPrefsCount,
    },
  });
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
      internalErrorMessage: r.internalErrorMessage,
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

  // Guardia: este endpoint resetea progress a 0 y reencola el JOB DE
  // GENERACIÓN COMPLETO — correcto para un job normal genuinamente colgado,
  // pero CATASTRÓFICO para un job en flujo de reparación in-situ (status
  // repairing/repaired-pending-review), que no tiene ningún pipeline de
  // generación corriendo de fondo que "reencolar" — solo tiene una promesa
  // de autoRepairBundle ejecutándose en background sobre una app ya
  // existente. Reencolarlo como si fuera generación normal perdía el
  // progreso real y relanzaba TODO el pipeline desde cero (Architect →
  // Frontend → ...), exactamente el síntoma reportado: "vuelve a empezar
  // en vez de seguir donde se quedó".
  if ((job as any).status === "repairing" || (job as any).status === "repaired-pending-review") {
    const appId = (job as any).appId;
    if (!appId) {
      res.status(409).json({ error: "Este job de reparación no tiene una app asociada para relanzar la reparación." });
      return;
    }
    const repairInstruction = String(job.prompt || "").replace(/^\[ADMIN (REPAIR|RECOVERY)\]\s*/, "").replace(/\[MARIS AI REQUEST LOCALE\][^\n]*\n?/i, "").trim() || "Continúa y completa esta app.";
    await GenerationJob.findByIdAndUpdate(id, {
      $set: { status: "repairing", phase: "repairing", updatedAt: new Date() }, // mantiene el progress actual, NO lo resetea
    });
    res.json({ id: String(job._id), status: "repairing", message: "Relanzando la reparación in-situ sobre la app existente, sin perder el progreso." });
    void autoRepairBundle({
      appId: String(appId),
      userId: String((job as any).userId),
      trigger: "manual",
      errorSummary: repairInstruction,
      maxCycles: 6,
      jobId: id,
      log: logger.child({ module: "admin-retry-repair", jobId: id }),
    }).then(async (success) => {
      await GenerationJob.findByIdAndUpdate(id, {
        $set: success
          ? { status: "repaired-pending-review", phase: "done", progress: 100, errorMessage: null }
          : { status: "failed", phase: "done", errorMessage: "La reparación automática no produjo cambios válidos tras relanzarla." },
      });
    }).catch(async (err) => {
      logger.error({ err, jobId: id }, "admin-retry-repair: autoRepairBundle falló");
      await GenerationJob.findByIdAndUpdate(id, {
        $set: { status: "failed", phase: "done", errorMessage: String(err?.message || err).slice(0, 500) },
      });
    });
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
      // OJO: 'internalErrorMessage' no existe en el schema real de
      // AgentMemory (ver lib/db/src/schema/index.ts) — este campo nunca se
      // ha guardado, así que siempre sale undefined en el panel admin. No
      // es un error de tipos que arreglar con un cast silencioso: hay que
      // decidir si se añade el campo al schema (si se pensaba guardar este
      // dato) o se quita de aquí (si ya no hace falta).
      internalErrorMessage: (r as { internalErrorMessage?: string }).internalErrorMessage,
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

// Los endpoints admin/clerk-users y admin/sync-clerk-users se han retirado
// junto con Clerk: ya no hay un sistema externo con el que comparar/sincronizar.

// ─── Presencia en tiempo real ──────────────────────────────────────────────
// Qué usuarios tienen Maris AI abierto AHORA MISMO (no "última vez que
// entraron", que ya existía como lastLoginAt pero no responde a esta
// pregunta). Ver lib/presence.ts para el detalle del mecanismo (socket.io
// con autenticación Clerk real en el handshake).
router.get("/admin/presence", async (_req, res) => {
  await connectDB();
  const { listOnlineUsers } = await import("../lib/presence");
  const online = listOnlineUsers();
  if (online.length === 0) {
    return void res.json({ online: [], count: 0 });
  }
  const userIds = online.map((o) => o.userId);
  const users = await User.find({ _id: { $in: userIds } }).lean();
  const userMap = new Map(users.map((u) => [String(u._id), u]));
  res.json({
    count: online.length,
    online: online.map((o) => {
      const u = userMap.get(o.userId);
      return {
        userId: o.userId,
        email: u?.email ?? o.email ?? null,
        fullName: u?.fullName ?? null,
        imageUrl: u?.imageUrl ?? null,
        sockets: o.sockets,
        connectedAt: o.connectedAt.toISOString(),
        lastActivityAt: o.lastActivityAt.toISOString(),
        currentPage: o.currentPage ?? null,
      };
    }),
  });
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
    // ENCONTRADO: esta agregación era por CONSUMO de créditos (kind:"usage"),
    // limitada a 5 -- el usuario pidió explícitamente el gasto REAL en
    // COMPRAS (kind:"purchase", priceCents), de todos los clientes sin
    // límite, para una campaña de email masivo. Se cambia el criterio y se
    // añade el resto de usuarios (con 0€ gastado) más abajo, tras el
    // Promise.all, para no bloquear el resto de métricas con una consulta
    // más pesada dentro del mismo array.
    CreditTransaction.aggregate([
      { $match: { kind: "purchase", status: { $ne: "refunded" } } },
      { $group: { _id: "$userId", total: { $sum: { $ifNull: ["$priceCents", 0] } } } },
      { $sort: { total: -1 } },
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

  // Ingresos reales desde CreditTransaction
  const revenueTxns = await CreditTransaction.find({ kind: "purchase", status: { $ne: "refunded" } }, { priceCents: 1 }).lean();
  const revenueCentsTotal = revenueTxns.reduce((sum: number, t: any) => sum + (t.priceCents ?? 0), 0);

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

  // Añadir TODOS los usuarios que no aparecen en topUsers (nunca han
  // comprado nada, 0€ de gasto) -- el objetivo es tener el listado
  // completo de clientes para email masivo, no solo a quien ha comprado.
  const spentUserIds = new Set(topUsers.map((u: { _id: string }) => String(u._id)));
  const allUsersForList = await User.find({}, { email: 1, isAdmin: 1 }).lean();
  const zeroSpendUsers = allUsersForList
    .filter((u) => !isAdminEmail(u.email) && !spentUserIds.has(String(u._id)))
    .map((u) => ({ _id: String(u._id), total: 0 }));
  const allTopUsers = [...topUsers, ...zeroSpendUsers];
  for (const u of allUsersForList) {
    if (!emailMap.has(String(u._id))) emailMap.set(String(u._id), u.email);
  }

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
    topUsers: allTopUsers
      .map((u: { _id: string; total: number }) => ({
        userId: u._id,
        email: emailMap.get(u._id) ?? "(usuario eliminado)",
        totalSpentCents: u.total,
      }))
      .sort((a, b) => b.totalSpentCents - a.totalSpentCents),
    publishedApps: { today: publishedToday, total: publishedTotal },
    server: getMetricsSnapshot(),
    queue: { ready: isQueueReady(), jobs24hByStatus: queueByStatus },
    redis: (() => {
      // ENCONTRADO A PETICIÓN DEL USUARIO (panel mostrando "Redis:
      // Desconectado" pese a que el usuario confirmó haber añadido
      // REDIS_URL en Coolify): getRedisStatus() devuelve el campo
      // "lastPingOk", pero el frontend (admin-dashboard.tsx) busca
      // "data.redis?.connected" -- un campo que nunca existía en la
      // respuesta, así que siempre caía en "Desconectado" sin importar
      // el estado real de la conexión. Se añade el alias "connected"
      // sin quitar los campos originales, por si algo más los usa.
      const status = getRedisStatus();
      return { ...status, connected: status.lastPingOk, latencyMs: status.lastPingMs };
    })(),
    revenueCentsTotal,
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
  const { subject, message, creditsAdded, attachment } = req.body;

  const user = await User.findById(targetId).lean();
  if (!user) {
    res.status(404).json({ error: "Usuario no encontrado" });
    return;
  }

  // Validación del adjunto del LADO DEL SERVIDOR — nunca confiar solo en el
  // límite ya aplicado en el cliente (admin.tsx, 5MB). attachment.content ya
  // viene en base64 desde el frontend (FileReader.readAsDataURL), así que el
  // tamaño real en bytes es aproximadamente content.length * 0.75.
  let validAttachment: { filename: string; content: string } | undefined;
  if (attachment && typeof attachment.content === "string" && typeof attachment.filename === "string") {
    const approxBytes = (attachment.content.length * 3) / 4;
    // ENCONTRADO: express.json() en app.ts está configurado con limit:"2mb"
    // para TODO el body de la petición — el adjunto en base64 comparte ese
    // límite con el resto del JSON (asunto, mensaje, etc.), así que el techo
    // real aquí es más bajo que el límite de 40MB de Resend. Se deja un
    // margen prudente por debajo de los 2MB del límite global de Express
    // para no fallar con un error genérico de "payload too large" antes de
    // llegar siquiera a esta validación — si en el futuro se necesitan
    // capturas más grandes, hay que subir TAMBIÉN el limit de express.json,
    // no solo este número.
    const MAX_ATTACHMENT_BYTES = 1.5 * 1024 * 1024;
    if (approxBytes > MAX_ATTACHMENT_BYTES) {
      res.status(400).json({ error: "El adjunto supera el tamaño máximo permitido (1.5MB)." });
      return;
    }
    // Saneamos el nombre de archivo — evita inyectar caracteres extraños en
    // la cabecera del adjunto que Resend reciba.
    const safeFilename = attachment.filename.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 150) || "captura.png";
    validAttachment = { filename: safeFilename, content: attachment.content };
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
          ...(validAttachment ? { attachments: [validAttachment] } : {}),
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

// ─── Admin: Test de envío de email al cliente ─────────────────────────────────
// POST /api/admin/test-customer-email — envía un email de prueba a la dirección
// del admin para verificar que Resend + plantillas de cliente funcionan
router.post("/admin/test-customer-email", async (req: any, res: any): Promise<void> => {
  const targetEmail = req.body?.email || req.dbUser?.email;
  if (!targetEmail) { res.status(400).json({ error: "Indica un email de destino" }); return; }

  const { sendCustomAdminEmail } = await import("../lib/notify");
  const sent = await sendCustomAdminEmail({
    userEmail: targetEmail,
    userName: "Admin",
    subject: "✅ Test Maris AI — Correos a clientes funcionando",
    body: `Este es un email de prueba enviado desde el panel de administración de Maris AI.\n\nSi estás viendo este mensaje, el sistema de envío de correos a clientes está funcionando correctamente con Resend.\n\nLas plantillas de reactivación (proyecto a medias, empujón suave, recuperar cliente, etc.) están disponibles en el desplegable '💌 Enviar correo' de los paneles En vivo y Apps clientes.\n\nTodo ok 🎉`,
    creditsCompensation: 0,
  });

  if (!sent) {
    res.status(500).json({
      error: "Email NO enviado. Verifica: 1) RESEND_API_KEY en Coolify, 2) el dominio marisai.es verificado en resend.com, 3) que el email remitente alertas@marisai.es está autorizado.",
      targetEmail,
    });
    return;
  }
  res.json({ ok: true, message: `Email de prueba enviado a ${targetEmail} ✅ — revisa la bandeja de entrada` });
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

// DELETE /api/admin/jobs/:id — eliminar un job individual
router.delete("/admin/jobs/:id", async (req: any, res: any): Promise<void> => {
  await connectDB();
  const job = await GenerationJob.findByIdAndDelete(req.params.id).lean();
  if (!job) { res.status(404).json({ error: "Job no encontrado" }); return; }
  logger.info({ jobId: req.params.id }, "Admin: job eliminado individualmente");
  res.json({ ok: true, message: "Job eliminado" });
});

// A petición explícita del usuario: vaciar la pantalla "Jobs & Errores"
// (todos los GenerationJob de la base de datos, de cualquier usuario)
// dejando vivo SOLO el job indicado en keepJobId. Esto NO toca GeneratedApp
// (las apps ya entregadas siguen existiendo), NO toca User, y NO toca
// CreditTransaction — solo borra registros de la cola/historial de jobs.
router.post("/admin/jobs/keep-only", async (req: any, res: any): Promise<void> => {
  await connectDB();
  const { keepJobId } = req.body ?? {};
  if (!keepJobId) {
    res.status(400).json({ error: "keepJobId es requerido" }); return;
  }
  const keepJob = await GenerationJob.findById(keepJobId).lean();
  if (!keepJob) {
    res.status(404).json({ error: "El job a conservar no existe — no se ha borrado nada." });
    return;
  }
  const result = await GenerationJob.deleteMany({
    _id: { $ne: keepJobId },
  });
  logger.info({ keepJobId, deleted: result.deletedCount }, "Admin: wiped Jobs & Errores, kept only one job");
  res.json({ ok: true, deleted: result.deletedCount, keptJobId: keepJobId });
});

// A petición explícita del usuario: borrar de un clic TODOS los jobs en
// estado "failed" de la pantalla "Monitorización en vivo", sin tener que
// seleccionar IDs uno a uno (a diferencia de /admin/jobs/bulk, que exige
// una lista de jobIds concreta).
router.post("/admin/jobs/delete-failed", async (_req: any, res: any): Promise<void> => {
  await connectDB();
  const result = await GenerationJob.deleteMany({ status: "failed" });
  logger.info({ deleted: result.deletedCount }, "Admin: deleted all failed jobs");
  res.json({ ok: true, deleted: result.deletedCount });
});

// A petición explícita del usuario: detectar y eliminar jobs duplicados —
// mismo usuario + mismo prompt (normalizado) creados dentro de una
// ventana de 30 minutos entre sí (mismo criterio real ya usado para
// detectar reintentos automáticos al guardar una GeneratedApp). De cada
// grupo de duplicados se CONSERVA siempre el más reciente.
router.post("/admin/jobs/delete-duplicates", async (_req: any, res: any): Promise<void> => {
  await connectDB();
  const jobs = await GenerationJob.find({})
    .select("_id userId prompt createdAt")
    .sort({ createdAt: -1 })
    .lean();

  const toDelete: string[] = [];
  const seenGroups: Array<{ userId: string; normalizedPrompt: string; createdAt: Date; keptId: string }> = [];

  for (const job of jobs) {
    const normalizedPrompt = String(job.prompt || "").toLowerCase().replace(/\s+/g, " ").trim().slice(0, 200);
    if (normalizedPrompt.length < 10) continue; // prompts muy cortos no son fiables para detectar duplicados

    const match = seenGroups.find((g) =>
      g.userId === job.userId &&
      g.normalizedPrompt === normalizedPrompt &&
      Math.abs(g.createdAt.getTime() - new Date(job.createdAt).getTime()) < 30 * 60 * 1000,
    );

    if (match) {
      // Ya vimos un job más reciente igual a este — este es el duplicado a borrar.
      toDelete.push(String(job._id));
    } else {
      seenGroups.push({ userId: job.userId, normalizedPrompt, createdAt: new Date(job.createdAt), keptId: String(job._id) });
    }
  }

  if (toDelete.length === 0) {
    res.json({ ok: true, deleted: 0 });
    return;
  }

  const result = await GenerationJob.deleteMany({ _id: { $in: toDelete } });
  logger.info({ deleted: result.deletedCount, candidates: toDelete.length }, "Admin: deleted duplicate jobs");
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

  // 1. Buscar apps con el ID exacto que se pasa
  const byUserId = await GeneratedApp.find({ userId: id }).select("_id title userId createdAt").lean();

  // 2. Buscar jobs del usuario y sus appIds
  const jobs = await GenerationJob
    .find({ userId: id }).sort({ createdAt: -1 }).limit(20).select("appId editAppId status").lean();
  const jobAppIds = [...new Set([
    ...jobs.map((j: any) => j.appId),
    ...jobs.map((j: any) => j.editAppId),
  ].filter(Boolean).map(String))];

  // 3. Buscar las apps que referencian esos appIds
  const byJobAppIds = jobAppIds.length > 0
    ? await GeneratedApp.find({ _id: { $in: jobAppIds } }).select("_id title userId createdAt").lean()
    : [];

  // 4. Ver qué userId tienen esas apps (el dato clave para diagnosticar la discrepancia)
  const uniqueUserIdsInApps = [...new Set(byJobAppIds.map((a: any) => String(a.userId)))];

  // 5. Ver las últimas 5 apps creadas en toda la BD para comparar formato de userId
  const recentApps = await GeneratedApp.find({}).sort({ createdAt: -1 }).limit(5).select("_id title userId createdAt").lean();

  res.json({
    searchedId: id,
    userFoundInDB: !!user,
    userEmail: user?.email,
    // El resultado de buscar apps por el ID exacto que pasamos
    appsByExactId: byUserId.map((a: any) => ({ id: String(a._id), title: a.title, userId: a.userId })),
    // Jobs del usuario y los appIds que referencian
    jobCount: jobs.length,
    jobAppIds,
    // Las apps encontradas vía jobs
    appsByJobs: byJobAppIds.map((a: any) => ({ id: String(a._id), title: a.title, userId: a.userId })),
    // Los userIds reales guardados en esas apps (puede ser distinto del id que buscamos)
    userIdsActuallyInApps: uniqueUserIdsInApps,
    // ¿Coincide el ID que buscamos con el userId real guardado?
    idMatchesAppUserId: uniqueUserIdsInApps.includes(id),
    // Muestra de apps recientes para ver el formato de userId en la BD
    recentAppsInDB: recentApps.map((a: any) => ({ title: a.title, userId: String(a.userId), userId_length: String(a.userId).length })),
  });
});

// POST /api/admin/apps/patch-by-slug — parchear app por slug público

// POST /api/admin/apps/unblock-all — desbloquear TODAS las apps con
// pendingAdminApproval:true que llevan más de 10 min en ese estado.
// Endpoint de emergencia para limpiar apps que quedaron ocultas para el
// cliente por el bug de autoRepairAgent que no limpiaba pendingAdminApproval.
// FIX: ahora también crea UserNotification para cada cliente afectado.
router.post("/admin/apps/unblock-all", async (req: any, res: any): Promise<void> => {
  await connectDB();
  const cutoff = new Date(Date.now() - 10 * 60 * 1000);

  // Limpiar notificaciones support_patch duplicadas (mismo userId+appId en <24h)
  // antes de crear las nuevas — esto arregla las que ya están duplicadas
  try {
    const allDups = await UserNotification.aggregate([
      { $match: { type: "support_patch", createdAt: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } } },
      { $sort: { createdAt: 1 } },
      { $group: { _id: { userId: "$userId", appId: "$appId" }, ids: { $push: "$_id" }, count: { $sum: 1 } } },
      { $match: { count: { $gt: 1 } } },
    ]);
    for (const dup of allDups) {
      // Mantener solo la primera (la más antigua), borrar el resto
      const [, ...toDelete] = dup.ids;
      if (toDelete.length > 0) await UserNotification.deleteMany({ _id: { $in: toDelete } });
    }
    if (allDups.length > 0) logger.info({ cleaned: allDups.length }, "Admin: notificaciones duplicadas limpiadas");
  } catch (dupErr) {
    logger.warn({ dupErr }, "unblock-all: error limpiando duplicados");
  } // 10 minutos atrás

  // Obtener las apps afectadas ANTES de actualizar para poder notificar a cada cliente
  const appsToUnblock = await GeneratedApp.find(
    { pendingAdminApproval: true, pendingApprovalSince: { $lt: cutoff } },
    { _id: 1, userId: 1, title: 1 },
  ).lean() as any[];

  const result = await GeneratedApp.updateMany(
    { pendingAdminApproval: true, pendingApprovalSince: { $lt: cutoff } },
    { $set: { pendingAdminApproval: false } },
  );

  // Notificar a cada cliente cuya app fue desbloqueada
  if (appsToUnblock.length > 0) {
    const notifications = appsToUnblock
      .filter((app: any) => app.userId)
      .map((app: any) => ({
        userId: app.userId,
        appId: String(app._id),
        appTitle: app.title || "Tu app",
        type: "support_patch",
        message: `✅ Tu app **${app.title || "Tu app"}** ha sido revisada y actualizada por el equipo de soporte. Ya puedes verla y continuar editándola desde tu panel. 💜`,
        read: false,
      }));
    try {
      if (notifications.length > 0) {
        // Deduplicar: no crear notificación si ya existe una igual en las últimas 24h
        const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
        const filtered = [];
        for (const n of notifications) {
          const exists = await UserNotification.exists({
            userId: n.userId,
            appId: n.appId,
            type: "support_patch",
            createdAt: { $gte: since },
          });
          if (!exists) filtered.push(n);
        }
        if (filtered.length > 0) await UserNotification.insertMany(filtered);
      }
    } catch (notifErr) {
      logger.warn({ notifErr }, "unblock-all: error al crear notificaciones masivas");
    }
  }

  logger.info({ modified: result.modifiedCount }, "Admin: apps desbloqueadas masivamente");
  res.json({ ok: true, unblocked: result.modifiedCount, message: `${result.modifiedCount} app(s) desbloqueadas y visibles de nuevo para sus clientes.` });
});

// POST /api/admin/apps/:id/unblock — desbloquear una app específica
router.post("/admin/apps/:id/unblock", async (req: any, res: any): Promise<void> => {
  await connectDB();
  const app = await GeneratedApp.findByIdAndUpdate(
    req.params.id,
    { $set: { pendingAdminApproval: false } },
    { new: true },
  ).lean() as any;
  if (!app) { res.status(404).json({ error: "App no encontrada" }); return; }

  const appTitle = (app as any).title || "Tu app";
  if ((app as any).userId) {
    try {
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const alreadyNotified = await UserNotification.exists({
        userId: (app as any).userId,
        appId: req.params.id,
        type: "support_patch",
        createdAt: { $gte: since },
      });
      if (!alreadyNotified) {
        // Notificación principal: la app está lista y visible
        await UserNotification.create({
          userId: (app as any).userId,
          appId: req.params.id,
          appTitle,
          type: "support_patch",
          message: `✅ Tu app **${appTitle}** ya está lista y visible en tu panel. Nuestro equipo la ha construido para ti. Ábrela, pruébala y dinos si quieres personalizar algo más. 💜`,
          read: false,
        });
        // Segunda notificación: invitar a personalizar/expandir la app
        // Esto incentiva al cliente a entrar al chat de edición donde
        // podrá hacer sus propias preguntas y el agente le ayudará.
        await UserNotification.create({
          userId: (app as any).userId,
          appId: req.params.id,
          appTitle,
          type: "app_ready",
          message: `🚀 ¿Quieres añadir algo a **${appTitle}**? Puedes pedirle al agente que añada nuevas funciones, cambie el diseño, integre pagos o cualquier cosa que necesites. Solo escríbelo en el chat de edición de tu app.`,
          read: false,
        });
      }
    } catch (notifErr) {
      logger.warn({ notifErr, appId: req.params.id }, "unblock: error creando notificaciones al cliente");
    }
  }

  logger.info({ appId: req.params.id, appTitle }, "Admin: app desbloqueada — cliente notificado");
  res.json({ ok: true, appId: req.params.id, appTitle, message: "App visible para el cliente. Se le ha notificado para que la revise y personalice." });
});

// POST /api/admin/apps/:id/reassign-user — reasignar el userId de una app
// al usuario correcto cuando hay discrepancia en la BD
router.post("/admin/apps/:id/reassign-user", async (req: any, res: any): Promise<void> => {
  await connectDB();
  const { targetUserId } = req.body ?? {};
  if (!targetUserId) { res.status(400).json({ error: "targetUserId requerido" }); return; }
  const user = await User.findById(targetUserId).lean() as any;
  if (!user) { res.status(404).json({ error: "Usuario no encontrado" }); return; }
  const app = await GeneratedApp.findById(req.params.id).lean() as any;
  if (!app) { res.status(404).json({ error: "App no encontrada" }); return; }
  const oldUserId = app.userId;
  await GeneratedApp.findByIdAndUpdate(req.params.id, { $set: { userId: targetUserId } });
  logger.info({ appId: req.params.id, oldUserId, newUserId: targetUserId }, "Admin: app userId reasignado");
  res.json({ ok: true, appId: req.params.id, oldUserId, newUserId: targetUserId, appTitle: app.title });
});

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
    coderModel: "zoco-plus",
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

// A petición explícita del usuario: "desplegable con clichés ya añadidos"
// para enviar correos a clientes de forma rápida desde el panel de admin.
// El frontend tiene las plantillas predefinidas (bienvenida, disculpas,
// app lista, incidencia resuelta, etc.) con el texto ya escrito y
// editable; este endpoint solo envía lo que el admin confirme tras
// revisar/editar el texto. No requiere un GenerationJob concreto — el
// admin puede enviarlo directamente desde la ficha de un usuario.
router.post("/admin/users/:id/send-email", async (req: any, res: any): Promise<void> => {
  await connectDB();
  const { subject, body, creditsCompensation, recipientEmail } = req.body ?? {};
  if (!subject || !body) {
    res.status(400).json({ error: "subject y body son requeridos" }); return;
  }
  const dbUser = await User.findById(req.params.id).lean() as any;
  const userEmail = recipientEmail || dbUser?.email;
  if (!userEmail) { res.status(400).json({ error: "Usuario sin email" }); return; }

  const { sendCustomAdminEmail } = await import("../lib/notify");
  const sent = await sendCustomAdminEmail({
    userEmail,
    userName: dbUser?.fullName,
    subject,
    body,
    creditsCompensation: typeof creditsCompensation === "number" ? creditsCompensation : 0,
  });

  logger.info({ userId: req.params.id, userEmail, sent, subject }, "Admin: sent custom templated email");

  if (!sent) {
    res.status(500).json({
      error: "No se pudo enviar el correo. Comprueba que RESEND_API_KEY está configurada en Coolify y que el dominio marisai.es está verificado en Resend.",
      userEmail,
    });
    return;
  }

  res.json({ ok: true, userEmail, message: `Correo enviado a ${userEmail} ✅` });
});

// ── POST /api/admin/broadcast — campaña masiva a todos los clientes ────────────
// Envía el mismo email a TODOS los usuarios con al menos 1 job generado.
// Respeta rate limits de Resend (600ms entre envíos).
// Excluye: admins, cuentas de demo/test, usuarios sin email.
router.post("/admin/broadcast", async (req: any, res: any): Promise<void> => {
  await connectDB();
  const dbUser = await User.findById(req.dbUser?._id).lean() as any;
  const { isAdminEmail } = await import("../lib/auth");
  if (!isAdminEmail(dbUser?.email)) { res.status(403).json({ error: "Forbidden" }); return; }

  const { subject, body, creditsCompensation = 0 } = req.body ?? {};
  if (!subject?.trim() || !body?.trim()) {
    res.status(400).json({ error: "subject y body son requeridos" }); return;
  }

  // Buscar todos los usuarios que han generado al menos 1 job
  const { GenerationJob } = await import("@workspace/db/schema");
  const activeUserIds = await GenerationJob.distinct("userId");
  const users = await User.find({
    _id: { $in: activeUserIds },
    email: { $exists: true, $ne: "", $not: /demo|test|noreply|no-reply/i },
    broadcastUnsubscribed: { $ne: true },
  }).select("_id email fullName").lean() as any[];

  logger.info({ total: users.length, subject }, "Admin: iniciando campaña masiva");

  // Responder inmediatamente — el envío ocurre en background
  res.json({ ok: true, total: users.length, message: `Campaña iniciada: ${users.length} destinatarios. Los emails se envían en background (aprox. ${Math.ceil(users.length * 0.6 / 60)} min).` });

  // Enviar en background respetando rate limits
  void (async () => {
    const { sendCustomAdminEmail } = await import("../lib/notify");
    let sent = 0; let failed = 0;
    for (const user of users) {
      try {
        const ok = await sendCustomAdminEmail({
          userEmail: user.email,
          userName: user.fullName,
          subject,
          body,
          creditsCompensation,
        });
        if (ok) {
          sent++;
          if (creditsCompensation > 0) {
            await User.findByIdAndUpdate(user._id, { $inc: { credits: creditsCompensation } });
          }
        } else {
          failed++;
        }
      } catch { failed++; }
      // Resend permite ~2 emails/seg → 600ms entre envíos para ir seguros
      await new Promise((r) => setTimeout(r, 600));
    }
    logger.info({ sent, failed, total: users.length, subject }, "Admin: campaña masiva completada");
  })();
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

  // Guardia de seguridad: este endpoint es para REPARAR un job ya terminado
  // (failed/reviewing). Si el frontend muestra el botón antes de que el
  // panel se haya refrescado (ventana de carrera tras recargar la página,
  // dado el polling de 3s), rechazamos aquí para no crear una condición de
  // carrera sobre un job que sigue trabajando activamente.
  if (failedJob.status === "running" || failedJob.status === "queued" || failedJob.status === "repairing") {
    res.status(409).json({
      error: `Este job sigue en estado "${failedJob.status}" — todavía no ha terminado ni fallado. Espera a que termine o falle antes de repararlo. Si la página no se ha actualizado, refréscala.`,
    });
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

  // 3. App existente — reparar EN SITIO, sobre el mismo job y la misma app.
  // IMPORTANTE: ya NO se crea un GenerationJob nuevo. El job fallido original
  // (failedJob._id) se actualiza in-situ a status "repairing", y al terminar
  // pasa a "repaired-pending-review" — un estado intermedio que el panel de
  // Monitorización sigue mostrando (no se mueve solo a "Apps de clientes")
  // hasta que el admin lo apruebe explícitamente con otra acción.
  if (baseAppId) {
    const existingApp = await GeneratedApp.findById(baseAppId).lean() as any;
    if (existingApp?.frontendCode && existingApp.frontendCode.length > 500) {
      await GenerationJob.findByIdAndUpdate(failedJob._id, {
        $set: { status: "repairing", phase: "repairing", progress: failedJob.progress || 70, appId: String(baseAppId) },
      });
      // Marcar la app como pendiente de revisión del admin — queda oculta
      // para el cliente (GET /api/apps la excluye) hasta aprobación manual.
      await GeneratedApp.findByIdAndUpdate(baseAppId, {
        $set: { pendingAdminApproval: true, pendingApprovalSince: new Date() },
      });
      // Responder ya — la reparación sigue en background y el panel verá el
      // progreso vía polling del propio job (mismo id, sin ventana nueva).
      res.status(200).json({
        ok: true,
        jobId: String(failedJob._id),
        appId: String(baseAppId),
        strategy: "repair-in-place",
        message: "Reparando la app existente en el mismo job — sin crear una generación nueva.",
      });
      const recoverPrompt = `[ADMIN RECOVERY] Continúa y completa esta app que quedó incompleta. Revisa el código existente, identifica qué falta (páginas sin implementar, componentes vacíos, imports rotos) y completa TODO lo que falta para que sea completamente funcional. NO rehagas lo que ya funciona. Prompt original: ${cleanPrompt.slice(0, 300)}`;
      void autoRepairBundle({
        appId: String(baseAppId),
        userId: failedJob.userId,
        trigger: "manual",
        errorSummary: recoverPrompt,
        maxCycles: 6, // flujo de soporte humano: más margen que el modo automático estándar
        jobId: String(failedJob._id),
        log: logger.child({ module: "admin-recover", jobId: String(failedJob._id) }),
      }).then(async (success) => {
        await GenerationJob.findByIdAndUpdate(failedJob._id, {
          $set: success
            ? { status: "repaired-pending-review", phase: "done", progress: 100, errorMessage: null }
            : { status: "failed", phase: "done", errorMessage: "La reparación automática no produjo cambios válidos. Revisa manualmente o usa Regenerar desde 0." },
        });
      }).catch(async (err) => {
        logger.error({ err, jobId: String(failedJob._id) }, "admin-recover: repair-in-place falló");
        await GenerationJob.findByIdAndUpdate(failedJob._id, {
          $set: { status: "failed", phase: "done", errorMessage: String(err?.message || err).slice(0, 500) },
        });
      });
      return;
    }
  }

  // 4. Código parcial sin app creada todavía — crear la app UNA VEZ (necesario,
  // no existía antes) pero seguir reparando sobre el MISMO job fallido, no uno nuevo.
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
        pendingAdminApproval: true, pendingApprovalSince: new Date(),
      });
      await GenerationJob.findByIdAndUpdate(failedJob._id, {
        $set: { appId: String(recoveredApp._id), status: "repairing", phase: "repairing", progress: failedJob.progress || 70 },
      });
      res.status(200).json({
        ok: true,
        jobId: String(failedJob._id),
        appId: String(recoveredApp._id),
        strategy: "repair-in-place",
        message: `App creada desde ${Math.round(partialCode.length / 1000)} KB de código parcial. Completando lo que falta en el mismo job, sin generación nueva.`,
      });
      const recoverPrompt = `[ADMIN RECOVERY] Completa esta app que quedó incompleta por un timeout. Tienes ${Math.round(partialCode.length / 1000)}KB de código como base. Completa todo lo que falta sin rehacer lo que ya funciona. Prompt original: ${cleanPrompt.slice(0, 300)}`;
      void autoRepairBundle({
        appId: String(recoveredApp._id),
        userId: failedJob.userId,
        trigger: "manual",
        errorSummary: recoverPrompt,
        maxCycles: 6, // flujo de soporte humano: más margen que el modo automático estándar
        jobId: String(failedJob._id),
        log: logger.child({ module: "admin-recover", jobId: String(failedJob._id) }),
      }).then(async (success) => {
        await GenerationJob.findByIdAndUpdate(failedJob._id, {
          $set: success
            ? { status: "repaired-pending-review", phase: "done", progress: 100, errorMessage: null }
            : { status: "failed", phase: "done", errorMessage: "La reparación automática no produjo cambios válidos. Revisa manualmente o usa Regenerar desde 0." },
        });
      }).catch(async (err) => {
        logger.error({ err, jobId: String(failedJob._id) }, "admin-recover: repair-in-place falló");
        await GenerationJob.findByIdAndUpdate(failedJob._id, {
          $set: { status: "failed", phase: "done", errorMessage: String(err?.message || err).slice(0, 500) },
        });
      });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : "Error creando app de recuperación" });
    }
    return;
  }

  // 5. Sin código parcial — aquí SÍ es inevitable lanzar una generación nueva
  // (no hay nada que reparar, hay que crear desde cero). Esto es honesto: si
  // no hay código previo, "continuar donde se quedó" no es posible porque no
  // hay un "donde" real. Se mantiene como única excepción documentada.
  logger.warn({ jobId: req.params.id }, "Admin recovery: no partial code found, generating fresh with full Sonnet");
  try {
    const newJobId = new mongoose.Types.ObjectId().toString();
    await GenerationJob.create({
      _id: newJobId, userId: failedJob.userId,
      prompt: failedJob.prompt || `[MARIS AI REQUEST LOCALE] uiLanguage=es; locale=es-ES; country=ES; source=admin-recovery. ${cleanPrompt}`,
      coderModel: "zoco-plus",
      language: failedJob.language || "typescript",
      kind: failedJob.kind || "fullstack",
      status: "queued", phase: "queued", progress: 0, isAdmin: true, hasEverPaid: true,
    });
    await enqueueGenerateJob(newJobId);
    res.status(201).json({ ok: true, jobId: newJobId, strategy: "fresh-generation", message: "Este job se quedó sin generar ningún código todavía (falló durante la planificación) — no hay nada que reparar in-situ, así que se ha lanzado una generación nueva desde el prompt original. El cliente verá el progreso." });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Error lanzando generación de recuperación" });
  }
});

// POST /api/admin/jobs/:id/approve-for-client
// El admin revisa la app reparada (vista previa) y, si está satisfecho,
// la aprueba explícitamente para que el cliente vuelva a verla. Hasta este
// punto, GET /api/apps (cliente) la mantiene oculta vía pendingAdminApproval.
// FIX: ahora también crea una UserNotification para que el cliente vea el
// banner de actualización inmediatamente en su dashboard (polling 5s).
// POST /api/admin/jobs/:id/skip-gating — fuerza la reanudación de un job
// pausado en awaiting_technical_clarification, saltando las preguntas.
// Útil cuando el admin generó la app pero el job quedó atascado en gating
// porque fue creado antes de que existiera el campo skipGating.
router.post("/admin/jobs/:id/skip-gating", async (req: any, res: any): Promise<void> => {
  await connectDB();
  const job = await GenerationJob.findById(req.params.id).lean() as any;
  if (!job) { res.status(404).json({ error: "Job no encontrado" }); return; }
  if (job.status !== "awaiting_approval" && job.phase !== "awaiting_technical_clarification") {
    res.status(400).json({ error: `El job no está en awaiting_technical_clarification (estado: ${job.status}/${job.phase})` });
    return;
  }

  // Marcar el gating como ya aprobado + skipGating para que no vuelva a pausar
  await GenerationJob.findByIdAndUpdate(req.params.id, {
    $set: {
      status: "queued",
      phase: "queued",
      awaitingApproval: false,
      skipGating: true,
      isAdmin: true,
      updatedAt: new Date(),
    },
    $addToSet: { approvedFacets: "technical_architecture" },
  });

  // Re-encolar el job para que continue desde donde estaba
  const { enqueueGenerateJob } = await import("../lib/jobQueue");
  const { runJobById } = await import("./apps");
  await enqueueGenerateJob(req.params.id);
  runJobById(req.params.id).catch((err: any) =>
    logger.error({ err, jobId: req.params.id }, "skip-gating: error al re-ejecutar job"),
  );

  logger.info({ jobId: req.params.id }, "Admin: skip-gating aplicado — job reanudado");
  res.json({ ok: true, message: "Gating saltado — el job continuará la generación sin preguntas al cliente." });
});

router.post("/admin/jobs/:id/approve-for-client", async (req: any, res: any): Promise<void> => {
  await connectDB();
  const job = await GenerationJob.findById(req.params.id).lean() as any;
  if (!job) {
    res.status(404).json({ error: `Job ${req.params.id} no encontrado.` });
    return;
  }
  if (!job.appId) {
    res.status(400).json({ error: "Este job no tiene una app asociada para aprobar." });
    return;
  }
  const app = await GeneratedApp.findByIdAndUpdate(
    job.appId,
    { $set: { pendingAdminApproval: false, approvedByAdminAt: new Date() } },
    { new: true },
  ).lean() as any;
  if (!app) {
    res.status(404).json({ error: `App ${job.appId} no encontrada.` });
    return;
  }
  await GenerationJob.findByIdAndUpdate(job._id, { $set: { status: "done", phase: "done" } });

  // ── Notificar al cliente: su app ya está lista y visible ──────────────────
  // Esto hace que el banner de actualización aparezca inmediatamente en el
  // dashboard del cliente (el polling de notificaciones es cada 5s tras el fix).
  const appTitle = (app as any).title || "Tu app";
  try {
    await UserNotification.create({
      userId: job.userId,
      appId: String(job.appId),
      appTitle,
      type: "support_patch",
      message: `✅ Tu app **${appTitle}** ha sido revisada y actualizada por el equipo de soporte. Ya puedes verla y continuar editándola desde tu panel. 💜`,
      read: false,
    });
    logger.info({ jobId: String(job._id), appId: String(job.appId), userId: job.userId }, "Admin approved app — notification sent to client");
  } catch (notifErr) {
    logger.warn({ notifErr, jobId: String(job._id) }, "approve-for-client: no se pudo crear la notificación al cliente");
  }

  logger.info({ jobId: String(job._id), appId: String(job.appId) }, "Admin approved app for client");
  res.json({ ok: true, appId: String(job.appId), appTitle, message: "App aprobada — ya es visible para el cliente." });
});

// GET /api/admin/apps/:appId/revisions
// Lista las revisiones guardadas de una app (snapshotCurrentApp ya las crea
// automáticamente antes de cada edición desde hoy — antes existían la
// colección y las funciones pero ningún endpoint las exponía).
router.get("/admin/apps/:appId/revisions", async (req: any, res: any): Promise<void> => {
  await connectDB();
  const { appId } = req.params;
  const app = await GeneratedApp.findById(appId, { _id: 1 }).lean();
  if (!app) {
    res.status(404).json({ error: `App ${appId} no encontrada.` });
    return;
  }
  const revisions = await AppRevision.find(
    { appId },
    { frontendCode: 0, backendCode: 0 }, // no mandamos el código completo en el listado, solo metadatos
  ).sort({ createdAt: -1 }).limit(30).lean() as any[];
  res.json({
    ok: true,
    revisions: revisions.map((r) => ({
      id: String(r._id),
      source: r.source,
      summary: r.summary,
      jobId: r.jobId ? String(r.jobId) : null,
      createdAt: r.createdAt,
    })),
  });
});

// POST /api/admin/apps/:appId/revisions/:revisionId/restore
// Restaura una app a una revisión anterior — para cuando una edición pasó
// todas las validaciones automáticas (compila bien) pero rompió algo que el
// admin/cliente detecta visualmente y que ninguna validación de sintaxis
// puede capturar.
router.post("/admin/apps/:appId/revisions/:revisionId/restore", async (req: any, res: any): Promise<void> => {
  await connectDB();
  const { appId, revisionId } = req.params;
  const app = await GeneratedApp.findById(appId, { userId: 1, title: 1 }).lean() as any;
  if (!app) {
    res.status(404).json({ error: `App ${appId} no encontrada.` });
    return;
  }
  const result = await restoreAppRevision({ appId, revisionId, userId: String(app.userId) });
  if (!result.ok) {
    const messages: Record<string, string> = {
      not_found: "Esa revisión no existe o no pertenece a esta app.",
      forbidden: "No se pudo verificar la propiedad de esta app.",
      job_in_flight: "Hay un job en curso para esta app — espera a que termine antes de restaurar.",
    };
    res.status(409).json({ error: messages[result.reason] || "No se pudo restaurar la revisión." });
    return;
  }
  logger.info({ appId, revisionId }, "Admin restored app revision");
  res.json({ ok: true, message: `"${app.title}" restaurada a la revisión seleccionada.` });
});

// POST /api/admin/jobs/:id/continue
// Para el caso real distinto de "reparar algo roto": un job que se detuvo
// EN UN PUNTO VÁLIDO esperando confirmación del admin (ej. "Frontend
// terminado. El backend se ha pausado para tu revisión. Si te gusta el
// diseño, dime 'Continúa con el backend'"). No hay nada que arreglar — el
// pipeline simplemente está esperando la palabra exacta que activa la
// siguiente fase (ver runBackend en apps.ts: busca "backend"/"servidor"/
// "base de datos" en el prompt). autoRepairBundle (usado por /recover) no
// sirve aquí porque parchea un bundle YA completo — esto necesita el
// pipeline de generación completo en modo edición para construir el backend
// que nunca se generó.
router.post("/admin/jobs/:id/continue", async (req: any, res: any): Promise<void> => {
  await connectDB();
  const sourceJob = await GenerationJob.findById(req.params.id).lean() as any;
  if (!sourceJob) {
    res.status(404).json({ error: `Job ${req.params.id} no encontrado.` });
    return;
  }
  if (sourceJob.status === "running" || sourceJob.status === "queued" || sourceJob.status === "repairing") {
    res.status(409).json({ error: `Este job sigue en estado "${sourceJob.status}" — espera a que termine antes de continuarlo.` });
    return;
  }
  const baseAppId = sourceJob.appId || sourceJob.editAppId;
  if (!baseAppId) {
    res.status(400).json({ error: "Este job no tiene una app asociada sobre la que continuar." });
    return;
  }
  const continueInstruction = String(req.body?.instruction || "Continúa con el backend").trim();

  const trackingJobId = new mongoose.Types.ObjectId().toString();
  const generationPrompt = `[MARIS AI REQUEST LOCALE] uiLanguage=es; locale=es-ES; country=ES; source=admin-continue. ${continueInstruction}`;
  await GenerationJob.create({
    _id: trackingJobId,
    userId: sourceJob.userId,
    prompt: generationPrompt,
    editAppId: String(baseAppId),
    appId: String(baseAppId),
    kind: "edit",
    coderModel: "zoco-plus",
    language: sourceJob.language || "typescript",
    status: "queued",
    phase: "queued",
    progress: 0,
    isAdmin: true,
    hasEverPaid: true,
  });
  await GeneratedApp.findByIdAndUpdate(baseAppId, {
    $set: { pendingAdminApproval: true, pendingApprovalSince: new Date() },
  });
  await enqueueGenerateJob(trackingJobId);
  logger.info({ trackingJobId, sourceJobId: String(sourceJob._id), baseAppId }, "Admin continued paused job");
  res.status(201).json({
    ok: true,
    jobId: trackingJobId,
    appId: String(baseAppId),
    message: `Continuando: "${continueInstruction}" — sobre la app existente, sin perder el frontend ya generado.`,
  });
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
      coderModel: "zoco-plus",
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

  // También buscar en GeneratedApp directamente — ÚLTIMO RECURSO, solo si no
  // hay ninguna pista más específica (ni el propio job, ni jobs relacionados
  // con appId/código parcial). Mismo riesgo que se corrigió en el endpoint
  // de "Aplicar reparación": para un usuario con varias apps, elegir "la más
  // reciente" sin más contexto puede acertar la app equivocada. Como aquí no
  // hay ningún ID explícito posible (recover-by-email solo recibe un email,
  // no un appId), al menos registramos si había ambigüedad real para poder
  // detectarlo en logs si vuelve a pasar.
  if (!baseAppId) {
    const candidateApps = await GeneratedApp.find({ userId: failedJob.userId }, { _id: 1, title: 1 }).sort({ createdAt: -1 }).limit(5).lean() as any[];
    if (candidateApps.length > 1) {
      logger.warn({ userId: failedJob.userId, candidateCount: candidateApps.length, chosen: candidateApps[0]?.title }, "recover-by-email: usuario con múltiples apps, eligiendo la más reciente como último recurso — riesgo de ambigüedad");
    }
    if (candidateApps[0]?._id) baseAppId = String(candidateApps[0]._id);
  }

  if (baseAppId) {
    const existingApp = await GeneratedApp.findById(baseAppId).lean() as any;
    if (existingApp?.frontendCode && existingApp.frontendCode.length > 500) {
      const recoverPrompt = `[ADMIN RECOVERY] Continúa y completa esta app que quedó incompleta. Revisa el código existente, identifica qué falta y completa TODO para que sea funcional. NO rehagas lo que ya funciona. Prompt original: ${cleanPrompt.slice(0, 300)}`;
      const newJobId = new mongoose.Types.ObjectId().toString();
      await GenerationJob.create({
        _id: newJobId, userId: failedJob.userId,
        prompt: `[MARIS AI REQUEST LOCALE] uiLanguage=es; locale=es-ES; country=ES; source=admin-recovery. ${recoverPrompt}`,
        editAppId: String(baseAppId), coderModel: "zoco-plus",
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
    coderModel: "zoco-plus",
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
    coderModel: "zoco-plus",
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
  const explicitAppId = req.body?.appId ? String(req.body.appId) : null;
  const isRepair = rawPrompt.startsWith("[ADMIN REPAIR]") || rawPrompt.startsWith("[ADMIN RECOVERY]");
  const defaultPrompt = "Crea una landing page profesional moderna para un emprendedor en España. Hero con titular impactante y CTA, sección de 3 beneficios con iconos, cómo funciona en 3 pasos, FAQ con 3 preguntas y footer. Diseño limpio en español. Sin backend.";
  const prompt = rawPrompt || defaultPrompt;

  const user = await User.findById(targetId, { email: 1 }).lean();
  if (!user) {
    res.status(404).json({ error: "Usuario no encontrado" });
    return;
  }

  try {
    // Si es una instrucción de reparación (botón "Aplicar" / chips del panel de
    // soporte), reparamos EN SITIO con autoRepairBundle — mismo flujo que
    // /recover. Antes esto creaba un GenerationJob nuevo con kind:'edit'
    // (pipeline COMPLETO de generación vía enqueueGenerateJob), lo cual podía
    // tardar minutos, pasar por fastPatchEdit/callModel (con el riesgo de
    // colgarse que arreglamos hoy), y no estaba realmente dirigido a aplicar
    // solo la instrucción puntual.
    //
    // BUG CRÍTICO encontrado en producción y corregido aquí: cuando el admin
    // no especificaba qué app exactamente, el código elegía "la más reciente
    // del usuario" (sort updatedAt:-1) — para CUALQUIER cliente (nuevo o
    // veterano) con más de una app generada, esto podía elegir una app
    // completamente distinta a la que el admin tenía abierta en pantalla,
    // aplicando la reparación sobre el proyecto equivocado sin ningún aviso.
    // Ahora: si el frontend manda appId explícito (la tarjeta exacta donde
    // se pulsó el botón), SIEMPRE se usa esa — "la más reciente" queda solo
    // como fallback para llamadas antiguas que aún no manden el ID.
    if (isRepair) {
      const latestApp = explicitAppId
        ? await GeneratedApp.findOne(
            { _id: explicitAppId, userId: targetId },
            { _id: 1, title: 1, frontendCode: 1 },
          ).lean() as any
        : await GeneratedApp.findOne(
            { userId: targetId },
            { _id: 1, title: 1, frontendCode: 1 }
          ).sort({ updatedAt: -1 }).lean() as any;

      if (explicitAppId && !latestApp) {
        res.status(404).json({ error: `La app ${explicitAppId} no existe o no pertenece a este usuario.` });
        return;
      }
      if (!latestApp?._id || !latestApp.frontendCode || latestApp.frontendCode.length < 500) {
        res.status(400).json({ error: "Este usuario no tiene una app existente con código suficiente para reparar en sitio. Usa 'Regenerar desde 0' en su lugar." });
        return;
      }

      const repairInstruction = rawPrompt.replace(/^\[ADMIN (REPAIR|RECOVERY)\]\s*/, "").trim();

      // Job ligero de seguimiento — NO dispara enqueueGenerateJob (no pasa por
      // el pipeline completo de generación), solo da visibilidad en el panel
      // de Monitorización mientras autoRepairBundle trabaja en background.
      const trackingJobId = new mongoose.Types.ObjectId().toString();
      await GenerationJob.create({
        _id: trackingJobId,
        userId: targetId,
        prompt: rawPrompt,
        appId: String(latestApp._id),
        kind: "edit",
        coderModel: "zoco-plus",
        language: "typescript",
        status: "repairing",
        phase: "repairing",
        progress: 70,
        isAdmin: true,
        hasEverPaid: true,
      });

      res.status(200).json({
        ok: true,
        jobId: trackingJobId,
        appId: String(latestApp._id),
        strategy: "repair-in-place",
        message: `Aplicando "${repairInstruction.slice(0, 60)}${repairInstruction.length > 60 ? "…" : ""}" sobre "${latestApp.title}" — sin crear una generación nueva.`,
      });
      await GeneratedApp.findByIdAndUpdate(latestApp._id, {
        $set: { pendingAdminApproval: true, pendingApprovalSince: new Date() },
      });
      void autoRepairBundle({
        appId: String(latestApp._id),
        userId: targetId,
        trigger: "manual",
        errorSummary: repairInstruction,
        maxCycles: 6,
        jobId: trackingJobId,
        log: logger.child({ module: "admin-inject-repair", appId: String(latestApp._id) }),
      }).then(async (success) => {
        await GenerationJob.findByIdAndUpdate(trackingJobId, {
          $set: success
            ? { status: "repaired-pending-review", phase: "done", progress: 100 }
            : { status: "failed", phase: "done", errorMessage: "La reparación automática no produjo cambios válidos sobre la instrucción indicada." },
        });
      }).catch(async (err) => {
        logger.error({ err, appId: String(latestApp._id) }, "admin-inject-repair: autoRepairBundle falló");
        await GenerationJob.findByIdAndUpdate(trackingJobId, {
          $set: { status: "failed", phase: "done", errorMessage: String(err?.message || err).slice(0, 500) },
        });
      });
      return;
    }

    const jobId = new mongoose.Types.ObjectId().toString();
    const generationPrompt = `[MARIS AI REQUEST LOCALE] uiLanguage=es; locale=es-ES; country=ES; source=admin-inject. ${prompt}`;

    // forceBasicGeneration: fuerza scope-cut de 7 hitos aunque hasEverPaid=true.
    // Útil para recuperar clientes free con apps fallidas.
    const forceBasicGeneration = req.body?.forceBasicGeneration === true;

    await GenerationJob.create({
      _id: jobId,
      userId: targetId,
      prompt: generationPrompt,
      kind: "fullstack",
      coderModel: "zoco-plus",
      language: "typescript",
      status: "queued",
      phase: "queued",
      progress: 0,
      isAdmin: true,
      hasEverPaid: true, // admin siempre true — forceBasicGeneration controla el scope-cut por separado
      skipGating: true,
      forceBasicGeneration,
    });

    await enqueueGenerateJob(jobId);
    logger.info({ jobId, targetId, email: (user as any).email }, "Admin generate-app for user");

    res.status(201).json({ ok: true, jobId, message: `Nueva app en cola para ${(user as any).email}. Estará lista en breve.` });
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
      coderModel: "zoco-plus",
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

// ─── Admin Security Endpoints ─────────────────────────────────────────────────
import { getSecurityStats, unblockIP, blockIP } from "../middlewares/security";

// GET /api/admin/security — estadísticas de seguridad en tiempo real
router.get("/admin/security", requireAdmin, async (_req, res) => {
  try {
    const stats = getSecurityStats();
    res.json({
      ok: true,
      ...stats,
      timestamp: new Date().toISOString(),
    });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/admin/security/block — bloquear IP manualmente
router.post("/admin/security/block", requireAdmin, async (req, res) => {
  const { ip } = req.body;
  if (!ip) return res.status(400).json({ error: "IP requerida" });
  blockIP(ip);
  logger.warn({ ip }, "[SECURITY] IP bloqueada manualmente por admin");
  return res.json({ ok: true, message: `IP ${ip} bloqueada.` });
});

// POST /api/admin/security/unblock — desbloquear IP
router.post("/admin/security/unblock", requireAdmin, async (req, res) => {
  const { ip } = req.body;
  if (!ip) return res.status(400).json({ error: "IP requerida" });
  const removed = unblockIP(ip);
  return res.json({ ok: removed, message: removed ? `IP ${ip} desbloqueada.` : `IP ${ip} no estaba bloqueada.` });
});

// ═══════════════════════════════════════════════════════════════════════════
// VISTA REMOTA DEL DASHBOARD DEL CLIENTE (impersonación de solo lectura)
// Permite a soporte ver EXACTAMENTE lo que ve el cliente en su panel:
// stats, créditos, todas sus apps (incluidas las ocultas por revisión),
// notificaciones activas y estado de bloqueo. Sirve para hacer pruebas
// completas del dashboard de cada cliente sin salir del panel de admin.
// ═══════════════════════════════════════════════════════════════════════════

// GET /api/admin/users/:id/dashboard-view — snapshot completo del panel del cliente
// Query opcional: ?email=xxx para resolución robusta del usuario (misma lógica que /apps).
router.get("/admin/users/:id/dashboard-view", async (req: any, res: any): Promise<void> => {
  try {
    await connectDB();
    const rawId = req.params.id;
    const emailHint = (req.query.email as string || "").trim().toLowerCase();

    // Resolver el usuario de forma robusta: por _id directo o por email.
    let user = await User.findById(rawId).lean() as any;
    if (!user && emailHint) {
      user = await User.findOne({ email: emailHint }).lean() as any;
    }
    if (!user) { res.status(404).json({ error: "Usuario no encontrado" }); return; }

    const userId = String(user._id);

    // Conjunto de IDs candidatos (por si el email tiene varios registros históricos).
    const candidateIds = new Set<string>([userId, rawId]);
    if (emailHint) {
      const sameEmail = await User.find({ email: emailHint }).select("_id").lean() as any[];
      sameEmail.forEach((u: any) => candidateIds.add(String(u._id)));
    }
    const idList = [...candidateIds];

    // TODAS las apps del cliente (incluidas las pendientes de aprobación, para que
    // soporte pueda ver también las que están ocultas al cliente por revisión).
    const allApps = await GeneratedApp.find(
      { userId: { $in: idList } },
      { frontendCode: 0, backendCode: 0 },
    ).sort({ createdAt: -1 }).limit(50).lean() as any[];

    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const appsThisWeek = allApps.filter((a: any) => a.createdAt && new Date(a.createdAt) >= sevenDaysAgo).length;

    // Créditos gastados (suma real de transacciones de uso).
    const txns = await CreditTransaction.find({ userId: { $in: idList } }, { kind: 1, amount: 1 }).lean();
    let creditsSpentTotal = 0;
    for (const t of txns) if (t.kind === "usage") creditsSpentTotal += Math.abs(t.amount);

    // Notificaciones de soporte activas (no leídas) del cliente.
    const notifications = await UserNotification.find({ userId: { $in: idList } })
      .sort({ createdAt: -1 }).limit(20).lean() as any[];

    // Jobs / generaciones del cliente (incluidas las que están a medias: en curso,
    // pausadas, en revisión o fallidas y que aún NO se convirtieron en una app publicada).
    // Esto permite a soporte ver e interactuar en vivo con trabajos que no aparecen
    // como "apps generadas" porque nunca llegaron a completarse.
    const now = Date.now();
    const jobs = await GenerationJob.find({ userId: { $in: idList } })
      .sort({ createdAt: -1 }).limit(30).lean() as any[];

    // Conjunto de appIds que YA figuran como apps publicadas, para marcar los jobs
    // "huérfanos" (a medias) que no tienen su app visible en la lista de arriba.
    const publishedAppIds = new Set(allApps.map((a: any) => String(a._id)));

    res.json({
      user: {
        id: userId,
        email: user.email,
        fullName: user.fullName ?? null,
        imageUrl: user.imageUrl ?? null,
        marisId: (user as any).marisId ?? null,
        credits: user.credits ?? 0,
        isAdmin: isAdminEmail(user.email),
        isPremium: !!(user as any).isPremium,
        isSuspended: !!(user as any).isSuspended,
        isBanned: !!(user as any).isBanned,
        createdAt: user.createdAt ? new Date(user.createdAt).toISOString() : null,
      },
      stats: {
        credits: user.credits ?? 0,
        appsGenerated: allApps.length,
        appsThisWeek,
        creditsSpentTotal,
      },
      apps: allApps.map((a: any) => ({
        id: String(a._id),
        _id: String(a._id),
        title: a.title,
        description: a.description ?? "",
        prompt: a.prompt,
        status: a.status,
        kind: a.kind,
        techStack: a.techStack,
        // ¿la ve el cliente en su panel? (oculta si está pendiente de aprobación)
        pendingAdminApproval: !!a.pendingAdminApproval,
        visibleToClient: !a.pendingAdminApproval,
        pendingApprovalSince: a.pendingApprovalSince ? new Date(a.pendingApprovalSince).toISOString() : null,
        createdAt: a.createdAt ? new Date(a.createdAt).toISOString() : "",
        updatedAt: a.updatedAt ? new Date(a.updatedAt).toISOString() : "",
      })),
      notifications: notifications.map((n: any) => ({
        id: String(n._id),
        appId: n.appId ? String(n.appId) : null,
        appTitle: n.appTitle ?? null,
        type: n.type,
        message: n.message,
        read: !!n.read,
        createdAt: n.createdAt ? new Date(n.createdAt).toISOString() : "",
      })),
      // Generaciones/jobs del cliente. `hasPublishedApp` indica si el job ya produjo
      // una app visible; si es false y el job no está "succeeded", es un trabajo a medias
      // que soporte necesita ver para poder repararlo en vivo.
      jobs: jobs.map((r: any) => {
        const linkedAppId = r.appId || r.editAppId || null;
        return {
          id: String(r._id),
          appId: r.appId || null,
          editAppId: r.editAppId || null,
          linkedAppId: linkedAppId ? String(linkedAppId) : null,
          prompt: r.prompt,
          status: r.status,
          phase: r.phase ?? null,
          progress: r.progress ?? 0,
          coderModel: r.coderModel ?? null,
          language: r.language ?? null,
          retryCount: r.retryCount ?? 0,
          errorMessage: r.errorMessage ?? null,
          internalErrorMessage: r.internalErrorMessage ?? null,
          // ¿este job ya tiene una app publicada/visible en la lista de apps?
          hasPublishedApp: linkedAppId ? publishedAppIds.has(String(linkedAppId)) : false,
          // trabajo a medias = no terminado y sin app publicada visible
          isInProgress: r.status !== "succeeded" && r.status !== "failed",
          ageMs: r.updatedAt ? now - new Date(r.updatedAt).getTime() : null,
          createdAt: r.createdAt ? new Date(r.createdAt).toISOString() : "",
          updatedAt: r.updatedAt ? new Date(r.updatedAt).toISOString() : "",
        };
      }),
    });
  } catch (err: any) {
    logger.error({ err: err?.message, userId: req.params.id }, "admin/users/:id/dashboard-view error");
    res.status(500).json({ error: err?.message || "Error interno" });
  }
});

// ── FIX CREDITS FLOAT — migración puntual ────────────────────────────────────
// POST /api/admin/fix-credits-float
// Redondea a entero TODOS los saldos de créditos con decimales en BD.
// Ejecutar UNA sola vez desde el panel admin.
router.post("/admin/fix-credits-float", async (_req, res) => {
  await connectDB();
  try {
    const users = await User.find({}, { _id: 1, credits: 1, email: 1 }).lean() as any[];
    let fixed = 0;
    const fixedList: string[] = [];
    for (const u of users) {
      const rounded = Math.round(u.credits ?? 0);
      if (rounded !== u.credits) {
        await User.findByIdAndUpdate(u._id, { $set: { credits: rounded } });
        fixed++;
        fixedList.push(`${u.email}: ${u.credits} → ${rounded}`);
      }
    }
    res.json({ ok: true, usersChecked: users.length, usersFixed: fixed, fixedList });
  } catch (err: any) {
    res.status(500).json({ error: String(err) });
  }
});

// ─── Auditoría financiera — historial global de pagos y reembolsos ────────
// A petición explícita del usuario, tras no poder rastrear un cargo real
// de 20€ que nunca quedó registrado correctamente (ver hallazgos: 1.
// creditPurchase() nunca guardaba el importe en euros de ninguna compra,
// solo los créditos -- "Ingresos totales" mostraba 0€ siempre; 2. no
// existía forma de auditar ni reembolsar pagos desde el panel).
router.get("/admin/payments/all", async (req: any, res: any): Promise<void> => {
  await connectDB();
  try {
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 50));
    const search = (req.query.search as string || "").trim();

    const query: any = { kind: "purchase" };
    if (search) {
      const users = await User.find(
        { $or: [{ email: new RegExp(search, "i") }, { fullName: new RegExp(search, "i") }] },
        { _id: 1 },
      ).lean();
      const userIds = users.map((u) => String(u._id));
      query.userId = { $in: userIds.length > 0 ? userIds : ["__no_match__"] };
    }

    const [rows, total] = await Promise.all([
      CreditTransaction.find(query).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
      CreditTransaction.countDocuments(query),
    ]);

    const userIds = [...new Set(rows.map((r) => r.userId))];
    const users = await User.find({ _id: { $in: userIds } }, { email: 1, fullName: 1 }).lean();
    const userMap = new Map(users.map((u) => [String(u._id), u]));

    res.json({
      payments: rows.map((r: any) => ({
        id: r._id,
        userId: r.userId,
        userEmail: userMap.get(r.userId)?.email ?? null,
        userName: userMap.get(r.userId)?.fullName ?? null,
        credits: r.amount,
        priceCents: r.priceCents ?? null,
        gateway: r.gateway ?? "legacy",
        status: r.status ?? "succeeded",
        cardLast4: r.cardLast4 ?? null,
        cardBrand: r.cardBrand ?? null,
        vivaTransactionId: r.vivaTransactionId ?? null,
        stripeSessionId: r.stripeSessionId ?? null,
        description: r.description,
        createdAt: r.createdAt.toISOString(),
        refundedAt: r.refundedAt ? r.refundedAt.toISOString() : null,
        refundReason: r.refundReason ?? null,
      })),
      page,
      limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    });
  } catch (err: any) {
    logger.error({ err }, "GET /admin/payments/all failed");
    res.status(500).json({ error: String(err) });
  }
});

router.post("/admin/payments/refund", async (req: any, res: any): Promise<void> => {
  await connectDB();
  try {
    const { transactionId, reason } = req.body;
    if (!transactionId) {
      res.status(400).json({ error: "transactionId es obligatorio" });
      return;
    }

    const tx = await CreditTransaction.findById(transactionId);
    if (!tx) {
      res.status(404).json({ error: "Transacción no encontrada" });
      return;
    }
    if (tx.status === "refunded") {
      res.status(409).json({ error: "Esta transacción ya fue reembolsada anteriormente." });
      return;
    }
    if (tx.gateway !== "viva" || !tx.vivaTransactionId) {
      res.status(400).json({
        error: tx.gateway === "stripe"
          ? "Esta es una transacción legada de Stripe — usa POST /admin/users/:id/stripe-refund en su lugar."
          : "Esta transacción no tiene un vivaTransactionId real asociado (probablemente una compra antigua registrada antes de este sistema) — no se puede reembolsar automáticamente. Hazlo manualmente desde el panel de Viva.com y, si corresponde, resta los créditos a mano.",
      });
      return;
    }
    if (!tx.priceCents) {
      res.status(400).json({ error: "No se conoce el importe real cobrado (priceCents vacío) — no se puede reembolsar de forma segura sin esa cifra. Revisa el importe manualmente en el panel de Viva.com." });
      return;
    }

    const { refundTransaction } = await import("../lib/vivaPayments");
    const result = await refundTransaction({
      transactionId: tx.vivaTransactionId,
      amountCents: tx.priceCents,
    });

    if (!result.ok) {
      res.status(502).json({ error: `Viva.com rechazó el reembolso: ${result.error}` });
      return;
    }

    // Reembolso confirmado por Viva — actualizar nuestro registro y restar
    // los créditos correspondientes (si el usuario ya se los gastó, el
    // saldo puede quedar negativo -- es una señal legítima para soporte,
    // no se oculta ni se trunca a 0).
    tx.status = "refunded";
    tx.refundedAt = new Date();
    tx.refundedBy = req.userId;
    tx.refundReason = reason || "Reembolso manual desde el panel de administración";
    await tx.save();

    await User.findByIdAndUpdate(tx.userId, { $inc: { credits: -Math.abs(tx.amount) } });

    logger.info({ transactionId, adminId: req.userId, amountCents: tx.priceCents }, "Reembolso procesado desde el panel admin");
    res.json({ ok: true, refundedCredits: tx.amount, refundedCents: tx.priceCents });
  } catch (err: any) {
    logger.error({ err }, "POST /admin/payments/refund failed");
    res.status(500).json({ error: String(err) });
  }
});

// ─── Diagnóstico de frecuencia de errores — datos reales, no especulación ──
// A peticion explicita del usuario: antes de decidir si cambiar wouter por
// react-router-dom en toda la plataforma (o cualquier otra decision de
// fondo similar en el futuro), medir con datos reales cuantas veces un
// patron de error concreto ha ocurrido de verdad en produccion, en vez de
// decidir a ojo. Reutiliza AgentMemory, que ya guarda cada errorMessage
// real que el ciclo de reparacion ha visto y arreglado.
router.get("/admin/diagnostics/error-frequency", async (req: any, res: any): Promise<void> => {
  await connectDB();
  try {
    const query = String(req.query.query || "").trim();
    if (!query) {
      res.status(400).json({ error: "Falta el parámetro ?query= (texto a buscar dentro de errorMessage)" });
      return;
    }
    const matches = await AgentMemory.find(
      { errorMessage: new RegExp(query, "i") },
      { errorMessage: 1, language: 1, framework: 1, successCount: 1, createdAt: 1 },
    ).sort({ createdAt: -1 }).lean();

    const totalOccurrences = matches.length;
    const totalReuses = matches.reduce((sum, m: any) => sum + (m.successCount || 1), 0);
    const oldestSeen = matches.length > 0 ? matches[matches.length - 1].createdAt : null;
    const newestSeen = matches.length > 0 ? matches[0].createdAt : null;

    res.json({
      query,
      totalOccurrences,
      // totalReuses cuenta cada vez que el mismo parche se ha vuelto a
      // aplicar ante un error casi identico (successCount) -- da una idea
      // real de "cuantas veces le ha pasado esto de verdad a un cliente",
      // no solo cuantos parches distintos hay guardados.
      totalReuses,
      oldestSeen,
      newestSeen,
      samples: matches.slice(0, 20).map((m: any) => ({
        errorMessage: m.errorMessage.slice(0, 200),
        language: m.language,
        framework: m.framework,
        successCount: m.successCount,
        createdAt: m.createdAt,
      })),
    });
  } catch (err: any) {
    logger.error({ err }, "GET /admin/diagnostics/error-frequency failed");
    res.status(500).json({ error: String(err) });
  }
});

// ─── Project Playbooks — visibilidad de lo que el sistema ha aprendido ─────
router.get("/admin/playbooks", async (req: any, res: any): Promise<void> => {
  await connectDB();
  try {
    const { ProjectPlaybook } = await import("@workspace/db/schema");
    const playbooks = await ProjectPlaybook.find({})
      .sort({ createdAt: -1 })
      .limit(100)
      .lean();
    res.json({
      total: playbooks.length,
      byVertical: playbooks.reduce((acc: Record<string, number>, p: any) => {
        acc[p.businessVertical] = (acc[p.businessVertical] || 0) + 1;
        return acc;
      }, {}),
      playbooks: playbooks.map((p: any) => ({
        id: p._id,
        businessVertical: p.businessVertical,
        kind: p.kind,
        summary: p.summary,
        qualityScore: p.qualityScore,
        timesReused: p.timesReused,
        sourceAppId: p.sourceAppId,
        createdAt: p.createdAt,
      })),
    });
  } catch (err: any) {
    logger.error({ err }, "GET /admin/playbooks failed");
    res.status(500).json({ error: String(err) });
  }
});

// ─── Plantilla E2B con más memoria para importaciones grandes ──────────────
router.post("/admin/e2b-build-import-template", async (_req: any, res: any): Promise<void> => {
  try {
    const { buildImportTemplate } = await import("../lib/e2bTemplateSetup");
    const result = await buildImportTemplate();
    res.json(result);
  } catch (err: any) {
    logger.error({ err }, "POST /admin/e2b-build-import-template failed");
    res.status(500).json({ ok: false, reason: String(err) });
  }
});

export default router;
