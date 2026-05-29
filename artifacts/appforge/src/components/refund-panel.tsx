import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { useAdminRefund } from "@/lib/api-client"; // Asumimos que este hook se creará
import { DollarSign, Loader2 } from "lucide-react";

export function RefundPanel() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [userId, setUserId] = useState("");
  const [amount, setAmount] = useState<number | string>("");
  const [reason, setReason] = useState("");

  const refundMutation = useAdminRefund({
    mutation: {
      onSuccess: (data) => {
        toast({ title: "Reembolso exitoso", description: data.message });
        queryClient.invalidateQueries({ queryKey: ["getMyStats"] }); // Invalidar estadísticas para reflejar cambios
        setUserId("");
        setAmount("");
        setReason("");
      },
      onError: (error: any) => {
        toast({ title: "Error en reembolso", description: error?.message || "No se pudo procesar el reembolso.", variant: "destructive" });
      },
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!userId || !amount || !reason) {
      toast({ title: "Campos incompletos", description: "Por favor, rellena todos los campos para el reembolso.", variant: "destructive" });
      return;
    }
    refundMutation.mutate({ data: { userId, amount: Number(amount), reason } });
  };

  return (
    <Card className="bg-card/50 border-white/5 shadow-sm">
      <CardHeader>
        <CardTitle className="text-xl flex items-center"><DollarSign className="h-5 w-5 text-green-400 mr-2" />Gestión de Reembolsos</CardTitle>
        <CardDescription>Procesa reembolsos para usuarios y ajusta sus créditos. Solo para administradores.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <Label htmlFor="refund-userId">ID de Usuario</Label>
            <Input
              id="refund-userId"
              value={userId}
              onChange={(e) => setUserId(e.target.value)}
              placeholder="ID del usuario a reembolsar"
              disabled={refundMutation.isPending}
            />
          </div>
          <div>
            <Label htmlFor="refund-amount">Cantidad de Créditos</Label>
            <Input
              id="refund-amount"
              type="number"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="Cantidad de créditos a reembolsar"
              disabled={refundMutation.isPending}
              min={1}
            />
          </div>
          <div>
            <Label htmlFor="refund-reason">Razón del Reembolso</Label>
            <Textarea
              id="refund-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Describe brevemente la razón del reembolso"
              disabled={refundMutation.isPending}
            />
          </div>
          <Button type="submit" disabled={refundMutation.isPending} className="w-full">
            {refundMutation.isPending ? (
              <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Procesando…</>
            ) : (
              <>Realizar Reembolso</>
            )}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
