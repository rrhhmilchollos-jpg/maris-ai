import { createHash } from "node:crypto";
import OpenAI from "openai";
import { connectDB } from "./db";
import { AgentMemory, type IAgentMemory } from "@workspace/db/schema";
import { logger } from "./logger";

export type AgentMemoryEntry = IAgentMemory;

const openai = new OpenAI({
  apiKey:
    process.env.OPENAI_API_KEY ??
    process.env.MARIS_AI_OPENAI_API_KEY ??
    process.env.AI_INTEGRATIONS_OPENAI_API_KEY ??
    "sk-noop",
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL ?? process.env.OPENAI_BASE_URL,
});

const EMBED_DIMS = 1536;
const EMBED_MODEL = "text-embedding-3-small";
const MAX_INPUT_CHARS = 8_000;
export const MAX_STORED_PATCH_CHARS = 800;

const SECRET_PATTERNS: RegExp[] = [
  /sk-[A-Za-z0-9_-]{16,}/g,
  /\b[A-Za-z0-9_-]{0,8}(?:secret|token|api[_-]?key|password|passwd|bearer)[A-Za-z0-9_-]{0,8}\s*[:=]\s*['"][^'"\n]{4,}['"]/gi,
  /\bgh[ps]_[A-Za-z0-9]{20,}\b/g,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/g,
  /\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g,
  /\b[A-Fa-f0-9]{40,}\b/g,
];

export function redactSecrets(text: string): string {
  let out = text;
  for (const re of SECRET_PATTERNS) {
    out = out.replace(re, "[REDACTED]");
  }
  return out;
}

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
          "OpenAI embeddings unavailable; falling back to lexical hashing",
        );
      }
    }
  }

  const vec = lexicalEmbed(trimmed);
  rememberInCache(key, vec);
  return vec;
}

export interface MemoryRecallResult {
  id: string;
  errorMessage: string;
  errorContext: string;
  patch: string;
  similarity: number;
  successCount: number;
}

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB) || 1);
}

function embedInputText(errorMessage: string, errorContext?: string): string {
  const ctx = (errorContext ?? "").trim();
  if (!ctx) return errorMessage;
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
  const minSuccessCount = Math.max(1, options.minSuccessCount ?? 1);

  try {
    await connectDB();
    const queryVec = await embedText(embedInputText(errorMessage, options.errorContext));

    const query: Record<string, unknown> = { successCount: { $gte: minSuccessCount } };
    if (options.language) query.language = options.language;

    const entries = await AgentMemory.find(query).lean();

    const results: MemoryRecallResult[] = entries
      .filter((e) => Array.isArray(e.embedding) && e.embedding.length === EMBED_DIMS)
      .map((e) => ({
        id: String(e._id),
        errorMessage: e.errorMessage,
        errorContext: e.errorContext ?? "",
        patch: e.patch,
        successCount: 1,
        similarity: cosineSimilarity(queryVec, e.embedding as number[]),
      }))
      .filter((r) => r.similarity >= threshold)
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, limit);

    return results;
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

export async function rememberPatch(input: RememberInput): Promise<AgentMemoryEntry | null> {
  if (!input.errorMessage || !input.patch) return null;
  try {
    await connectDB();
    const vec = await embedText(embedInputText(input.errorMessage, input.errorContext));

    const entries = await AgentMemory.find({}).lean();
    const dup = entries
      .filter((e) => Array.isArray(e.embedding) && e.embedding.length === EMBED_DIMS)
      .map((e) => ({ id: e._id, similarity: cosineSimilarity(vec, e.embedding as number[]) }))
      .sort((a, b) => b.similarity - a.similarity)[0];

    if (dup && dup.similarity > 0.92) {
      const updated = await AgentMemory.findByIdAndUpdate(
        dup.id,
        { $inc: { successCount: 1 }, $set: { updatedAt: new Date() } },
        { new: true },
      );
      return updated;
    }

    const inserted = await AgentMemory.create({
      errorMessage: input.errorMessage.slice(0, 4000),
      errorContext: (input.errorContext ?? "").slice(0, 4000),
      patch: input.patch.slice(0, 8000),
      embedding: vec,
      language: input.language ?? "typescript",
      framework: input.framework ?? "react",
    });
    return inserted;
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
