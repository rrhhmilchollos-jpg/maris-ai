/**
 * worker.ts — Entry point del servicio Worker de Render.
 *
 * Este proceso NO expone ningún puerto HTTP.
 * Su única responsabilidad es:
 *   1. Conectar a MongoDB.
 *   2. Arrancar el bucle de polling de la cola de jobs (MongoDB-backed).
 *   3. Registrar el handler de generación de apps.
 *   4. Recuperar jobs huérfanos de arranques anteriores.
 *
 * Se puede escalar horizontalmente añadiendo más instancias de este worker
 * en Render sin tocar el API server.
 */
import { logger } from "./lib/logger";
import { reclaimOrphanedJobs, runJobById } from "./routes/apps";
import { startQueue, registerGenerateWorker, stopQueue } from "./lib/jobQueue";
import { connectDB } from "./lib/db";
import { pingRedis, isRedisConfigured } from "./lib/redisHealth";
import { startSeoGeoAutopilot } from "./lib/seoGeoAutopilot";

const RECLAIM_SWEEP_MS = Number(process.env.RECLAIM_SWEEP_MS) || 2 * 60 * 1000;

async function main() {
  logger.info("Maris AI Worker starting…");

  // 1) MongoDB
  try {
    await connectDB();
    logger.info("MongoDB connected");
  } catch (err) {
    logger.error({ err }, "MongoDB connection failed — exiting");
    process.exit(1);
  }

  // 2) Job queue
  try {
    await startQueue();
    await registerGenerateWorker(runJobById);
    logger.info("Job queue started and worker registered");
  } catch (err) {
    logger.error({ err }, "Failed to start job queue — exiting");
    process.exit(1);
  }

  // 3) Recover orphaned jobs from previous boots
  reclaimOrphanedJobs().catch((err) => {
    logger.warn({ err }, "Initial orphan reclaim failed");
  });

  // 4) Redis ping (informational only)
  if (isRedisConfigured()) {
    pingRedis()
      .then((result) => {
        if (result.ok) {
          logger.info({ latencyMs: result.latencyMs }, "Redis ping ok");
        } else {
          logger.warn({ err: result.error }, "Redis ping failed at boot");
        }
      })
      .catch((err) => logger.warn({ err }, "Redis ping threw at boot"));
  } else {
    logger.info("Redis not configured — using in-process queue");
  }

  // 5) SEO + GEO editorial autopilot. Crea borradores diarios y nunca publica
  // ni modifica contenido existente sin una aprobación editorial explícita.
  const stopSeoGeoAutopilot = startSeoGeoAutopilot();

  // 6) Periodic orphan sweep
  const sweep = setInterval(() => {
    reclaimOrphanedJobs().catch((err) => {
      logger.warn({ err }, "Periodic orphan reclaim failed");
    });
  }, RECLAIM_SWEEP_MS);
  sweep.unref();
  process.once("SIGTERM", stopSeoGeoAutopilot);
  process.once("SIGINT", stopSeoGeoAutopilot);

  logger.info("Worker ready — processing jobs");
}

// Graceful shutdown
const shutdown = async (signal: NodeJS.Signals) => {
  logger.info({ signal }, "Worker shutting down");
  await stopQueue();
  process.exit(0);
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

main().catch((err) => {
  logger.error({ err }, "Worker fatal error");
  process.exit(1);
});
