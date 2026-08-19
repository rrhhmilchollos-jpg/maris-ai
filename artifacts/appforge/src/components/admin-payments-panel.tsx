import { useState } from "react";
import { useListAdminPayments } from "@/lib/api-client";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Search, Loader2, ExternalLink } from "lucide-react";

function formatEur(cents: number | null) {
  if (cents === null || cents === undefined) return "—";
  return `${(cents / 100).toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
}

export function AdminPaymentsPanel() {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const { data, isLoading } = useListAdminPayments({ page, limit: 50, search: search || undefined });
  const payments: any[] = data?.payments ?? [];

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
        Los reembolsos y compensaciones no se ejecutan desde este panel. El cliente debe solicitarlos mediante un ticket de soporte y un administrador los aprobará manualmente desde el expediente.
      </div>
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Buscar por email o nombre del cliente..."
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          className="pl-9 bg-card/40 border-white/10"
        />
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
      ) : payments.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-12">No se encontraron pagos.</p>
      ) : (
        <div className="rounded-lg border border-white/10 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-card/60 text-xs text-muted-foreground uppercase">
              <tr>
                <th className="text-left p-3">Fecha</th>
                <th className="text-left p-3">Cliente</th>
                <th className="text-left p-3">Créditos</th>
                <th className="text-left p-3">Importe</th>
                <th className="text-left p-3">Tarjeta</th>
                <th className="text-left p-3">Pasarela</th>
                <th className="text-left p-3">Estado</th>
                <th className="text-right p-3">Acción</th>
              </tr>
            </thead>
            <tbody>
              {payments.map((p) => (
                <tr key={p.id} className="border-t border-white/5 hover:bg-white/[0.02]">
                  <td className="p-3 text-muted-foreground whitespace-nowrap">
                    {new Date(p.createdAt).toLocaleString("es-ES", { dateStyle: "short", timeStyle: "short" })}
                  </td>
                  <td className="p-3">
                    <div className="font-medium">{p.userName || "—"}</div>
                    <div className="text-xs text-muted-foreground">{p.userEmail || p.userId}</div>
                  </td>
                  <td className="p-3">{p.credits.toLocaleString("es-ES")} cr</td>
                  <td className="p-3 font-medium">{formatEur(p.priceCents)}</td>
                  <td className="p-3 text-muted-foreground">
                    {p.cardLast4 ? `•••• ${p.cardLast4}` : "—"}
                  </td>
                  <td className="p-3">
                    <Badge variant="outline" className="text-[10px] uppercase">{p.gateway}</Badge>
                  </td>
                  <td className="p-3">
                    {p.status === "refunded" ? (
                      <Badge className="bg-orange-500/15 text-orange-300 border-orange-500/30">Reembolsado</Badge>
                    ) : p.status === "failed" ? (
                      <Badge className="bg-red-500/15 text-red-300 border-red-500/30">Fallido</Badge>
                    ) : (
                      <Badge className="bg-emerald-500/15 text-emerald-300 border-emerald-500/30">Correcto</Badge>
                    )}
                  </td>
                  <td className="p-3 text-right text-xs text-muted-foreground">Solo mediante ticket</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {data && data.totalPages > 1 && (
        <div className="flex items-center justify-center gap-2">
          <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Anterior</Button>
          <span className="text-xs text-muted-foreground">Página {page} de {data.totalPages}</span>
          <Button size="sm" variant="outline" disabled={page >= data.totalPages} onClick={() => setPage((p) => p + 1)}>Siguiente</Button>
        </div>
      )}

    </div>
  );
}
