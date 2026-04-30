/**
 * Self-monitor wiring (Fase 9 PRO, real version).
 *
 * Periodically reads real numbers from `generation_jobs` (the pg-boss
 * payload table for app generation) and feeds them into the JS scaffold
 * under `/communication/stateSync.js` and `/self/analyzer.js`. The
 * optimizer then emits `system:optimize` events on the bus, which we
 * forward to the pino logger so they show up in our normal log stream
 * instead of `console.log`.
 *
 * IMPORTANT — what this does NOT do:
 *  - It does NOT mutate pg-boss concurrency in flight. Increasing
 *    workers mid-run requires restarting the worker registration and
 *    is risky to wire blindly. For now we surface the *intent* in the
 *    logs so an operator can react.
 *  - It does NOT publish to a distributed bus. The bridge uses an
 *    in-process EventEmitter, which is fine for a single-instance API
 *    server but won't reach other processes (workers running elsewhere,
 *    horizontal replicas) until the bus is moved to Redis/NATS.
 *
 * Why the long-but-quiet interval? The doc says 10s. In production that
 * floods the logs with empty reports. We default to 30s and only log
 * when there's actual signal (load > 0 OR an optimize event fires).
 */

import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "./logger";
import {
  agentBus,
  agentState,
  agentAnalyzer,
  agentOptimizer,
} from "./agentBusBridge";

const TICK_MS = 30_000;
let started = false;
let timer: NodeJS.Timeout | null = null;

/**
 * Pull a snapshot of real generation-job activity from the database and
 * shape it the way the analyzer expects: an array of
 * `{id, time, status}` for tasks (so `.filter(t => t.time > 3000)` works)
 * and a list of failed-job rows for issues.
 */
async function snapshotFromDb(): Promise<{
  tasks: Array<{ id: number; time: number; status: string }>;
  issues: Array<{ id: number; reason: string }>;
}> {
  // Active or recently-active jobs (last 5 minutes). `time` is duration in
  // ms since createdAt for jobs still running, or full lifetime for those
  // that finished — good enough for the "is anything stuck?" signal.
  const activeRows = await db.execute<{
    id: number;
    status: string;
    time_ms: number;
  }>(sql`
    SELECT
      id,
      status,
      EXTRACT(EPOCH FROM (NOW() - created_at)) * 1000 AS time_ms
    FROM generation_jobs
    WHERE updated_at > NOW() - INTERVAL '5 minutes'
       OR status IN ('queued', 'running')
    ORDER BY id DESC
    LIMIT 100
  `);

  // Failures in the last 15 minutes — what the optimizer cares about.
  const failedRows = await db.execute<{
    id: number;
    error_message: string | null;
  }>(sql`
    SELECT id, error_message
    FROM generation_jobs
    WHERE status = 'failed'
      AND updated_at > NOW() - INTERVAL '15 minutes'
    ORDER BY id DESC
    LIMIT 50
  `);

  const tasks = activeRows.rows.map((r) => ({
    id: Number(r.id),
    status: String(r.status),
    time: Number(r.time_ms ?? 0),
  }));
  const issues = failedRows.rows.map((r) => ({
    id: Number(r.id),
    reason: r.error_message ?? "unknown",
  }));
  return { tasks, issues };
}

async function tick(): Promise<void> {
  try {
    const { tasks, issues } = await snapshotFromDb();
    agentState.updateState({ tasks, issues });
    const report = agentAnalyzer.analyzeSystem();

    if (
      report.load > 0 ||
      report.slowTasks.length > 0 ||
      report.failedTasks.length > 0
    ) {
      logger.info(
        {
          load: report.load,
          slowTasks: report.slowTasks.length,
          failedTasks: report.failedTasks.length,
        },
        "Self-monitor snapshot",
      );
    }

    agentOptimizer.optimize(report);
  } catch (err) {
    logger.warn({ err }, "Self-monitor tick failed");
  }
}

/**
 * Start the periodic self-monitor. Idempotent — safe to call multiple
 * times during boot (only the first call wires anything up).
 *
 * Wires three things:
 *  1. The bus listener that re-routes `system:optimize` events from
 *     console.log into our pino logger.
 *  2. The bus listener for `conflict` events (same reasoning).
 *  3. The tick loop that polls the DB every TICK_MS.
 */
export function startSelfMonitor(): void {
  if (started) return;
  started = true;

  agentBus.on("system:optimize", (data: unknown) => {
    logger.info({ data }, "Self-monitor: optimize signal");
  });
  agentBus.on("conflict", (data: unknown) => {
    logger.warn({ data }, "Self-monitor: conflict reported");
  });

  // Fire once immediately so we don't wait 30s for the first signal,
  // then schedule the recurring tick.
  void tick();
  timer = setInterval(() => {
    void tick();
  }, TICK_MS);
  // Don't keep the event loop alive on its own.
  if (typeof timer.unref === "function") timer.unref();

  logger.info({ tickMs: TICK_MS }, "Self-monitor started");
}

/** Stop the loop. Mainly useful for tests; in production the process exits. */
export function stopSelfMonitor(): void {
  if (timer) clearInterval(timer);
  timer = null;
  started = false;
}
