import { useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  History,
  Loader2,
  Sparkles,
  Pencil,
  Wand2,
  Wrench,
  Undo2,
  RotateCcw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";

interface RevisionItem {
  id: string;
  source: string;
  sourceLabel: string;
  summary: string;
  createdAt: string;
}

interface RevisionHistoryPanelProps {
  revisions: RevisionItem[] | undefined;
  isLoading?: boolean;
  isRestoring?: boolean;
  /** Currently-pending revision id while a restore is in flight. */
  pendingRevisionId?: string | null;
  onRestore: (revisionId: string) => Promise<void>;
}

/** Lucide icon picker per revision source. */
function iconFor(source: string) {
  switch (source) {
    case "create":
      return <Sparkles className="h-3.5 w-3.5 text-emerald-300" />;
    case "edit":
      return <Pencil className="h-3.5 w-3.5 text-cyan-300" />;
    case "visual-fix":
      return <Wand2 className="h-3.5 w-3.5 text-fuchsia-300" />;
    case "health-fix":
      return <Wrench className="h-3.5 w-3.5 text-amber-300" />;
    case "restore-backup":
      return <Undo2 className="h-3.5 w-3.5 text-slate-300" />;
    default:
      return <History className="h-3.5 w-3.5 text-muted-foreground" />;
  }
}

function formatWhen(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString("es-ES", {
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

/**
 * Collapsible revision history panel — every successful generation, edit,
 * visual-fix and health-fix is captured as an immutable snapshot. The user
 * can restore any prior version with one click; the system always saves a
 * "restore-backup" of the current state first so no work is ever lost.
 */
export function RevisionHistoryPanel({
  revisions,
  isLoading,
  isRestoring,
  pendingRevisionId,
  onRestore,
}: RevisionHistoryPanelProps) {
  const [open, setOpen] = useState(false);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const { toast } = useToast();

  const handleRestore = async (revisionId: string) => {
    try {
      await onRestore(revisionId);
      setConfirmingId(null);
      toast({
        title: "Versión restaurada",
        description:
          "Tu versión anterior quedó guardada como copia por si quieres volver.",
      });
    } catch (err) {
      toast({
        title: "No pude restaurar esa versión",
        description:
          err instanceof Error ? err.message : "Inténtalo de nuevo en un momento.",
        variant: "destructive",
      });
    }
  };

  const count = revisions?.length ?? 0;

  return (
    <div className="rounded-lg border border-white/10 bg-white/5">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between gap-2 px-3 py-2 text-left text-sm font-medium text-white hover:bg-white/5 rounded-t-lg"
        data-testid="revision-history-toggle"
      >
        <div className="flex items-center gap-2 min-w-0">
          <History className="h-4 w-4 text-primary flex-shrink-0" />
          <span className="truncate">Historial de versiones</span>
          {!open && count > 0 && (
            <span
              className="ml-1 text-xs text-muted-foreground flex-shrink-0"
              data-testid="revision-history-count"
            >
              ({count})
            </span>
          )}
        </div>
        {open ? (
          <ChevronDown className="h-4 w-4 text-muted-foreground flex-shrink-0" />
        ) : (
          <ChevronRight className="h-4 w-4 text-muted-foreground flex-shrink-0" />
        )}
      </button>

      {open && (
        <div className="px-3 pb-3 border-t border-white/5">
          <p className="text-xs text-muted-foreground py-2">
            Cada generación, edición y reparación queda guardada aquí. Puedes
            volver a cualquier versión anterior con un clic — tu versión actual
            se guarda automáticamente como copia de seguridad.
          </p>
          {isLoading ? (
            <div className="flex items-center gap-2 text-xs text-muted-foreground py-4">
              <Loader2 className="h-3 w-3 animate-spin" />
              Cargando historial…
            </div>
          ) : count === 0 ? (
            <div className="text-xs text-muted-foreground py-4">
              Aún no hay versiones guardadas. La primera aparecerá tras tu
              próxima generación o edición.
            </div>
          ) : (
            <ul
              className="space-y-1.5 max-h-[320px] overflow-y-auto pr-1"
              data-testid="revision-history-list"
            >
              {revisions!.map((r) => {
                const isPending = isRestoring && pendingRevisionId === r.id;
                const isConfirming = confirmingId === r.id;
                return (
                  <li
                    key={r.id}
                    className="flex items-start gap-2 px-2 py-2 rounded-md bg-[#0a0a0f] border border-white/5"
                    data-testid={`revision-item-${r.id}`}
                  >
                    <div className="mt-0.5">{iconFor(r.source)}</div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 text-xs text-white/90">
                        <span className="font-medium">{r.sourceLabel}</span>
                        <span className="text-muted-foreground">·</span>
                        <span className="text-muted-foreground">
                          {formatWhen(r.createdAt)}
                        </span>
                      </div>
                      {r.summary && (
                        <p className="text-xs text-muted-foreground mt-0.5 break-words">
                          {r.summary}
                        </p>
                      )}
                      {isConfirming && (
                        <div className="mt-2 flex items-center gap-2">
                          <span className="text-[11px] text-amber-300">
                            ¿Restaurar esta versión?
                          </span>
                          <Button
                            size="sm"
                            variant="destructive"
                            disabled={isPending}
                            onClick={() => handleRestore(r.id)}
                            className="h-6 text-xs px-2"
                            data-testid={`revision-confirm-${r.id}`}
                          >
                            {isPending ? (
                              <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                            ) : (
                              <RotateCcw className="h-3 w-3 mr-1" />
                            )}
                            Sí, restaurar
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={isPending}
                            onClick={() => setConfirmingId(null)}
                            className="h-6 text-xs px-2"
                          >
                            Cancelar
                          </Button>
                        </div>
                      )}
                    </div>
                    {!isConfirming && (
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={isRestoring}
                        onClick={() => setConfirmingId(r.id)}
                        className="h-6 text-xs px-2 text-cyan-300 hover:text-cyan-200 hover:bg-cyan-400/10"
                        data-testid={`revision-restore-${r.id}`}
                      >
                        <RotateCcw className="h-3 w-3 mr-1" />
                        Restaurar
                      </Button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
