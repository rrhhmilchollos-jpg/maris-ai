import { PgBoss } from "pg-boss";
import { logger } from "./logger";

interface QueueWorkJob<T> {
  id: string;
  data: T;
}

/**
 * Persistent job queue for app-generation runs.
 *
 * Why pg-boss (not BullMQ + Redis):
 *   - Replit ships with Postgres but not Redis. Adding Redis would mean an
 *     external service or another paid managed dep — all to gain nothing the
 *     pipeline actually needs at our scale.
 *   - pg-boss persists every job in Postgres (its own schema `pgboss`), so
 *     restart-resilience and at-least-once delivery come for free over the DB
 *     we already trust.
 *   - The full BullMQ feature surface (delayed jobs, repeat-every-N, throttle,
 *     priority, retry-with-backoff, dead-letter) is all available here too.
 *
 * The worker runs INSIDE the api-server process for now (concurrency capped
 * via JOB_CONCURRENCY). Splitting workers into a separate process is a future
 * scaling step — pg-boss already supports it; we'd just spin up a second
 * service that calls `start()` and `work()`.
 */

// The queue name can be overridden via env var so the integration test can
// run against a dedicated queue (`appforge.generate-app.test`) without
// competing with the live api-server worker for jobs.
export const GENERATE_QUEUE =
  process.env.GENERATE_QUEUE_NAME ?? "appforge.generate-app";

const DEFAULT_CONCURRENCY = 3;
const DEFAULT_MAX_RETRIES = 2;
// 25 minutes. Long enough for the slowest realistic generation (game-3d with
// vision retries) plus headroom; short enough that a stuck worker won't hold a
// slot forever.
const DEFAULT_EXPIRE_SECONDS = 25 * 60;

let bossInstance: PgBoss | null = null;
let workerStarted = false;

/**
 * Boot the queue. Idempotent — safe to call multiple times. Returns the
 * singleton pg-boss instance.
 *
 * Caller is responsible for registering the worker (`registerGenerateWorker`)
 * before any jobs can be processed.
 */
export async function startQueue(): Promise<PgBoss> {
  if (bossInstance) return bossInstance;

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      "DATABASE_URL is required to start the job queue (pg-boss)",
    );
  }

  const boss = new PgBoss({
    connectionString,
    // Defaults are reasonable; keep these explicit so future maintainers see
    // the knobs without digging through docs. `monitorIntervalSeconds`
    // controls how often pg-boss publishes queue metric events.
    monitorIntervalSeconds: 30,
  });

  // Surface internal errors via the shared logger instead of unhandled.
  boss.on("error", (err: unknown) => {
    logger.error({ err }, "pg-boss internal error");
  });

  await boss.start();

  // Create the queue lazily so a fresh DB doesn't 500 on first send. The
  // policy is "standard" — multiple workers can pull jobs in parallel.
  await boss.createQueue(GENERATE_QUEUE);

  bossInstance = boss;
  logger.info("Job queue (pg-boss) started");
  return boss;
}

/**
 * Get the running pg-boss instance, throwing if it hasn't been started.
 * Server boot must call `startQueue()` before any request handler can use
 * this. Routes should NOT call `startQueue()` themselves on demand — that
 * would race with a normal boot and double-create the schema.
 */
export function getQueue(): PgBoss {
  if (!bossInstance) {
    throw new Error("Job queue not started — call startQueue() first");
  }
  return bossInstance;
}

/**
 * Enqueue a generation job. The payload is intentionally tiny: just the
 * jobId. The worker re-loads everything else (prompt, attachments, edit
 * target, model, language, isAdmin) from the `generation_jobs` row, which
 * was persisted in the same transaction as the credit reservation. This
 * keeps the queue payload small and ensures the worker always sees the
 * canonical state of the job in the DB.
 *
 * `singletonKey` is set to the jobId so a re-enqueue at boot (orphan
 * recovery) is naturally deduped — pg-boss will reject the duplicate.
 */
export async function enqueueGenerateJob(jobId: number): Promise<void> {
  const boss = getQueue();
  await boss.send(
    GENERATE_QUEUE,
    { jobId },
    {
      retryLimit: DEFAULT_MAX_RETRIES,
      retryBackoff: true, // Exponential
      retryDelay: 30, // first retry after ~30s, then 60s, then 120s
      expireInSeconds: DEFAULT_EXPIRE_SECONDS,
      singletonKey: `gen-${jobId}`,
      // singletonSeconds covers the whole retry window so resends within
      // that window dedupe.
      singletonSeconds: 60 * 60,
    },
  );
}

/**
 * Force a fresh enqueue for a job that has already been processed (e.g. an
 * admin clicked "Retry" on a failed job). Bypasses the singleton key by
 * appending a nonce — the user explicitly asked for another run.
 */
export async function reenqueueGenerateJob(jobId: number): Promise<void> {
  const boss = getQueue();
  await boss.send(
    GENERATE_QUEUE,
    { jobId },
    {
      retryLimit: DEFAULT_MAX_RETRIES,
      retryBackoff: true,
      retryDelay: 30,
      expireInSeconds: DEFAULT_EXPIRE_SECONDS,
      singletonKey: `gen-${jobId}-${Date.now()}`,
      singletonSeconds: 60 * 60,
    },
  );
}

export interface JobPayload {
  jobId: number;
}

/**
 * Per-attempt context handed to the worker so the handler can distinguish
 * a first attempt from the final retry. `attempt` is 1-indexed (first try is
 * attempt 1); `maxAttempts` = initial + DEFAULT_MAX_RETRIES.
 *
 * The handler MUST throw on transient errors so pg-boss applies its retry +
 * backoff. Only on the final attempt should the handler swallow the error
 * and finalise the row (mark failed, refund, post chat message).
 */
export interface AttemptContext {
  attempt: number;
  maxAttempts: number;
}

export const MAX_ATTEMPTS = DEFAULT_MAX_RETRIES + 1;

export async function registerGenerateWorker(
  handler: (jobId: number, ctx: AttemptContext) => Promise<void>,
): Promise<void> {
  if (workerStarted) {
    logger.warn("registerGenerateWorker called twice — ignoring");
    return;
  }
  const boss = getQueue();

  const concurrency = (() => {
    const raw = process.env.JOB_CONCURRENCY;
    if (!raw) return DEFAULT_CONCURRENCY;
    const n = Number.parseInt(raw, 10);
    if (!Number.isFinite(n) || n < 1) return DEFAULT_CONCURRENCY;
    return Math.min(n, 10); // hard cap to protect the box
  })();

  await boss.work<JobPayload>(
    GENERATE_QUEUE,
    {
      // pg-boss v10+: `batchSize` controls how many jobs are fetched per
      // poll, `pollingIntervalSeconds` controls poll cadence.
      // `includeMetadata: true` is REQUIRED so each job carries `retryCount`
      // (and other metadata fields) — without it we cannot tell a first
      // attempt apart from the third and the handler can't decide whether
      // to re-throw or finalise.
      batchSize: concurrency,
      pollingIntervalSeconds: 1,
      includeMetadata: true,
    },
    async (jobs) => {
      // Run all jobs in the batch concurrently. pg-boss won't hand us more
      // than `batchSize` so this is bounded.
      await Promise.all(
        jobs.map(async (job) => {
          const { jobId } = job.data;
          if (typeof jobId !== "number" || !Number.isFinite(jobId)) {
            logger.error({ jobData: job.data }, "Worker received malformed job payload");
            return;
          }
          // pg-boss v12's JobWithMetadata exposes `retryCount` (camelCase).
          // Older versions / lower-level rows surface it as `retrycount`
          // (lowercase, mapping the raw Postgres column). We accept either
          // to stay forward-compatible. attempt 1 = first run; attempt N =
          // (N-1)th retry. The handler uses this to decide whether a thrown
          // error should be re-thrown (more retries left) or absorbed +
          // finalised.
          const raw = job as QueueWorkJob<JobPayload> & {
            retrycount?: number;
            retryCount?: number;
          };
          const priorRetries =
            typeof raw.retryCount === "number"
              ? raw.retryCount
              : typeof raw.retrycount === "number"
                ? raw.retrycount
                : 0;
          const attempt = priorRetries + 1;
          try {
            await handler(jobId, { attempt, maxAttempts: MAX_ATTEMPTS });
          } catch (err) {
            // Re-throw so pg-boss records the failure and triggers retry/backoff.
            logger.error(
              { err, jobId, queueJobId: job.id, attempt, maxAttempts: MAX_ATTEMPTS },
              "Generation job worker threw — pg-boss will retry if attempts remain",
            );
            throw err;
          }
        }),
      );
    },
  );

  workerStarted = true;
  logger.info({ concurrency }, "Generation worker registered");
}

/**
 * Graceful shutdown for tests/SIGTERM. Best-effort — never throws.
 */
export async function stopQueue(): Promise<void> {
  if (!bossInstance) return;
  try {
    await bossInstance.stop({ graceful: true, timeout: 10_000 });
  } catch (err) {
    logger.warn({ err }, "Error stopping pg-boss");
  }
  bossInstance = null;
  workerStarted = false;
}
