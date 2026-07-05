import { useState } from "react";
import { useListAdminPayments, useRefundPayment } from "@/lib/api-client";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Search, Loader2, RotateCcw, ExternalLink } from "lucide-react";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";

function formatEur(cents: number | null) {
  if (cents === null || cents === undefined) return "—";
  return `${(cents / 100).toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
}

export function AdminPaymentsPanel() {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [confirmRefund, setConfirmRefund] = useState<{ id: string; email: string | null; amount: string } | null>(null);
  const [refundReason, setRefundReason] = useState("");
  const { toast } = useToast();

  const { data, isLoading, refetch } = useListAdminPayments({ page, limit: 50, search: search || undefined });
  const refundMutation = useRefundPayment();

  const payments: any[] = data?.payments ?? [];

  const handleRefund = async () => {
    if (!confirmRefund) return;
    try {
      const res = await refundMutation.mutateAsync({ transactionId: confirmRefund.id, reason: refundReason || undefined });
      toast({ title: "Reembolso ejecutado", description: `${res.refundedCredits} créditos y ${formatEur(res.refundedCents)} devueltos.` });
      setConfirmRefund(null);
      setRefundReason("");
      refetch();
    } catch (err: any) {
      toast({ title: "No se pudo reembolsar", description: err?.message || "Error desconocido", variant: "destructive" });
    }
  };

  return (
    <div className="space-y-4">
      {/* Aviso: solo transacciones con vivaTransactionId real se pueden
          reembolsar automáticamente desde aquí -- ver el porqué en el
          endpoint POST /admin/payments/refund */}
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
                  <td className="p-3 text-right">
                    {p.status === "succeeded" && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-xs border-red-500/30 text-red-300 hover:bg-red-500/10"
                        onClick={() => setConfirmRefund({ id: p.id, email: p.userEmail, amount: formatEur(p.priceCents) })}
                        title={!p.vivaTransactionId ? "Sin vivaTransactionId real — el reembolso automático fallará, revisa manualmente en Viva.com" : undefined}
                      >
                        <RotateCcw className="h-3 w-3 mr-1" /> Reembolsar
                      </Button>
                    )}
                  </td>
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

      <AlertDialog open={!!confirmRefund} onOpenChange={(o) => { if (!o) setConfirmRefund(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Procesar reembolso?</AlertDialogTitle>
            <AlertDialogDescription>
              Vas a reembolsar <strong>{confirmRefund?.amount}</strong> a <strong>{confirmRefund?.email}</strong> vía Viva.com,
              y se le restarán los créditos correspondientes de su cuenta. Esta acción mueve dinero real y no se puede deshacer.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Input
            placeholder="Motivo del reembolso (opcional, queda registrado)"
            value={refundReason}
            onChange={(e) => setRefundReason(e.target.value)}
            className="bg-card/40 border-white/10"
          />
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleRefund}
              disabled={refundMutation.isPending}
              className="bg-red-600 hover:bg-red-500"
            >
              {refundMutation.isPending && <Loader2 className="h-3 w-3 mr-2 animate-spin" />}
              Confirmar reembolso
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
