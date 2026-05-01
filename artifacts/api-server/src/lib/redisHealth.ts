import IORedis, { type Redis } from "ioredis";
import { logger } from "./logger";

let client: Redis | null = null;
let lastPingOk = false;
let lastPingMs = 0;
let lastPingAt = 0;
let lastError: string | null = null;

/**
 * REDIS_URL must be a TCP/TLS URL that the RESP protocol speaks: `redis://`
 * or `rediss://`. Upstash users frequently paste their REST URL by mistake
 * (`https://...`), which would make ioredis fall back to a Unix socket path
 * and emit reconnection storms. We reject anything that isn't a recognised
 * RESP scheme up front so the rest of the code stays simple.
 */
const RESP_URL_RE = /^rediss?:\/\//i;

export function isRedisConfigured(): boolean {
  const url = process.env.REDIS_URL;
  return Boolean(url) && RESP_URL_RE.test(url!);
}

export function getRedisUrlError(): string | null {
  const url = process.env.REDIS_URL;
  if (!url) return "REDIS_URL not set";
  if (!RESP_URL_RE.test(url)) {
    return "REDIS_URL must start with redis:// or rediss:// (BullMQ/ioredis cannot talk to REST endpoints)";
  }
  return null;
}

/**
 * Lazy singleton ioredis client pointing at REDIS_URL. Configured for the
 * BullMQ migration path: `maxRetriesPerRequest: null` is the explicit
 * setting BullMQ requires for blocking commands. `enableReadyCheck: false`
 * matches Upstash/Redis Cloud guidance for managed providers behind TLS.
 *
 * The client is intentionally created lazily so a missing/broken REDIS_URL
 * never blocks server boot — pingRedis() reports the failure instead.
 */
export function getRedisClient(): Redis | null {
  if (!isRedisConfigured()) return null;
  if (client) return client;
  client = new IORedis(process.env.REDIS_URL!, {
    lazyConnect: true,
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    // Cap reconnection attempts so a bad URL doesn't spam the logs forever.
    // Also stop firing reconnects on any error class — the boot ping and the
    // /admin/redis-ping endpoint will surface the real status on demand.
    retryStrategy: (times: number) => (times > 3 ? null : Math.min(times * 200, 1000)),
    reconnectOnError: () => false,
  });
  client.on("error", (err: Error) => {
    lastError = err.message;
    // Single-line log; keep it terse so a misconfigured URL doesn't dump
    // multi-line stack frames every reconnect attempt.
    logger.warn({ msg: err.message }, "Redis client error");
  });
  return client;
}

export interface RedisStatus {
  configured: boolean;
  lastPingOk: boolean;
  lastPingMs: number;
  lastPingAt: number;
  lastError: string | null;
}

export function getRedisStatus(): RedisStatus {
  const urlError = getRedisUrlError();
  return {
    configured: isRedisConfigured(),
    lastPingOk,
    lastPingMs,
    lastPingAt,
    lastError: urlError ?? lastError,
  };
}

/**
 * Round-trip PING against Redis. Caches the most recent result so the admin
 * metrics endpoint can show it without hitting the network on every read.
 *
 * Always resolves — never throws. Used at boot and from /admin/redis-ping.
 */
export async function pingRedis(): Promise<{
  ok: boolean;
  latencyMs: number;
  error?: string;
}> {
  const start = Date.now();
  const urlError = getRedisUrlError();
  if (urlError) {
    return { ok: false, latencyMs: 0, error: urlError };
  }
  const c = getRedisClient();
  if (!c) {
    return { ok: false, latencyMs: 0, error: "client not initialized" };
  }
  try {
    if (c.status !== "ready" && c.status !== "connecting") {
      await c.connect();
    }
    const reply = await c.ping();
    lastPingOk = reply === "PONG";
    lastPingMs = Date.now() - start;
    lastPingAt = Date.now();
    lastError = lastPingOk ? null : `unexpected reply: ${reply}`;
    return {
      ok: lastPingOk,
      latencyMs: lastPingMs,
      error: lastError ?? undefined,
    };
  } catch (err) {
    lastPingOk = false;
    lastPingMs = Date.now() - start;
    lastPingAt = Date.now();
    lastError = err instanceof Error ? err.message : String(err);
    return { ok: false, latencyMs: lastPingMs, error: lastError };
  }
}

export async function closeRedisClient(): Promise<void> {
  if (client) {
    try {
      await client.quit();
    } catch {
      // ignore
    }
    client = null;
  }
}
