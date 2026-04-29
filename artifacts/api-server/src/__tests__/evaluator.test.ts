/**
 * Unit tests for the autonomous evaluator's pure helpers.
 *
 * We don't try to spin up Puppeteer or hit Anthropic in this test — those
 * are exercised end-to-end against a real Replit preview. What we DO want
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
} from "../lib/evaluator.js";

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

if (failed > 0) {
  console.error(`\n${failed} test(s) failed`);
  process.exit(1);
}
console.log("\nAll evaluator helper tests passed");
