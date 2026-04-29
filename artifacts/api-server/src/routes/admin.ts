import { Router, type IRouter } from "express";
import { eq, sql, count, gte, desc } from "drizzle-orm";
import { db } from "../lib/db";
import { requireAuth, requireAdmin, isAdminEmail } from "../lib/auth";
import {
  users,
  generatedApps,
  generationJobs,
  creditTransactions,
} from "@workspace/db/schema";
import { reenqueueGenerateJob } from "../lib/jobQueue";
import { logger } from "../lib/logger";

const router: IRouter = Router();

router.use("/admin", requireAuth, requireAdmin);

router.get("/admin/overview", async (_req, res) => {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const [usersTotal] = await db.select({ total: count() }).from(users);
  const [appsTotal] = await db.select({ total: count() }).from(generatedApps);
  const [appsWeek] = await db
    .select({ total: count() })
    .from(generatedApps)
    .where(gte(generatedApps.createdAt, sevenDaysAgo));
  const [creditsOutstanding] = await db
    .select({ total: sql<number>`COALESCE(SUM(${users.credits}), 0)::int` })
    .from(users);

  const txns = await db.select().from(creditTransactions);
  let creditsSpentTotal = 0;
  let creditsPurchasedTotal = 0;
  for (const t of txns) {
    if (t.kind === "usage") creditsSpentTotal += Math.abs(t.amount);
    if (t.kind === "purchase") creditsPurchasedTotal += t.amount;
  }

  res.json({
    totalUsers: usersTotal?.total ?? 0,
    totalApps: appsTotal?.total ?? 0,
    appsLast7Days: appsWeek?.total ?? 0,
    creditsOutstanding: creditsOutstanding?.total ?? 0,
    creditsSpentTotal,
    creditsPurchasedTotal,
    revenueCentsTotal: 0,
  });
});

router.get("/admin/users", async (_req, res) => {
  const rows = await db
    .select({
      id: users.id,
      email: users.email,
      fullName: users.fullName,
      imageUrl: users.imageUrl,
      credits: users.credits,
      createdAt: users.createdAt,
      appsGenerated: sql<number>`COALESCE(COUNT(${generatedApps.id}), 0)::int`,
    })
    .from(users)
    .leftJoin(generatedApps, eq(generatedApps.userId, users.id))
    .groupBy(users.id)
    .orderBy(desc(users.createdAt));

  res.json(
    rows.map((u) => ({
      id: u.id,
      email: u.email,
      fullName: u.fullName,
      imageUrl: u.imageUrl,
      credits: u.credits,
      appsGenerated: u.appsGenerated,
      isAdmin: isAdminEmail(u.email),
      createdAt: u.createdAt.toISOString(),
    })),
  );
});

router.post("/admin/users/:id/credits", async (req, res) => {
  const targetId = req.params.id;
  const body = req.body as { delta?: number; reason?: string };
  const delta = Number.isInteger(body?.delta) ? Number(body.delta) : 0;
  if (!delta) {
    res.status(400).json({ error: "El campo delta es obligatorio y distinto de cero" });
    return;
  }

  const result = await db.transaction(async (tx) => {
    // Atomic lock + update + ledger inside a single transaction to prevent
    // lost-update races when two admins adjust the same user simultaneously.
    const locked = await tx.execute(
      sql`SELECT id, email, full_name, image_url, credits, created_at
          FROM users WHERE id = ${targetId} FOR UPDATE`,
    );
    const row = (locked.rows ?? locked)[0] as
      | { id: string; email: string; full_name: string | null; image_url: string | null; credits: number; created_at: Date }
      | undefined;
    if (!row) return null;

    const newBalance = Math.max(0, row.credits + delta);
    const actualDelta = newBalance - row.credits;

    if (actualDelta !== 0) {
      await tx
        .update(users)
        .set({ credits: newBalance, updatedAt: new Date() })
        .where(eq(users.id, targetId));

      await tx.insert(creditTransactions).values({
        userId: targetId,
        amount: actualDelta,
        kind: actualDelta > 0 ? "bonus" : "usage",
        description: body.reason?.trim() || "Ajuste manual del administrador",
      });
    }

    return { row, newBalance };
  });

  if (!result) {
    res.status(404).json({ error: "Usuario no encontrado" });
    return;
  }

  const [appsCount] = await db
    .select({ total: count() })
    .from(generatedApps)
    .where(eq(generatedApps.userId, targetId));

  res.json({
    id: result.row.id,
    email: result.row.email,
    fullName: result.row.full_name,
    imageUrl: result.row.image_url,
    credits: result.newBalance,
    appsGenerated: appsCount?.total ?? 0,
    isAdmin: isAdminEmail(result.row.email),
    createdAt: new Date(result.row.created_at).toISOString(),
  });
});

router.get("/admin/apps", async (_req, res) => {
  const rows = await db
    .select({
      id: generatedApps.id,
      userId: generatedApps.userId,
      userEmail: users.email,
      title: generatedApps.title,
      description: generatedApps.description,
      techStack: generatedApps.techStack,
      status: generatedApps.status,
      createdAt: generatedApps.createdAt,
    })
    .from(generatedApps)
    .leftJoin(users, eq(users.id, generatedApps.userId))
    .orderBy(desc(generatedApps.createdAt))
    .limit(200);

  res.json(
    rows.map((r) => ({
      id: r.id,
      userId: r.userId,
      userEmail: r.userEmail,
      title: r.title,
      description: r.description,
      techStack: Array.isArray(r.techStack) ? r.techStack : [],
      status: r.status,
      createdAt: r.createdAt.toISOString(),
    })),
  );
});

/**
 * GET /admin/jobs
 *
 * Recent generation jobs across all users with summary counters. Used by
 * the admin "Cola" tab to monitor queue health and triage stuck jobs.
 *
 * Returns the last 100 jobs by recency. Counters look at all queued/running
 * (any age) plus a 24h window for failed/succeeded so the admin can spot
 * incident bursts.
 */
router.get("/admin/jobs", async (_req, res) => {
  const sinceDate = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const [rows, queuedRow, runningRow, failed24Row, succ24Row] = await Promise.all([
    db
      .select({
        id: generationJobs.id,
        userId: generationJobs.userId,
        userEmail: users.email,
        appId: generationJobs.appId,
        editAppId: generationJobs.editAppId,
        prompt: generationJobs.prompt,
        status: generationJobs.status,
        phase: generationJobs.phase,
        progress: generationJobs.progress,
        coderModel: generationJobs.coderModel,
        language: generationJobs.language,
        retryCount: generationJobs.retryCount,
        errorMessage: generationJobs.errorMessage,
        createdAt: generationJobs.createdAt,
        updatedAt: generationJobs.updatedAt,
      })
      .from(generationJobs)
      .leftJoin(users, eq(generationJobs.userId, users.id))
      .orderBy(desc(generationJobs.createdAt))
      .limit(100),
    db.select({ c: count() }).from(generationJobs).where(eq(generationJobs.status, "queued")),
    db.select({ c: count() }).from(generationJobs).where(eq(generationJobs.status, "running")),
    db
      .select({ c: count() })
      .from(generationJobs)
      .where(sql`${generationJobs.status} = 'failed' AND ${generationJobs.updatedAt} >= ${sinceDate}`),
    db
      .select({ c: count() })
      .from(generationJobs)
      .where(sql`${generationJobs.status} = 'succeeded' AND ${generationJobs.updatedAt} >= ${sinceDate}`),
  ]);

  const now = Date.now();
  res.json({
    queued: queuedRow[0]?.c ?? 0,
    running: runningRow[0]?.c ?? 0,
    failedLast24h: failed24Row[0]?.c ?? 0,
    succeededLast24h: succ24Row[0]?.c ?? 0,
    jobs: rows.map((r) => ({
      id: r.id,
      userId: r.userId,
      userEmail: r.userEmail,
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

/**
 * POST /admin/jobs/:id/retry
 *
 * Manual re-enqueue. Only allowed for terminal-failure jobs and stale
 * runners — refusing to resurrect succeeded jobs (would clobber the live
 * app) and active jobs (still owned by a worker).
 */
router.post("/admin/jobs/:id/retry", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "ID inválido" });
    return;
  }

  const [job] = await db
    .select()
    .from(generationJobs)
    .where(eq(generationJobs.id, id))
    .limit(1);
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
    res
      .status(409)
      .json({ error: `Job en estado '${job.status}' no es reintentable ahora.` });
    return;
  }

  // Snapshot the prior state so we can roll back atomically if the queue
  // send fails — without this, the row would be left as "queued" forever
  // (no worker would ever pick it up), recreating the very stuck-state
  // problem this whole feature is meant to eliminate.
  const priorStatus = job.status;
  const priorPhase = job.phase;
  const priorProgress = job.progress;
  const priorErrorMessage = job.errorMessage;
  const priorRetryCount = job.retryCount ?? 0;
  const priorUpdatedAt = job.updatedAt;

  const [updated] = await db
    .update(generationJobs)
    .set({
      status: "queued",
      phase: "queued",
      progress: 0,
      errorMessage: null,
      retryCount: priorRetryCount + 1,
      updatedAt: new Date(),
    })
    .where(eq(generationJobs.id, id))
    .returning();

  try {
    await reenqueueGenerateJob(id);
  } catch (err) {
    logger.error({ err, jobId: id }, "Manual retry: failed to re-enqueue — rolling back DB state");
    // Compensating update: restore the previous state. Best-effort; we
    // never let a rollback-error mask the original enqueue error.
    try {
      await db
        .update(generationJobs)
        .set({
          status: priorStatus,
          phase: priorPhase,
          progress: priorProgress,
          errorMessage: priorErrorMessage,
          retryCount: priorRetryCount,
          updatedAt: priorUpdatedAt,
        })
        .where(eq(generationJobs.id, id));
    } catch (rollbackErr) {
      logger.error(
        { err: rollbackErr, jobId: id },
        "Manual retry: rollback also failed — admin must fix this row manually",
      );
    }
    res.status(500).json({ error: "No se pudo re-encolar el job." });
    return;
  }

  const u = await db
    .select({ email: users.email })
    .from(users)
    .where(eq(users.id, updated.userId))
    .limit(1);
  const ageMsAfter = Date.now() - new Date(updated.updatedAt).getTime();
  res.json({
    id: updated.id,
    userId: updated.userId,
    userEmail: u[0]?.email ?? null,
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

export default router;
