import app from "./app";
import { logger } from "./lib/logger";
import { reclaimOrphanedJobs, runJobById } from "./routes/apps";
import { startQueue, registerGenerateWorker, stopQueue } from "./lib/jobQueue";
import { startSelfMonitor } from "./lib/selfMonitor";
import { pingRedis, isRedisConfigured } from "./lib/redisHealth";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

/**
 * Idempotent bootstrap step: ensures the pgvector extension exists in the
 * connected Postgres database. Required by `lib/db/src/schema/agentMemory.ts`
 * (1536-dim vector column + HNSW cosine index). Running it on every boot is
 * safe — `CREATE EXTENSION IF NOT EXISTS` is a no-op when the extension is
 * already installed, and Neon allows it without superuser. If the host
 * doesn't allow extension creation we log loudly and continue: the rest of
 * the API still works; only agent_memory operations would fail.
 */
async function ensurePgVector(): Promise<void> {
  try {
    await db.execute(sql`CREATE EXTENSION IF NOT EXISTS vector`);
    logger.info("pgvector extension ensured");
  } catch (err) {
    logger.error(
      { err },
      "Could not ensure pgvector extension — agent_memory features will be unavailable until it is installed manually",
    );
  }
}

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

app.listen(port, async (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");

  // 0) Ensure DB extensions exist before any feature that depends on them
  //    runs (agent_memory uses pgvector). Best-effort: failures don't block
  //    server startup.
  await ensurePgVector();

  // 1) Start the persistent queue. Must come before the worker and before
  //    reclaim — reclaim calls enqueueGenerateJob which needs the boss.
  // 2) Register the worker so this process picks up jobs.
  // 3) Reclaim orphaned jobs from previous boots (re-enqueues queued ones,
  //    fails stale running ones).
  try {
    await startQueue();
    await registerGenerateWorker(runJobById);
  } catch (queueErr) {
    // The whole product can still serve reads if the queue is down — log
    // loudly and continue. Generations will fall back to the in-process
    // setImmediate path (not restart-safe but at least working).
    logger.error({ err: queueErr }, "Failed to start job queue — generations will run in-process");
  }

  reclaimOrphanedJobs().catch((reclaimErr) => {
    logger.error({ err: reclaimErr }, "Orphan job reclaim failed");
  });

  // 4) Self-monitor (Fase 9 PRO scaffold, real version): periodic DB
  //    snapshot → state sync → analyzer → optimizer events. Failures
  //    inside the monitor never throw out — it logs and keeps going.
  try {
    startSelfMonitor();
  } catch (selfErr) {
    logger.error({ err: selfErr }, "Failed to start self-monitor");
  }

  // 5) Best-effort Redis ping. If REDIS_URL is set we want to know at boot
  //    whether it's reachable (and how fast) so the admin panel reflects the
  //    real state. A failure here is logged and ignored — Redis is not yet on
  //    the critical path; the existing pg-boss queue keeps generations
  //    running. This becomes the foundation for the BullMQ migration.
  if (isRedisConfigured()) {
    pingRedis()
      .then((result) => {
        if (result.ok) {
          // Redis is reachable. Log it explicitly as "ready for BullMQ" so an
          // operator looking for the trigger to migrate the queue from
          // pg-boss can spot it. The actual swap is still manual (we don't
          // hot-swap a live queue), but this signal removes the guesswork.
          logger.info(
            { latencyMs: result.latencyMs },
            "Redis ping ok — ready for BullMQ migration when desired (currently using pg-boss)",
          );
        } else {
          logger.warn({ err: result.error }, "Redis ping failed at boot");
        }
      })
      .catch((pingErr) => {
        logger.warn({ err: pingErr }, "Redis ping threw at boot");
      });
  } else {
    logger.info("Redis not configured (REDIS_URL unset) — skipping ping");
  }

  // Periodic sweep: re-run the reclaim every 2 minutes so jobs that get stuck
  // *between* server restarts (worker crashed mid-run, OpenAI call hung past
  // pg-boss expiry, network partition) don't permanently block the user
  // behind a 409 "ya hay un cambio en curso". Combined with the inline
  // recovery in the /generate 409 check, this gives two independent paths
  // for unsticking a dead job: (1) the user retries and we recover inline,
  // (2) nobody touches the app and the sweep eventually frees it anyway.
  const RECLAIM_SWEEP_MS = Number(process.env.RECLAIM_SWEEP_MS) || 2 * 60 * 1000;
  const sweep = setInterval(() => {
    reclaimOrphanedJobs().catch((reclaimErr) => {
      logger.warn({ err: reclaimErr }, "Periodic orphan job reclaim failed");
    });
  }, RECLAIM_SWEEP_MS);
  // unref() so the interval doesn't keep the process alive during graceful
  // shutdown — pg-boss + Express still hold their own refs.
  sweep.unref();
});

// Best-effort graceful shutdown so in-flight jobs get a chance to checkpoint.
const shutdown = async (signal: NodeJS.Signals) => {
  logger.info({ signal }, "Shutting down — stopping job queue");
  await stopQueue();
  process.exit(0);
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
