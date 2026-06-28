/**
 * workflowEngine.ts
 *
 * Motor de ejecución de los flujos visuales de automatización (editor tipo
 * n8n, por app generada). Recibe la definición del flujo (nodos + conexiones,
 * ver schema Workflow en @workspace/db/schema) y un payload de disparo, y
 * ejecuta el grafo nodo por nodo, registrando cada paso en WorkflowRun para
 * que el usuario pueda depurar visualmente qué pasó en cada ejecución.
 *
 * TIPOS DE NODO SOPORTADOS (alcance acordado explícitamente con el usuario:
 * versión avanzada desde el principio, no solo trigger→acción→condición):
 * - trigger:    punto de entrada. No se "ejecuta" — solo recibe el payload inicial.
 * - action:     llama a una URL HTTP externa (igual contrato que los webhooks
 *               salientes ya generados en el backend de cada app: HTTP+JSON,
 *               firma HMAC opcional).
 * - condition:  evalúa una expresión sobre el contexto actual; tiene dos
 *               salidas (sourceHandle "true"/"false").
 * - loop:       itera sobre un array del contexto, ejecutando la rama "each"
 *               una vez por elemento, y continuando por "done" al terminar.
 * - transform:  evalúa una expresión JS sobre el contexto y guarda el
 *               resultado en una clave nueva del contexto — ejecutada en un
 *               sandbox real (node:vm), sin acceso a process/require/fs.
 * - delay:      espera N milisegundos antes de continuar (con un máximo
 *               razonable para no bloquear el worker indefinidamente).
 * - webhook-out: variante explícita de action pensada para encajar con el
 *               WebhookSubscription que ya existe en el backend de la app
 *               generada — mismo comportamiento que action en este motor.
 */
import vm from "node:vm";
import { Workflow, WorkflowRun, type IWorkflowNode, type IWorkflowEdge } from "@workspace/db/schema";
import { logger } from "./logger";

const MAX_NODES_PER_RUN = 200; // límite duro contra bucles infinitos por un grafo mal formado
const MAX_LOOP_ITERATIONS = 1000;
const TRANSFORM_TIMEOUT_MS = 1000; // node:vm corta la ejecución si se excede
const DELAY_MAX_MS = 5 * 60 * 1000; // 5 minutos — un delay mayor debería ser un cron, no este motor síncrono

type WorkflowContext = Record<string, unknown>;

interface NodeRunResult {
  output?: unknown;
  nextHandle?: string; // qué arista de salida seguir (ej. "true"/"false" en condition; "each"/"done" en loop)
}

/**
 * Evalúa una expresión JS del usuario en un sandbox real con node:vm —
 * sin acceso a process, require, fs, ni al scope del proceso de Maris AI.
 * Solo se expone el contexto del workflow (los datos del flujo hasta ese
 * punto) bajo el nombre `context`, igual que en n8n/Zapier.
 */
function evaluateExpressionSandboxed(expression: string, context: WorkflowContext): unknown {
  const sandbox = { context, result: undefined as unknown };
  const vmContext = vm.createContext(sandbox, { codeGeneration: { strings: false, wasm: false } });
  try {
    vm.runInContext(`result = (${expression});`, vmContext, { timeout: TRANSFORM_TIMEOUT_MS });
  } catch (err) {
    throw new Error(`Error evaluando la expresión: ${(err as Error).message}`);
  }
  return sandbox.result;
}

async function runActionNode(node: IWorkflowNode, context: WorkflowContext): Promise<NodeRunResult> {
  const data = node.data as { url?: string; method?: string; bodyTemplate?: string; secret?: string };
  if (!data.url) throw new Error("Nodo de acción sin URL configurada.");
  const body = data.bodyTemplate
    ? evaluateExpressionSandboxed(data.bodyTemplate, context)
    : context;
  const payload = JSON.stringify(body);
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (data.secret) {
    // Mismo esquema de firma que el dispatcher de webhooks salientes generado
    // en el backend de cada app — consistencia entre ambos sistemas.
    const crypto = await import("node:crypto");
    headers["X-MarisAI-Signature"] = crypto.createHmac("sha256", data.secret).update(payload).digest("hex");
  }
  const res = await fetch(data.url, { method: data.method || "POST", headers, body: payload });
  const responseText = await res.text().catch(() => "");
  if (!res.ok) throw new Error(`La URL externa respondió ${res.status}: ${responseText.slice(0, 200)}`);
  let parsed: unknown = responseText;
  try { parsed = JSON.parse(responseText); } catch { /* respuesta no-JSON, se deja como texto */ }
  return { output: parsed };
}

function runConditionNode(node: IWorkflowNode, context: WorkflowContext): NodeRunResult {
  const data = node.data as { expression?: string };
  if (!data.expression) throw new Error("Nodo de condición sin expresión configurada.");
  const result = evaluateExpressionSandboxed(data.expression, context);
  return { output: !!result, nextHandle: result ? "true" : "false" };
}

function runTransformNode(node: IWorkflowNode, context: WorkflowContext): NodeRunResult {
  const data = node.data as { expression?: string; outputKey?: string };
  if (!data.expression) throw new Error("Nodo de transformación sin expresión configurada.");
  const result = evaluateExpressionSandboxed(data.expression, context);
  if (data.outputKey) context[data.outputKey] = result;
  return { output: result };
}

async function runDelayNode(node: IWorkflowNode): Promise<NodeRunResult> {
  const data = node.data as { ms?: number };
  const ms = Math.min(Math.max(0, data.ms ?? 0), DELAY_MAX_MS);
  await new Promise((resolve) => setTimeout(resolve, ms));
  return {};
}

/**
 * Ejecuta un grafo de workflow completo a partir del nodo trigger, siguiendo
 * las aristas según el sourceHandle que cada nodo devuelva. Registra cada
 * paso en un WorkflowRun para depuración visual posterior.
 */
export async function executeWorkflow(workflowId: string, triggerPayload: unknown): Promise<void> {
  const workflow = await Workflow.findById(workflowId).lean();
  if (!workflow || !workflow.active) return;

  const run = await WorkflowRun.create({
    workflowId,
    appId: workflow.appId,
    status: "running",
    triggerPayload,
    nodeLogs: [],
    startedAt: new Date(),
  });

  const context: WorkflowContext = { trigger: triggerPayload };
  const nodesById = new Map(workflow.nodes.map((n: IWorkflowNode) => [n.id, n]));
  const edgesBySource = new Map<string, IWorkflowEdge[]>();
  for (const edge of workflow.edges) {
    const list = edgesBySource.get(edge.source) ?? [];
    list.push(edge);
    edgesBySource.set(edge.source, list);
  }

  const triggerNode = workflow.nodes.find((n: IWorkflowNode) => n.type === "trigger");
  if (!triggerNode) {
    await WorkflowRun.findByIdAndUpdate(run._id, { status: "error", error: "El flujo no tiene un nodo de inicio.", finishedAt: new Date() });
    return;
  }

  let visitedCount = 0;
  let runStatus: "success" | "error" = "success";
  let runError: string | undefined;

  async function visit(nodeId: string, loopDepth = 0): Promise<void> {
    if (visitedCount++ > MAX_NODES_PER_RUN) {
      throw new Error(`Límite de ${MAX_NODES_PER_RUN} pasos por ejecución alcanzado — revisa el flujo por si tiene un bucle sin condición de salida.`);
    }
    const node = nodesById.get(nodeId);
    if (!node) return;

    const startedAt = new Date();
    let result: NodeRunResult = {};
    try {
      switch (node.type) {
        case "trigger":
          result = { output: triggerPayload };
          break;
        case "action":
        case "webhook-out":
          result = await runActionNode(node, context);
          break;
        case "condition":
          result = runConditionNode(node, context);
          break;
        case "transform":
          result = runTransformNode(node, context);
          break;
        case "delay":
          result = await runDelayNode(node);
          break;
        case "loop": {
          const data = node.data as { arrayExpression?: string; itemKey?: string };
          const items = data.arrayExpression ? evaluateExpressionSandboxed(data.arrayExpression, context) : [];
          if (!Array.isArray(items)) throw new Error("La expresión del bucle no evaluó a un array.");
          const eachEdges = (edgesBySource.get(node.id) ?? []).filter((e) => e.sourceHandle === "each");
          for (const item of items.slice(0, MAX_LOOP_ITERATIONS)) {
            if (data.itemKey) context[data.itemKey] = item;
            for (const edge of eachEdges) await visit(edge.target, loopDepth + 1);
          }
          result = { output: items.length, nextHandle: "done" };
          break;
        }
        default:
          result = {};
      }
      await WorkflowRun.findByIdAndUpdate(run._id, {
        $push: { nodeLogs: { nodeId: node.id, status: "success", startedAt, finishedAt: new Date(), output: result.output } },
      });
    } catch (err) {
      const message = (err as Error).message;
      await WorkflowRun.findByIdAndUpdate(run._id, {
        $push: { nodeLogs: { nodeId: node.id, status: "error", startedAt, finishedAt: new Date(), error: message } },
      });
      throw err; // un nodo fallido detiene la ejecución del flujo — no continuamos con un contexto potencialmente inconsistente
    }

    if (node.type === "loop") return; // el bucle ya gestionó sus propias ramas internamente arriba
    const outgoing = edgesBySource.get(node.id) ?? [];
    const next = result.nextHandle
      ? outgoing.filter((e) => e.sourceHandle === result.nextHandle)
      : outgoing;
    for (const edge of next) await visit(edge.target, loopDepth);
  }

  try {
    await visit(triggerNode.id);
  } catch (err) {
    runStatus = "error";
    runError = (err as Error).message;
    logger.warn({ workflowId, err }, "workflow execution failed");
  }

  await WorkflowRun.findByIdAndUpdate(run._id, { status: runStatus, error: runError, finishedAt: new Date() });
}

/**
 * Punto de entrada llamado desde el endpoint que recibe el evento de negocio
 * (ej. el propio dispatchWebhookEvent del backend generado, o un trigger
 * manual desde el editor). Busca todos los workflows activos de la app para
 * ese eventType y los ejecuta en paralelo, sin que el fallo de uno afecte a
 * los demás.
 */
export async function triggerWorkflowsForEvent(appId: string, eventType: string, payload: unknown): Promise<void> {
  const workflows = await Workflow.find({ appId, active: true, triggerEventType: eventType }).lean();
  await Promise.allSettled(workflows.map((w) => executeWorkflow(String(w._id), payload)));
}
