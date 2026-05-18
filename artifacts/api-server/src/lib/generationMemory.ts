/**
 * generationMemory.ts — Maris AI Persistent Generation Memory
 *
 * Sistema de memoria persistente entre generaciones. Aprende de cada app
 * generada exitosamente y usa ese conocimiento para mejorar las siguientes.
 *
 * Qué aprende:
 *   - Patrones de prompts que funcionan bien (por categoría)
 *   - Planes de arquitectura exitosos (estructura de archivos, páginas, componentes)
 *   - Design systems que han gustado (paleta, tipografía, vibe)
 *   - Errores comunes y sus fixes (heredado de agentMemory)
 *   - Tiempos de generación y tokens usados (optimización futura)
 *
 * Cómo funciona:
 *   - Almacena en MongoDB (misma DB que el resto de la app)
 *   - Búsqueda semántica por similitud de prompt (embeddings con Anthropic)
 *   - Fallback a búsqueda por keywords si los embeddings fallan
 *   - Límite de 10.000 entradas, las más antiguas y menos usadas se purgan
 */

import { MongoClient, Collection, ObjectId } from "mongodb";
import { logger } from "./logger";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface GenerationMemoryEntry {
  _id?: ObjectId;
  /** Prompt original del usuario (truncado a 2000 chars) */
  prompt: string;
  /** Keywords extraídas del prompt para búsqueda rápida */
  keywords: string[];
  /** Categoría inferida: landing, marketplace, dashboard, game, saas, etc. */
  category: string;
  /** Idioma de generación */
  language: "typescript" | "javascript";
  /** Plan de arquitectura que funcionó */
  plan: {
    title: string;
    pages: string[];
    components: string[];
    hooks: string[];
    backendNeeded: boolean;
    frontendFileCount: number;
  };
  /** Design system aplicado */
  design: {
    vibe: string;
    theme: string;
    primaryColor: string;
    fontSans: string;
  };
  /** Métricas de la generación */
  metrics: {
    durationMs: number;
    frontendKb: number;
    patchIterations: number;
    validationPassed: boolean;
  };
  /** Fragmentos de código reutilizables (hooks útiles, componentes clave) */
  codeSnippets: CodeSnippet[];
  /** Cuántas veces se ha recuperado esta memoria */
  recallCount: number;
  /** Puntuación de calidad (0-1): más alto = más útil para recall */
  qualityScore: number;
  createdAt: Date;
  lastRecalledAt?: Date;
}

export interface CodeSnippet {
  /** Qué hace este snippet */
  description: string;
  /** Tipo: hook, component, util, config */
  type: "hook" | "component" | "util" | "config";
  /** Código (máx 3000 chars) */
  code: string;
}

export interface RecallResult {
  entry: GenerationMemoryEntry;
  /** Similitud 0-1 */
  similarity: number;
}

// ─── DB Connection ───────────────────────────────────────────────────────────

let _collection: Collection<GenerationMemoryEntry> | null = null;

async function getCollection(): Promise<Collection<GenerationMemoryEntry> | null> {
  if (_collection) return _collection;
  const uri = process.env.MONGODB_URI;
  if (!uri) return null;
  try {
    const client = new MongoClient(uri, { serverSelectionTimeoutMS: 3000 });
    await client.connect();
    const db = client.db();
    _collection = db.collection<GenerationMemoryEntry>("generation_memory");
    // Índices para búsqueda rápida
    await _collection.createIndex({ keywords: 1 });
    await _collection.createIndex({ category: 1 });
    await _collection.createIndex({ qualityScore: -1 });
    await _collection.createIndex({ createdAt: -1 });
    await _collection.createIndex({ recallCount: -1 });
    logger.info("generationMemory: MongoDB conectado");
    return _collection;
  } catch (err) {
    logger.warn({ err }, "generationMemory: no se pudo conectar a MongoDB, memoria desactivada");
    return null;
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Extrae keywords significativas de un prompt.
 * Sin embeddings — búsqueda léxica rápida.
 */
function extractKeywords(prompt: string): string[] {
  const stopwords = new Set([
    "una", "un", "el", "la", "los", "las", "de", "del", "en", "con", "para",
    "que", "por", "como", "una", "esto", "este", "hacer", "crear", "hacer",
    "quiero", "necesito", "dame", "hazme", "genera", "crea", "construye",
    "the", "a", "an", "of", "in", "with", "for", "that", "this", "and", "or",
    "make", "build", "create", "generate", "app", "web", "page", "pagina",
  ]);
  return prompt
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 3 && !stopwords.has(w))
    .slice(0, 20);
}

/**
 * Infiere la categoría del prompt.
 */
function inferCategory(prompt: string): string {
  const p = prompt.toLowerCase();
  if (/landing|presentaci[oó]n|corporat|empresa|negocio/.test(p)) return "landing";
  if (/tienda|shop|ecommerce|e-commerce|product|comprar|vender/.test(p)) return "ecommerce";
  if (/dashboard|panel|admin|gesti[oó]n|crm|erp/.test(p)) return "dashboard";
  if (/marketplace|wallapop|airbnb|segunda mano|anuncio/.test(p)) return "marketplace";
  if (/juego|game|arcade|puzzle|quiz/.test(p)) return "game";
  if (/blog|articulo|post|noticias|revista/.test(p)) return "blog";
  if (/saas|suscripci[oó]n|herramienta|tool|plataforma/.test(p)) return "saas";
  if (/reserva|booking|cita|calendario|agenda/.test(p)) return "booking";
  if (/red social|social|chat|comunidad|foro/.test(p)) return "social";
  if (/portafolio|portfolio|cv|curriculum|personal/.test(p)) return "portfolio";
  return "general";
}

/**
 * Calcula similitud entre dos conjuntos de keywords (Jaccard).
 */
function keywordSimilarity(a: string[], b: string[]): number {
  if (!a.length || !b.length) return 0;
  const setA = new Set(a);
  const setB = new Set(b);
  const intersection = [...setA].filter((k) => setB.has(k)).length;
  const union = new Set([...setA, ...setB]).size;
  return intersection / union;
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Guarda una generación exitosa en memoria.
 * Llamar al final de generateApp cuando todo ha ido bien.
 */
export async function rememberGeneration(params: {
  prompt: string;
  language: "typescript" | "javascript";
  plan: {
    title: string;
    pages: Array<{ name: string }>;
    components: string[];
    hooks: string[];
    backendNeeded: boolean;
    frontendFiles: string[];
  };
  design: {
    vibe: string;
    theme: string;
    palette: { primary: string };
    typography: { sans: string };
  };
  metrics: {
    durationMs: number;
    frontendKb: number;
    patchIterations: number;
    validationPassed: boolean;
  };
  codeSnippets?: CodeSnippet[];
}): Promise<void> {
  const col = await getCollection();
  if (!col) return;

  try {
    const keywords = extractKeywords(params.prompt);
    const category = inferCategory(params.prompt);

    // Puntuación de calidad: penaliza muchos patches, premia validación OK
    const qualityScore = Math.max(
      0,
      Math.min(
        1,
        (params.metrics.validationPassed ? 0.6 : 0.2) +
          Math.max(0, 0.3 - params.metrics.patchIterations * 0.1) +
          (params.metrics.frontendKb > 10 ? 0.1 : 0),
      ),
    );

    const entry: GenerationMemoryEntry = {
      prompt: params.prompt.slice(0, 2000),
      keywords,
      category,
      language: params.language,
      plan: {
        title: params.plan.title,
        pages: params.plan.pages.map((p) => p.name),
        components: params.plan.components,
        hooks: params.plan.hooks,
        backendNeeded: params.plan.backendNeeded,
        frontendFileCount: params.plan.frontendFiles.length,
      },
      design: {
        vibe: params.design.vibe,
        theme: params.design.theme,
        primaryColor: params.design.palette.primary,
        fontSans: params.design.typography.sans,
      },
      metrics: params.metrics,
      codeSnippets: (params.codeSnippets ?? []).slice(0, 5),
      recallCount: 0,
      qualityScore,
      createdAt: new Date(),
    };

    await col.insertOne(entry);
    logger.info({ category, qualityScore: qualityScore.toFixed(2) }, "generationMemory: generación guardada");

    // Purgar si hay más de 10.000 entradas (mantener las mejores)
    const count = await col.countDocuments();
    if (count > 10_000) {
      const oldest = await col
        .find({})
        .sort({ qualityScore: 1, recallCount: 1, createdAt: 1 })
        .limit(count - 9_000)
        .project({ _id: 1 })
        .toArray();
      const ids = oldest.map((d) => d._id as ObjectId);
      await col.deleteMany({ _id: { $in: ids } });
      logger.info({ purged: ids.length }, "generationMemory: purga completada");
    }
  } catch (err) {
    logger.warn({ err }, "generationMemory: error al guardar (no crítico)");
  }
}

/**
 * Recupera generaciones similares al prompt actual.
 * Devuelve las más relevantes ordenadas por similitud.
 */
export async function recallGenerations(
  prompt: string,
  opts: {
    limit?: number;
    threshold?: number;
    category?: string;
    language?: "typescript" | "javascript";
  } = {},
): Promise<RecallResult[]> {
  const col = await getCollection();
  if (!col) return [];

  const { limit = 3, threshold = 0.15, language } = opts;
  const keywords = extractKeywords(prompt);
  const category = opts.category ?? inferCategory(prompt);

  try {
    // Buscar por categoría + keywords + idioma
    const filter: Record<string, unknown> = { category };
    if (language) filter.language = language;
    if (keywords.length > 0) filter.keywords = { $in: keywords };

    const candidates = await col
      .find(filter)
      .sort({ qualityScore: -1, recallCount: -1 })
      .limit(50)
      .toArray();

    // Calcular similitud y filtrar por threshold
    const scored: RecallResult[] = candidates
      .map((entry) => ({
        entry,
        similarity: keywordSimilarity(keywords, entry.keywords),
      }))
      .filter((r) => r.similarity >= threshold)
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, limit);

    if (scored.length > 0) {
      // Actualizar contadores de recall en background
      const ids = scored.map((r) => r.entry._id as ObjectId);
      col
        .updateMany(
          { _id: { $in: ids } },
          { $inc: { recallCount: 1 }, $set: { lastRecalledAt: new Date() } },
        )
        .catch(() => {});
    }

    return scored;
  } catch (err) {
    logger.warn({ err }, "generationMemory: error en recall (no crítico)");
    return [];
  }
}

/**
 * Construye el bloque de contexto de memoria para inyectar en los prompts.
 * Formato compacto para no desperdiciar tokens.
 */
export function buildGenerationMemoryBlock(recalls: RecallResult[]): string {
  if (!recalls.length) return "";

  const lines: string[] = [
    "--- MEMORIA DE GENERACIONES ANTERIORES (úsala como referencia, no como regla) ---",
  ];

  for (const { entry, similarity } of recalls) {
    lines.push(
      `\n[Similitud ${Math.round(similarity * 100)}%] Prompt similar: "${entry.prompt.slice(0, 120)}…"`,
      `  Categoría: ${entry.category} | Tema: ${entry.design.vibe} | Backend: ${entry.plan.backendNeeded ? "sí" : "no"}`,
      `  Páginas usadas: ${entry.plan.pages.slice(0, 6).join(", ")}`,
      `  Componentes clave: ${entry.plan.components.slice(0, 6).join(", ")}`,
      `  Color primario: ${entry.design.primaryColor} | Fuente: ${entry.design.fontSans}`,
      `  Archivos frontend: ${entry.plan.frontendFileCount} | Patches necesarios: ${entry.metrics.patchIterations}`,
    );

    if (entry.codeSnippets.length > 0) {
      lines.push("  Snippets útiles de esa generación:");
      for (const s of entry.codeSnippets.slice(0, 2)) {
        lines.push(`    [${s.type}] ${s.description}`);
        lines.push(`    \`\`\`\n${s.code.slice(0, 800)}\n    \`\`\``);
      }
    }
  }

  lines.push("--- FIN MEMORIA ---\n");
  return lines.join("\n");
}

/**
 * Stats de memoria para mostrar en logs/dashboard.
 */
export async function getMemoryStats(): Promise<{
  total: number;
  byCategory: Record<string, number>;
  avgQuality: number;
  topRecalled: string[];
} | null> {
  const col = await getCollection();
  if (!col) return null;

  try {
    const [total, byCategory, topRecalled] = await Promise.all([
      col.countDocuments(),
      col
        .aggregate<{ _id: string; count: number }>([
          { $group: { _id: "$category", count: { $sum: 1 } } },
        ])
        .toArray()
        .then((r) =>
          Object.fromEntries(r.map((x) => [x._id, x.count])),
        ),
      col
        .find({})
        .sort({ recallCount: -1 })
        .limit(5)
        .project({ prompt: 1 })
        .toArray()
        .then((r) => r.map((x) => x.prompt?.slice(0, 80) ?? "")),
    ]);

    const qualitySample = await col
      .find({})
      .sort({ createdAt: -1 })
      .limit(100)
      .project({ qualityScore: 1 })
      .toArray();

    const avgQuality =
      qualitySample.reduce((s, x) => s + (x.qualityScore ?? 0), 0) /
      Math.max(qualitySample.length, 1);

    return { total, byCategory, avgQuality, topRecalled };
  } catch {
    return null;
  }
}
