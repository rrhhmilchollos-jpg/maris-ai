/**
 * Stub implementations for the agent bus bridge.
 *
 * The original /communication and /self scaffold directories were removed
 * from the repository. This file provides no-op stub implementations so
 * the rest of the server can continue to import these symbols without
 * crashing at startup.
 */

type AnyFn = (...args: unknown[]) => unknown;

// ── Bus stub ─────────────────────────────────────────────────────────────────
const _listeners: Record<string, AnyFn[]> = {};

export const agentBus = {
  emit(event: string, _data: unknown): void {
    const fns = _listeners[event] ?? [];
    fns.forEach((fn) => {
      try { fn(_data); } catch { /* ignore */ }
    });
  },
  on(event: string, callback: AnyFn): void {
    if (!_listeners[event]) _listeners[event] = [];
    _listeners[event].push(callback);
  },
};

// ── State sync stub ───────────────────────────────────────────────────────────
let _state: Record<string, unknown> = {};

export const agentState = {
  updateState(partial: Record<string, unknown>): void {
    _state = { ..._state, ...partial };
  },
  getState(): Record<string, unknown> {
    return { ..._state };
  },
};

// ── Analyzer stub ─────────────────────────────────────────────────────────────
export const agentAnalyzer = {
  analyzeSystem() {
    return {
      slowTasks: [] as Array<{ id: number; time: number; status: string }>,
      failedTasks: [] as unknown[],
      load: 0,
    };
  },
};

// ── Optimizer stub ────────────────────────────────────────────────────────────
export const agentOptimizer = {
  optimize(_report: ReturnType<typeof agentAnalyzer.analyzeSystem>): void {
    // no-op
  },
};
