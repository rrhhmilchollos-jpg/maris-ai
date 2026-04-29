import app from "./app";
import { logger } from "./lib/logger";
import { reclaimOrphanedJobs, runJobById } from "./routes/apps";
import { startQueue, registerGenerateWorker, stopQueue } from "./lib/jobQueue";
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
});

// Best-effort graceful shutdown so in-flight jobs get a chance to checkpoint.
const shutdown = async (signal: NodeJS.Signals) => {
  logger.info({ signal }, "Shutting down — stopping job queue");
  await stopQueue();
  process.exit(0);
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
