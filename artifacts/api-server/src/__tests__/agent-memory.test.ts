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
} from "../lib/agentMemory";
import { planExecution, planSummaryEs } from "../lib/planner";

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
      await db.delete(agentMemory).where(eq(agentMemory.id, id));
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
  expect("rememberPatch returns an entry", saved !== null && typeof saved.id === "number");
  if (saved) insertedIds.push(saved.id);

  const matches = await recallSimilar(errMsg, { limit: 5, threshold: 0.5, language: "typescript" });
  expect("recallSimilar finds the saved patch", matches.some((m) => m.patch === patch));
  const top = matches[0];
  if (top) {
    expect("top match has high similarity (≥ 0.9)", Number(top.similarity) >= 0.9, `sim=${top.similarity}`);
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
    dupSaved !== null && saved !== null && dupSaved.id === saved.id && (dupSaved.successCount ?? 0) >= 2,
    `dup.id=${dupSaved?.id} saved.id=${saved?.id} count=${dupSaved?.successCount}`,
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

async function main(): Promise<void> {
  console.log("=== Agent memory + planner integration test ===");
  try {
    await testEmbedding();
    await testRememberAndRecall();
    await testRecallBlock();
    await testPlanner();
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
