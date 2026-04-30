/**
 * Free-answer rate limiter.
 *
 * The chat-intent classifier lets us answer questions and run web research
 * without spending a credit. That's great for legitimate users — but a
 * malicious owner of a free trial account could spam questions to burn
 * Anthropic / web_search tokens for free, on us.
 *
 * This module enforces a per-user hourly cap on free answers. Once the cap
 * is hit the route handler falls through to the normal generation pipeline
 * (which charges 1 credit) instead of giving more free Haiku/web_search
 * runs. We never block the message outright — the user can always pay to
 * keep going — we just stop subsidising abuse.
 *
 * Storage is a process-local Map. We're a single-instance API today, so
 * this is fine. If we ever scale horizontally we'll need to move this to
 * Postgres or Redis (and the function signatures already lend themselves
 * to that — they're async).
 */

const HOUR_MS = 60 * 60 * 1000;

/** Max free question/research answers per user per rolling hour. */
export const FREE_ANSWERS_PER_HOUR = 30;

type Window = {
  /** Timestamps (ms) of free-answer events inside the current rolling hour. */
  hits: number[];
};

const windows = new Map<string, Window>();

/**
 * Try to consume one free-answer slot for `userId`. Returns true if the
 * user is below the hourly cap (and the slot is now reserved), false if
 * they've hit the cap. Admins are exempt — they bypass the limiter.
 *
 * Side-effect: every call also prunes expired entries for that user, so
 * the map size stays bounded.
 */
export async function tryConsumeFreeAnswer(
  userId: string,
  isAdmin: boolean,
): Promise<{ allowed: boolean; remaining: number; resetMs: number }> {
  if (isAdmin) {
    return { allowed: true, remaining: Number.MAX_SAFE_INTEGER, resetMs: 0 };
  }
  const now = Date.now();
  const cutoff = now - HOUR_MS;
  let w = windows.get(userId);
  if (!w) {
    w = { hits: [] };
    windows.set(userId, w);
  }
  // Prune everything older than 1h.
  w.hits = w.hits.filter((t) => t > cutoff);
  if (w.hits.length >= FREE_ANSWERS_PER_HOUR) {
    const oldest = w.hits[0];
    return {
      allowed: false,
      remaining: 0,
      resetMs: Math.max(0, oldest + HOUR_MS - now),
    };
  }
  w.hits.push(now);
  return {
    allowed: true,
    remaining: FREE_ANSWERS_PER_HOUR - w.hits.length,
    resetMs: 0,
  };
}
