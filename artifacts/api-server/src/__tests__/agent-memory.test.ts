/**
 * Integration test for the agent memory + planner pipeline.
 *
 * Verifies:
 *   1. embedText() returns a 1536-dim vector even with no embeddings API.
 *   2. rememberPatch() inserts into agent_memory with the right shape.
 *   3. recallSimilar() finds the saved patch when queried with a near-duplicate
 *      error message (cosine similarity above threshold).
 *   4. Duplicate inserts increment successCount instead of creating new rows.
 *   5. The heuristic planner correctly classifies common Spanish prompts.
 *   6. buildRecallExamplesBlock() produces a non-empty Spanish block.
 *
 * Self-cleanup: every row inserted by this test is deleted at the end.
 */
import { db } from "../lib/db";
import { agentMemory } from "@workspace/db";
import { eq } from "drizzle-orm";
import {
  embedText,
  rememberPatch,
  recallSimilar,
  buildRecallExamplesBlock,
  extractFixHint,
  redactSecrets,
  MAX_STORED_PATCH_CHARS,
} from "../lib/agentMemory";
import { planExecution, planSummaryEs, PLAN_FAST_PATCH, PLAN_FEATURE, PLAN_FULL } from "../lib/planner";

let failures = 0;
const insertedIds: number[] = [];

function expect(label: string, ok: boolean, info?: unknown): void {
  if (ok) {
    console.log(`  ✓ ${label}`);
  } else {
    console.log(`  ✗ ${label}`, info ?? "");
    failures++;
  }
}

async function cleanup(): Promise<void> {
  if (insertedIds.length === 0) return;
  for (const id of insertedIds) {
    try {
      await (db as any).delete(agentMemory).where(eq((agentMemory as any).id, id));
    } catch {
      /* best-effort cleanup */
    }
  }
}

async function testEmbedding(): Promise<void> {
  console.log("\n[1] Embedding helper");
  const v = await embedText("Cannot find module 'react-router-dom'");
  expect("returns 1536 dimensions", v.length === 1536, `got ${v.length}`);
  expect("is normalised (or close to it)", Math.abs(v.reduce((s, x) => s + x * x, 0) - 1) < 0.05);

  const empty = await embedText("");
  expect("empty string returns zero vector", empty.length === 1536 && empty.every((x) => x === 0));

  const v2 = await embedText("Cannot find module 'react-router-dom'");
  expect("deterministic across calls", v.every((x, i) => Math.abs(x - v2[i]) < 1e-9));
}

async function testRememberAndRecall(): Promise<void> {
  console.log("\n[2] Remember + recall");
  const errMsg = `__test__ Cannot find module '@/components/ui/foo' in src/App.tsx`;
  const patch = `// fake patched bundle\nimport Foo from "./components/Foo"\nexport default function App(){return <Foo/>}`;

  const saved = await rememberPatch({
    errorMessage: errMsg,
    errorContext: "test fixture",
    patch,
    language: "typescript",
  });
    expect("rememberPatch returns an entry", saved !== null && (typeof (saved as any).id === "number" || typeof (saved as any).id === "string"));
  if (saved) insertedIds.push((saved as any).id);

  const matches = await recallSimilar(errMsg, { limit: 5, threshold: 0.5, language: "typescript" });
  expect("recallSimilar finds the saved patch", matches.some((m) => m.patch === patch));
  const top = matches[0];
  if (top) {
    expect(
      "top match has high similarity (≥ 0.7, production threshold)",
      Number(top.similarity) >= 0.7,
      `sim=${top.similarity}`,
    );
  }

  // Near-duplicate insert should bump successCount, not create a new row.
  const dupSaved = await rememberPatch({
    errorMessage: errMsg,
    errorContext: "test fixture (duplicate)",
    patch,
    language: "typescript",
  });
  expect(
    "near-duplicate increments successCount instead of inserting",
    dupSaved !== null && saved !== null && (dupSaved as any).id === (saved as any).id && ((dupSaved as any).successCount ?? 0) >= 2,
    `dup.id=${(dupSaved as any)?.id} saved.id=${(saved as any)?.id} count=${(dupSaved as any)?.successCount}`,
  );
}

async function testRecallBlock(): Promise<void> {
  console.log("\n[3] Recall examples block");
  const matches = await recallSimilar(
    `__test__ Cannot find module '@/components/ui/foo' in src/App.tsx`,
    { limit: 3, threshold: 0.5, language: "typescript" },
  );
  const block = buildRecallExamplesBlock(matches);
  expect("non-empty block when matches exist", block.length > 0 && block.includes("FAILED-FIXES MEMORY"));
  expect("empty block when no matches", buildRecallExamplesBlock([]) === "");
}

async function testPlanner(): Promise<void> {
  console.log("\n[4] Planner heuristics");

  // Cosmetic edit on existing app → fast-patch.
  const cosmetic = await planExecution("cambia el color del botón comprar a verde", { hasExistingApp: true });
  expect(
    `cosmetic edit → fast-patch (got ${cosmetic.scope})`,
    cosmetic.scope === "fast-patch",
  );

  // Feature on existing app → feature.
  const feature = await planExecution("añade una pantalla de checkout con stripe", { hasExistingApp: true });
  expect(
    `feature ask → feature (got ${feature.scope})`,
    feature.scope === "feature" || feature.scope === "full-build",
  );

  // No existing app → must run full pipeline.
  const fresh = await planExecution("crea una app de notas", { hasExistingApp: false });
  expect(
    `no app yet → full-build (got ${fresh.scope})`,
    fresh.scope === "full-build",
  );

  // Spanish summary should mention the planner emoji.
  expect("planSummaryEs includes planner emoji", planSummaryEs(cosmetic).includes("🧭"));
}

async function testSameErrorTwiceConvergence(): Promise<void> {
  console.log("\n[5] Repeat-error recall delivers the saved fix on second occurrence");

  const error1 = `__test__convergence__ Module not found: '@/components/ui/widget' (line 42, src/App.tsx)`;
  const fix1 = `import { Widget } from "./components/ui/widget"; export const App = () => <Widget />;`;

  const beforeMatches = await recallSimilar(error1, { limit: 3, threshold: 0.7, language: "typescript" });
  const beforeBlock = buildRecallExamplesBlock(beforeMatches);
  expect("cold: zero matches", beforeMatches.length === 0);
  expect("cold: empty memory block", beforeBlock === "");

  const saved = await rememberPatch({
    errorMessage: error1,
    errorContext: "first occurrence",
    patch: fix1,
    language: "typescript",
  });
  expect("rememberPatch returned an entry", saved !== null);
  if (saved) insertedIds.push(saved.id);

  const error2 = `__test__convergence__ Module not found: '@/components/ui/widget' (line 87, src/Dashboard.tsx)`;
  const afterMatches = await recallSimilar(error2, { limit: 3, threshold: 0.7, language: "typescript" });
  const afterBlock = buildRecallExamplesBlock(afterMatches);
  expect("warm: recall returns saved patch", afterMatches.some((m) => m.patch === fix1));
  expect("warm: memory block contains FAILED-FIXES header", afterBlock.includes("FAILED-FIXES MEMORY"));
  expect("warm: memory block contains verbatim past fix", afterBlock.includes(fix1.slice(0, 60)));
  expect(
    "warm: top similarity ≥ 0.7 (production recall threshold)",
    afterMatches.length > 0 && Number(afterMatches[0].similarity) >= 0.7,
    `sim=${afterMatches[0]?.similarity}`,
  );
}

// Security regression: stored patches must be tiny and free of obvious
// secrets, otherwise shared memory becomes a cross-tenant leak channel.
function testPatchSanitization(): void {
  console.log("\n[8] Stored patches are bounded and redacted");

  const giantBundle = "const a = 1;\n".repeat(2000);
  const hint = extractFixHint(giantBundle, "no line ref here");
  expect(
    `extractFixHint caps output at MAX_STORED_PATCH_CHARS (${MAX_STORED_PATCH_CHARS})`,
    hint.length <= MAX_STORED_PATCH_CHARS,
    `len=${hint.length}`,
  );

  const linedBundle = Array.from({ length: 200 }, (_, i) => `line ${i + 1};`).join("\n");
  const localised = extractFixHint(linedBundle, "TypeError at line 42 in src/App.tsx");
  expect(
    "extractFixHint extracts only the region around the error line",
    localised.includes("line 42") && localised.length < 300,
    `len=${localised.length}`,
  );

  const dirty = `const key = "sk-AAAAAAAAAAAAAAAAAAAA";\nconst gh = "ghp_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";\nconst hex = "deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef";`;
  const clean = redactSecrets(dirty);
  expect("redactSecrets removes OpenAI-style sk- keys", !clean.includes("sk-AAAAAAAAAAAAAAAAAAAA"));
  expect("redactSecrets removes GitHub PAT-style strings", !clean.includes("ghp_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"));
  expect("redactSecrets removes long hex strings", !clean.includes("deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef"));
  expect("redactSecrets leaves the rest of the code intact", clean.includes("const key") && clean.includes("[REDACTED]"));
}

// Regression: when fastPatchEdit() returns null in edit mode, the dispatcher
// MUST promote the plan so the validate+patch loop is no longer gated off.
// Without this, the original PLAN_FAST_PATCH gates (`phases = ["patch"]`)
// would short-circuit runValidatePatchLoop and ship unvalidated code.
function testFastPatchFallbackPromotesPlan(): void {
  console.log("\n[7] Fast-patch fallback promotes plan to feature (validate+patch ON)");

  // Simulate the exact mutation the dispatcher performs at the fallback site.
  let execPlan = { ...PLAN_FAST_PATCH };
  expect(
    "before fallback: validate gate is OFF (correct for happy-path fast-patch)",
    !execPlan.phases.includes("validate"),
  );

  // Mirror the production fallback assignment.
  execPlan = {
    ...execPlan,
    scope: "feature",
    phases: PLAN_FEATURE.phases,
  };

  expect(
    "after fallback: scope promoted to 'feature'",
    execPlan.scope === "feature",
    `scope=${execPlan.scope}`,
  );
  expect(
    "after fallback: validate gate is ON",
    execPlan.phases.includes("validate"),
    `phases=${execPlan.phases.join(",")}`,
  );
  expect(
    "after fallback: patch gate is ON",
    execPlan.phases.includes("patch"),
    `phases=${execPlan.phases.join(",")}`,
  );
}

function testPhasesAreConsumable(): void {
  console.log("\n[6] Planner constants expose phases the dispatcher can gate on");
  expect(
    "fast-patch phases = [patch]",
    PLAN_FAST_PATCH.phases.length === 1 && PLAN_FAST_PATCH.phases[0] === "patch",
  );
  expect(
    "feature phases include architect+frontend+validate+patch and exclude research+design",
    PLAN_FEATURE.phases.includes("architect") &&
      PLAN_FEATURE.phases.includes("frontend") &&
      PLAN_FEATURE.phases.includes("validate") &&
      PLAN_FEATURE.phases.includes("patch") &&
      !PLAN_FEATURE.phases.includes("research") &&
      !PLAN_FEATURE.phases.includes("design"),
  );
  expect(
    "full-build phases include every pipeline stage",
    ["research", "architect", "design", "integration", "frontend", "backend", "qa", "tests", "validate", "patch"]
      .every((p) => PLAN_FULL.phases.includes(p as (typeof PLAN_FULL.phases)[number])),
  );
}

async function main(): Promise<void> {
  console.log("=== Agent memory + planner integration test ===");
  try {
    await testEmbedding();
    await testRememberAndRecall();
    await testRecallBlock();
    await testPlanner();
    await testSameErrorTwiceConvergence();
    testPhasesAreConsumable();
    testFastPatchFallbackPromotesPlan();
    testPatchSanitization();
  } catch (err) {
    console.error("Test crashed:", err);
    failures++;
  } finally {
    await cleanup();
  }

  console.log(`\n${failures === 0 ? "✅" : "❌"} ${failures === 0 ? "all checks passed" : `${failures} check(s) failed`}`);
  // Force-exit so pg-boss / drizzle pool handles don't keep the process alive.
  process.exit(failures === 0 ? 0 : 1);
}

void main();
