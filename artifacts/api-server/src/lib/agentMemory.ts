import { createHash } from "node:crypto";
import OpenAI from "openai";
import { db } from "./db";
import { agentMemory, type AgentMemoryEntry } from "@workspace/db";
import { sql, eq } from "drizzle-orm";
import { logger } from "./logger";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY ?? process.env.REPLIT_AI_INTEGRATIONS_API_KEY ?? "sk-noop",
  baseURL: process.env.OPENAI_BASE_URL,
});

const EMBED_DIMS = 1536;
const EMBED_MODEL = "text-embedding-3-small";
const MAX_INPUT_CHARS = 8_000;

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

export async function recallSimilar(
  errorMessage: string,
  options: { limit?: number; threshold?: number; language?: string } = {},
): Promise<MemoryRecallResult[]> {
  const limit = Math.max(1, Math.min(10, options.limit ?? 3));
  const threshold = options.threshold ?? 0.7;
  const queryVec = await embedText(errorMessage);
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
      ${options.language ? sql`WHERE language = ${options.language}` : sql``}
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
    const vec = await embedText(input.errorMessage);
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
