/**
 * workflow-list-panel.tsx
 *
 * Lista de flujos de automatización de una app generada — punto de entrada
 * antes de abrir el editor visual (workflow-editor.tsx). Permite crear un
 * flujo nuevo (con su nodo de disparador inicial ya colocado) y activar/
 * desactivar flujos existentes sin entrar al editor.
 */
import { useState, useEffect, useCallback } from "react";
import { Workflow as WorkflowIcon, Plus, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { apiFetch } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { WorkflowEditor } from "@/components/workflow-editor";

interface WorkflowSummary {
  _id: string;
  name: string;
  description?: string;
  active: boolean;
  triggerEventType?: string;
  updatedAt: string;
}

export function WorkflowListPanel({ appId, onClose }: { appId: string; onClose: () => void }) {
  const [workflows, setWorkflows] = useState<WorkflowSummary[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [savingNew, setSavingNew] = useState(false);
  const [openWorkflowId, setOpenWorkflowId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await apiFetch<{ workflows: WorkflowSummary[] }>(`/api/apps/${appId}/workflows`);
    setWorkflows(res.workflows);
  }, [appId]);

  useEffect(() => { load(); }, [load]);

  const handleCreate = useCallback(async () => {
    if (!newName.trim()) return;
    setSavingNew(true);
    try {
      const res = await apiFetch<{ workflow: WorkflowSummary }>(`/api/apps/${appId}/workflows`, {
        method: "POST",
        body: JSON.stringify({ name: newName.trim() }),
      });
      setNewName("");
      setCreating(false);
      await load();
      setOpenWorkflowId(res.workflow._id);
    } finally {
      setSavingNew(false);
    }
  }, [appId, newName, load]);

  if (openWorkflowId) {
    return (
      <div className="fixed inset-0 z-[200] bg-[#0a0d15]">
        <WorkflowEditor appId={appId} workflowId={openWorkflowId} onClose={() => { setOpenWorkflowId(null); load(); }} />
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className="relative w-full max-w-2xl rounded-2xl border border-white/[0.09] bg-[#0d0f1a] shadow-2xl">
        <div className="flex items-center gap-3 border-b border-white/[0.07] px-5 py-4">
          <div className="grid h-8 w-8 place-items-center rounded-lg bg-[#7c3aed]/20">
            <WorkflowIcon className="h-4 w-4 text-[#c084fc]" />
          </div>
          <div>
            <p className="text-base font-bold text-white">Automatización</p>
            <p className="text-[12px] text-white/40">Flujos privados de esta app — conecta eventos con n8n, Zapier, Make o tu propio endpoint.</p>
          </div>
          <button onClick={onClose} className="ml-auto grid h-8 w-8 place-items-center rounded-lg text-white/40 hover:bg-white/[0.06] hover:text-white">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="max-h-[60vh] overflow-y-auto p-5">
          {workflows === null ? (
            <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-white/30" /></div>
          ) : workflows.length === 0 && !creating ? (
            <div className="py-10 text-center">
              <WorkflowIcon className="mx-auto mb-3 h-8 w-8 text-white/15" />
              <p className="text-[13px] text-white/40">Todavía no tienes flujos de automatización.</p>
              <p className="mt-1 text-[12px] text-white/25">Crea uno para conectar eventos de tu app con herramientas externas.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {workflows.map((w) => (
                <button
                  key={w._id}
                  onClick={() => setOpenWorkflowId(w._id)}
                  className="flex w-full items-center gap-3 rounded-xl border border-white/[0.07] bg-white/[0.02] px-4 py-3 text-left transition hover:border-white/15 hover:bg-white/[0.05]"
                >
                  <div className={cn("grid h-8 w-8 shrink-0 place-items-center rounded-lg", w.active ? "bg-emerald-500/15" : "bg-white/[0.05]")}>
                    <WorkflowIcon className={cn("h-4 w-4", w.active ? "text-emerald-400" : "text-white/30")} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-semibold text-white">{w.name}</p>
                    <p className="truncate text-[11px] text-white/35">{w.triggerEventType || "Sin evento configurado"}</p>
                  </div>
                  <Badge className={cn("shrink-0 text-[10px]", w.active ? "border-emerald-500/30 bg-emerald-500/15 text-emerald-400" : "border-white/15 bg-white/[0.05] text-white/40")}>
                    {w.active ? "Activo" : "Borrador"}
                  </Badge>
                </button>
              ))}
            </div>
          )}

          {creating && (
            <div className="mt-3 flex items-center gap-2 rounded-xl border border-[#7c3aed]/30 bg-[#7c3aed]/5 p-3">
              <Input
                autoFocus
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleCreate()}
                placeholder="Ej. Notificar nuevo pedido"
                className="h-9 flex-1 border-white/10 bg-white/[0.04] text-[13px] text-white"
              />
              <Button onClick={handleCreate} disabled={savingNew || !newName.trim()} className="h-9 bg-[#7c3aed] text-[12px] font-bold text-white hover:bg-[#8b5cf6]">
                {savingNew ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Crear"}
              </Button>
            </div>
          )}
        </div>

        {!creating && (
          <div className="border-t border-white/[0.07] p-4">
            <Button onClick={() => setCreating(true)} className="h-9 w-full bg-[#7c3aed] text-[13px] font-bold text-white hover:bg-[#8b5cf6]">
              <Plus className="mr-1.5 h-4 w-4" /> Nuevo flujo
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
