// jobQueue.ts — ROUTER entre las dos implementaciones de cola de trabajos.
//
// A petición explícita del usuario ("lo de redis hay que hacerlo sí o sí"):
// en vez de sustituir directamente el sistema que funciona hoy (single
// instance, sondeo a MongoDB — ver jobQueueMongo.ts) por el sistema
// escalable con Redis/BullMQ (multi-instancia — ver jobQueue-bullmq.ts),
// este archivo decide automáticamente cuál usar:
//
//   - Si REDIS_URL está configurada (Ivan la añade en Coolify) → BullMQ.
//   - Si no está configurada → sigue exactamente como hasta ahora, Mongo.
//
// Esto es deliberadamente el camino MÁS SEGURO posible para esta migración:
// el código nuevo se despliega ya, pero el comportamiento en producción NO
// cambia ni un poco hasta que Ivan decida activar Redis añadiendo la
// variable — y si algo fuera mal con la versión de Redis en algún momento,
// basta con quitar la variable de entorno para volver instantáneamente al
// sistema de siempre, sin tocar código ni hacer un nuevo despliegue.
//
// Ambos archivos exportan exactamente la misma superficie de funciones
// (verificado a mano antes de conectar esto: mismas firmas en
// startQueue/isQueueReady/stopQueue/enqueueGenerateJob/
// reenqueueGenerateJob/registerGenerateWorker), así que este router no
// necesita ninguna lógica de adaptación, solo elegir cuál reexportar.
import { isRedisConfigured } from "./redisHealth";
import { logger } from "./logger";
import * as mongoImpl from "./jobQueueMongo";
import * as redisImpl from "./jobQueue-bullmq";

const useRedis = isRedisConfigured();
const impl = useRedis ? redisImpl : mongoImpl;

logger.info(
  { queueBackend: useRedis ? "redis-bullmq" : "mongo-polling" },
  useRedis
    ? "Job queue: usando Redis/BullMQ (escalable, multi-instancia) — REDIS_URL detectada"
    : "Job queue: usando MongoDB polling (comportamiento de siempre) — REDIS_URL no configurada",
);

export const GENERATE_QUEUE = impl.GENERATE_QUEUE;
export type JobPayload = mongoImpl.JobPayload;
export type AttemptContext = mongoImpl.AttemptContext;

export const startQueue = impl.startQueue;
export const isQueueReady = impl.isQueueReady;
export const stopQueue = impl.stopQueue;
export const enqueueGenerateJob = impl.enqueueGenerateJob;
export const reenqueueGenerateJob = impl.reenqueueGenerateJob;
export const registerGenerateWorker = impl.registerGenerateWorker;

// MAX_ATTEMPTS solo existe en la version Mongo (uso interno suyo) -- se
// reexporta igualmente por si algun otro archivo llegara a necesitarlo,
// con el mismo valor fijo (3) que ya usa la version de Redis.
export const MAX_ATTEMPTS = 3;
