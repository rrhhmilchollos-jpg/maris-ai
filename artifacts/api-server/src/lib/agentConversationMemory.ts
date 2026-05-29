import { createHash } from "node:crypto";
import OpenAI from "openai";
import { connectDB } from "./db";
import { AgentConversationMemory, type IAgentConversationMemory } from "@workspace/db/schema";
import { logger } from "./logger";

const openai = new OpenAI({
  apiKey:
    process.env.OPENAI_API_KEY ??
    process.env.MARIS_AI_OPENAI_API_KEY ??
    process.env.AI_INTEGRATIONS_OPENAI_API_KEY ??
    "sk-noop",
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL ?? process.env.OPENAI_BASE_URL,
});

const EMBED_DIMS = 1536;
const MAX_INPUT_CHARS = 8_000;
const EMBED_MODEL = "text-embedding-3-small";

let openAiEmbeddingsAvailable: boolean | null = null;

async function embedText(text: string): Promise<number[]> {
  const trimmed = (text ?? "").slice(0, MAX_INPUT_CHARS);
  if (!trimmed) return new Array<number>(EMBED_DIMS).fill(0);

  if (openAiEmbeddingsAvailable !== false) {
    try {
      const response = await openai.embeddings.create({
        model: EMBED_MODEL,
        input: trimmed,
      });
      const vec = response.data[0]?.embedding;
      if (Array.isArray(vec) && vec.length === EMBED_DIMS) {
        openAiEmbeddingsAvailable = true;
        return vec;
      }
    } catch (err) {
      if (openAiEmbeddingsAvailable === null) {
        openAiEmbeddingsAvailable = false;
        logger.warn(
          { err: err instanceof Error ? err.message : String(err) },
          "OpenAI embeddings unavailable for conversation memory; falling back to lexical hashing",
        );
      }
    }
  }

  // Fallback to lexical hashing if OpenAI embeddings are not available
  const v = new Array<number>(EMBED_DIMS).fill(0);
  const lower = trimmed.toLowerCase();
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

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB) || 1);
}

export async function rememberConversation(userId: string, agent: string, prompt: string, response: string): Promise<IAgentConversationMemory | null> {
  if (!prompt || !response) return null;
  try {
    await connectDB();
    const embedding = await embedText(`${prompt}\n${response}`);

    const inserted = await AgentConversationMemory.create({
      userId,
      agent,
      prompt,
      response,
      embedding,
    });
    return inserted;
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : String(err) },
      "agent_conversation_memory remember failed",
    );
    return null;
  }
}

export interface ConversationRecallResult {
  id: string;
  prompt: string;
  response: string;
  similarity: number;
  timestamp: Date;
  agent: string;
}

export async function recallConversations(userId: string, agent: string, queryText: string, options: { limit?: number; threshold?: number } = {}): Promise<ConversationRecallResult[]> {
  const limit = Math.max(1, Math.min(10, options.limit ?? 3));
  const threshold = options.threshold ?? 0.7;

  try {
    await connectDB();
    const queryVec = await embedText(queryText);

    const entries = await AgentConversationMemory.find({ userId, agent }).lean();

    const results: ConversationRecallResult[] = entries
      .filter((e) => Array.isArray(e.embedding) && e.embedding.length === EMBED_DIMS)
      .map((e) => ({
        id: String(e._id),
        prompt: e.prompt,
        response: e.response,
        timestamp: e.timestamp,
        agent: e.agent,
        similarity: cosineSimilarity(queryVec, e.embedding as number[]),
      }))
      .filter((r) => r.similarity >= threshold)
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, limit);

    return results;
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : String(err) },
      "agent_conversation_memory recall failed",
    );
    return [];
  }
}
