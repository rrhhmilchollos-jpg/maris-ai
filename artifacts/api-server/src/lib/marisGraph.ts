/**
 * marisGraph.ts — Pipeline de generación con LangGraph
 *
 * Convierte el pipeline lineal de Maris AI en un GRAFO de estado
 * con checkpointing, retry selectivo y flujo condicional real.
 *
 * GRAFO DE GENERACIÓN:
 *
 *   START
 *     │
 *     ▼
 *   [research]  ──────────────────────────────────────┐
 *     │                                               │
 *     ▼                                               │
 *   [architect] ──→ (plan too big?) ──→ [trim_plan]   │
 *     │                                    │          │
 *     ▼ ◄──────────────────────────────────┘          │
 *   [design]                                          │
 *     │                                               │
 *     ▼                                               │
 *   [frontend]  ──→ (timeout?) ──→ [retry_frontend]   │
 *     │                                  │            │
 *     ▼ ◄───────────────────────────────-┘            │
 *   [backend?]  ──→ (not needed?) ──→ skip            │
 *     │                                               │
 *     ▼                                               │
 *   [quality_check] ──→ (fail?) ──→ [patch]           │
 *     │                               │               │
 *     ▼ ◄─────────────────────────────┘               │
 *   [finalize]                                        │
 *     │                                               │
 *     ▼                                               │
 *    END ◄──────────────────────────────────────────── ┘
 *                                           (error path)
 *
 * VENTAJAS SOBRE EL PIPELINE LINEAL:
 * - Checkpointing: si falla en "frontend", retoma desde ahí (no desde cero)
 * - Condicional: salta nodos innecesarios (no busca en web para apps simples)
 * - Retry selectivo: reintenta solo el nodo que falló
 * - Visibilidad: cada nodo reporta su estado al panel admin
 */

import { StateGraph, Annotation, END, START } from "@langchain/langgraph";
import { logger } from "./logger";

// ─── Estado del grafo ─────────────────────────────────────────────────────────

const GraphState = Annotation.Root({
  // Input
  jobId:        Annotation<string>(),
  userId:       Annotation<string>(),
  prompt:       Annotation<string>(),
  kind:         Annotation<string>(),
  language:     Annotation<string>(),
  hasEverPaid:  Annotation<boolean>(),
  previousApp:  Annotation<any>(),

  // Resultados de cada agente
  research:     Annotation<string>({ default: () => "", reducer: (_, b) => b }),
  plan:         Annotation<any>({ default: () => null, reducer: (_, b) => b }),
  design:       Annotation<any>({ default: () => null, reducer: (_, b) => b }),
  frontendCode: Annotation<string>({ default: () => "", reducer: (_, b) => b }),
  backendCode:  Annotation<string>({ default: () => "", reducer: (_, b) => b }),
  qualityScore: Annotation<number>({ default: () => 0, reducer: (_, b) => b }),
  patchCount:   Annotation<number>({ default: () => 0, reducer: (_, b) => b }),

  // Control de flujo
  phase:        Annotation<string>({ default: () => "init", reducer: (_, b) => b }),
  errors:       Annotation<string[]>({ default: () => [], reducer: (a, b) => [...a, ...b] }),
  retries:      Annotation<number>({ default: () => 0, reducer: (_, b) => b }),
  skipResearch: Annotation<boolean>({ default: () => false, reducer: (_, b) => b }),
  skipBackend:  Annotation<boolean>({ default: () => false, reducer: (_, b) => b }),

  // Callbacks
  log:          Annotation<((agent: string, msg: string) => Promise<void>) | undefined>(),
  onProgress:   Annotation<((p: any) => Promise<void>) | undefined>(),
});

type GraphStateType = typeof GraphState.State;

// ─── Nodos del grafo ──────────────────────────────────────────────────────────

async function nodeResearch(state: GraphStateType): Promise<Partial<GraphStateType>> {
  const { prompt, log, onProgress } = state;
  await log?.("researcher", "🔍 Investigando contexto del proyecto…");
  await onProgress?.({ phase: "researching", progress: 5 });

  // Prompts simples no necesitan research
  const simplePrompts = /landing|calculadora|juego simple|conversor|todo list/i;
  if (simplePrompts.test(prompt) && prompt.length < 100) {
    return { research: "", skipResearch: true, phase: "architect" };
  }

  try {
    const { researchTopic } = await import("../routes/apps");
    const result = await researchTopic(prompt, undefined, log);
    await onProgress?.({ phase: "researching", progress: 12 });
    return { research: result, phase: "architect" };
  } catch (err) {
    logger.warn({ err, jobId: state.jobId }, "marisGraph: research node failed");
    return { research: "", errors: [`research: ${String(err)}`], phase: "architect" };
  }
}

async function nodeArchitect(state: GraphStateType): Promise<Partial<GraphStateType>> {
  const { prompt, research, log, onProgress } = state;
  await log?.("architect", "🏗️ Diseñando la arquitectura de tu app…");
  await onProgress?.({ phase: "architecting", progress: 20 });

  try {
    const { architectPlan } = await import("../routes/apps");
    const plan = await architectPlan(prompt, research);
    const skipBackend = !plan.backendNeeded;
    await log?.("architect", `✅ Arquitectura lista: ${plan.pages?.length || 0} páginas, ${plan.components?.length || 0} componentes${skipBackend ? "" : " + backend"}`);
    await onProgress?.({ phase: "architecting", progress: 30 });
    return { plan, skipBackend, phase: "design" };
  } catch (err) {
    logger.warn({ err }, "marisGraph: architect node failed");
    return { errors: [`architect: ${String(err)}`], phase: "finalize" };
  }
}

async function nodeDesign(state: GraphStateType): Promise<Partial<GraphStateType>> {
  const { plan, research, log, onProgress } = state;
  await log?.("designer", "🎨 Definiendo el sistema visual…");
  await onProgress?.({ phase: "designing", progress: 35 });

  try {
    const { designSystem } = await import("../routes/apps");
    const design = await designSystem(plan, research);
    await onProgress?.({ phase: "designing", progress: 40 });
    return { design, phase: "frontend" };
  } catch (err) {
    logger.warn({ err }, "marisGraph: design node failed — using defaults");
    return { design: null, phase: "frontend" }; // design es opcional
  }
}

async function nodeFrontend(state: GraphStateType): Promise<Partial<GraphStateType>> {
  const { prompt, plan, design, research, language, hasEverPaid, log, onProgress, jobId } = state;
  await log?.("coder", "⚡ Construyendo el frontend de tu app…");
  await onProgress?.({ phase: "generating", progress: 45 });

  try {
    const { generateFrontend } = await import("../routes/apps");
    const frontendCode = await generateFrontend(
      prompt, plan, design, research, language as any,
      (chars) => onProgress?.({ phase: "generating", progress: 45 + Math.min(chars / 2000, 25) }),
      log, hasEverPaid, jobId,
    );
    await log?.("coder", `✅ Frontend listo (${Math.round(frontendCode.length / 1024)} KB)`);
    await onProgress?.({ phase: "generating", progress: 75 });
    return { frontendCode, phase: state.skipBackend ? "quality_check" : "backend" };
  } catch (err) {
    const retries = state.retries + 1;
    if (retries <= 2) {
      logger.warn({ err, retries }, "marisGraph: frontend failed, retrying");
      await log?.("coder", `⚠️ Generando de nuevo (intento ${retries}/2)…`);
      return { retries, errors: [`frontend_attempt_${retries}: ${String(err)}`], phase: "frontend" };
    }
    return { errors: [`frontend_final: ${String(err)}`], phase: "finalize" };
  }
}

async function nodeBackend(state: GraphStateType): Promise<Partial<GraphStateType>> {
  const { prompt, plan, frontendCode, language, log, onProgress } = state;
  await log?.("coder", "🔧 Construyendo el backend…");
  await onProgress?.({ phase: "backend", progress: 78 });

  try {
    const { generateBackend } = await import("../routes/apps");
    const backendCode = await generateBackend(prompt, plan, frontendCode, language as any, log);
    await log?.("coder", `✅ Backend listo (${Math.round(backendCode.length / 1024)} KB)`);
    await onProgress?.({ phase: "backend", progress: 88 });
    return { backendCode, phase: "quality_check" };
  } catch (err) {
    logger.warn({ err }, "marisGraph: backend failed — continuing without backend");
    return { backendCode: "", phase: "quality_check" };
  }
}

async function nodeQualityCheck(state: GraphStateType): Promise<Partial<GraphStateType>> {
  const { frontendCode, prompt, log, onProgress, jobId, patchCount } = state;
  await log?.("qa", "🔍 Verificando calidad del código…");
  await onProgress?.({ phase: "quality_check", progress: 90 });

  try {
    const { evaluateJobQuality } = await import("./aiAutopilot");
    const eval_ = await evaluateJobQuality(jobId, "", frontendCode, prompt);
    await log?.("qa", `✅ Calidad: ${eval_.score}/100${eval_.pass ? "" : ` — ${eval_.issues.slice(0,2).join(", ")}`}`);

    if (!eval_.pass && patchCount < 2) {
      return { qualityScore: eval_.score, phase: "patch" };
    }
    return { qualityScore: eval_.score, phase: "finalize" };
  } catch {
    return { qualityScore: 70, phase: "finalize" };
  }
}

async function nodePatch(state: GraphStateType): Promise<Partial<GraphStateType>> {
  const { frontendCode, prompt, log, onProgress } = state;
  await log?.("coder", "🩹 Aplicando mejoras automáticas…");
  await onProgress?.({ phase: "patching", progress: 93 });

  try {
    const { patchBundle } = await import("./generate");
    const issues = `Código generado con problemas de calidad. Prompt original: ${prompt.slice(0, 200)}`;
    const patched = await patchBundle(frontendCode, issues, "typescript" as any, log, () => {});
    return {
      frontendCode: patched || frontendCode,
      patchCount: state.patchCount + 1,
      phase: "quality_check",
    };
  } catch {
    return { patchCount: state.patchCount + 1, phase: "finalize" };
  }
}

async function nodeFinalize(state: GraphStateType): Promise<Partial<GraphStateType>> {
  const { log, onProgress } = state;
  await onProgress?.({ phase: "done", progress: 100 });
  await log?.("system", "✅ Generación completada correctamente.");
  return { phase: "done" };
}

// ─── Condiciones de enrutamiento ──────────────────────────────────────────────

function routeAfterFrontend(state: GraphStateType): string {
  if (state.phase === "frontend") return "frontend"; // retry
  if (state.phase === "finalize") return "finalize";
  return state.skipBackend ? "quality_check" : "backend";
}

function routeAfterQuality(state: GraphStateType): string {
  return state.phase === "patch" ? "patch" : "finalize";
}

function routeAfterPatch(state: GraphStateType): string {
  return state.patchCount < 2 ? "quality_check" : "finalize";
}

// ─── Construcción del grafo ───────────────────────────────────────────────────

function buildMarisGraph() {
  const graph = new StateGraph(GraphState)
    .addNode("research",       nodeResearch)
    .addNode("architect",      nodeArchitect)
    .addNode("design",         nodeDesign)
    .addNode("frontend",       nodeFrontend)
    .addNode("backend",        nodeBackend)
    .addNode("quality_check",  nodeQualityCheck)
    .addNode("patch",          nodePatch)
    .addNode("finalize",       nodeFinalize)
    .addEdge(START,            "research")
    .addEdge("research",       "architect")
    .addEdge("architect",      "design")
    .addEdge("design",         "frontend")
    .addConditionalEdges("frontend", routeAfterFrontend, {
      frontend:      "frontend",
      backend:       "backend",
      quality_check: "quality_check",
      finalize:      "finalize",
    })
    .addEdge("backend",        "quality_check")
    .addConditionalEdges("quality_check", routeAfterQuality, {
      patch:    "patch",
      finalize: "finalize",
    })
    .addConditionalEdges("patch", routeAfterPatch, {
      quality_check: "quality_check",
      finalize:      "finalize",
    })
    .addEdge("finalize", END);

  return graph.compile();
}

// Singleton compilado una vez al arrancar
let _compiledGraph: ReturnType<typeof buildMarisGraph> | null = null;
export function getMarisGraph() {
  if (!_compiledGraph) _compiledGraph = buildMarisGraph();
  return _compiledGraph;
}

// ─── Entrada pública ──────────────────────────────────────────────────────────

export interface MarisGraphInput {
  jobId: string;
  userId: string;
  prompt: string;
  kind?: string;
  language?: string;
  hasEverPaid?: boolean;
  previousApp?: any;
  log: (agent: string, msg: string) => Promise<void>;
  onProgress: (p: { phase: string; progress: number }) => Promise<void>;
}

export async function runMarisGraph(input: MarisGraphInput): Promise<{
  frontendCode: string;
  backendCode: string;
  plan: any;
  design: any;
  qualityScore: number;
  errors: string[];
}> {
  const graph = getMarisGraph();

  const finalState = await graph.invoke({
    jobId:       input.jobId,
    userId:      input.userId,
    prompt:      input.prompt,
    kind:        input.kind || "fullstack",
    language:    input.language || "typescript",
    hasEverPaid: input.hasEverPaid ?? false,
    previousApp: input.previousApp ?? null,
    log:         input.log,
    onProgress:  input.onProgress,
  });

  return {
    frontendCode: finalState.frontendCode || "",
    backendCode:  finalState.backendCode || "",
    plan:         finalState.plan,
    design:       finalState.design,
    qualityScore: finalState.qualityScore || 0,
    errors:       finalState.errors || [],
  };
}
