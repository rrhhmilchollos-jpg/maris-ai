import { isE2BEnabled } from "./e2bValidator";

// Runtime flag controlling whether the generation pipeline runs the
// real-build E2B validation step. Default seeded from env var so the
// behaviour matches a fresh boot, then mutable via the admin panel.
//
// We deliberately keep this in-memory: persisting it would couple the
// app's runtime state to a new schema migration, and the env var is the
// authoritative "default on boot" anyway. If the user wants the toggle
// to survive restarts, they set E2B_VALIDATE_ON_GENERATE=true in
// Replit Secrets.
let runtimeEnabled = process.env.E2B_VALIDATE_ON_GENERATE === "true";

/**
 * Should the generation pipeline run E2B real-build validation?
 * Both conditions must be true:
 *   1. E2B is configured (E2B_API_KEY is set)
 *   2. The runtime toggle is on (env var on boot, or admin flipped it)
 */
export function shouldValidateInE2B(): boolean {
  return runtimeEnabled && isE2BEnabled();
}

/** Current runtime gate state (independent of whether E2B is configured). */
export function getE2BGateEnabled(): boolean {
  return runtimeEnabled;
}

/** Flip the runtime gate. Returns the new value. */
export function setE2BGateEnabled(enabled: boolean): boolean {
  runtimeEnabled = enabled;
  return runtimeEnabled;
}
