import app from "./app";
import { logger } from "./lib/logger";
import { reclaimOrphanedJobs, runJobById } from "./routes/apps";
import { startQueue, registerGenerateWorker, stopQueue } from "./lib/jobQueue";
import { startSelfMonitor } from "./lib/selfMonitor";
import { pingRedis, isRedisConfigured } from "./lib/redisHealth";
import { connectDB } from "./lib/db";
 
const rawPort = process.env["PORT"] || "3000";
const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  logger.warn(`Invalid PORT value: "${rawPort}". Defaulting to 3000.`);
}
const finalPort = (Number.isNaN(port) || port <= 0) ? 3000 : port;
 
app.listen(finalPort, async (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }
 
  logger.info({ port: finalPort }, "Server listening v2.1.0 (Testing Agent Active)");
 
  // 0) Connect to MongoDB before anything else.
  try {
    await connectDB();
    logger.info("MongoDB connected successfully");
  } catch (dbErr) {
    logger.error({ err: dbErr }, "Failed to connect to MongoDB — exiting");
    process.exit(1);
  }
 
  // 1) Start the in-process job queue (MongoDB-backed polling loop).
  // 2) Register the worker so this process picks up jobs.
  // 3) Reclaim orphaned jobs from previous boots.
  try {
    await startQueue();
    await registerGenerateWorker(runJobById);
  } catch (queueErr) {
    logger.error(
      { err: queueErr },
      "Failed to start job queue — generations will run in-process",
    );
  }
 
  reclaimOrphanedJobs().catch((reclaimErr) => {
    logger.error({ err: reclaimErr }, "Orphan job reclaim failed");
  });
 
  // 4) Self-monitor — periodic state sync and optimizer events.
  try {
    startSelfMonitor();
  } catch (selfErr) {
    logger.error({ err: selfErr }, "Failed to start self-monitor");
  }
 
  // 5) Best-effort Redis ping at boot.
  if (isRedisConfigured()) {
    pingRedis()
      .then((result) => {
        if (result.ok) {
          logger.info(
            { latencyMs: result.latencyMs },
            "Redis ping ok",
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
 
  // 6) Periodic orphan job sweep every 2 minutes.
  const RECLAIM_SWEEP_MS = Number(process.env.RECLAIM_SWEEP_MS) || 2 * 60 * 1000;
  const sweep = setInterval(() => {
    reclaimOrphanedJobs().catch((reclaimErr) => {
      logger.warn({ err: reclaimErr }, "Periodic orphan job reclaim failed");
    });
  }, RECLAIM_SWEEP_MS);
  sweep.unref();
});
 
// Graceful shutdown
const shutdown = async (signal: NodeJS.Signals) => {
  logger.info({ signal }, "Shutting down — stopping job queue");
  await stopQueue();
  process.exit(0);
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
 
