import { Router, type IRouter } from "express";
import { eq, sql, count, gte, desc, and } from "drizzle-orm";
import { db } from "../lib/db";
import { requireAuth, requireAdmin, isAdminEmail } from "../lib/auth";
import {
  users,
  generatedApps,
  generationJobs,
  creditTransactions,
} from "@workspace/db/schema";
import { reenqueueGenerateJob, isQueueReady } from "../lib/jobQueue";
import { logger } from "../lib/logger";
import { agentMemory } from "@workspace/db";
import { getMetricsSnapshot } from "../lib/metrics";

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

  // Snapshot prior state for compensating rollback if queue send fails.
  const priorStatus = job.status;
  const priorPhase = job.phase;
  const priorProgress = job.progress;
  const priorErrorMessage = job.errorMessage;
  const priorRetryCount = job.retryCount ?? 0;
  const priorUpdatedAt = job.updatedAt;

  // Concurrency-safe via status guard: two concurrent retries can't both win
  // because the first UPDATE flips status, invalidating the second's WHERE.
  const updatedRows = await db
    .update(generationJobs)
    .set({
      status: "queued",
      phase: "queued",
      progress: 0,
      errorMessage: null,
      retryCount: priorRetryCount + 1,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(generationJobs.id, id),
        eq(generationJobs.status, priorStatus),
      ),
    )
    .returning();

  if (updatedRows.length === 0) {
    res.status(409).json({
      error:
        "El job cambió de estado mientras se procesaba el reintento. Recarga e inténtalo de nuevo.",
    });
    return;
  }
  const [updated] = updatedRows;

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

router.get("/admin/memory", async (req, res) => {
  const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50));
  const offset = Math.max(0, Number(req.query.offset) || 0);
  const q = (typeof req.query.q === "string" ? req.query.q : "").trim();
  // Case-insensitive substring search across errorMessage + patch. Drizzle
  // safely parameterises both bind values, so SQL injection isn't a concern.
  const where = q
    ? sql`(${agentMemory.errorMessage} ILIKE ${"%" + q + "%"} OR ${agentMemory.patch} ILIKE ${"%" + q + "%"})`
    : undefined;
  const baseRows = db
    .select({
      id: agentMemory.id,
      errorMessage: agentMemory.errorMessage,
      errorContext: agentMemory.errorContext,
      patch: agentMemory.patch,
      language: agentMemory.language,
      framework: agentMemory.framework,
      successCount: agentMemory.successCount,
      createdAt: agentMemory.createdAt,
      updatedAt: agentMemory.updatedAt,
    })
    .from(agentMemory);
  const rows = await (where ? baseRows.where(where) : baseRows)
    .orderBy(desc(agentMemory.updatedAt))
    .limit(limit)
    .offset(offset);
  const baseCount = db.select({ value: count() }).from(agentMemory);
  const [{ value: total } = { value: 0 }] = await (where ? baseCount.where(where) : baseCount);
  res.json({
    total: Number(total),
    limit,
    offset,
    q,
    entries: rows.map((r) => ({
      id: r.id,
      errorMessage: r.errorMessage,
      errorContext: r.errorContext,
      patchPreview: r.patch.slice(0, 600),
      patchLength: r.patch.length,
      language: r.language,
      framework: r.framework,
      successCount: r.successCount,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    })),
  });
});

router.delete("/admin/memory/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id) || id <= 0) {
    res.status(400).json({ message: "id inválido" });
    return;
  }
  const deleted = await db.delete(agentMemory).where(eq(agentMemory.id, id)).returning();
  if (deleted.length === 0) {
    res.status(404).json({ message: "no encontrado" });
    return;
  }
  res.json({ ok: true, id });
});

/**
 * Aggregated business metrics for the admin dashboard. Single endpoint so the
 * UI can refresh every 30s with one query. All windows are computed in JS
 * from raw SQL groupings to keep the queries portable.
 */
router.get("/admin/metrics", async (_req, res) => {
  const now = new Date();
  const day = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  // 1) Jobs in the last 24h: total / success / fail / avg duration (ms).
  const jobs24h = await db
    .select({
      status: generationJobs.status,
      total: count(),
      avgMs: sql<
        number | null
      >`AVG(EXTRACT(EPOCH FROM (${generationJobs.updatedAt} - ${generationJobs.createdAt})) * 1000)::int`,
    })
    .from(generationJobs)
    .where(gte(generationJobs.createdAt, day))
    .groupBy(generationJobs.status);

  let jobsTotal = 0;
  let jobsSuccess = 0;
  let jobsFailed = 0;
  let avgDurationMsAccum = 0;
  let avgDurationCount = 0;
  for (const row of jobs24h) {
    jobsTotal += row.total;
    if (row.status === "succeeded") jobsSuccess += row.total;
    if (row.status === "failed") jobsFailed += row.total;
    if (row.avgMs && (row.status === "succeeded" || row.status === "failed")) {
      avgDurationMsAccum += row.avgMs * row.total;
      avgDurationCount += row.total;
    }
  }
  const avgDurationMs =
    avgDurationCount > 0 ? Math.round(avgDurationMsAccum / avgDurationCount) : 0;

  // 2) Top failing phases in the last 24h.
  const failingPhases = await db
    .select({
      phase: generationJobs.phase,
      total: count(),
    })
    .from(generationJobs)
    .where(
      and(eq(generationJobs.status, "failed"), gte(generationJobs.createdAt, day)),
    )
    .groupBy(generationJobs.phase)
    .orderBy(desc(count()))
    .limit(3);

  // 3) Credits spent today and this month (usage = negative amounts).
  const [creditsToday] = await db
    .select({
      total: sql<number>`COALESCE(SUM(ABS(${creditTransactions.amount})), 0)::int`,
    })
    .from(creditTransactions)
    .where(
      and(
        eq(creditTransactions.kind, "usage"),
        gte(creditTransactions.createdAt, todayStart),
      ),
    );
  const [creditsMonth] = await db
    .select({
      total: sql<number>`COALESCE(SUM(ABS(${creditTransactions.amount})), 0)::int`,
    })
    .from(creditTransactions)
    .where(
      and(
        eq(creditTransactions.kind, "usage"),
        gte(creditTransactions.createdAt, monthStart),
      ),
    );

  // 4) Top 5 users by credits consumed all-time.
  const topUsers = await db
    .select({
      userId: creditTransactions.userId,
      email: users.email,
      total: sql<number>`COALESCE(SUM(ABS(${creditTransactions.amount})), 0)::int`,
    })
    .from(creditTransactions)
    .leftJoin(users, eq(users.id, creditTransactions.userId))
    .where(eq(creditTransactions.kind, "usage"))
    .groupBy(creditTransactions.userId, users.email)
    .orderBy(desc(sql`SUM(ABS(${creditTransactions.amount}))`))
    .limit(5);

  // 5) Apps published today + total. "Published" = has a public_slug.
  const [publishedTotal] = await db
    .select({ total: count() })
    .from(generatedApps)
    .where(sql`${generatedApps.publicSlug} IS NOT NULL`);
  const [publishedToday] = await db
    .select({ total: count() })
    .from(generatedApps)
    .where(
      and(
        sql`${generatedApps.publicSlug} IS NOT NULL`,
        gte(generatedApps.createdAt, todayStart),
      ),
    );

  res.json({
    generatedAt: now.toISOString(),
    jobs24h: {
      total: jobsTotal,
      succeeded: jobsSuccess,
      failed: jobsFailed,
      successRate: jobsTotal > 0 ? Math.round((jobsSuccess / jobsTotal) * 100) : null,
      avgDurationMs,
    },
    topFailingPhases: failingPhases.map((p) => ({
      phase: p.phase,
      count: p.total,
    })),
    credits: {
      today: creditsToday?.total ?? 0,
      month: creditsMonth?.total ?? 0,
    },
    topUsers: topUsers.map((u) => ({
      userId: u.userId,
      email: u.email ?? "(usuario eliminado)",
      creditsUsed: u.total,
    })),
    publishedApps: {
      today: publishedToday?.total ?? 0,
      total: publishedTotal?.total ?? 0,
    },
  });
});

// Operational metrics: in-memory request counters + live queue state.
// Survives only until process restart — intentional, no external dep.
router.get("/admin/metrics", async (_req, res) => {
  const snapshot = getMetricsSnapshot();

  // Pull queue state from generation_jobs (the source of truth Maris uses).
  // Last 24h window so the numbers reflect "what's happening now" rather
  // than lifetime totals.
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const statusRows = await db
    .select({
      status: generationJobs.status,
      total: count(),
    })
    .from(generationJobs)
    .where(gte(generationJobs.createdAt, since))
    .groupBy(generationJobs.status);

  const queueByStatus: Record<string, number> = {};
  for (const row of statusRows) {
    queueByStatus[row.status] = Number(row.total);
  }

  res.json({
    server: snapshot,
    queue: {
      ready: isQueueReady(),
      jobs24hByStatus: queueByStatus,
    },
  });
});

export default router;
