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

export const GENERATE_QUEUE = "appforge.generate-app";

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
 * Register the worker that processes the generation queue. Called once on
 * boot. Concurrency is bounded by JOB_CONCURRENCY (default 3) so a flurry of
 * heavy jobs doesn't OOM the api-server.
 *
 * `handler` is the function that knows how to actually run a generation
 * given the jobId — passed in to keep this module decoupled from the apps
 * route's internals.
 */
export async function registerGenerateWorker(
  handler: (jobId: number) => Promise<void>,
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
      batchSize: concurrency,
      pollingIntervalSeconds: 1,
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
          try {
            await handler(jobId);
          } catch (err) {
            // Re-throw so pg-boss records the failure and triggers retry/backoff.
            logger.error({ err, jobId, queueJobId: job.id }, "Generation job worker threw");
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
