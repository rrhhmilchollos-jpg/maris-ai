import { connectDB } from "./db";
import { GenerationJob } from "@workspace/db/schema";
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

async function snapshotFromDb(): Promise<{
  tasks: Array<{ id: string; time: number; status: string }>;
  issues: Array<{ id: string; reason: string }>;
}> {
  await connectDB();

  const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
  const fifteenMinutesAgo = new Date(Date.now() - 15 * 60 * 1000);

  const activeJobs = await GenerationJob.find({
    $or: [
      { updatedAt: { $gte: fiveMinutesAgo } },
      { status: { $in: ["queued", "running"] } },
    ],
  })
    .sort({ createdAt: -1 })
    .limit(100)
    .lean();

  const failedJobs = await GenerationJob.find({
    status: "failed",
    updatedAt: { $gte: fifteenMinutesAgo },
  })
    .sort({ createdAt: -1 })
    .limit(50)
    .lean();

  const now = Date.now();

  const tasks = activeJobs.map((j) => ({
    id: String(j._id),
    status: j.status,
    time: now - new Date(j.createdAt).getTime(),
  }));

  const issues = failedJobs.map((j) => ({
    id: String(j._id),
    reason: j.errorMessage ?? "unknown",
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

export function startSelfMonitor(): void {
  if (started) return;
  started = true;

  agentBus.on("system:optimize", (data: unknown) => {
    logger.info({ data }, "Self-monitor: optimize signal");
  });
  agentBus.on("conflict", (data: unknown) => {
    logger.warn({ data }, "Self-monitor: conflict reported");
  });

  void tick();
  timer = setInterval(() => {
    void tick();
  }, TICK_MS);
  if (typeof timer.unref === "function") timer.unref();

  logger.info({ tickMs: TICK_MS }, "Self-monitor started");
}

export function stopSelfMonitor(): void {
  if (timer) clearInterval(timer);
  timer = null;
  started = false;
}
