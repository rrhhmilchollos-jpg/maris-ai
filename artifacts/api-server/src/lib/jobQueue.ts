import { connectDB } from "./db";
import { GenerationJob } from "@workspace/db/schema";
import { logger } from "./logger";

// ---------------------------------------------------------------------------
// Simple in-process job queue backed by MongoDB.
// Replaces pg-boss (which required PostgreSQL).
//
// Design:
//   - Jobs are stored in MongoDB (generation_jobs collection).
//   - A polling loop picks up "queued" jobs and runs them in-process.
//   - Concurrency is controlled by a semaphore (active job counter).
//   - Retries are handled by re-setting status to "queued" up to MAX_ATTEMPTS.
// ---------------------------------------------------------------------------

// CONCURRENCIA — auditado a petición del usuario tras una limitación señalada
// externamente sobre "tolerar millones de usuarios concurrentes". El límite
// real no está en este código (el bloqueo atómico vía findOneAndUpdate ya
// es correcto y libre de condiciones de carrera, confirmado leyendo
// registerGenerateWorker más abajo) sino en cuántas generaciones simultáneas
// puede absorber la cuenta de Anthropic sin entrar en rate limiting 429
// (manejado con reintentos en shared-agents.ts, pero cada 429 retrasa esa
// generación). DEFAULT_CONCURRENCY=3 era un valor conservador sin
// justificación numérica explícita en el código — se mantiene como
// predeterminado seguro, pero JOB_CONCURRENCY ahora permite subir el techo
// hasta 25 (antes 10) para quien tenga un tier de Anthropic con más
// capacidad y quiera absorber más tráfico simultáneo de generación.
export const GENERATE_QUEUE =
  process.env.GENERATE_QUEUE_NAME ?? "appforge.generate-app";

const DEFAULT_CONCURRENCY = 3;
const MAX_CONCURRENCY = 25;
const DEFAULT_POLL_INTERVAL_MS = process.env.JOB_POLL_INTERVAL_MS ? Number.parseInt(process.env.JOB_POLL_INTERVAL_MS, 10) : 500; // Ultra-optimizado: 500ms para arranque instantáneo
export const MAX_ATTEMPTS = 3; // Retry limit

export interface JobPayload {
  jobId: string;
}

export interface AttemptContext {
  attempt: number;
  maxAttempts: number;
}

type JobHandler = (jobId: string, ctx: AttemptContext) => Promise<void>;

let pollInterval: ReturnType<typeof setInterval> | null = null;
let activeJobs = 0;
const activeJobsByUser = new Map<string, number>();
let registeredHandler: JobHandler | null = null;
let isStarted = false;
let triggerPollFn: (() => Promise<void>) | null = null;

// ---------------------------------------------------------------------------
// Queue lifecycle
// ---------------------------------------------------------------------------

export async function startQueue(): Promise<void> {
  if (isStarted) return;
  await connectDB();
  isStarted = true;
  logger.info("Job queue (MongoDB in-process) started");
}

export function isQueueReady(): boolean {
  return isStarted;
}

export async function stopQueue(): Promise<void> {
  if (pollInterval) {
    clearInterval(pollInterval);
    pollInterval = null;
  }
  isStarted = false;
  registeredHandler = null;
  logger.info("Job queue stopped");
}

// ---------------------------------------------------------------------------
// Enqueue
// ---------------------------------------------------------------------------

/**
 * Mark a generation_jobs row as queued so the polling loop picks it up.
 * Idempotent — if the job is already queued or running, this is a no-op.
 */
export async function enqueueGenerateJob(jobId: string): Promise<void> {
  await connectDB();
  await GenerationJob.findOneAndUpdate(
    { _id: jobId, status: { $nin: ["running", "succeeded"] } },
    { $set: { status: "queued", phase: "queued" } },
  );
  
  // Trigger immediate poll if possible
  if (registeredHandler && activeJobs < DEFAULT_CONCURRENCY) {
    logger.info({ jobId }, "Triggering immediate job poll after enqueue");
    // We don't await here to keep the response fast
    setImmediate(async () => {
      // Manually trigger a check to start the job in milliseconds
      if (triggerPollFn) {
        await triggerPollFn();
      }
    });
  }
}

/** Admin manual retry — always re-queues regardless of current status. */
export async function reenqueueGenerateJob(jobId: string): Promise<void> {
  await connectDB();
  await GenerationJob.findByIdAndUpdate(jobId, {
    $set: { status: "queued", phase: "queued", retryCount: 0 },
  });
}

// ---------------------------------------------------------------------------
// Worker registration + polling loop
// ---------------------------------------------------------------------------

export async function registerGenerateWorker(
  handler: JobHandler,
): Promise<void> {
  if (registeredHandler) {
    logger.warn("registerGenerateWorker called twice — ignoring");
    return;
  }
  registeredHandler = handler;

  const concurrency = (() => {
    const raw = process.env.JOB_CONCURRENCY;
    if (!raw) return DEFAULT_CONCURRENCY;
    const n = Number.parseInt(raw, 10);
    if (!Number.isFinite(n) || n < 1) return DEFAULT_CONCURRENCY;
    return Math.min(n, MAX_CONCURRENCY);
  })();

  logger.info({ concurrency }, "Generation worker registered");

  const triggerPoll = async () => {
    if (activeJobs >= concurrency) return;
    if (!registeredHandler) return;

    try {
      await connectDB();

      // Claim up to (concurrency - activeJobs) queued jobs atomically.
      const slots = concurrency - activeJobs;
      const jobs = await GenerationJob.find({ status: "queued" })
        .sort({ createdAt: 1 })
        .limit(slots)
        .lean();

      for (const job of jobs) {
        // Per-user concurrency limit — check DB to survive Railway restarts
        const jobUserId = String(job.userId || "unknown");
        const userActive = activeJobsByUser.get(jobUserId) ?? 0;
        if (userActive >= 1) {
          logger.info({ jobId: String(job._id), userId: jobUserId }, "User already has an active job (memory) — skipping");
          continue;
        }

        // Also check DB for running jobs (survives process restarts)
        const runningInDB = await GenerationJob.countDocuments({
          userId: jobUserId,
          status: "running",
          _id: { $ne: job._id },
        });
        if (runningInDB >= 1) {
          logger.info({ jobId: String(job._id), userId: jobUserId, runningInDB }, "User already has running job in DB — skipping");
          continue;
        }

        const claimed = await GenerationJob.findOneAndUpdate(
          { _id: job._id, status: "queued" },
          { $set: { status: "running", updatedAt: new Date() } },
          { new: true },
        );
        if (!claimed) continue; // another worker claimed it first

        activeJobs++;
        activeJobsByUser.set(jobUserId, (activeJobsByUser.get(jobUserId) ?? 0) + 1);
        const jobId = String(job._id);
        const attempt = (job.retryCount ?? 0) + 1;

        // Run the handler in the background (don't await in the poll loop).
        (async () => {
          try {
            await registeredHandler!(jobId, { attempt, maxAttempts: MAX_ATTEMPTS });
          } catch (err) {
            logger.error({ err, jobId, attempt }, "Generation job worker threw");

            // Verificar si el job ya completó exitosamente antes de marcar como fallido
            const currentJob = await GenerationJob.findById(jobId).select("status").lean() as any;
            if (currentJob?.status === "succeeded") {
              logger.info({ jobId }, "Job already succeeded — ignoring worker catch");
              return;
            }

            if (attempt < MAX_ATTEMPTS) {
              // Re-queue for retry.
              await GenerationJob.findByIdAndUpdate(jobId, {
                $set: { status: "queued", phase: "queued", updatedAt: new Date() },
                $inc: { retryCount: 1 },
              }).catch(() => {});
            } else {
              // Final failure — mark as failed.
              await GenerationJob.findByIdAndUpdate(jobId, {
                $set: {
                  status: "failed",
                  phase: "failed",
                  errorMessage: err instanceof Error ? err.message : "Error desconocido",
                  updatedAt: new Date(),
                },
              }).catch(() => {});
            }
          } finally {
            activeJobs--;
            const uid = String(job.userId || "unknown");
            const prev = activeJobsByUser.get(uid) ?? 1;
            if (prev <= 1) activeJobsByUser.delete(uid);
            else activeJobsByUser.set(uid, prev - 1);
          }
        })();
      }
    } catch (err) {
      logger.error({ err }, "Job queue poll loop error");
    }
  };

  triggerPollFn = triggerPoll;
  logger.info({ pollIntervalMs: DEFAULT_POLL_INTERVAL_MS }, "Job queue polling configured");
  pollInterval = setInterval(triggerPollFn, DEFAULT_POLL_INTERVAL_MS);

  // Prevent the interval from keeping Node alive if nothing else is running.
  if (pollInterval.unref) pollInterval.unref();
}
