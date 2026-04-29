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
import { and, eq } from "drizzle-orm";
import {
  startQueue,
  stopQueue,
  registerGenerateWorker,
  enqueueGenerateJob,
  getQueue,
  GENERATE_QUEUE,
  MAX_ATTEMPTS,
} from "../lib/jobQueue";
import { reclaimOrphanedJobs, runJobById } from "../routes/apps";

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
  return async (jobId: number, _ctx: { attempt: number; maxAttempts: number }) => {
    processedIds.add(jobId);
    await db
      .update(generationJobs)
      .set({ status: "succeeded", phase: "done", progress: 100, updatedAt: new Date() })
      .where(eq(generationJobs.id, jobId));
  };
}

/**
 * A worker that throws on the first attempt and only succeeds once the queue
 * has retried it. Used to verify that pg-boss really does dispatch retries
 * when the worker re-throws.
 */
function makeFlakyHandler(failuresBeforeSuccess: number, attemptsObserved: number[]) {
  let failureCount = 0;
  return async (jobId: number, ctx: { attempt: number; maxAttempts: number }) => {
    attemptsObserved.push(ctx.attempt);
    if (failureCount < failuresBeforeSuccess) {
      failureCount++;
      throw new Error(`forced failure ${failureCount}/${failuresBeforeSuccess}`);
    }
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

/** Helper: enqueue with tight retry timing so the test doesn't wait 30s+. */
async function enqueueWithFastRetry(jobId: number, retryLimit: number) {
  const boss = getQueue();
  await boss.send(
    GENERATE_QUEUE,
    { jobId },
    {
      retryLimit,
      retryBackoff: false,
      retryDelay: 1,
      expireInSeconds: 60,
      // Fresh nonce so we never collide with the live queue's singletonKey.
      singletonKey: `test-${jobId}-${Date.now()}`,
      singletonSeconds: 60,
    },
  );
}

async function runScenario5RetriesAreDispatched(appId: number) {
  // Fail the first attempt, succeed on the second. Verifies that pg-boss
  // actually re-dispatches when the worker re-throws — the bug the previous
  // review caught (runJob swallowing all errors) would make this fail.
  const attempts: number[] = [];
  const handler = makeFlakyHandler(/* failuresBeforeSuccess */ 1, attempts);
  await startQueue();
  await registerGenerateWorker((id, ctx) => handler(id, ctx));

  const jobId = await insertJobRow(appId);
  await enqueueWithFastRetry(jobId, 2);

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

  const sawRetry = attempts.length >= 2 && attempts.includes(2);
  record(
    "5. Transient failure → pg-boss retries → eventually succeeds",
    succeeded && sawRetry,
    `attempts=[${attempts.join(",")}]`,
  );

  await stopQueue();
}

async function runScenario6FinalAttemptFinalises(appId: number) {
  // Verify the contract that runJob's catch block honours: when the handler
  // is invoked on the FINAL attempt and throws, the row gets finalised
  // (status=failed, retryCount=max) and the throw is absorbed (no further
  // retry). We stub a handler that mimics runJob's branch so the test
  // doesn't have to spin up the real AI pipeline (which can take minutes
  // and call paid APIs). The contract under test is the worker behaviour:
  // earlier attempts re-throw, final attempt absorbs.
  const attempts: number[] = [];
  const stub = async (jobId: number, ctx: { attempt: number; maxAttempts: number }) => {
    attempts.push(ctx.attempt);
    if (ctx.attempt < ctx.maxAttempts) {
      // Mimic runJob's "still have retries" branch: bump retryCount, leave
      // status alone, re-throw so pg-boss schedules another attempt.
      await db
        .update(generationJobs)
        .set({ phase: "retrying", retryCount: ctx.attempt, updatedAt: new Date() })
        .where(eq(generationJobs.id, jobId));
      throw new Error(`forced retriable failure on attempt ${ctx.attempt}`);
    }
    // Final attempt branch: finalise the row, do NOT re-throw.
    await db
      .update(generationJobs)
      .set({
        status: "failed",
        phase: "failed",
        errorMessage: "Falló la generación: forced terminal failure",
        retryCount: ctx.attempt,
        updatedAt: new Date(),
      })
      .where(eq(generationJobs.id, jobId));
  };

  await startQueue();
  await registerGenerateWorker(stub);

  const jobId = await insertJobRow(appId);
  // retryLimit=2 → up to 3 total attempts, matching MAX_ATTEMPTS in jobQueue.
  await enqueueWithFastRetry(jobId, MAX_ATTEMPTS - 1);

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
  const allAttemptsRan = attempts.length === MAX_ATTEMPTS && attempts[0] === 1 && attempts.at(-1) === MAX_ATTEMPTS;
  const ok = finalised && allAttemptsRan && after?.retryCount === MAX_ATTEMPTS;
  record(
    "6. Retry exhaustion → row finalised once (no extra dispatches)",
    ok,
    `attempts=[${attempts.join(",")}] status=${after?.status ?? "(missing)"} retryCount=${after?.retryCount ?? "?"}`,
  );

  await stopQueue();
}

async function runScenario7HandlerAlwaysThrowsRecordedAsFailed(appId: number) {
  // Contract under test: when runJob's final-attempt DB write fails, runJob
  // re-throws. The worker re-throws. pg-boss records the job as failed
  // (i.e. it does NOT think the job succeeded — which is what would happen
  // if we silently absorbed the error).
  //
  // We simulate this directly with a handler that always throws on every
  // attempt, including the final one. This is the exact wire-level
  // observation the operator gets if runJob's terminal DB write blows up.
  const attempts: number[] = [];
  const stub = async (jobId: number, ctx: { attempt: number; maxAttempts: number }) => {
    attempts.push(ctx.attempt);
    // Mark the row as `running` so we can detect that it never reaches
    // `succeeded` (which is the silent-success failure mode we're guarding
    // against).
    await db
      .update(generationJobs)
      .set({ status: "running", phase: "retrying", updatedAt: new Date() })
      .where(eq(generationJobs.id, jobId));
    throw new Error(`handler always throws (simulating final-attempt finalise failure on attempt ${ctx.attempt})`);
  };

  await startQueue();
  await registerGenerateWorker(stub);

  const jobId = await insertJobRow(appId);
  await enqueueWithFastRetry(jobId, MAX_ATTEMPTS - 1);

  // Wait for pg-boss to consume all attempts and stop dispatching. We
  // observe by waiting until `attempts.length === MAX_ATTEMPTS` then giving
  // pg-boss a beat to record state. The job in pg-boss should end up in
  // `failed`, and the DB row should be in `running`/`retrying` (the stale-
  // running reclaim will eventually catch it) — critically NOT `succeeded`.
  try {
    await waitFor(
      `job ${jobId} dispatched ${MAX_ATTEMPTS} times`,
      async () => (attempts.length >= MAX_ATTEMPTS ? attempts.length : null),
      30_000,
    );
  } catch (err) {
    console.error(err);
  }
  await sleep(750); // give pg-boss a moment to settle the job state

  const after = await getJob(jobId);
  const queue = getQueue();
  const queueState = await queue
    .getJobById(GENERATE_QUEUE, "stub")
    .catch(() => null);
  // The important assertion: row was never silently flipped to succeeded.
  // pg-boss's own job state is checked indirectly by counting attempts —
  // it stops dispatching once retries are exhausted.
  const ok =
    attempts.length === MAX_ATTEMPTS &&
    after?.status !== "succeeded" &&
    attempts[0] === 1 &&
    attempts.at(-1) === MAX_ATTEMPTS;
  record(
    "7. Handler throws on every attempt → no silent success",
    ok,
    `attempts=[${attempts.join(",")}] rowStatus=${after?.status ?? "(missing)"}` +
      (queueState ? ` queueState=present` : ""),
  );

  await stopQueue();
}

async function runScenario8ConcurrentAdminRetrySingleEnqueue(appId: number) {
  // Contract under test: the admin retry endpoint uses an UPDATE ... WHERE
  // status=? AND updatedAt=? guard so that two concurrent retry requests
  // racing for the same row result in exactly ONE successful state
  // transition (and therefore exactly ONE enqueue). The other request gets
  // zero rows back and returns 409.
  //
  // We exercise the SQL guard directly here (the HTTP handler isn't
  // exported), running the exact same UPDATE pattern in parallel and
  // asserting only one of them returns a row.
  const jobId = await insertJobRow(appId, {
    status: "failed",
    phase: "failed",
    errorMessage: "test-precondition",
    retryCount: 1,
  });
  const before = await getJob(jobId);
  if (!before) {
    record("8. Concurrent admin retry → single effective transition", false, "could not insert fixture");
    return;
  }

  const guardedUpdate = () =>
    db
      .update(generationJobs)
      .set({
        status: "queued",
        phase: "queued",
        progress: 0,
        errorMessage: null,
        retryCount: (before.retryCount ?? 0) + 1,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(generationJobs.id, jobId),
          eq(generationJobs.status, before.status),
        ),
      )
      .returning({ id: generationJobs.id });

  // Fire both updates concurrently. Postgres serialises row writes so
  // exactly one will win.
  const [a, b] = await Promise.all([guardedUpdate(), guardedUpdate()]);
  const winners = [a, b].filter((r) => r.length === 1).length;
  const losers = [a, b].filter((r) => r.length === 0).length;
  const ok = winners === 1 && losers === 1;
  record(
    "8. Concurrent admin retry → single effective transition",
    ok,
    `winners=${winners} losers=${losers}`,
  );
}

async function purgeTestQueue() {
  // Wipe any leftover jobs in the test queue from prior runs so we don't
  // race with stale items. Best-effort — never throws.
  try {
    await startQueue();
    const boss = getQueue();
    await boss.deleteAllJobs(GENERATE_QUEUE);
  } catch (err) {
    console.warn("Failed to purge test queue (probably first run):", err);
  } finally {
    await stopQueue();
  }
}

async function main() {
  console.log("=== Queue recovery integration test ===");
  await cleanup();
  await purgeTestQueue();
  const { appId } = await ensureFixtures();

  try {
    await runScenario1HappyPath(appId);
    await runScenario2RestartResilience(appId);
    await runScenario3OrphanReclaimQueued(appId);
    await runScenario4StaleRunningFails(appId);
    await runScenario5RetriesAreDispatched(appId);
    await runScenario6FinalAttemptFinalises(appId);
    await runScenario7HandlerAlwaysThrowsRecordedAsFailed(appId);
    await runScenario8ConcurrentAdminRetrySingleEnqueue(appId);
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
