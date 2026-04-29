import { PgBoss } from "pg-boss";
import { logger } from "./logger";

interface QueueWorkJob<T> {
  id: string;
  data: T;
}

// pg-boss queue for app-generation jobs. Postgres-backed (no Redis required).

export const GENERATE_QUEUE =
  process.env.GENERATE_QUEUE_NAME ?? "appforge.generate-app";

const DEFAULT_CONCURRENCY = 3;
const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_EXPIRE_SECONDS = 25 * 60;

let bossInstance: PgBoss | null = null;
let workerStarted = false;

export async function startQueue(): Promise<PgBoss> {
  if (bossInstance) return bossInstance;

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is required to start the job queue (pg-boss)");
  }

  const boss = new PgBoss({
    connectionString,
    monitorIntervalSeconds: 30,
  });

  boss.on("error", (err: unknown) => {
    logger.error({ err }, "pg-boss internal error");
  });

  await boss.start();
  await boss.createQueue(GENERATE_QUEUE);

  bossInstance = boss;
  logger.info("Job queue (pg-boss) started");
  return boss;
}

export function isQueueReady(): boolean {
  return bossInstance !== null;
}

export function getQueue(): PgBoss {
  if (!bossInstance) {
    throw new Error("Job queue not started — call startQueue() first");
  }
  return bossInstance;
}

// Payload is just the jobId; worker reloads the row from generation_jobs.
// singletonKey dedupes boot-time orphan re-enqueue.
export async function enqueueGenerateJob(jobId: number): Promise<void> {
  const boss = getQueue();
  await boss.send(
    GENERATE_QUEUE,
    { jobId },
    {
      retryLimit: DEFAULT_MAX_RETRIES,
      retryBackoff: true,
      retryDelay: 30,
      expireInSeconds: DEFAULT_EXPIRE_SECONDS,
      singletonKey: `gen-${jobId}`,
      singletonSeconds: 24 * 60 * 60,
    },
  );
}

// Manual admin retry — nonce in singletonKey so it bypasses dedupe.
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
      singletonSeconds: 24 * 60 * 60,
    },
  );
}

export interface JobPayload {
  jobId: number;
}

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

  // includeMetadata: true is required so each job carries retryCount.
  await boss.work<JobPayload>(
    GENERATE_QUEUE,
    { batchSize: concurrency, pollingIntervalSeconds: 1, includeMetadata: true },
    async (jobs) => {
      await Promise.all(
        jobs.map(async (job) => {
          const { jobId } = job.data;
          if (typeof jobId !== "number" || !Number.isFinite(jobId)) {
            logger.error({ jobData: job.data }, "Worker received malformed job payload");
            return;
          }
          // v12 exposes camelCase `retryCount`; accept lowercase too for forward-compat.
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
            logger.error(
              { err, jobId, queueJobId: job.id, attempt, maxAttempts: MAX_ATTEMPTS },
              "Generation job worker threw",
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
