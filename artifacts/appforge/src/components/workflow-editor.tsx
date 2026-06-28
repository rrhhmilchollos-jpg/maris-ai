/**
 * workflow-editor.tsx
 *
 * Editor visual de flujos de automatización (motor tipo n8n, privado por
 * app generada). Construido sobre @xyflow/react — lienzo de nodos
 * arrastrables y conectables, conectado a la API real de /api/apps/:appId/workflows
 * (CRUD + ejecución de prueba) y al motor de ejecución del backend
 * (lib/workflowEngine.ts), que soporta trigger, action, condition (dos
 * salidas), loop (iteración real), transform (sandbox node:vm), delay y
 * webhook-out.
 */
import { useState, useCallback, useRef, useEffect } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  addEdge,
  useNodesState,
  useEdgesState,
  Handle,
  Position,
  type Node,
  type Edge,
  type Connection,
  type NodeProps,
  ReactFlowProvider,
  BackgroundVariant,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  Zap, ArrowRight, GitBranch, Repeat, Code2, Clock, Webhook,
  Plus, Play, Save, X, ChevronRight, CheckCircle2, XCircle, Loader2,
  Trash2, History,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { apiFetch } from "@/lib/api-client";
import { cn } from "@/lib/utils";

// ─── Tipos ────────────────────────────────────────────────────────────────

type WorkflowNodeType = "trigger" | "action" | "condition" | "loop" | "transform" | "delay" | "webhook-out";

interface NodeTypeMeta {
  type: WorkflowNodeType;
  label: string;
  icon: React.ComponentType<any>;
  color: string;
  bgColor: string;
  borderColor: string;
  description: string;
}

const NODE_TYPE_META: Record<WorkflowNodeType, NodeTypeMeta> = {
  trigger: { type: "trigger", label: "Disparador", icon: Zap, color: "text-violet-300", bgColor: "bg-violet-500/15", borderColor: "border-violet-500/40", description: "Punto de inicio del flujo — un evento de negocio de tu app." },
  action: { type: "action", label: "Llamar URL", icon: ArrowRight, color: "text-emerald-300", bgColor: "bg-emerald-500/15", borderColor: "border-emerald-500/40", description: "Envía una petición HTTP a un servicio externo (n8n, Zapier, Make, tu propio endpoint)." },
  condition: { type: "condition", label: "Condición", icon: GitBranch, color: "text-amber-300", bgColor: "bg-amber-500/15", borderColor: "border-amber-500/40", description: "Evalúa si/no y continúa por una de dos ramas." },
  loop: { type: "loop", label: "Bucle", icon: Repeat, color: "text-cyan-300", bgColor: "bg-cyan-500/15", borderColor: "border-cyan-500/40", description: "Repite los pasos siguientes por cada elemento de una lista." },
  transform: { type: "transform", label: "Transformar datos", icon: Code2, color: "text-fuchsia-300", bgColor: "bg-fuchsia-500/15", borderColor: "border-fuchsia-500/40", description: "Calcula un nuevo valor a partir de los datos del flujo." },
  delay: { type: "delay", label: "Esperar", icon: Clock, color: "text-sky-300", bgColor: "bg-sky-500/15", borderColor: "border-sky-500/40", description: "Pausa el flujo unos segundos antes de continuar." },
  "webhook-out": { type: "webhook-out", label: "Webhook saliente", icon: Webhook, color: "text-rose-300", bgColor: "bg-rose-500/15", borderColor: "border-rose-500/40", description: "Notifica a una suscripción de webhook ya configurada en tu app." },
};

interface WorkflowRunLog {
  nodeId: string;
  status: "success" | "error" | "skipped";
  startedAt: string;
  finishedAt?: string;
  output?: unknown;
  error?: string;
}

interface WorkflowRun {
  _id: string;
  status: "running" | "success" | "error";
  startedAt: string;
  finishedAt?: string;
  nodeLogs: WorkflowRunLog[];
  error?: string;
}

interface WorkflowData {
  _id: string;
  name: string;
  description?: string;
  active: boolean;
  triggerEventType?: string;
  nodes: Array<{ id: string; type: WorkflowNodeType; position: { x: number; y: number }; data: Record<string, unknown> }>;
  edges: Array<{ id: string; source: string; target: string; sourceHandle?: string }>;
}

// ─── Nodo personalizado del lienzo ──────────────────────────────────────────

function FlowNode({ data, selected }: NodeProps) {
  const meta = NODE_TYPE_META[data.nodeType as WorkflowNodeType];
  if (!meta) return null;
  const Icon = meta.icon;
  const hasTwoOutputs = meta.type === "condition";
  const hasLoopOutputs = meta.type === "loop";

  return (
    <div
      className={cn(
        "min-w-[180px] rounded-xl border-2 bg-[#0d0f1a] px-3 py-2.5 shadow-lg transition-all",
        meta.borderColor,
        selected && "ring-2 ring-white/40",
      )}
    >
      {meta.type !== "trigger" && <Handle type="target" position={Position.Left} className="!h-3 !w-3 !border-2 !border-white/30 !bg-[#0d0f1a]" />}
      <div className="flex items-center gap-2">
        <div className={cn("grid h-7 w-7 shrink-0 place-items-center rounded-lg", meta.bgColor)}>
          <Icon className={cn("h-3.5 w-3.5", meta.color)} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[12.5px] font-semibold text-white">{(data.label as string) || meta.label}</p>
          <p className="truncate text-[10px] text-white/40">{meta.label}</p>
        </div>
      </div>

      {hasTwoOutputs ? (
        <>
          <div className="mt-1.5 flex justify-between px-1 text-[9px] font-semibold">
            <span className="text-emerald-400">Sí</span>
            <span className="text-red-400">No</span>
          </div>
          <Handle type="source" position={Position.Right} id="true" style={{ top: "62%" }} className="!h-3 !w-3 !border-2 !border-emerald-400 !bg-[#0d0f1a]" />
          <Handle type="source" position={Position.Right} id="false" style={{ top: "85%" }} className="!h-3 !w-3 !border-2 !border-red-400 !bg-[#0d0f1a]" />
        </>
      ) : hasLoopOutputs ? (
        <>
          <div className="mt-1.5 flex justify-between px-1 text-[9px] font-semibold">
            <span className="text-cyan-400">Cada elemento</span>
            <span className="text-white/50">Al terminar</span>
          </div>
          <Handle type="source" position={Position.Right} id="each" style={{ top: "62%" }} className="!h-3 !w-3 !border-2 !border-cyan-400 !bg-[#0d0f1a]" />
          <Handle type="source" position={Position.Right} id="done" style={{ top: "85%" }} className="!h-3 !w-3 !border-2 !border-white/40 !bg-[#0d0f1a]" />
        </>
      ) : (
        <Handle type="source" position={Position.Right} className="!h-3 !w-3 !border-2 !border-white/30 !bg-[#0d0f1a]" />
      )}
    </div>
  );
}

const nodeTypes = { flowNode: FlowNode };

// ─── Panel de configuración del nodo seleccionado ───────────────────────────

function NodeConfigPanel({ node, onChange, onClose, onDelete }: {
  node: Node;
  onChange: (data: Record<string, unknown>) => void;
  onClose: () => void;
  onDelete: () => void;
}) {
  const meta = NODE_TYPE_META[node.data.nodeType as WorkflowNodeType];
  const Icon = meta.icon;
  const data = node.data as Record<string, unknown>;

  return (
    <div className="flex h-full w-[340px] flex-col border-l border-white/[0.08] bg-[#0a0d15]">
      <div className="flex items-center gap-2 border-b border-white/[0.07] px-4 py-3.5">
        <div className={cn("grid h-7 w-7 place-items-center rounded-lg", meta.bgColor)}>
          <Icon className={cn("h-3.5 w-3.5", meta.color)} />
        </div>
        <span className="text-sm font-bold text-white">{meta.label}</span>
        <button onClick={onClose} className="ml-auto grid h-7 w-7 place-items-center rounded-lg text-white/40 hover:bg-white/[0.06] hover:text-white">
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        <p className="text-[12px] text-white/45 leading-relaxed">{meta.description}</p>

        <div className="space-y-1.5">
          <Label className="text-[11px] text-white/55">Nombre del paso</Label>
          <Input
            value={(data.label as string) || ""}
            onChange={(e) => onChange({ ...data, label: e.target.value })}
            placeholder={meta.label}
            className="h-8 border-white/10 bg-white/[0.04] text-[13px] text-white"
          />
        </div>

        {node.data.nodeType === "trigger" && (
          <div className="space-y-1.5">
            <Label className="text-[11px] text-white/55">Evento que dispara este flujo</Label>
            <Input
              value={(data.eventType as string) || ""}
              onChange={(e) => onChange({ ...data, eventType: e.target.value })}
              placeholder="pedido.creado"
              className="h-8 border-white/10 bg-white/[0.04] font-mono text-[13px] text-white"
            />
            <p className="text-[10px] text-white/30">Debe coincidir con el nombre del evento que tu app envía (ver dispatchWebhookEvent en tu backend).</p>
          </div>
        )}

        {(node.data.nodeType === "action" || node.data.nodeType === "webhook-out") && (
          <>
            <div className="space-y-1.5">
              <Label className="text-[11px] text-white/55">URL de destino</Label>
              <Input
                value={(data.url as string) || ""}
                onChange={(e) => onChange({ ...data, url: e.target.value })}
                placeholder="https://tu-flujo.n8n.cloud/webhook/..."
                className="h-8 border-white/10 bg-white/[0.04] font-mono text-[12px] text-white"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-[11px] text-white/55">Método</Label>
              <div className="flex gap-1.5">
                {["POST", "GET", "PUT"].map((m) => (
                  <button
                    key={m}
                    onClick={() => onChange({ ...data, method: m })}
                    className={cn(
                      "rounded-md px-2.5 py-1 text-[11px] font-semibold transition",
                      (data.method || "POST") === m ? "bg-emerald-600 text-white" : "bg-white/[0.04] text-white/40 hover:text-white/70",
                    )}
                  >
                    {m}
                  </button>
                ))}
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-[11px] text-white/55">Cuerpo a enviar (expresión, opcional)</Label>
              <Textarea
                value={(data.bodyTemplate as string) || ""}
                onChange={(e) => onChange({ ...data, bodyTemplate: e.target.value })}
                placeholder="context.trigger"
                className="min-h-[70px] border-white/10 bg-white/[0.04] font-mono text-[12px] text-white"
              />
              <p className="text-[10px] text-white/30">Déjalo vacío para enviar todos los datos del flujo. Usa context.algo para enviar solo una parte.</p>
            </div>
            <div className="space-y-1.5">
              <Label className="text-[11px] text-white/55">Secreto de firma (opcional)</Label>
              <Input
                type="password"
                value={(data.secret as string) || ""}
                onChange={(e) => onChange({ ...data, secret: e.target.value })}
                placeholder="Para que el receptor verifique la firma"
                className="h-8 border-white/10 bg-white/[0.04] text-[12px] text-white"
              />
            </div>
          </>
        )}

        {node.data.nodeType === "condition" && (
          <div className="space-y-1.5">
            <Label className="text-[11px] text-white/55">Condición (expresión)</Label>
            <Textarea
              value={(data.expression as string) || ""}
              onChange={(e) => onChange({ ...data, expression: e.target.value })}
              placeholder="context.trigger.amount > 100"
              className="min-h-[70px] border-white/10 bg-white/[0.04] font-mono text-[12px] text-white"
            />
            <p className="text-[10px] text-white/30">Si es verdadero, sigue por "Sí"; si no, por "No".</p>
          </div>
        )}

        {node.data.nodeType === "loop" && (
          <>
            <div className="space-y-1.5">
              <Label className="text-[11px] text-white/55">Lista a recorrer (expresión)</Label>
              <Input
                value={(data.arrayExpression as string) || ""}
                onChange={(e) => onChange({ ...data, arrayExpression: e.target.value })}
                placeholder="context.trigger.items"
                className="h-8 border-white/10 bg-white/[0.04] font-mono text-[12px] text-white"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-[11px] text-white/55">Nombre para cada elemento</Label>
              <Input
                value={(data.itemKey as string) || ""}
                onChange={(e) => onChange({ ...data, itemKey: e.target.value })}
                placeholder="item"
                className="h-8 border-white/10 bg-white/[0.04] font-mono text-[12px] text-white"
              />
              <p className="text-[10px] text-white/30">Dentro de "Cada elemento", podrás usar context.item para referirte al elemento actual.</p>
            </div>
          </>
        )}

        {node.data.nodeType === "transform" && (
          <>
            <div className="space-y-1.5">
              <Label className="text-[11px] text-white/55">Cálculo (expresión)</Label>
              <Textarea
                value={(data.expression as string) || ""}
                onChange={(e) => onChange({ ...data, expression: e.target.value })}
                placeholder="context.trigger.price * context.trigger.quantity"
                className="min-h-[70px] border-white/10 bg-white/[0.04] font-mono text-[12px] text-white"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-[11px] text-white/55">Guardar resultado como</Label>
              <Input
                value={(data.outputKey as string) || ""}
                onChange={(e) => onChange({ ...data, outputKey: e.target.value })}
                placeholder="total"
                className="h-8 border-white/10 bg-white/[0.04] font-mono text-[12px] text-white"
              />
              <p className="text-[10px] text-white/30">Disponible después como context.total en los pasos siguientes.</p>
            </div>
          </>
        )}

        {node.data.nodeType === "delay" && (
          <div className="space-y-1.5">
            <Label className="text-[11px] text-white/55">Tiempo de espera (segundos)</Label>
            <Input
              type="number"
              value={data.ms ? Number(data.ms) / 1000 : ""}
              onChange={(e) => onChange({ ...data, ms: Number(e.target.value) * 1000 })}
              placeholder="5"
              className="h-8 border-white/10 bg-white/[0.04] text-[13px] text-white"
            />
          </div>
        )}
      </div>

      {node.data.nodeType !== "trigger" && (
        <div className="border-t border-white/[0.07] p-3">
          <Button
            variant="outline"
            onClick={onDelete}
            className="h-8 w-full border-red-500/30 text-[12px] text-red-400 hover:bg-red-500/10"
          >
            <Trash2 className="mr-1.5 h-3.5 w-3.5" /> Eliminar paso
          </Button>
        </div>
      )}
    </div>
  );
}

// ─── Panel de historial de ejecuciones ──────────────────────────────────────

function RunsPanel({ runs, onClose }: { runs: WorkflowRun[]; onClose: () => void }) {
  const [expanded, setExpanded] = useState<string | null>(null);
  return (
    <div className="flex h-full w-[380px] flex-col border-l border-white/[0.08] bg-[#0a0d15]">
      <div className="flex items-center gap-2 border-b border-white/[0.07] px-4 py-3.5">
        <History className="h-4 w-4 text-white/50" />
        <span className="text-sm font-bold text-white">Ejecuciones recientes</span>
        <button onClick={onClose} className="ml-auto grid h-7 w-7 place-items-center rounded-lg text-white/40 hover:bg-white/[0.06] hover:text-white">
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-2">
        {runs.length === 0 && (
          <p className="px-2 py-8 text-center text-[12px] text-white/30">Todavía no se ha ejecutado este flujo.</p>
        )}
        {runs.map((run) => {
          const isOpen = expanded === run._id;
          return (
            <div key={run._id} className="rounded-lg border border-white/[0.07] bg-white/[0.02]">
              <button
                onClick={() => setExpanded(isOpen ? null : run._id)}
                className="flex w-full items-center gap-2 px-3 py-2.5 text-left"
              >
                {run.status === "success" ? <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-400" />
                  : run.status === "error" ? <XCircle className="h-3.5 w-3.5 shrink-0 text-red-400" />
                  : <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-violet-400" />}
                <span className="flex-1 truncate text-[12px] text-white/70">{new Date(run.startedAt).toLocaleString("es-ES")}</span>
                <ChevronRight className={cn("h-3.5 w-3.5 text-white/30 transition-transform", isOpen && "rotate-90")} />
              </button>
              {isOpen && (
                <div className="space-y-1.5 border-t border-white/[0.06] px-3 py-2.5">
                  {run.error && <p className="rounded-md bg-red-500/10 px-2 py-1.5 text-[11px] text-red-300">{run.error}</p>}
                  {run.nodeLogs.map((log, i) => (
                    <div key={i} className="flex items-center gap-2 text-[11px]">
                      {log.status === "success" ? <CheckCircle2 className="h-3 w-3 shrink-0 text-emerald-400" /> : <XCircle className="h-3 w-3 shrink-0 text-red-400" />}
                      <span className="font-mono text-white/50">{log.nodeId}</span>
                      {log.error && <span className="truncate text-red-300">{log.error}</span>}
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Editor principal ────────────────────────────────────────────────────────

function WorkflowCanvas({ appId, workflowId, onClose }: { appId: string; workflowId: string; onClose: () => void }) {
  const [workflow, setWorkflow] = useState<WorkflowData | null>(null);
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [selectedNode, setSelectedNode] = useState<Node | null>(null);
  const [showRuns, setShowRuns] = useState(false);
  const [runs, setRuns] = useState<WorkflowRun[]>([]);
  const [running, setRunning] = useState(false);
  const [saving, setSaving] = useState(false);
  const idCounter = useRef(0);

  const load = useCallback(async () => {
    const res = await apiFetch<{ workflow: WorkflowData }>(`/api/apps/${appId}/workflows/${workflowId}`);
    setWorkflow(res.workflow);
    setNodes(res.workflow.nodes.map((n) => ({
      id: n.id,
      type: "flowNode",
      position: n.position,
      data: { ...n.data, nodeType: n.type },
    })));
    setEdges(res.workflow.edges.map((e) => ({ id: e.id, source: e.source, target: e.target, sourceHandle: e.sourceHandle, animated: true, style: { stroke: "rgba(255,255,255,0.25)" } })));
  }, [appId, workflowId, setNodes, setEdges]);

  useEffect(() => { load(); }, [load]);

  const onConnect = useCallback((connection: Connection) => {
    setEdges((eds) => addEdge({ ...connection, animated: true, style: { stroke: "rgba(255,255,255,0.25)" } }, eds));
  }, [setEdges]);

  const addNode = useCallback((type: WorkflowNodeType) => {
    idCounter.current += 1;
    const id = `${type}-${Date.now()}-${idCounter.current}`;
    const newNode: Node = {
      id,
      type: "flowNode",
      position: { x: 250 + Math.random() * 150, y: 150 + Math.random() * 250 },
      data: { nodeType: type },
    };
    setNodes((nds) => [...nds, newNode]);
  }, [setNodes]);

  const updateSelectedNodeData = useCallback((data: Record<string, unknown>) => {
    if (!selectedNode) return;
    setNodes((nds) => nds.map((n) => (n.id === selectedNode.id ? { ...n, data } : n)));
    setSelectedNode((prev) => (prev ? { ...prev, data } : prev));
  }, [selectedNode, setNodes]);

  const deleteSelectedNode = useCallback(() => {
    if (!selectedNode) return;
    setNodes((nds) => nds.filter((n) => n.id !== selectedNode.id));
    setEdges((eds) => eds.filter((e) => e.source !== selectedNode.id && e.target !== selectedNode.id));
    setSelectedNode(null);
  }, [selectedNode, setNodes, setEdges]);

  const handleSave = useCallback(async (activate?: boolean) => {
    setSaving(true);
    try {
      const payloadNodes = nodes.map((n) => ({
        id: n.id,
        type: n.data.nodeType as WorkflowNodeType,
        position: n.position,
        data: Object.fromEntries(Object.entries(n.data).filter(([k]) => k !== "nodeType")),
      }));
      const payloadEdges = edges.map((e) => ({ id: e.id, source: e.source, target: e.target, sourceHandle: e.sourceHandle }));
      const triggerNode = payloadNodes.find((n) => n.type === "trigger");
      const body: Record<string, unknown> = { nodes: payloadNodes, edges: payloadEdges };
      if (triggerNode?.data.eventType) body.triggerEventType = triggerNode.data.eventType;
      if (activate !== undefined) body.active = activate;
      const res = await apiFetch<{ workflow: WorkflowData }>(`/api/apps/${appId}/workflows/${workflowId}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      });
      setWorkflow(res.workflow);
    } finally {
      setSaving(false);
    }
  }, [appId, workflowId, nodes, edges]);

  const handleTestRun = useCallback(async () => {
    setRunning(true);
    try {
      await handleSave();
      const res = await apiFetch<{ run: WorkflowRun }>(`/api/apps/${appId}/workflows/${workflowId}/run`, {
        method: "POST",
        body: JSON.stringify({ payload: { test: true, triggeredManually: true } }),
      });
      setRuns((prev) => [res.run, ...prev]);
      setShowRuns(true);
    } finally {
      setRunning(false);
    }
  }, [appId, workflowId, handleSave]);

  const loadRuns = useCallback(async () => {
    const res = await apiFetch<{ runs: WorkflowRun[] }>(`/api/apps/${appId}/workflows/${workflowId}/runs`);
    setRuns(res.runs);
    setShowRuns(true);
  }, [appId, workflowId]);

  if (!workflow) {
    return (
      <div className="flex h-full items-center justify-center bg-[#0a0d15]">
        <Loader2 className="h-6 w-6 animate-spin text-white/30" />
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col bg-[#0a0d15]">
      {/* Barra superior */}
      <div className="flex h-[52px] shrink-0 items-center gap-3 border-b border-white/[0.08] px-4">
        <button onClick={onClose} className="grid h-8 w-8 place-items-center rounded-lg text-white/40 hover:bg-white/[0.06] hover:text-white">
          <X className="h-4 w-4" />
        </button>
        <div className="min-w-0">
          <p className="truncate text-[13px] font-bold text-white">{workflow.name}</p>
        </div>
        <Badge className={cn("ml-1 text-[10px]", workflow.active ? "border-emerald-500/30 bg-emerald-500/15 text-emerald-400" : "border-white/15 bg-white/[0.05] text-white/40")}>
          {workflow.active ? "Activo" : "Borrador"}
        </Badge>
        <div className="ml-auto flex items-center gap-2">
          <Button variant="outline" onClick={loadRuns} className="h-8 border-white/10 bg-white/[0.04] text-[12px] text-white/70 hover:bg-white/[0.08]">
            <History className="mr-1.5 h-3.5 w-3.5" /> Historial
          </Button>
          <Button variant="outline" onClick={handleTestRun} disabled={running} className="h-8 border-white/10 bg-white/[0.04] text-[12px] text-white/70 hover:bg-white/[0.08]">
            {running ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Play className="mr-1.5 h-3.5 w-3.5" />} Probar
          </Button>
          <Button
            onClick={() => handleSave(!workflow.active)}
            disabled={saving}
            className={cn("h-8 text-[12px] font-bold text-white", workflow.active ? "bg-white/[0.08] hover:bg-white/[0.12]" : "bg-emerald-600 hover:bg-emerald-700")}
          >
            {saving ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Save className="mr-1.5 h-3.5 w-3.5" />}
            {workflow.active ? "Desactivar" : "Activar flujo"}
          </Button>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Paleta de nodos */}
        <div className="flex w-[180px] shrink-0 flex-col gap-1.5 overflow-y-auto border-r border-white/[0.08] p-2.5">
          <p className="px-1.5 pb-1 text-[10px] font-bold uppercase tracking-wider text-white/30">Añadir paso</p>
          {(Object.keys(NODE_TYPE_META) as WorkflowNodeType[])
            .filter((t) => t !== "trigger")
            .map((type) => {
              const meta = NODE_TYPE_META[type];
              const Icon = meta.icon;
              return (
                <button
                  key={type}
                  onClick={() => addNode(type)}
                  className="flex items-center gap-2 rounded-lg border border-white/[0.06] bg-white/[0.02] px-2.5 py-2 text-left transition hover:border-white/15 hover:bg-white/[0.05]"
                >
                  <div className={cn("grid h-6 w-6 shrink-0 place-items-center rounded-md", meta.bgColor)}>
                    <Icon className={cn("h-3 w-3", meta.color)} />
                  </div>
                  <span className="truncate text-[11px] font-medium text-white/75">{meta.label}</span>
                  <Plus className="ml-auto h-3 w-3 shrink-0 text-white/20" />
                </button>
              );
            })}
        </div>

        {/* Lienzo */}
        <div className="relative flex-1">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onNodeClick={(_, node) => setSelectedNode(node)}
            onPaneClick={() => setSelectedNode(null)}
            nodeTypes={nodeTypes}
            colorMode="dark"
            fitView
            proOptions={{ hideAttribution: true }}
          >
            <Background variant={BackgroundVariant.Dots} color="rgba(255,255,255,0.08)" gap={20} />
            <Controls className="!border !border-white/10 !bg-[#0d0f1a] [&>button]:!border-white/10 [&>button]:!bg-[#0d0f1a] [&>button]:!text-white/60 [&>button:hover]:!bg-white/10" />
            <MiniMap
              className="!border !border-white/10 !bg-[#0d0f1a]"
              maskColor="rgba(10,13,21,0.7)"
              nodeColor={() => "rgba(124,58,237,0.6)"}
            />
          </ReactFlow>
        </div>

        {selectedNode && (
          <NodeConfigPanel
            node={selectedNode}
            onChange={updateSelectedNodeData}
            onClose={() => setSelectedNode(null)}
            onDelete={deleteSelectedNode}
          />
        )}
        {showRuns && !selectedNode && <RunsPanel runs={runs} onClose={() => setShowRuns(false)} />}
      </div>
    </div>
  );
}

export function WorkflowEditor(props: { appId: string; workflowId: string; onClose: () => void }) {
  return (
    <ReactFlowProvider>
      <WorkflowCanvas {...props} />
    </ReactFlowProvider>
  );
}
