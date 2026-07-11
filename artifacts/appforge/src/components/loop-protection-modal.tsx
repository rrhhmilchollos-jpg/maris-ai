/**
 * loop-protection-modal.tsx
 *
 * Aparece cuando GET /api/jobs/:id devuelve stuckLoopDetected o
 * budgetExceeded (ver evaluator.ts — protección de bucles / presupuesto
 * por tarea). En vez de dejar al cliente con un job atascado sin
 * explicación, se le da el diagnóstico real y 3 salidas:
 *  - Editar el prompt a mano (pista directa a la IA)
 *  - Forzar un reintento (por si fue un fallo puntual)
 *  - Volver a la última versión estable (usa el Time Machine ya existente:
 *    useListAppRevisions + useRestoreAppRevision — no se inventa un
 *    mecanismo de rollback nuevo, se reutiliza el que ya hay).
 */
import { useState } from "react";
import { AlertTriangle, Loader2, RotateCcw, Send, ShieldCheck, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useListAppRevisions, useRestoreAppRevision, useSendAppMessage } from "@/lib/api-client";
import { useToast } from "@/hooks/use-toast";

export function LoopProtectionModal({
  appId,
  job,
  onClose,
  onForceRetry,
}: {
  appId: string;
  job: any;
  onClose: () => void;
  onForceRetry: () => void;
}) {
  const { toast } = useToast();
  const [mode, setMode] = useState<"diagnostic" | "edit_prompt" | "revert">("diagnostic");
  const [hint, setHint] = useState("");
  const [sending, setSending] = useState(false);

  const { data: revisionsData, isLoading: loadingRevisions } = useListAppRevisions(appId, {
    query: { enabled: mode === "revert" },
  });
  const restoreRevision = useRestoreAppRevision();
  const sendMessage = useSendAppMessage();

  const reason = job?.budgetExceeded
    ? `Se alcanzó el presupuesto máximo (${job.maxCreditsForJob} créditos) fijado para esta tarea.`
    : "El agente intentó corregir el mismo problema varias veces seguidas sin resolverlo.";

  const handleSendHint = async () => {
    if (!hint.trim()) return;
    setSending(true);
    try {
      await sendMessage.mutateAsync({ id: appId, data: { content: hint.trim(), attachmentIds: [] } });
      toast({ title: "Pista enviada", description: "El agente va a intentarlo de nuevo con tu indicación." });
      onClose();
    } catch {
      toast({ title: "No se pudo enviar", description: "Inténtalo de nuevo en unos segundos.", variant: "destructive" });
    } finally {
      setSending(false);
    }
  };

  const handleRestore = async (revisionId: string) => {
    try {
      await restoreRevision.mutateAsync({ id: appId, revisionId });
      toast({ title: "Versión restaurada", description: "Se volvió a la última versión estable." });
      onClose();
    } catch {
      toast({ title: "No se pudo restaurar", description: "Inténtalo de nuevo en unos segundos.", variant: "destructive" });
    }
  };

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className="w-full max-w-lg rounded-2xl bg-[#111114] border border-amber-500/25 shadow-2xl overflow-hidden">
        <div className="flex items-start gap-3 p-5 border-b border-white/10">
          <div className="p-2 rounded-full bg-amber-500/15 shrink-0">
            <AlertTriangle className="h-5 w-5 text-amber-400" />
          </div>
          <div className="flex-1">
            <h3 className="text-white font-semibold text-sm">Ejecución pausada para proteger tus créditos</h3>
            <p className="text-xs text-white/50 mt-1">
              El sistema detuvo la reparación automática antes de seguir gastando de más.
            </p>
          </div>
          <button onClick={onClose} className="text-white/40 hover:text-white/80 shrink-0">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div className="rounded-lg bg-black/40 border border-white/10 p-3 font-mono text-xs text-white/70">
            <div className="text-amber-400/80 mb-1">$ diagnóstico</div>
            {reason}
            {job?.lastIssueSummary && (
              <div className="mt-2 text-white/50">→ {job.lastIssueSummary}</div>
            )}
          </div>

          {mode === "diagnostic" && (
            <div className="grid grid-cols-1 gap-2">
              <Button
                variant="outline"
                className="justify-start gap-2"
                onClick={() => setMode("edit_prompt")}
              >
                <Send className="h-4 w-4" /> Editar prompt manualmente
              </Button>
              <Button
                variant="outline"
                className="justify-start gap-2"
                onClick={onForceRetry}
              >
                <ShieldCheck className="h-4 w-4" /> Forzar reintento (una vez)
              </Button>
              <Button
                variant="outline"
                className="justify-start gap-2"
                onClick={() => setMode("revert")}
              >
                <RotateCcw className="h-4 w-4" /> Volver a la última versión estable
              </Button>
            </div>
          )}

          {mode === "edit_prompt" && (
            <div className="space-y-2">
              <textarea
                autoFocus
                value={hint}
                onChange={(e) => setHint(e.target.value)}
                placeholder="Ej: Usa la librería X en lugar de Y para esta parte..."
                className="w-full h-24 rounded-lg bg-white/5 border border-white/10 p-3 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-primary/50"
              />
              <div className="flex gap-2 justify-end">
                <Button variant="ghost" size="sm" onClick={() => setMode("diagnostic")}>Atrás</Button>
                <Button size="sm" disabled={!hint.trim() || sending} onClick={handleSendHint}>
                  {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Enviar pista"}
                </Button>
              </div>
            </div>
          )}

          {mode === "revert" && (
            <div className="space-y-2">
              {loadingRevisions && <div className="text-xs text-white/40">Cargando historial...</div>}
              {!loadingRevisions && (revisionsData?.revisions?.length ?? 0) === 0 && (
                <div className="text-xs text-white/40">Todavía no hay versiones anteriores guardadas de esta app.</div>
              )}
              <div className="space-y-1.5 max-h-48 overflow-auto custom-scrollbar">
                {(revisionsData?.revisions ?? []).slice(0, 5).map((rev: any) => (
                  <button
                    key={rev.id}
                    onClick={() => handleRestore(rev.id)}
                    disabled={restoreRevision.isPending}
                    className="w-full flex items-center justify-between gap-2 px-3 py-2 rounded-lg bg-white/5 border border-white/10 hover:border-primary/40 text-left text-xs text-white/70 disabled:opacity-50"
                  >
                    <span className="truncate">{rev.summary || rev.sourceLabel}</span>
                    <span className="text-white/30 shrink-0">{new Date(rev.createdAt).toLocaleString()}</span>
                  </button>
                ))}
              </div>
              <div className="flex justify-end">
                <Button variant="ghost" size="sm" onClick={() => setMode("diagnostic")}>Atrás</Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
