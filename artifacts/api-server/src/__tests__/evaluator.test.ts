/**
 * Unit tests for the autonomous evaluator's pure helpers.
 *
 * We don't try to spin up Puppeteer or hit Anthropic in this test — those
 * are exercised end-to-end against a real Maris AI preview. What we DO want
 * locked in is:
 *
 *   1. `normalizeVerdict` correctly tolerates the small variations Claude
 *      emits (pass-as-bool, missing fields, malformed issues, fenced JSON,
 *      …) and never returns "pass" while listing critical issues.
 *
 *   2. `formatIssuesForPatcher` drops minor issues, caps the list, and
 *      synthesises a usable fallback `fix` string when the model omits one.
 *
 * Run via:  pnpm --filter @workspace/api-server run test:evaluator
 */
import {
  normalizeVerdict,
  formatIssuesForPatcher,
  runAutoEvaluator,
  type EvaluatorReport,
} from "../lib/evaluator.js";
import pino from "pino";
import { generatedApps, users } from "@workspace/db/schema";

let failed = 0;
function check(label: string, cond: boolean, detail?: unknown): void {
  if (cond) {
    console.log(`  ✓ ${label}`);
  } else {
    failed++;
    console.error(`  ✗ ${label}`, detail ?? "");
  }
}

console.log("normalizeVerdict");
{
  const out = normalizeVerdict(null, "fallback");
  check("null payload → fail", out.verdict === "fail");
  check("null payload → fallback summary", out.summary === "fallback");
  check("null payload → no issues", out.issues.length === 0);
}
{
  const out = normalizeVerdict(
    { verdict: "PASS", summary: "todo bien", issues: [] },
    "x",
  );
  check("uppercase 'PASS' → pass", out.verdict === "pass");
  check("preserves summary", out.summary === "todo bien");
}
{
  const out = normalizeVerdict({ pass: true, summary: "ok" }, "x");
  check("legacy {pass:true} → pass", out.verdict === "pass");
}
{
  const out = normalizeVerdict(
    {
      verdict: "pass",
      summary: "se ve bien",
      issues: [
        { severity: "critical", description: "blank screen", fix: "render shell" },
      ],
    },
    "x",
  );
  check(
    "pass + critical issue → coerced to fail (safety net)",
    out.verdict === "fail",
  );
  check("critical issue retained", out.issues[0].severity === "critical");
}
{
  const out = normalizeVerdict(
    {
      verdict: "fail",
      issues: [
        { severity: "weird", description: "x", fix: "y" } as never,
        { description: "no severity" } as never,
        { severity: "minor", description: "" } as never,
      ],
    },
    "fb",
  );
  check("unknown severity → defaults to major", out.issues[0].severity === "major");
  check("missing severity → defaults to major", out.issues[1].severity === "major");
  check(
    "empty description filtered out",
    out.issues.every((i) => i.description.length > 0),
  );
}

console.log("formatIssuesForPatcher");
{
  const issues = [
    { severity: "critical" as const, description: "A", fix: "fixA" },
    { severity: "minor" as const, description: "B", fix: "fixB" },
    { severity: "major" as const, description: "C", fix: "" },
  ];
  const out = formatIssuesForPatcher(issues);
  check("drops minor severity", out.every((i) => !i.problem.includes("[minor]")));
  check("count after drop", out.length === 2);
  check("synthesises fallback fix", out[1].fix.length > 0);
  check("file slot is unique-ish", new Set(out.map((i) => i.file)).size === out.length);
}
{
  const tooMany = Array.from({ length: 10 }, (_, idx) => ({
    severity: "major" as const,
    description: `desc ${idx}`,
    fix: `fix ${idx}`,
  }));
  const out = formatIssuesForPatcher(tooMany);
  check("caps at 6 issues", out.length === 6);
}

/* ------------------------------------------------------------------ */
/* Integration tests for runAutoEvaluator                              */
/* ------------------------------------------------------------------ */
/*
 * These exercise the full state machine of the evaluator against the real
 * database, but with the slow / network-bound parts (Puppeteer + Anthropic
 * vision, Anthropic patcher, email transport, deploy bundle) replaced by
 * deterministic fakes via the `__evaluator` / `__patcher` / `__notifier` /
 * `__deploy` injection points.
 *
 * Coverage:
 *   3a. Three consecutive fail rounds → status=needs_review, no auto-publish,
 *       deploy NOT invoked, evaluatorSummary persisted.
 *   3b. Pass on first round + autoPublish=true → deploy invoked exactly once,
 *       email notifier invoked, autoPublish result is true with deploy URL.
 *   3c. Pass on first round + autoPublish=false → deploy NOT invoked,
 *       email NOT invoked, status stays ready.
 */
async function setupTestApp(opts: {
  autoPublish: boolean;
  plannedPages?: Array<{ name: string; route?: string; purpose?: string }>;
}): Promise<{ appId: number; userId: string }> {
  const userId = `test_evaluator_${Date.now()}_${Math.random()
    .toString(36)
    .slice(2, 8)}`;
  await db.insert(users).values({
    id: userId,
    email: `${userId}@test.local`,
    fullName: "Evaluator Integration Test",
    credits: 0,
  });
  const [row] = await db
    .insert(generatedApps)
    .values({
      userId,
      title: "Test App",
      description: "Integration test app",
      prompt: "Build a thing",
      techStack: ["React"],
      frontendCode: "// stub frontend\nexport default function App(){return null}",
      backendCode: "",
      status: "ready",
      autoPublish: opts.autoPublish,
      plannedPages: opts.plannedPages ?? null,
    })
    .returning();
  return { appId: row.id, userId };
}

async function cleanupTestApp(userId: string): Promise<void> {
  await db.delete(generatedApps).where(eq(generatedApps.userId, userId));
  await db.delete(users).where(eq(users.id, userId));
}

const silentLog = pino({ level: "silent" }) as unknown as Parameters<
  typeof runAutoEvaluator
>[0]["log"];

console.log("\nrunAutoEvaluator (integration)");

(async () => {
  // 3a. Three fail rounds → needs_review, no deploy, no notify.
  {
    const { appId, userId } = await setupTestApp({ autoPublish: true });
    let evalCalls = 0;
    let patcherCalls = 0;
    let deployCalls = 0;
    let notifyCalls = 0;
    try {
      const result = await runAutoEvaluator({
        appId,
        userId,
        userIntent: "build a thing",
        jobId: 0,
        baseUrl: "http://localhost:80",
        log: silentLog,
        __evaluator: async (): Promise<EvaluatorReport> => {
          evalCalls++;
          return {
            verdict: "fail",
            summary: "blank",
            issues: [
              { severity: "critical", description: "blank screen", fix: "render shell" },
            ],
            screenshots: [],
          };
        },
        __patcher: async () => {
          patcherCalls++;
          return "// patched bundle";
        },
        __notifier: async () => {
          notifyCalls++;
        },
        __deploy: async () => {
          deployCalls++;
          return { url: "https://example.test/p/x", slug: "x" };
        },
      });
      check(
        "3a: 3 fail rounds → finalVerdict=fail",
        result.finalVerdict === "fail",
        result,
      );
      check("3a: not autoPublished", result.autoPublished === false);
      check("3a: deploy NEVER invoked", deployCalls === 0);
      check("3a: notifier NEVER invoked", notifyCalls === 0);
      // Loop runs at least once, may early-break after a patcher cycle when
      // the (faked) bundle fails the structural sanity check. Either way the
      // public contract — fail verdict + no auto-publish — must hold.
      check("3a: evaluator called at least once", evalCalls >= 1, { evalCalls });
      check("3a: patcher attempted at least once", patcherCalls >= 1, {
        patcherCalls,
      });
      const [persisted] = await db
        .select({
          status: generatedApps.status,
          summary: generatedApps.evaluatorSummary,
        })
        .from(generatedApps)
        .where(eq(generatedApps.id, appId));
      check(
        "3a: status persisted as needs_review",
        persisted?.status === "needs_review",
        persisted,
      );
      check(
        "3a: evaluatorSummary persisted",
        typeof persisted?.summary === "string" && persisted.summary.length > 0,
      );
    } finally {
      await cleanupTestApp(userId);
    }
  }

  // 3b. Pass + autoPublish=true → deploy + notify both invoked exactly once.
  {
    const { appId, userId } = await setupTestApp({
      autoPublish: true,
      plannedPages: [{ name: "Home", route: "/", purpose: "Landing" }],
    });
    let deployCalls = 0;
    let notifyCalls = 0;
    let receivedPlannedPages: unknown = null;
    try {
      const result = await runAutoEvaluator({
        appId,
        userId,
        userIntent: "build a thing",
        jobId: 0,
        baseUrl: "http://localhost:80",
        log: silentLog,
        __evaluator: async (args): Promise<EvaluatorReport> => {
          receivedPlannedPages = args.plannedPages;
          return {
            verdict: "pass",
            summary: "todo bien",
            issues: [],
            screenshots: [],
          };
        },
        __patcher: async () => null,
        __notifier: async () => {
          notifyCalls++;
        },
        __deploy: async (args) => {
          deployCalls++;
          check(
            "3b: deploy receives the right appId",
            args.appId === appId,
            args,
          );
          return {
            url: "https://example.test/p/winner",
            slug: "winner",
          };
        },
      });
      check("3b: deploy invoked exactly once", deployCalls === 1, { deployCalls });
      check("3b: notifier invoked exactly once", notifyCalls === 1, {
        notifyCalls,
      });
      check("3b: autoPublished true", result.autoPublished === true);
      check(
        "3b: publicUrl returned from deploy result",
        result.publicUrl === "https://example.test/p/winner",
        result,
      );
      check(
        "3b: plannedPages from row was forwarded to vision",
        Array.isArray(receivedPlannedPages) &&
          (receivedPlannedPages as Array<{ name: string }>)[0]?.name === "Home",
        receivedPlannedPages,
      );
    } finally {
      await cleanupTestApp(userId);
    }
  }

  // 3c. Pass + autoPublish=false → deploy NOT invoked, notify NOT invoked.
  {
    const { appId, userId } = await setupTestApp({ autoPublish: false });
    let deployCalls = 0;
    let notifyCalls = 0;
    try {
      const result = await runAutoEvaluator({
        appId,
        userId,
        userIntent: "build a thing",
        jobId: 0,
        baseUrl: "http://localhost:80",
        log: silentLog,
        __evaluator: async (): Promise<EvaluatorReport> => ({
          verdict: "pass",
          summary: "ok",
          issues: [],
          screenshots: [],
        }),
        __patcher: async () => null,
        __notifier: async () => {
          notifyCalls++;
        },
        __deploy: async () => {
          deployCalls++;
          return { url: "x", slug: "x" };
        },
      });
      check("3c: pass without autoPublish", result.autoPublished === false);
      check("3c: deploy NOT invoked", deployCalls === 0);
      check("3c: notifier NOT invoked", notifyCalls === 0);
      check("3c: finalVerdict=pass", result.finalVerdict === "pass");
    } finally {
      await cleanupTestApp(userId);
    }
  }

  if (failed > 0) {
    console.error(`\n${failed} test(s) failed`);
    process.exit(1);
  }
  console.log("\nAll evaluator helper + integration tests passed");
  process.exit(0);
})().catch((err) => {
  console.error("\nIntegration test crashed:", err);
  process.exit(1);
});
