import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Search, Loader2, ChevronDown, ChevronUp } from "lucide-react";
import { useErrorFrequencyDiagnostic } from "@/lib/api-client";

/**
 * Caja de diagnóstico: cuántas veces ha ocurrido de verdad un patrón de
 * error en producción, usando datos reales de AgentMemory (no intuición).
 * Pensada para decisiones de fondo tipo "¿merece la pena cambiar wouter
 * por react-router-dom en toda la plataforma?" con cifras reales delante.
 */
export function ErrorFrequencyDiagnostic() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const diag = useErrorFrequencyDiagnostic();

  const handleSearch = () => {
    if (!query.trim()) return;
    diag.mutate({ query: query.trim() });
  };

  return (
    <Card className="bg-card/40 border-white/5">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between px-4 py-3 text-sm font-medium text-white/80 hover:text-white transition-colors"
      >
        <span className="flex items-center gap-2">
          <Search className="h-4 w-4" /> Diagnóstico de frecuencia de errores (datos reales)
        </span>
        {open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
      </button>
      {open && (
        <CardContent className="pt-0 space-y-3">
          <p className="text-xs text-muted-foreground">
            Busca un texto (ej. "react-router-dom") y verás cuántas veces ha aparecido de verdad
            este error en generaciones/reparaciones reales de clientes — antes de decidir si vale
            la pena un cambio grande basado en eso.
          </p>
          <div className="flex gap-2">
            <Input
              placeholder="ej. react-router-dom"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSearch()}
              className="bg-card/40 border-white/10"
            />
            <Button onClick={handleSearch} disabled={diag.isPending || !query.trim()}>
              {diag.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Buscar"}
            </Button>
          </div>

          {diag.isError && (
            <p className="text-sm text-red-400">
              {(diag.error as any)?.message || "Error al consultar el diagnóstico."}
            </p>
          )}

          {diag.data && (
            <div className="space-y-3 pt-2 border-t border-white/5">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="rounded-lg bg-white/[0.03] border border-white/5 p-3">
                  <p className="text-2xl font-bold text-primary">{diag.data.totalOccurrences}</p>
                  <p className="text-xs text-muted-foreground">casos distintos registrados</p>
                </div>
                <div className="rounded-lg bg-white/[0.03] border border-white/5 p-3">
                  <p className="text-2xl font-bold text-amber-400">{diag.data.totalReuses}</p>
                  <p className="text-xs text-muted-foreground">veces que le ha pasado a un cliente</p>
                </div>
                <div className="rounded-lg bg-white/[0.03] border border-white/5 p-3 col-span-2 sm:col-span-1">
                  <p className="text-xs font-medium">{diag.data.oldestSeen ? new Date(diag.data.oldestSeen).toLocaleDateString("es-ES") : "—"}</p>
                  <p className="text-xs text-muted-foreground">primera vez visto</p>
                </div>
                <div className="rounded-lg bg-white/[0.03] border border-white/5 p-3 col-span-2 sm:col-span-1">
                  <p className="text-xs font-medium">{diag.data.newestSeen ? new Date(diag.data.newestSeen).toLocaleDateString("es-ES") : "—"}</p>
                  <p className="text-xs text-muted-foreground">última vez visto</p>
                </div>
              </div>

              {diag.data.samples?.length > 0 && (
                <div className="space-y-1.5 max-h-64 overflow-y-auto">
                  {diag.data.samples.map((s: any, i: number) => (
                    <div key={i} className="text-xs bg-white/[0.02] border border-white/5 rounded-md p-2">
                      <p className="text-white/70 line-clamp-2">{s.errorMessage}</p>
                      <p className="text-muted-foreground mt-1">
                        {s.framework || s.language} · reutilizado {s.successCount}x · {new Date(s.createdAt).toLocaleDateString("es-ES")}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </CardContent>
      )}
    </Card>
  );
}
