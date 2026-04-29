import { createHash } from "node:crypto";
import OpenAI from "openai";
import { db } from "./db";
import { agentMemory, type AgentMemoryEntry } from "@workspace/db";
import { sql, eq } from "drizzle-orm";
import { logger } from "./logger";

const openai = new OpenAI({
  // Align with the rest of the codebase (generate.ts uses these names) so the
  // real Replit AI Integrations proxy is used for embeddings when the
  // integration is configured. We keep the legacy var names as fallbacks for
  // local dev, and finally fall through to the lexical-hash path if neither
  // is set or if the proxy returns 401 (current behaviour for embeddings).
  apiKey:
    process.env.AI_INTEGRATIONS_OPENAI_API_KEY ??
    process.env.OPENAI_API_KEY ??
    process.env.REPLIT_AI_INTEGRATIONS_API_KEY ??
    "sk-noop",
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL ?? process.env.OPENAI_BASE_URL,
});

const EMBED_DIMS = 1536;
const EMBED_MODEL = "text-embedding-3-small";
const MAX_INPUT_CHARS = 8_000;
// Hard cap on stored patches. Memory is shared across apps/users, so storing
// large bundles would risk leaking proprietary code or secrets to unrelated
// jobs via recall. We instead store only a tiny snippet of the corrected
// region (extracted near the error line) — enough for the next patcher to
// recognise the pattern, not enough to be useful as a code dump.
export const MAX_STORED_PATCH_CHARS = 800;

// Patterns that look like secrets we never want to persist into shared
// memory. Conservative and additive — false positives are fine, missed
// secrets are not.
const SECRET_PATTERNS: RegExp[] = [
  /sk-[A-Za-z0-9_-]{16,}/g, // OpenAI / Replit AI Integrations style keys
  /\b[A-Za-z0-9_-]{0,8}(?:secret|token|api[_-]?key|password|passwd|bearer)[A-Za-z0-9_-]{0,8}\s*[:=]\s*['"][^'"\n]{4,}['"]/gi,
  /\bgh[ps]_[A-Za-z0-9]{20,}\b/g, // GitHub PAT
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/g, // Slack
  /\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, // JWT
  /\b[A-Fa-f0-9]{40,}\b/g, // long hex strings (private keys, hashes)
];

export function redactSecrets(text: string): string {
  let out = text;
  for (const re of SECRET_PATTERNS) {
    out = out.replace(re, "[REDACTED]");
  }
  return out;
}

// Pull the smallest possible "fix hint" out of the corrected bundle. We try
// to find a line number reference inside the error message, then return ~12
// lines of context around it. If we cannot parse a location, we fall back to
// the first MAX_STORED_PATCH_CHARS of the bundle (which is much smaller than
// the previous 8000-char dump).
export function extractFixHint(bundle: string, errorMessage: string): string {
  const lineMatch = errorMessage.match(/(?:line|línea)\s*[:#]?\s*(\d+)/i);
  if (lineMatch) {
    const targetLine = Number(lineMatch[1]);
    const lines = bundle.split("\n");
    if (targetLine >= 1 && targetLine <= lines.length) {
      const start = Math.max(0, targetLine - 6);
      const end = Math.min(lines.length, targetLine + 6);
      const snippet = lines.slice(start, end).join("\n");
      return redactSecrets(snippet).slice(0, MAX_STORED_PATCH_CHARS);
    }
  }
  return redactSecrets(bundle).slice(0, MAX_STORED_PATCH_CHARS);
}

const inMemoryCache = new Map<string, number[]>();
const MAX_CACHE_ENTRIES = 500;

function cacheKey(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function rememberInCache(key: string, vec: number[]): void {
  if (inMemoryCache.size >= MAX_CACHE_ENTRIES) {
    const firstKey = inMemoryCache.keys().next().value;
    if (firstKey !== undefined) inMemoryCache.delete(firstKey);
  }
  inMemoryCache.set(key, vec);
}

// Deterministic 1536-d hashing fallback. Bag-of-trigrams projected to fixed
// dimensions via FNV-1a hashing, then L2-normalised. Good enough for matching
// near-duplicate error messages even if the embedding endpoint is unavailable.
function lexicalEmbed(text: string): number[] {
  const v = new Array<number>(EMBED_DIMS).fill(0);
  const lower = text.toLowerCase();
  for (let i = 0; i < lower.length - 2; i++) {
    const tri = lower.slice(i, i + 3);
    let h = 2166136261;
    for (let j = 0; j < tri.length; j++) {
      h ^= tri.charCodeAt(j);
      h = Math.imul(h, 16777619) >>> 0;
    }
    const idx = h % EMBED_DIMS;
    const sign = (h & 1) === 0 ? 1 : -1;
    v[idx] += sign;
  }
  let norm = 0;
  for (const x of v) norm += x * x;
  norm = Math.sqrt(norm) || 1;
  for (let i = 0; i < EMBED_DIMS; i++) v[i] = v[i] / norm;
  return v;
}

let openAiEmbeddingsAvailable: boolean | null = null;

export async function embedText(text: string): Promise<number[]> {
  const trimmed = (text ?? "").slice(0, MAX_INPUT_CHARS);
  if (!trimmed) return new Array<number>(EMBED_DIMS).fill(0);
  const key = cacheKey(trimmed);
  const cached = inMemoryCache.get(key);
  if (cached) return cached;

  if (openAiEmbeddingsAvailable !== false) {
    try {
      const response = await openai.embeddings.create({
        model: EMBED_MODEL,
        input: trimmed,
      });
      const vec = response.data[0]?.embedding;
      if (Array.isArray(vec) && vec.length === EMBED_DIMS) {
        openAiEmbeddingsAvailable = true;
        rememberInCache(key, vec);
        return vec;
      }
    } catch (err) {
      if (openAiEmbeddingsAvailable === null) {
        openAiEmbeddingsAvailable = false;
        logger.warn(
          { err: err instanceof Error ? err.message : String(err) },
          "OpenAI embeddings unavailable; falling back to lexical hashing for agent memory",
        );
      }
    }
  }

  const vec = lexicalEmbed(trimmed);
  rememberInCache(key, vec);
  return vec;
}

export interface MemoryRecallResult {
  id: number;
  errorMessage: string;
  errorContext: string;
  patch: string;
  similarity: number;
  successCount: number;
}

// pgvector embeds need the literal "[a,b,c]" string form for parameterised SQL.
function toVectorLiteral(vec: number[]): string {
  return `[${vec.join(",")}]`;
}

// Build the canonical text we hand to the embedder. Both recall and remember
// use this so the cold-store and warm-query embeddings come from the same
// representation. Including the (truncated) errorContext when available
// improves retrieval precision when two errors share a message but live in
// different files / stack frames.
function embedInputText(errorMessage: string, errorContext?: string): string {
  const ctx = (errorContext ?? "").trim();
  if (!ctx) return errorMessage;
  // Cap context to keep token costs bounded; the message stays ungated so
  // exact-match recall on the message alone still works for short errors.
  return `${errorMessage}\nContext:\n${ctx.slice(0, 1500)}`;
}

export async function recallSimilar(
  errorMessage: string,
  options: {
    limit?: number;
    threshold?: number;
    language?: string;
    errorContext?: string;
    minSuccessCount?: number;
  } = {},
): Promise<MemoryRecallResult[]> {
  const limit = Math.max(1, Math.min(10, options.limit ?? 3));
  const threshold = options.threshold ?? 0.7;
  // Quality guardrail: only reuse fixes that have been confirmed to converge
  // at least once. successCount is incremented whenever a near-duplicate fix
  // succeeds again, so this floor keeps unproven entries (or future
  // failure-tracked entries with successCount=0) out of the patcher prompt.
  const minSuccessCount = Math.max(1, options.minSuccessCount ?? 1);
  const queryVec = await embedText(embedInputText(errorMessage, options.errorContext));
  const lit = toVectorLiteral(queryVec);
  try {
    const rows = await db.execute(sql`
      SELECT
        id,
        error_message AS "errorMessage",
        error_context AS "errorContext",
        patch,
        success_count AS "successCount",
        1 - (embedding <=> ${lit}::vector) AS similarity
      FROM agent_memory
      WHERE success_count >= ${minSuccessCount}
      ${options.language ? sql`AND language = ${options.language}` : sql``}
      ORDER BY embedding <=> ${lit}::vector
      LIMIT ${limit}
    `);
    const results = (rows.rows ?? []) as unknown as MemoryRecallResult[];
    return results.filter((r) => Number(r.similarity) >= threshold);
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : String(err) },
      "agent_memory recall failed",
    );
    return [];
  }
}

export interface RememberInput {
  errorMessage: string;
  errorContext?: string;
  patch: string;
  language?: string;
  framework?: string;
}

// Save a successful patch. If a near-duplicate (similarity > 0.92) exists, just
// bump its successCount instead of polluting the index with duplicates.
export async function rememberPatch(input: RememberInput): Promise<AgentMemoryEntry | null> {
  if (!input.errorMessage || !input.patch) return null;
  try {
    const vec = await embedText(embedInputText(input.errorMessage, input.errorContext));
    const lit = toVectorLiteral(vec);
    const dup = (await db.execute(sql`
      SELECT id, 1 - (embedding <=> ${lit}::vector) AS similarity
      FROM agent_memory
      ORDER BY embedding <=> ${lit}::vector
      LIMIT 1
    `)).rows as unknown as Array<{ id: number; similarity: number }>;
    if (dup[0] && Number(dup[0].similarity) > 0.92) {
      const [updated] = await db
        .update(agentMemory)
        .set({
          successCount: sql`${agentMemory.successCount} + 1`,
          updatedAt: new Date(),
        })
        .where(eq(agentMemory.id, dup[0].id))
        .returning();
      return updated ?? null;
    }
    const [inserted] = await db
      .insert(agentMemory)
      .values({
        errorMessage: input.errorMessage.slice(0, 4000),
        errorContext: (input.errorContext ?? "").slice(0, 4000),
        patch: input.patch.slice(0, 8000),
        embedding: vec,
        language: input.language ?? "typescript",
        framework: input.framework ?? "react",
      })
      .returning();
    return inserted ?? null;
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : String(err) },
      "agent_memory remember failed",
    );
    return null;
  }
}

export function buildRecallExamplesBlock(matches: MemoryRecallResult[]): string {
  if (matches.length === 0) return "";
  const blocks = matches.map((m, i) => {
    const sim = Math.round(Number(m.similarity) * 100);
    return `### Ejemplo ${i + 1} (similitud ${sim}%, usado ${m.successCount} vez/veces)
Error anterior: ${m.errorMessage.slice(0, 400)}
Solución que funcionó:
${m.patch.slice(0, 1200)}`;
  });
  return `\n\nFAILED-FIXES MEMORY (errores parecidos ya resueltos en el pasado — toma estos parches como referencia, NO los apliques literalmente):
${blocks.join("\n\n")}\n`;
}
