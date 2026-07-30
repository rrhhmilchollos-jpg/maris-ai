import { anthropic as zocoia } from "@workspace/integrations-anthropic-ai";
/**
 * componentCache.ts — Maris AI Component Library Cache
 *
 * Stores and retrieves React/Tailwind components that were generated
 * successfully in past generations. When a new app is being built, the
 * Architect and Frontend agents can pull pre-validated components from this
 * cache, reducing generation time by up to 70% and improving quality.
 *
 * Architecture:
 *   - Each cached component has an embedding vector for semantic search.
 *   - Components are tagged by category (ui, layout, form, chart, nav, etc.)
 *   - Only components from validated builds (E2B passed) are stored.
 *   - Components are deduplicated by cosine similarity (>0.93 threshold).
 */

import mongoose, { Schema, Document, Model } from "mongoose";
import { connectDB } from "./db";
import { logger } from "./logger";
import OpenAI from "openai";

// Cliente de embeddings — VOYAGE AI (el proveedor de embeddings recomendado
// por Anthropic; Claude no ofrece endpoint propio de embeddings). API
// OpenAI-compatible en https://api.voyageai.com/v1/embeddings. Si no hay
// VOYAGE_API_KEY, embedText cae automáticamente al hashing léxico local.
// Lazy: evita crash al arrancar si la configuración no está puesta todavía.
let _openaiCache: OpenAI | null = null;
function getOpenAICache(): OpenAI {
  if (!_openaiCache) {
    const voyageKey = process.env.VOYAGE_API_KEY;
    if (!voyageKey) {
      throw new Error("Embeddings no configurados: define VOYAGE_API_KEY (https://voyageai.com)");
    }
    _openaiCache = new OpenAI({
      baseURL: process.env.VOYAGE_BASE_URL || "https://api.voyageai.com/v1",
      apiKey: voyageKey,
    });
  }
  return _openaiCache;
}

// Modelo de embeddings de Voyage AI. Configurable sin tocar código.
const EMBED_MODEL = process.env.VOYAGE_EMBED_MODEL || "voyage-3.5-lite";
const EMBED_DIMS = 1536;

// Normaliza el vector devuelto por Voyage a EMBED_DIMS (trunca o rellena con
// ceros + re-normalización L2) para mantener compatibilidad con los vectores
// ya guardados en MongoDB.
function fitToDims(vec: number[]): number[] {
  let out: number[];
  if (vec.length === EMBED_DIMS) out = vec.slice();
  else if (vec.length > EMBED_DIMS) out = vec.slice(0, EMBED_DIMS);
  else out = [...vec, ...new Array<number>(EMBED_DIMS - vec.length).fill(0)];
  let norm = 0;
  for (const x of out) norm += x * x;
  norm = Math.sqrt(norm) || 1;
  for (let i = 0; i < EMBED_DIMS; i++) out[i] = out[i] / norm;
  return out;
}
const DEDUP_THRESHOLD = 0.93;
const RECALL_THRESHOLD = 0.6;
const MAX_COMPONENT_CHARS = 6000;

// ─── Mongoose Schema ──────────────────────────────────────────────────────────

export interface IComponentCache extends Document {
  name: string;
  description: string;
  category: string;
  code: string;
  embedding: number[];
  language: string;
  usageCount: number;
  qualityScore: number;
  tags: string[];
  createdAt: Date;
  updatedAt: Date;
}

const ComponentCacheSchema = new Schema<IComponentCache>(
  {
    name: { type: String, required: true },
    description: { type: String, required: true },
    category: {
      type: String,
      enum: ["ui", "layout", "form", "chart", "nav", "card", "modal", "table", "hero", "footer", "other"],
      default: "ui",
    },
    code: { type: String, required: true },
    embedding: { type: [Number], default: [] },
    language: { type: String, default: "typescript" },
    usageCount: { type: Number, default: 1 },
    qualityScore: { type: Number, default: 1.0 },
    tags: { type: [String], default: [] },
  },
  { timestamps: true },
);

ComponentCacheSchema.index({ category: 1 });
ComponentCacheSchema.index({ usageCount: -1 });

const ComponentCache: Model<IComponentCache> =
  mongoose.models.ComponentCache ||
  mongoose.model<IComponentCache>("ComponentCache", ComponentCacheSchema);

// ─── Embedding helper ─────────────────────────────────────────────────────────

let embeddingsAvailable: boolean | null = null;

async function embedText(text: string): Promise<number[]> {
  const trimmed = text.trim().slice(0, 4000);
  if (embeddingsAvailable !== false && process.env.VOYAGE_API_KEY) {
    try {
      const res = await getOpenAICache().embeddings.create({ model: EMBED_MODEL, input: trimmed });
      const raw = res.data[0]?.embedding;
      if (Array.isArray(raw) && raw.length > 0) {
        embeddingsAvailable = true;
        return fitToDims(raw);
      }
    } catch {
      embeddingsAvailable = false;
    }
  }
  // Fallback: lexical hash embedding
  return lexicalEmbed(trimmed);
}

function lexicalEmbed(text: string): number[] {
  const vec = new Array(EMBED_DIMS).fill(0);
  for (let i = 0; i < text.length; i++) {
    vec[i % EMBED_DIMS] += text.charCodeAt(i) / 256;
  }
  const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0)) || 1;
  return vec.map((v) => v / norm);
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

// ─── Public API ───────────────────────────────────────────────────────────────

export interface ComponentCacheEntry {
  id: string;
  name: string;
  description: string;
  category: string;
  code: string;
  language: string;
  usageCount: number;
  qualityScore: number;
  tags: string[];
  similarity?: number;
}

export interface StoreComponentInput {
  name: string;
  description: string;
  category?: string;
  code: string;
  language?: string;
  tags?: string[];
}

/**
 * Store a successfully generated component in the cache.
 * Deduplicates by semantic similarity to avoid storing near-identical components.
 */
export async function storeComponent(input: StoreComponentInput): Promise<ComponentCacheEntry | null> {
  if (!input.name || !input.code) return null;
  try {
    await connectDB();
    const embedInput = `${input.name}: ${input.description}`;
    const vec = await embedText(embedInput);
    const existing = await ComponentCache.find({
      category: input.category ?? "ui",
    }).lean();
    const dup = existing
      .filter((e) => Array.isArray(e.embedding) && e.embedding.length > 0)
      .map((e) => ({ id: e._id, sim: cosineSimilarity(vec, e.embedding as number[]) }))
      .sort((a, b) => b.sim - a.sim)[0];
    if (dup && dup.sim > DEDUP_THRESHOLD) {
      // Update usage count and quality score for the existing component
      const updated = await ComponentCache.findByIdAndUpdate(
        dup.id,
        { $inc: { usageCount: 1 }, $set: { updatedAt: new Date() } },
        { new: true },
      );
      return _toEntry(updated);
    }
    const doc = await ComponentCache.create({
      name: input.name.slice(0, 100),
      description: input.description.slice(0, 500),
      category: input.category ?? "ui",
      code: input.code.slice(0, MAX_COMPONENT_CHARS),
      embedding: vec,
      language: input.language ?? "typescript",
      tags: (input.tags ?? []).slice(0, 10),
    });
    logger.info({ name: input.name, category: input.category }, "componentCache: stored new component");
    return _toEntry(doc);
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : String(err) }, "componentCache.storeComponent failed (silenced)");
    return null;
  }
}

/**
 * Recall components similar to the given description.
 * Used by the Frontend agent to assemble apps from proven components.
 */
export async function recallComponents(
  description: string,
  options: {
    limit?: number;
    threshold?: number;
    category?: string;
    language?: string;
  } = {},
): Promise<ComponentCacheEntry[]> {
  const limit = Math.max(1, Math.min(8, options.limit ?? 4));
  const threshold = options.threshold ?? RECALL_THRESHOLD;
  try {
    await connectDB();
    const queryVec = await embedText(description);
    const query: Record<string, unknown> = {};
    if (options.category) query.category = options.category;
    if (options.language) query.language = options.language;
    const entries = await ComponentCache.find(query).lean();
    return entries
      .filter((e) => Array.isArray(e.embedding) && e.embedding.length > 0)
      .map((e) => ({
        ..._toEntry(e),
        similarity: cosineSimilarity(queryVec, e.embedding as number[]),
      }))
      .filter((e) => (e.similarity ?? 0) >= threshold)
      .sort((a, b) => (b.similarity ?? 0) - (a.similarity ?? 0))
      .slice(0, limit);
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : String(err) }, "componentCache.recallComponents failed (silenced)");
    return [];
  }
}

/**
 * Build the component cache block to inject into the Frontend agent's prompt.
 */
export function buildComponentCacheBlock(entries: ComponentCacheEntry[]): string {
  if (!entries || entries.length === 0) return "";
  const blocks = entries.map((e, i) => {
    const sim = Math.round((e.similarity ?? 0) * 100);
    return `### Componente reutilizable ${i + 1}: ${e.name} (similitud ${sim}%, usado ${e.usageCount} vez/veces)
Categoría: ${e.category} | Tags: ${e.tags.join(", ") || "—"}
Descripción: ${e.description}
\`\`\`tsx
${e.code.slice(0, 1500)}
\`\`\``;
  });
  return `\n\nCOMPONENT LIBRARY CACHE (componentes React/Tailwind probados y validados — úsalos como base, adapta según el diseño actual, NO los copies literalmente):
${blocks.join("\n\n")}\n`;
}

/**
 * Extract and store components from a successfully generated frontend bundle.
 * Called after a successful E2B validation.
 */
export async function extractAndStoreComponents(
  frontendCode: string,
  language: string = "typescript",
): Promise<void> {
  try {
    // Extract individual component files from the bundle
    const fileRegex = /\/\/ === FILE: (src\/components\/[^\s]+) ===\n([\s\S]*?)(?=\/\/ === FILE:|$)/g;
    let match;
    const stored: string[] = [];
    while ((match = fileRegex.exec(frontendCode)) !== null) {
      const filePath = match[1];
      const code = match[2].trim();
      if (!code || code.length < 100) continue;
      // Extract component name from file path
      const nameParts = filePath.split("/");
      const fileName = nameParts[nameParts.length - 1].replace(/\.(tsx|jsx|ts|js)$/, "");
      // Detect category from component name
      const category = detectCategory(fileName);
      // Extract description from JSDoc or first comment
      const description = extractDescription(code, fileName);
      await storeComponent({
        name: fileName,
        description,
        category,
        code,
        language,
        tags: [category, language],
      });
      stored.push(fileName);
    }
    if (stored.length > 0) {
      logger.info({ count: stored.length, components: stored }, "componentCache: extracted and stored components from successful build");
    }
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : String(err) }, "componentCache.extractAndStoreComponents failed (silenced)");
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function detectCategory(name: string): string {
  const lower = name.toLowerCase();
  if (/nav|header|sidebar|menu|breadcrumb/.test(lower)) return "nav";
  if (/hero|banner|jumbotron/.test(lower)) return "hero";
  if (/card|tile|item/.test(lower)) return "card";
  if (/form|input|field|select|checkbox|radio/.test(lower)) return "form";
  if (/chart|graph|plot|stat|metric/.test(lower)) return "chart";
  if (/table|grid|list|row/.test(lower)) return "table";
  if (/modal|dialog|drawer|sheet|popup/.test(lower)) return "modal";
  if (/footer|bottom/.test(lower)) return "footer";
  if (/layout|container|wrapper|section/.test(lower)) return "layout";
  return "ui";
}

function extractDescription(code: string, fallbackName: string): string {
  // Try JSDoc comment
  const jsdoc = code.match(/\/\*\*([\s\S]*?)\*\//);
  if (jsdoc) {
    return jsdoc[1].replace(/\s*\*\s*/g, " ").trim().slice(0, 300);
  }
  // Try single-line comment
  const comment = code.match(/\/\/\s*(.+)/);
  if (comment) return comment[1].trim().slice(0, 300);
  // Fallback
  return `Componente React reutilizable: ${fallbackName}`;
}

function _toEntry(doc: any): ComponentCacheEntry {
  return {
    id: String(doc._id ?? doc.id ?? ""),
    name: doc.name ?? "",
    description: doc.description ?? "",
    category: doc.category ?? "ui",
    code: doc.code ?? "",
    language: doc.language ?? "typescript",
    usageCount: doc.usageCount ?? 1,
    qualityScore: doc.qualityScore ?? 1.0,
    tags: doc.tags ?? [],
    similarity: doc.similarity,
  };
}
