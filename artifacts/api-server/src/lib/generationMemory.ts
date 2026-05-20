import mongoose, { Schema, type Model } from "mongoose";
import { ProjectSeed, IProjectSeed } from "@workspace/db/schema";
import { connectDB } from "./db";
import { embedText } from "./agentMemory";
import { logger } from "./logger";

// ─── Tipos ────────────────────────────────────────────────────────────────────

export interface GenerationMemoryInput {
  prompt: string;
  language: string;
  plan: {
    title: string;
    description?: string;
    pages?: Array<{ name: string; route?: string; purpose?: string }>;
    components?: Array<{ name: string; purpose?: string }>;
    hooks?: Array<{ name: string; purpose?: string }>;
    utils?: Array<{ name: string; purpose?: string }>;
    dataModels?: Array<{ name: string; fields?: string[] }>;
    frontendFiles?: string[];
    backendNeeded?: boolean;
  };
  design?: {
    palette?: Record<string, string>;
    typography?: { sans?: string; display?: string };
    vibe?: string;
  };
  metrics?: {
    durationMs?: number;
    frontendKb?: number;
    patchIterations?: number;
    validationPassed?: boolean;
  };
  codeSnippets?: string[];
}

export interface GenerationMemoryEntry extends GenerationMemoryInput {
  id: string;
  createdAt: Date;
  similarity?: number;
  isSeed?: boolean;
}

// New helper to convert IProjectSeed to GenerationMemoryEntry
function _toProjectSeedEntry(seed: IProjectSeed, similarity: number): GenerationMemoryEntry {
  return {
    id: String(seed._id),
    prompt: seed.description, // Use description as prompt for similarity
    language: "typescript", // Default language for seeds
    plan: {
      title: seed.title,
      description: seed.description,
      techStack: seed.techStack,
      frontendFiles: seed.frontendCodeSnippet ? ["<snippet>"] : [],
      backendNeeded: !!seed.backendCodeSnippet,
      pages: [], components: [], hooks: [], utils: [], dataModels: [], // Initialize empty
    },
    design: {
      vibe: seed.kind, // Use kind as vibe for design context
    },
    codeSnippets: [seed.frontendCodeSnippet, seed.backendCodeSnippet].filter(Boolean) as string[],
    createdAt: seed.createdAt,
    similarity: similarity,
    isSeed: true, // To distinguish from regular generations
  };
}

export interface RecallGenerationsOptions {
  limit?: number;
  threshold?: number;
}

// ─── Schema & Model ───────────────────────────────────────────────────────────

const generationMemorySchema = new Schema(
  {
    prompt:       { type: String, required: true, maxlength: 4000 },
    language:     { type: String, default: "typescript" },
    plan:         { type: Schema.Types.Mixed, default: {} },
    design:       { type: Schema.Types.Mixed, default: {} },
    metrics:      { type: Schema.Types.Mixed, default: {} },
    codeSnippets: { type: [String], default: [] },
    embedding:    { type: [Number], default: [] },
  },
  { timestamps: true },
);

function getModel(): Model<any> {
  return (
    (mongoose.models["GenerationMemory"] as Model<any> | undefined) ??
    mongoose.model("GenerationMemory", generationMemorySchema)
  );
}

// ─── Similitud coseno ─────────────────────────────────────────────────────────

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot   += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB) || 1);
}

// ─── Helper interno ───────────────────────────────────────────────────────────

function _toEntry(doc: any): GenerationMemoryEntry {
  return {
    id:           String(doc._id ?? doc.id ?? ""),
    prompt:       doc.prompt ?? "",
    language:     doc.language ?? "typescript",
    plan:         doc.plan ?? {},
    design:       doc.design ?? {},
    metrics:      doc.metrics ?? {},
    codeSnippets: doc.codeSnippets ?? [],
    createdAt:    doc.createdAt ?? new Date(),
    similarity:   doc.similarity,
  };
}

// ─── API pública ──────────────────────────────────────────────────────────────

/**
 * Guarda una generación exitosa en memoria persistente.
 * Silencia errores para no bloquear el pipeline.
 */
export async function rememberGeneration(
  input: GenerationMemoryInput,
): Promise<GenerationMemoryEntry | null> {
  try {
    await connectDB();
    const Model = getModel();
    const vec   = await embedText(input.prompt.slice(0, 4000));

    const existing = await Model.find({}).lean();
    const dup = (existing as any[])
      .filter((e: any) => Array.isArray(e.embedding) && e.embedding.length > 0)
      .map((e: any) => ({ id: e._id, sim: cosineSimilarity(vec, e.embedding) }))
      .sort((a: any, b: any) => b.sim - a.sim)[0];

    if (dup && dup.sim > 0.95) {
      const updated = await Model.findByIdAndUpdate(
        dup.id,
        { $set: { metrics: input.metrics, updatedAt: new Date() } },
        { new: true },
      );
      return _toEntry(updated);
    }

    const doc = await Model.create({
      prompt:       input.prompt.slice(0, 4000),
      language:     input.language ?? "typescript",
      plan:         input.plan,
      design:       input.design ?? {},
      metrics:      input.metrics ?? {},
      codeSnippets: (input.codeSnippets ?? []).slice(0, 5),
      embedding:    vec,
    });

    return _toEntry(doc);
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : String(err) },
      "generationMemory.rememberGeneration failed (silenced)",
    );
    return null;
  }
}

/**
 * Recupera generaciones pasadas similares al prompt actual.
 */
export async function recallGenerations(
  prompt: string,
  options: RecallGenerationsOptions = {},
): Promise<GenerationMemoryEntry[]> {
  const limit     = Math.max(1, Math.min(10, options.limit     ?? 3));
  const threshold = options.threshold ?? 0.5;

  try {
    await connectDB();
    const Model    = getModel();
    const queryVec = await embedText(prompt.slice(0, 4000));

    // 1. Recall from GenerationMemory (past successful generations)
    const memoryEntries = (await Model.find({}).lean() as any[])
      .filter((e: any) => Array.isArray(e.embedding) && e.embedding.length > 0)
      .map((e: any) => ({
        ..._toEntry(e),
        similarity: cosineSimilarity(queryVec, e.embedding),
      }))
      .filter((e: any) => e.similarity >= threshold);

    // 2. Recall from ProjectSeeds (pre-defined templates)
    const seedEntries = (await ProjectSeed.find({}).lean() as IProjectSeed[])
      .map((seed: IProjectSeed) => {
        // Calculate similarity based on prompt vs seed title/description/keywords
        const seedText = `${seed.title} ${seed.description} ${seed.keywords.join(" ")}`;
        // For simplicity, we'll use a basic text match for now, or embed seedText if embedding is available for seeds
        // For now, we'll just assume a high similarity if keywords match, or use a simple heuristic
        const promptLower = prompt.toLowerCase();
        const seedLower = seedText.toLowerCase();
        let similarity = 0;
        if (promptLower.includes(seedLower) || seedLower.includes(promptLower)) {
          similarity = 0.8; // High similarity if direct match
        } else if (seed.keywords.some(kw => promptLower.includes(kw.toLowerCase()))) {
          similarity = 0.6; // Moderate similarity if keywords match
        }
        return _toProjectSeedEntry(seed, similarity);
      })
      .filter((e: any) => e.similarity >= threshold);

    // Combine and sort results, prioritizing seeds or higher similarity
    const combinedEntries = [...memoryEntries, ...seedEntries]
      .sort((a: any, b: any) => b.similarity - a.similarity)
      .slice(0, limit);

    return combinedEntries;
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : String(err) },
      "generationMemory.recallGenerations failed (silenced)",
    );
    return [];
  }
}

/**
 * Construye el bloque de contexto que se inyecta en el prompt del Arquitecto.
 */
export function buildGenerationMemoryBlock(entries: GenerationMemoryEntry[]): string {
  if (!entries || entries.length === 0) return "";

  const blocks = entries.map((e, i) => {
    const sim   = Math.round((e.similarity ?? 0) * 100);
    const pages = e.plan?.pages?.map((p) => p.name).join(", ") || "—";
    const files = e.plan?.frontendFiles?.length ?? 0;
    const vibe  = e.design?.vibe ?? "—";
    const type  = e.isSeed ? "Plantilla" : "Generación";
    return `### ${type} ${i + 1} (similitud ${sim}%)
Prompt: ${e.prompt.slice(0, 300)}
Título: ${e.plan?.title ?? "—"}
Páginas: ${pages}
Archivos frontend: ${files}
Vibe de diseño: ${vibe}
Backend: ${e.plan?.backendNeeded ? "sí" : "no"}`;
  });

  return `\n\nGENERATION MEMORY (apps similares generadas con éxito — úsalas como inspiración de estructura, NO las copies literalmente):
${blocks.join("\n\n")}\n`;
}
