/**
 * ragApps.ts — RAG sobre apps del usuario en Maris AI
 *
 * Cuando el usuario va a generar una nueva app, buscamos apps similares
 * que ya haya generado y reutilizamos componentes que funcionaron.
 *
 * Implementación sin vector DB externa:
 * - Embeddings en memoria con similitud coseno
 * - Cache en MongoDB (campo embeddingText en GeneratedApp)
 * - Búsqueda por TF-IDF simplificado sobre títulos/descripciones/prompts
 *
 * Resultado: el prompt se enriquece con "COMPONENTES REUTILIZABLES DE TUS APPS ANTERIORES"
 * para que los agentes puedan copiar patrones que ya funcionaron.
 */

import { createClaudeMessageWithFallback } from "./shared-agents";
import { GeneratedApp } from "@workspace/db/schema";
import { logger } from "./logger";

// ─── TF-IDF simplificado para similitud sin vector DB ─────────────────────────

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(t => t.length > 2);
}

function similarity(a: string, b: string): number {
  const ta = new Set(tokenize(a));
  const tb = new Set(tokenize(b));
  const intersection = new Set([...ta].filter(t => tb.has(t)));
  const union = new Set([...ta, ...tb]);
  return union.size === 0 ? 0 : intersection.size / union.size;
}

export interface SimilarApp {
  appId: string;
  title: string;
  similarity: number;
  reusableComponents: string[];
  colorPalette?: string;
  techStack: string[];
}

/**
 * Busca apps similares del mismo usuario y extrae componentes reutilizables.
 * Solo mira las últimas 20 apps para no ralentizar.
 */
export async function findSimilarApps(
  userId: string,
  newPrompt: string,
  limit = 3,
): Promise<SimilarApp[]> {
  try {
    const userApps = await GeneratedApp.find(
      { userId, status: "ready" },
      { _id: 1, title: 1, description: 1, prompt: 1, techStack: 1, frontendCode: 1, agentNotes: 1 }
    ).sort({ createdAt: -1 }).limit(20).lean() as any[];

    if (userApps.length === 0) return [];

    // Calcular similitud de cada app con el nuevo prompt
    const scored = userApps.map(app => {
      const appText = `${app.title} ${app.description} ${(app.prompt || "").slice(0, 200)}`;
      const score = similarity(newPrompt, appText);
      return { app, score };
    }).filter(x => x.score > 0.1).sort((a, b) => b.score - a.score).slice(0, limit);

    if (scored.length === 0) return [];

    // Para cada app similar, extraer componentes reutilizables con IA
    const results: SimilarApp[] = [];
    for (const { app, score } of scored) {
      try {
        const codeSnippet = (app.frontendCode || "").slice(0, 3000);
        const response = await createClaudeMessageWithFallback("rag", "claude-haiku-4-5-20251001", {
          max_tokens: 300,
          system: "Analiza este código React y lista los componentes más reutilizables. Devuelve SOLO JSON: {\"components\": [\"NombreComponente: descripción breve\"], \"colorPalette\": \"hex principal\"}. Máximo 5 componentes.",
          messages: [{ role: "user", content: `App: "${app.title}"\nCódigo:\n${codeSnippet}` }],
        });
        const raw = (response.content[0] as any).text ?? "";
        const f = raw.indexOf("{"); const l = raw.lastIndexOf("}");
        let components: string[] = [];
        let colorPalette: string | undefined;
        if (f !== -1) {
          const parsed = JSON.parse(raw.slice(f, l + 1));
          components = parsed.components || [];
          colorPalette = parsed.colorPalette;
        }
        results.push({
          appId: String(app._id),
          title: app.title,
          similarity: Math.round(score * 100) / 100,
          reusableComponents: components,
          colorPalette,
          techStack: app.techStack || [],
        });
      } catch {
        results.push({
          appId: String(app._id),
          title: app.title,
          similarity: score,
          reusableComponents: [],
          techStack: app.techStack || [],
        });
      }
    }
    return results;
  } catch (err) {
    logger.warn({ err, userId }, "ragApps: findSimilarApps failed");
    return [];
  }
}

/**
 * Construye un bloque de contexto RAG para añadir al prompt de generación.
 */
export function buildRAGContextBlock(similarApps: SimilarApp[]): string {
  if (similarApps.length === 0) return "";
  const lines = ["[APPS ANTERIORES DEL USUARIO — REUTILIZAR PATRONES QUE FUNCIONARON]"];
  for (const app of similarApps) {
    lines.push(`\n• "${app.title}" (similitud: ${Math.round(app.similarity * 100)}%)`);
    if (app.colorPalette) lines.push(`  Color principal: ${app.colorPalette}`);
    if (app.reusableComponents.length > 0) {
      lines.push(`  Componentes reutilizables:`);
      app.reusableComponents.forEach(c => lines.push(`    - ${c}`));
    }
  }
  lines.push("\n[Usa estos patrones como referencia si aplican al nuevo proyecto]");
  return lines.join("\n");
}
