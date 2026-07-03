// Integration test for the persistent generation queue (MongoDB + in-process).
// Run: pnpm --filter @workspace/api-server run test:queue
// Set GENERATE_QUEUE_NAME to use an isolated queue (recommended for CI).
//
// Rewritten from the original Drizzle/pg-boss version (which was left behind
// when the project migrated to Mongoose/MongoDB) to match the current API:
//   - IDs are MongoDB ObjectId strings, not Postgres auto-increment numbers.
//   - All DB operations use Mongoose models (GeneratedApp, GenerationJob, User).
//   - The queue is an in-process polling loop (jobQueue.ts), not pg-boss.
//   - Scenarios 5-7 (pg-boss retry dispatch, retryLimit, getJobById) are
//     adapted to the in-process retry logic which re-queues the row directly.

import { GeneratedApp, GenerationJob, User } from "@workspace/db/schema";
import {
  startQueue,
  stopQueue,
  registerGenerateWorker,
  enqueueGenerateJob,
  GENERATE_QUEUE,
  MAX_ATTEMPTS,
} from "../lib/jobQueue";
import { connectDB } from "../lib/db";
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

async function ensureFixtures(): Promise<{ appId: string }> {
  await connectDB();

  // Ensure test user exists.
  await User.updateOne(
    { _id: TEST_USER_ID },
    { $setOnInsert: { email: TEST_EMAIL, credits: 100 } },
    { upsert: true },
  );

  // Ensure a disposable test app exists.
  let app = await GeneratedApp.findOne({ userId: TEST_USER_ID }).select("_id").lean();
  if (!app) {
    app = await GeneratedApp.create({
      userId: TEST_USER_ID,
      title: "queue-test-app",
      prompt: "queue-test",
      description: "Disposable app row used by queue-recovery integration test.",
      techStack: [],
      frontendCode: "",
      backendCode: "",
    });
  }
  return { appId: String(app._id) };
}

async function cleanup() {
  await connectDB();
  await GenerationJob.deleteMany({ userId: TEST_USER_ID });
  await GeneratedApp.deleteMany({ userId: TEST_USER_ID });
  await User.deleteOne({ _id: TEST_USER_ID });
}

const results: { name: string; ok: boolean; detail: string }[] = [];

function record(name: string, ok: boolean, detail = "") {
  results.push({ name, ok, detail });
  const tag = ok ? "PASS" : "FAIL";
  console.log(`[${tag}] ${name}${detail ? `  — ${detail}` : ""}`);
}

// ── Stub handlers ────────────────────────────────────────────────────────────

/** A worker that marks the row as succeeded so we can observe pickup. */
function makeStubHandler(processedIds: Set<string>) {
  return async (jobId: string, _ctx: { attempt: number; maxAttempts: number }) => {
    processedIds.add(jobId);
    await GenerationJob.findByIdAndUpdate(jobId, {
      $set: { status: "succeeded", phase: "done", progress: 100, updatedAt: new Date() },
    });
  };
}

/**
 * A worker that throws on the first N attempts and only succeeds once the
 * queue has retried it. Used to verify the in-process polling loop really
 * re-enqueues failed jobs.
 */
function makeFlakyHandler(failuresBeforeSuccess: number, attemptsObserved: number[]) {
  let failureCount = 0;
  return async (jobId: string, ctx: { attempt: number; maxAttempts: number }) => {
    attemptsObserved.push(ctx.attempt);
    if (failureCount < failuresBeforeSuccess) {
      failureCount++;
      throw new Error(`forced failure ${failureCount}/${failuresBeforeSuccess}`);
    }
    await GenerationJob.findByIdAndUpdate(jobId, {
      $set: { status: "succeeded", phase: "done", progress: 100, updatedAt: new Date() },
    });
  };
}

// ── DB helpers ───────────────────────────────────────────────────────────────

async function insertJobRow(
  appId: string,
  overrides: Record<string, unknown> = {},
): Promise<string> {
  const job = await GenerationJob.create({
    userId: TEST_USER_ID,
    appId,
    prompt: "queue-recovery-test",
    status: "queued",
    phase: "queued",
    progress: 0,
    coderModel: "auto",
    language: "typescript",
    isAdmin: false,
    ...overrides,
  });
  return String(job._id);
}

async function getJob(id: string) {
  return GenerationJob.findById(id).lean();
}

// ── Scenarios ────────────────────────────────────────────────────────────────

async function runScenario1HappyPath(appId: string) {
  const processed = new Set<string>();
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

async function runScenario2RestartResilience(appId: string) {
  // Stage 1: enqueue, no worker, stop.
  await startQueue();
  const jobId = await insertJobRow(appId);
  await enqueueGenerateJob(jobId);
  await stopQueue();

  // Stage 2: fresh boot, register worker, expect pickup.
  const processed = new Set<string>();
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
    console.error(err);
  }

  record(
    "2. Restart resilience: enqueue → stop → start → pickup",
    pickedUp && processed.has(jobId),
    `jobId=${jobId}`,
  );

  await stopQueue();
}

async function runScenario3OrphanReclaimQueued(appId: string) {
  // Row looks queued but is stale (simulates crash between insert and pickup).
  const staleDate = new Date(Date.now() - 25 * 60 * 1000);
  const jobId = await insertJobRow(appId, {
    status: "queued",
    phase: "queued",
    updatedAt: staleDate,
  });

  const processed = new Set<string>();
  await startQueue();
  await registerGenerateWorker(makeStubHandler(processed));

  // Same reclaim used at boot, scoped to test user.
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
    "3. Orphan reclaim: stale queued row → worker picks up after reclaim",
    pickedUp && processed.has(jobId),
    `jobId=${jobId}`,
  );

  await stopQueue();
}

async function runScenario4StaleRunningFails(appId: string) {
  // Row stuck in "running" for >20 min: reclaim must re-queue or mark failed.
  const twentyOneMinAgo = new Date(Date.now() - 21 * 60 * 1000);
  const jobId = await insertJobRow(appId, {
    status: "running",
    phase: "coding",
    progress: 50,
    createdAt: twentyOneMinAgo,
    updatedAt: twentyOneMinAgo,
  });

  await startQueue();
  // No worker registered: the reclaim should change the row state.
  await reclaimOrphanedJobs();

  const after = await getJob(jobId);
  // reclaimOrphanedJobs either re-queues or marks failed depending on
  // retryCount. Either way, it must no longer be "running".
  const ok = !!after && after.status !== "running";
  record(
    "4. Stale running >20min → reclaimed by reclaimOrphanedJobs",
    ok,
    `jobId=${jobId} status=${after?.status ?? "(missing)"}`,
  );

  await stopQueue();
}

async function runScenario5RetriesAreDispatched(appId: string) {
  // First attempt throws, second succeeds — proves the in-process queue
  // re-enqueues failed jobs and dispatches retries.
  const attempts: number[] = [];
  const handler = makeFlakyHandler(/* failuresBeforeSuccess */ 1, attempts);
  await startQueue();
  await registerGenerateWorker((id, ctx) => handler(id, ctx));

  const jobId = await insertJobRow(appId);
  await enqueueGenerateJob(jobId);

  let succeeded = false;
  try {
    await waitFor(
      `flaky job ${jobId} eventually succeeds`,
      async () => {
        const j = await getJob(jobId);
        return j && j.status === "succeeded" ? j : null;
      },
      30_000,
    );
    succeeded = true;
  } catch (err) {
    console.error(err);
  }

  const sawRetry = attempts.length >= 2;
  record(
    "5. Transient failure → queue retries → eventually succeeds",
    succeeded && sawRetry,
    `attempts=[${attempts.join(",")}]`,
  );

  await stopQueue();
}

async function runScenario6FinalAttemptFinalises(appId: string) {
  // Stub always throws — after MAX_ATTEMPTS the queue must mark the row as
  // failed (not silently leave it in "queued" or "running" forever).
  const attempts: number[] = [];
  const stub = async (jobId: string, ctx: { attempt: number; maxAttempts: number }) => {
    attempts.push(ctx.attempt);
    throw new Error(`forced failure on attempt ${ctx.attempt}`);
  };

  await startQueue();
  await registerGenerateWorker(stub);

  const jobId = await insertJobRow(appId);
  await enqueueGenerateJob(jobId);

  let finalised = false;
  try {
    await waitFor(
      `job ${jobId} reaches failed after ${MAX_ATTEMPTS} attempts`,
      async () => {
        const j = await getJob(jobId);
        return j && j.status === "failed" ? j : null;
      },
      30_000,
    );
    finalised = true;
  } catch (err) {
    console.error(err);
  }

  const after = await getJob(jobId);
  const ok = finalised && attempts.length >= MAX_ATTEMPTS && after?.status === "failed";
  record(
    "6. Retry exhaustion → row finalised as failed",
    ok,
    `attempts=[${attempts.join(",")}] status=${after?.status ?? "(missing)"}`,
  );

  await stopQueue();
}

async function runScenario7NeverSilentlySucceeds(appId: string) {
  // Stub always throws — asserts the row never gets silently flipped to
  // "succeeded" (which happened in the old pg-boss implementation).
  const attempts: number[] = [];
  const stub = async (_jobId: string, ctx: { attempt: number; maxAttempts: number }) => {
    attempts.push(ctx.attempt);
    throw new Error(`handler always throws (attempt ${ctx.attempt})`);
  };

  await startQueue();
  await registerGenerateWorker(stub);

  const jobId = await insertJobRow(appId);
  await enqueueGenerateJob(jobId);

  // Wait until all attempts consumed.
  try {
    await waitFor(
      `job ${jobId} dispatched ${MAX_ATTEMPTS} times`,
      async () => (attempts.length >= MAX_ATTEMPTS ? attempts.length : null),
      30_000,
    );
  } catch (err) {
    console.error(err);
  }
  await sleep(1000); // give the queue a moment to settle

  const after = await getJob(jobId);
  const ok =
    attempts.length >= MAX_ATTEMPTS &&
    after?.status !== "succeeded";
  record(
    "7. Handler throws on every attempt → no silent success",
    ok,
    `attempts=[${attempts.join(",")}] rowStatus=${after?.status ?? "(missing)"}`,
  );

  await stopQueue();
}

async function runScenario8ConcurrentAtomicUpdate(appId: string) {
  // Two concurrent findOneAndUpdate on the same row with an optimistic
  // status guard: exactly one wins (the MongoDB equivalent of the old
  // Postgres RETURNING trick).
  const jobId = await insertJobRow(appId, {
    status: "failed",
    phase: "failed",
    errorMessage: "test-precondition",
    retryCount: 1,
  });

  const guardedUpdate = () =>
    GenerationJob.findOneAndUpdate(
      { _id: jobId, status: "failed" },
      {
        $set: {
          status: "queued",
          phase: "queued",
          progress: 0,
          errorMessage: "",
          updatedAt: new Date(),
        },
        $inc: { retryCount: 1 },
      },
      { new: true },
    );

  // Fire both updates concurrently. MongoDB serialises writes on a single
  // document, so exactly one findOneAndUpdate will match status:"failed";
  // the other will find status:"queued" (already flipped) and return null.
  const [a, b] = await Promise.all([guardedUpdate(), guardedUpdate()]);
  const winners = [a, b].filter((r) => r !== null).length;
  const losers = [a, b].filter((r) => r === null).length;
  const ok = winners === 1 && losers === 1;
  record(
    "8. Concurrent admin retry → single effective transition",
    ok,
    `winners=${winners} losers=${losers}`,
  );
}

// ── Runner ───────────────────────────────────────────────────────────────────

async function main() {
  console.log("=== Queue recovery integration test ===");
  await connectDB();
  await cleanup();
  const { appId } = await ensureFixtures();

  try {
    await runScenario1HappyPath(appId);
    await runScenario2RestartResilience(appId);
    await runScenario3OrphanReclaimQueued(appId);
    await runScenario4StaleRunningFails(appId);
    await runScenario5RetriesAreDispatched(appId);
    await runScenario6FinalAttemptFinalises(appId);
    await runScenario7NeverSilentlySucceeds(appId);
    await runScenario8ConcurrentAtomicUpdate(appId);
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
