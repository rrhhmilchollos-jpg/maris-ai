/**
 * Integration test for the persistent generation queue.
 *
 * Why this exists:
 *   The whole point of moving generations from setImmediate() onto pg-boss
 *   is restart-resilience. A reviewer can't take "trust me" for that — this
 *   script proves it by exercising the four failure modes that mattered most
 *   in the design:
 *
 *     1. Happy path: enqueue → worker picks up → row updates.
 *     2. Restart resilience: enqueue → STOP queue without processing → start
 *        queue + worker again → worker picks up the leftover job.
 *     3. Orphan reclaim (queued): a row exists in `generation_jobs` with
 *        status="queued" but pg-boss has no entry for it (e.g. crash before
 *        send). Boot's reclaim re-enqueues it; worker processes it.
 *     4. Stale running fail: a row stuck in status="running" for >15min is
 *        marked failed by reclaim (not silently re-enqueued — the user gets
 *        their credit back via the existing failure path).
 *
 * How to run:
 *   pnpm --filter @workspace/api-server run test:queue
 *
 * The test creates one disposable user + one disposable app, runs all four
 * scenarios, prints PASS/FAIL, and cleans up. Exit code 0 on success.
 */

import { db, generationJobs, users, generatedApps } from "@workspace/db";
import { eq } from "drizzle-orm";
import {
  startQueue,
  stopQueue,
  registerGenerateWorker,
  enqueueGenerateJob,
} from "../lib/jobQueue";
import { reclaimOrphanedJobs } from "../routes/apps";

const TEST_USER_ID = "queue-test-user";
const TEST_EMAIL = "queue-test@local.invalid";

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitFor<T>(
  label: string,
  fn: () => Promise<T | null | undefined>,
  timeoutMs = 30_000,
  pollMs = 250,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await fn();
    if (result !== null && result !== undefined) return result;
    await sleep(pollMs);
  }
  throw new Error(`Timed out waiting for: ${label}`);
}

async function ensureFixtures(): Promise<{ appId: number }> {
  await db
    .insert(users)
    .values({ id: TEST_USER_ID, email: TEST_EMAIL, credits: 100 })
    .onConflictDoNothing();

  const existing = await db
    .select({ id: generatedApps.id })
    .from(generatedApps)
    .where(eq(generatedApps.userId, TEST_USER_ID))
    .limit(1);
  if (existing.length > 0) return { appId: existing[0].id };

  const [created] = await db
    .insert(generatedApps)
    .values({
      userId: TEST_USER_ID,
      title: "queue-test-app",
      prompt: "queue-test",
      description: "Disposable app row used by queue-recovery integration test.",
      techStack: [],
      frontendCode: "",
      backendCode: "",
    })
    .returning({ id: generatedApps.id });
  return { appId: created.id };
}

async function cleanup() {
  await db.delete(generationJobs).where(eq(generationJobs.userId, TEST_USER_ID));
  await db.delete(generatedApps).where(eq(generatedApps.userId, TEST_USER_ID));
  await db.delete(users).where(eq(users.id, TEST_USER_ID));
}

const results: { name: string; ok: boolean; detail: string }[] = [];

function record(name: string, ok: boolean, detail = "") {
  results.push({ name, ok, detail });
  const tag = ok ? "PASS" : "FAIL";
  console.log(`[${tag}] ${name}${detail ? `  — ${detail}` : ""}`);
}

/** A worker that just marks the row as succeeded so we can observe pickup. */
function makeStubHandler(processedIds: Set<number>) {
  return async (jobId: number) => {
    processedIds.add(jobId);
    await db
      .update(generationJobs)
      .set({ status: "succeeded", phase: "done", progress: 100, updatedAt: new Date() })
      .where(eq(generationJobs.id, jobId));
  };
}

async function insertJobRow(
  appId: number,
  overrides: Partial<typeof generationJobs.$inferInsert> = {},
): Promise<number> {
  const [row] = await db
    .insert(generationJobs)
    .values({
      userId: TEST_USER_ID,
      appId,
      prompt: "queue-recovery-test",
      status: "queued",
      phase: "queued",
      progress: 0,
      coderModel: "auto",
      language: "typescript",
      attachmentIds: [],
      isAdmin: false,
      ...overrides,
    })
    .returning({ id: generationJobs.id });
  return row.id;
}

async function getJob(id: number) {
  const rows = await db
    .select()
    .from(generationJobs)
    .where(eq(generationJobs.id, id))
    .limit(1);
  return rows[0] ?? null;
}

async function runScenario1HappyPath(appId: number) {
  const processed = new Set<number>();
  await startQueue();
  await registerGenerateWorker(makeStubHandler(processed));

  const jobId = await insertJobRow(appId);
  await enqueueGenerateJob(jobId);

  const final = await waitFor(
    `job ${jobId} processed (happy path)`,
    async () => {
      const j = await getJob(jobId);
      return j && j.status === "succeeded" ? j : null;
    },
  );

  record(
    "1. Happy path: enqueue → worker picks up",
    final.status === "succeeded" && processed.has(jobId),
    `jobId=${jobId} final.status=${final.status}`,
  );

  await stopQueue();
}

async function runScenario2RestartResilience(appId: number) {
  // Stage 1: enqueue without registering a worker, then stop queue.
  await startQueue();
  const jobId = await insertJobRow(appId);
  await enqueueGenerateJob(jobId);
  await stopQueue();

  // Stage 2: fresh boot — start queue + worker. The job should be picked up
  // even though no worker was running when it was sent.
  const processed = new Set<number>();
  await startQueue();
  await registerGenerateWorker(makeStubHandler(processed));

  let pickedUp = false;
  try {
    await waitFor(
      `job ${jobId} processed after restart`,
      async () => {
        const j = await getJob(jobId);
        return j && j.status === "succeeded" ? j : null;
      },
    );
    pickedUp = true;
  } catch (err) {
    pickedUp = false;
    console.error(err);
  }

  record(
    "2. Restart resilience: enqueue → stop → start → pickup",
    pickedUp && processed.has(jobId),
    `jobId=${jobId}`,
  );

  await stopQueue();
}

async function runScenario3OrphanReclaimQueued(appId: number) {
  // Insert a row that LOOKS queued but was never sent to pg-boss (simulating
  // a crash between DB tx commit and queue.send).
  const jobId = await insertJobRow(appId, { status: "queued", phase: "queued" });

  const processed = new Set<number>();
  await startQueue();
  await registerGenerateWorker(makeStubHandler(processed));

  // Run the same reclaim function the server runs at boot. Scoped to the
  // test user so we never touch real users' jobs.
  await reclaimOrphanedJobs({ userId: TEST_USER_ID });

  let pickedUp = false;
  try {
    await waitFor(
      `orphaned job ${jobId} processed after reclaim`,
      async () => {
        const j = await getJob(jobId);
        return j && j.status === "succeeded" ? j : null;
      },
    );
    pickedUp = true;
  } catch (err) {
    console.error(err);
  }

  record(
    "3. Orphan reclaim: queued row → worker picks up after reclaim",
    pickedUp && processed.has(jobId),
    `jobId=${jobId}`,
  );

  await stopQueue();
}

async function runScenario4StaleRunningFails(appId: number) {
  // Insert a row stuck in "running" for 20 minutes — simulates a worker that
  // crashed mid-generation. Reclaim should mark it failed (not silently
  // re-enqueue, because we have no idea how far it got).
  const twentyMinAgo = new Date(Date.now() - 20 * 60 * 1000);
  const jobId = await insertJobRow(appId, {
    status: "running",
    phase: "coding",
    progress: 50,
    createdAt: twentyMinAgo,
    updatedAt: twentyMinAgo,
  });

  await startQueue();
  // No worker registered — we don't want this re-picked up if reclaim
  // misbehaves. A failure here should be observable purely via the row state.
  await reclaimOrphanedJobs();

  const after = await getJob(jobId);
  const ok = !!after && after.status === "failed";
  record(
    "4. Stale running >15min → marked failed by reclaim",
    ok,
    `jobId=${jobId} status=${after?.status ?? "(missing)"}`,
  );

  await stopQueue();
}

async function main() {
  console.log("=== Queue recovery integration test ===");
  await cleanup();
  const { appId } = await ensureFixtures();

  try {
    await runScenario1HappyPath(appId);
    await runScenario2RestartResilience(appId);
    await runScenario3OrphanReclaimQueued(appId);
    await runScenario4StaleRunningFails(appId);
  } finally {
    await stopQueue().catch(() => {});
    await cleanup();
  }

  const failed = results.filter((r) => !r.ok);
  console.log("\n=== Summary ===");
  for (const r of results) {
    console.log(`  ${r.ok ? "PASS" : "FAIL"}  ${r.name}`);
  }
  if (failed.length > 0) {
    console.log(`\n${failed.length} of ${results.length} scenarios FAILED`);
    process.exit(1);
  }
  console.log(`\nAll ${results.length} scenarios PASSED`);
  process.exit(0);
}

main().catch((err) => {
  console.error("Test runner crashed:", err);
  process.exit(2);
});
