import { useEffect, useState } from "react";
import { ChevronDown, ChevronRight, Loader2, Save, Brain } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";

interface AgentNotesPanelProps {
  /** Header label shown in the collapsible bar. */
  title: string;
  /** One-line explanation shown right below the header when expanded. */
  description: string;
  /** Initial notes value (string). */
  initialValue: string | undefined;
  /** Whether the initial value is still loading from the server. */
  isLoading?: boolean;
  /** Persist callback. Should resolve when the write is committed. */
  onSave: (notes: string) => Promise<void>;
  /** Saving state from the mutation hook. */
  isSaving?: boolean;
  /** Test id prefix for e2e selectors. */
  testIdPrefix?: string;
  /** Whether the panel starts expanded. Defaults to false (collapsed). */
  defaultOpen?: boolean;
}

/**
 * Collapsible panel that shows the agent's persistent memory (per-app notes
 * or cross-app preferences) and lets the user edit it. The agent reads
 * whatever is in here on every future generation, so empowering the user to
 * tweak it is part of making the memory feel trustworthy ("I can see what
 * the agent remembers about me, and I can change it").
 */
export function AgentNotesPanel({
  title,
  description,
  initialValue,
  isLoading,
  onSave,
  isSaving,
  testIdPrefix = "agent-notes",
  defaultOpen = false,
}: AgentNotesPanelProps) {
  const [open, setOpen] = useState(defaultOpen);
  const [value, setValue] = useState(initialValue ?? "");
  const { toast } = useToast();

  // Keep the textarea in sync with the latest value pulled from the server,
  // but only when the user hasn't started editing — otherwise we'd silently
  // overwrite their typing every time the query refetches in the background.
  const [touched, setTouched] = useState(false);
  useEffect(() => {
    if (!touched && typeof initialValue === "string") {
      setValue(initialValue);
    }
  }, [initialValue, touched]);

  const handleSave = async () => {
    try {
      await onSave(value.slice(0, 3000));
      setTouched(false);
      toast({
        title: "Memoria actualizada",
        description: "El agente la usará en la próxima edición.",
      });
    } catch (err) {
      toast({
        title: "No pude guardar la memoria",
        description: err instanceof Error ? err.message : "Inténtalo de nuevo.",
        variant: "destructive",
      });
    }
  };

  const charCount = value.length;
  const overLimit = charCount > 3000;

  return (
    <div className="rounded-lg border border-white/10 bg-white/5">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between gap-2 px-3 py-2 text-left text-sm font-medium text-white hover:bg-white/5 rounded-t-lg"
        data-testid={`${testIdPrefix}-toggle`}
      >
        <div className="flex items-center gap-2 min-w-0">
          <Brain className="h-4 w-4 text-primary flex-shrink-0" />
          <span className="truncate">{title}</span>
          {!open && initialValue && initialValue.trim().length > 0 && (
            <span
              className="ml-1 text-xs text-muted-foreground flex-shrink-0"
              data-testid={`${testIdPrefix}-count`}
            >
              ({initialValue.split(/\r?\n/).filter((l) => l.trim()).length} ítems)
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
        <div className="px-3 pb-3 space-y-2 border-t border-white/5">
          <p className="text-xs text-muted-foreground pt-2">{description}</p>
          {isLoading ? (
            <div className="flex items-center gap-2 text-xs text-muted-foreground py-4">
              <Loader2 className="h-3 w-3 animate-spin" />
              Cargando…
            </div>
          ) : (
            <>
              <Textarea
                value={value}
                onChange={(e) => {
                  setTouched(true);
                  setValue(e.target.value);
                }}
                placeholder="Una idea por línea. Por ejemplo: 'usar siempre castellano', 'preferir diseño minimalista', 'mantener modo oscuro por defecto'."
                className="min-h-[120px] max-h-[260px] text-xs bg-[#0a0a0f] border-white/10 text-foreground"
                data-testid={`${testIdPrefix}-textarea`}
              />
              <div className="flex items-center justify-between gap-2">
                <span
                  className={`text-xs ${overLimit ? "text-destructive" : "text-muted-foreground"}`}
                  data-testid={`${testIdPrefix}-charcount`}
                >
                  {charCount}/3000
                </span>
                <Button
                  size="sm"
                  onClick={handleSave}
                  disabled={isSaving || !touched || overLimit}
                  className="h-7"
                  data-testid={`${testIdPrefix}-save`}
                >
                  {isSaving ? (
                    <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                  ) : (
                    <Save className="h-3 w-3 mr-1" />
                  )}
                  Guardar
                </Button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
