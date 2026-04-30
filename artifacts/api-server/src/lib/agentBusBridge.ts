/**
 * Bridge between the typed API server (TypeScript ESM) and the root-level
 * CommonJS scaffold under `/communication` and `/self` (Fase 8 + 9 PRO).
 *
 * The scaffold lives outside `src/` and is plain JS, so we pull it in via
 * `createRequire` rather than fighting the build pipeline. We expose a
 * tiny, typed surface for the rest of the server to use.
 *
 * Why bridge instead of duplicating? The user explicitly wanted the
 * scaffold "literal" at the repo root. Re-implementing it inside the
 * server would create two copies that drift. Bridging keeps a single
 * source of truth.
 */

import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// We need to find the repo root (where /communication and /self live).
// Counting `..` from `import.meta.url` is fragile because the file lives
// at different depths in dev (`src/lib/agentBusBridge.ts`) vs. build
// (`dist/index.mjs` after bundling). Instead walk up until we find a
// `pnpm-workspace.yaml`, which is the canonical marker for this repo.
const here = fileURLToPath(import.meta.url);
const requireFromHere = createRequire(here);

function findRepoRoot(start: string): string {
  let dir = start;
  for (let i = 0; i < 10; i += 1) {
    if (existsSync(resolve(dir, "pnpm-workspace.yaml"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(
    `Could not locate repo root (pnpm-workspace.yaml) starting from ${start}`,
  );
}

const repoRoot = findRepoRoot(dirname(here));

type AnyFn = (...args: unknown[]) => unknown;

interface BusModule {
  emit(event: string, data: unknown): void;
  on(event: string, callback: AnyFn): void;
}

interface StateSyncModule {
  updateState(partial: Record<string, unknown>): void;
  getState(): Record<string, unknown>;
}

interface AnalyzerModule {
  analyzeSystem(): {
    slowTasks: Array<{ id: number; time: number; status: string }>;
    failedTasks: unknown[];
    load: number;
  };
}

interface OptimizerModule {
  optimize(report: ReturnType<AnalyzerModule["analyzeSystem"]>): void;
}

const bus = requireFromHere(
  resolve(repoRoot, "communication/bus.js"),
) as BusModule;

const stateSync = requireFromHere(
  resolve(repoRoot, "communication/stateSync.js"),
) as StateSyncModule;

// Importing events.js registers its conflict listener on the bus as a
// side-effect. We require it for that side-effect only.
requireFromHere(resolve(repoRoot, "communication/events.js"));

const analyzer = requireFromHere(
  resolve(repoRoot, "self/analyzer.js"),
) as AnalyzerModule;

const optimizer = requireFromHere(
  resolve(repoRoot, "self/optimizer.js"),
) as OptimizerModule;

export const agentBus = bus;
export const agentState = stateSync;
export const agentAnalyzer = analyzer;
export const agentOptimizer = optimizer;
