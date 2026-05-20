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
 
export const GENERATE_QUEUE =
  process.env.GENERATE_QUEUE_NAME ?? "appforge.generate-app";
 
const DEFAULT_CONCURRENCY = 3;
const DEFAULT_POLL_INTERVAL_MS = 200;
export const MAX_ATTEMPTS = 3;
 
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
let registeredHandler: JobHandler | null = null;
let triggerPollFn: (() => Promise<void>) | null = null;
let isStarted = false;
 
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
  triggerPollFn = triggerPoll;
 
  const concurrency = (() => {
    const raw = process.env.JOB_CONCURRENCY;
    if (!raw) return DEFAULT_CONCURRENCY;
    const n = Number.parseInt(raw, 10);
    if (!Number.isFinite(n) || n < 1) return DEFAULT_CONCURRENCY;
    return Math.min(n, 10);
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
        // Atomic claim — only one worker wins per job.
        const claimed = await GenerationJob.findOneAndUpdate(
          { _id: job._id, status: "queued" },
          { $set: { status: "running", updatedAt: new Date() } },
          { new: true },
        );
        if (!claimed) continue; // another worker claimed it first

        activeJobs++;
        const jobId = String(job._id);
        const attempt = (job.retryCount ?? 0) + 1;

        // Run the handler in the background (don't await in the poll loop).
        (async () => {
          try {
            await registeredHandler!(jobId, { attempt, maxAttempts: MAX_ATTEMPTS });
          } catch (err) {
            logger.error({ err, jobId, attempt }, "Generation job worker threw");

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
          }
        })();
      }
    } catch (err) {
      logger.error({ err }, "Job queue poll loop error");
    }
  };

  pollInterval = setInterval(triggerPoll, DEFAULT_POLL_INTERVAL_MS);
 
  // Prevent the interval from keeping Node alive if nothing else is running.
  if (pollInterval.unref) pollInterval.unref();
}
 
