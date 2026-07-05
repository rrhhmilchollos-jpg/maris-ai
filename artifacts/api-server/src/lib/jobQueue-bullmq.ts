import { Queue, Worker, QueueEvents } from "bullmq";
import { connectDB } from "./db";
import { GenerationJob } from "@workspace/db/schema";
import { logger } from "./logger";
import Redis from "ioredis";

// ---------------------------------------------------------------------------
// BullMQ-based job queue for massive parallel processing.
// 
// Design:
//   - Jobs are stored in Redis (BullMQ) for fast, distributed processing.
//   - Multiple workers can process jobs in parallel across different instances.
//   - Concurrency is unlimited (scales horizontally with more Render instances).
//   - Each job is tied to a userId for strict multitenancy isolation.
//   - MongoDB is used for persistence and audit trail.
// ---------------------------------------------------------------------------

export const GENERATE_QUEUE = process.env.GENERATE_QUEUE_NAME ?? "appforge.generate-app";

const DEFAULT_CONCURRENCY = process.env.JOB_CONCURRENCY 
  ? Math.max(1, Math.min(Number.parseInt(process.env.JOB_CONCURRENCY, 10), 100))
  : 10;

export interface JobPayload {
  jobId: string;
  userId: string; // CRITICAL: Multitenancy isolation
}

export interface AttemptContext {
  attempt: number;
  maxAttempts: number;
}

type JobHandler = (jobId: string, ctx: AttemptContext) => Promise<void>;

let queue: Queue | null = null;
let worker: Worker | null = null;
let queueEvents: QueueEvents | null = null;
let redisConnection: Redis | null = null;
let registeredHandler: JobHandler | null = null;
let isStarted = false;

// ---------------------------------------------------------------------------
// Helper: Get Redis connection
// ---------------------------------------------------------------------------

function getRedisConnection(): Redis {
  if (redisConnection) return redisConnection;
  
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) {
    throw new Error("REDIS_URL environment variable is required for BullMQ");
  }
  
  redisConnection = new Redis(redisUrl, {
    maxRetriesPerRequest: null, // Required for BullMQ blocking commands
    enableReadyCheck: false,
    enableOfflineQueue: true,
  });
  
  redisConnection.on("error", (err) => {
    logger.error({ err }, "Redis connection error");
  });
  
  return redisConnection;
}

// ---------------------------------------------------------------------------
// Queue lifecycle
// ---------------------------------------------------------------------------

export async function startQueue(): Promise<void> {
  if (isStarted) return;
  
  try {
    await connectDB();
    
    const redis = getRedisConnection();
    
    // Initialize BullMQ queue
    queue = new Queue(GENERATE_QUEUE, { connection: redis });
    queueEvents = new QueueEvents(GENERATE_QUEUE, { connection: redis });
    
    // Listen to queue events for logging
    queueEvents.on("completed", ({ jobId }) => {
      logger.info({ jobId }, "Job completed via BullMQ");
    });
    
    queueEvents.on("failed", ({ jobId, failedReason }) => {
      logger.error({ jobId, failedReason }, "Job failed via BullMQ");
    });
    
    isStarted = true;
    logger.info({ concurrency: DEFAULT_CONCURRENCY }, "BullMQ job queue started");
  } catch (err) {
    logger.error({ err }, "Failed to start BullMQ queue");
    throw err;
  }
}

export function isQueueReady(): boolean {
  return isStarted && queue !== null;
}

export async function stopQueue(): Promise<void> {
  try {
    if (worker) {
      await worker.close();
      worker = null;
    }
    if (queueEvents) {
      await queueEvents.close();
      queueEvents = null;
    }
    if (queue) {
      await queue.close();
      queue = null;
    }
    if (redisConnection) {
      await redisConnection.quit();
      redisConnection = null;
    }
    isStarted = false;
    logger.info("BullMQ queue stopped");
  } catch (err) {
    logger.error({ err }, "Error stopping BullMQ queue");
  }
}

// ---------------------------------------------------------------------------
// Enqueue
// ---------------------------------------------------------------------------

/**
 * Add a generation job to the BullMQ queue.
 * The job will be picked up by any available worker immediately.
 * No waiting, no global queue bottleneck.
 */
export async function enqueueGenerateJob(jobId: string): Promise<void> {
  if (!queue) {
    throw new Error("Queue not initialized. Call startQueue() first.");
  }
  
  try {
    await connectDB();
    
    // Fetch the job to get userId for multitenancy isolation
    const job = await GenerationJob.findById(jobId, { userId: 1 }).lean();
    if (!job) {
      logger.warn({ jobId }, "Job not found in MongoDB, cannot enqueue");
      return;
    }
    
    // Add to BullMQ with userId in the payload for isolation
    const payload: JobPayload = { jobId, userId: job.userId };
    
    await queue.add(
      `generate-${jobId}`,
      payload,
      {
        jobId, // Use jobId as BullMQ job ID for deduplication
        attempts: 3,
        backoff: { type: "exponential", delay: 2000 },
        removeOnComplete: true,
        removeOnFail: false,
      }
    );
    
    logger.info({ jobId, userId: job.userId }, "Job enqueued to BullMQ");
  } catch (err) {
    logger.error({ err, jobId }, "Failed to enqueue job to BullMQ");
  }
}

/**
 * Admin manual retry — re-enqueues a job regardless of current status.
 */
export async function reenqueueGenerateJob(jobId: string): Promise<void> {
  await connectDB();
  await GenerationJob.findByIdAndUpdate(jobId, {
    $set: { status: "queued", phase: "queued", retryCount: 0 },
  });
  
  // Re-add to BullMQ
  await enqueueGenerateJob(jobId);
}

// ---------------------------------------------------------------------------
// Worker registration + processing
// ---------------------------------------------------------------------------

export async function registerGenerateWorker(
  handler: JobHandler,
): Promise<void> {
  if (registeredHandler) {
    logger.warn("registerGenerateWorker called twice — ignoring");
    return;
  }
  
  if (!queue) {
    throw new Error("Queue not initialized. Call startQueue() first.");
  }
  
  registeredHandler = handler;
  
  const redis = getRedisConnection();
  
  // Create BullMQ worker with parallel processing
  worker = new Worker(
    GENERATE_QUEUE,
    async (bullJob) => {
      const payload = bullJob.data as JobPayload;
      const { jobId, userId } = payload;
      
      try {
        await connectDB();
        
        // CRITICAL: Verify userId ownership before processing
        const job = await GenerationJob.findOne(
          { _id: jobId, userId }, // Multitenancy filter
          { userId: 1 }
        ).lean();
        
        if (!job) {
          throw new Error(
            `Security: Job ${jobId} does not belong to user ${userId}. Rejecting.`
          );
        }

        // ENCONTRADO ANTES DE ACTIVAR ESTA COLA (a peticion del usuario,
        // revision completa antes de conectar): jobQueueMongo.ts limita a 1
        // generacion activa por usuario a la vez (para que un solo cliente
        // no acapare toda la capacidad concurrente) -- esta version de
        // Redis no tenia ninguna proteccion equivalente. Se anade la misma
        // regla aqui, consultando MongoDB directamente (no una variable en
        // memoria, porque con Redis puede haber VARIAS instancias
        // procesando a la vez -- la comprobacion tiene que valer para todas
        // ellas, no solo para el proceso local).
        const runningInDB = await GenerationJob.countDocuments({
          userId,
          status: "running",
          _id: { $ne: jobId },
        });
        if (runningInDB >= 1) {
          logger.info({ jobId, userId, runningInDB }, "Usuario ya tiene un job corriendo — reencolando para más tarde en vez de procesar en paralelo");
          // Reencolar con un pequeño retraso en vez de procesar ahora mismo
          // -- lanzar un error normal haría que BullMQ lo cuente como
          // "intento fallido" (gastando reintentos sin necesidad), así que
          // se reencola explícitamente con backoff propio.
          await queue!.add(
            `generate-${jobId}`,
            { jobId, userId } as JobPayload,
            { jobId: `${jobId}-retry-${Date.now()}`, delay: 5_000, attempts: 1, removeOnComplete: true },
          );
          return;
        }
        
        // Update status to running
        await GenerationJob.findByIdAndUpdate(jobId, {
          $set: { status: "running", updatedAt: new Date() },
        });
        
        // Execute the handler
        const attempt = (bullJob.attemptsMade ?? 0) + 1;
        await handler(jobId, { attempt, maxAttempts: 3 });
        
        // ENCONTRADO Y CORREGIDO ANTES DE ACTIVAR ESTA COLA (a peticion del
        // usuario, tras revisar a fondo antes de conectar nada): este bloque
        // marcaba el job como "succeeded" INCONDICIONALMENTE en cuanto el
        // handler (runJobById, definido en apps.ts) terminaba sin lanzar
        // error -- pero runJobById ya gestiona su PROPIO estado final de
        // forma mucho mas matizada (incluido "reviewing" para el sistema de
        // garantia de primera generacion construido antes en esta misma
        // sesion, que oculta al cliente una app que no supero el control de
        // calidad hasta que un admin la revise). Sobrescribir aqui a
        // "succeeded" sin condicion habria roto esa logica en silencio --
        // la app habria pasado a "succeeded" igualmente aunque runJobById
        // hubiera decidido "reviewing". Ahora, igual que hace la version
        // Mongo (jobQueueMongo.ts): NO tocar el estado si el handler ya
        // termino sin error -- el propio handler es la fuente de verdad de
        // su estado final.
        logger.info({ jobId, userId }, "Job handler completado sin errores");
      } catch (err) {
        logger.error(
          { err, jobId, userId, attempt: bullJob.attemptsMade },
          "Job processing error"
        );

        // Misma comprobación defensiva que jobQueueMongo.ts: si el job ya
        // quedó marcado como éxito (o en revisión, por el sistema de
        // garantía de primera generación) por el propio handler antes de
        // que este catch se disparase, no lo pisamos con un fallo.
        const currentJob = await GenerationJob.findById(jobId).select("status").lean() as any;
        if (currentJob?.status === "succeeded" || currentJob?.status === "reviewing") {
          logger.info({ jobId, status: currentJob.status }, "Job ya resuelto por el handler — ignorando el catch del worker");
          return;
        }
        
        // Update job with error context, but only mark as terminal failure if attempts are exhausted
        const isFinalAttempt = (bullJob.attemptsMade ?? 0) + 1 >= (bullJob.opts.attempts ?? 3);
        await GenerationJob.findByIdAndUpdate(jobId, {
          $set: {
            status: isFinalAttempt ? "failed" : "queued",
            phase: isFinalAttempt ? "failed" : "retrying",
            errorMessage: err instanceof Error ? err.message : "Unknown error",
            updatedAt: new Date(),
          },
          $inc: { retryCount: 1 }
        }).catch(() => {});
        
        // Re-throw so BullMQ retries according to backoff strategy
        throw err;
      }
    },
    {
      connection: redis,
      concurrency: DEFAULT_CONCURRENCY, // Parallel workers on this instance
      lockDuration: 420_000, // 7 minutes — must exceed max job duration (5min frontend + overhead)
      lockRenewTime: 120_000, // Renew lock every 2 minutes (must be < lockDuration/3)
    }
  );
  
  worker.on("completed", (job) => {
    logger.info({ jobId: job.id }, "BullMQ worker completed job");
  });
  
  worker.on("failed", (job, err) => {
    logger.error({ jobId: job?.id, err }, "BullMQ worker failed job");
  });
  
  logger.info(
    { concurrency: DEFAULT_CONCURRENCY, queueName: GENERATE_QUEUE },
    "BullMQ worker registered and listening for jobs"
  );
}
