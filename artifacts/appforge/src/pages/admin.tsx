import { useState } from "react";
import { useLocation } from "wouter";
import {
  useGetAdminOverview,
  useListAdminUsers,
  useListAdminApps,
  useAdjustUserCredits,
  getListAdminUsersQueryKey,
  getGetAdminOverviewQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Layout } from "@/components/layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { Shield, Users, Code2, Sparkles, CreditCard, Plus, Minus, ShieldCheck } from "lucide-react";

export default function AdminPage() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: overview, isLoading: overviewLoading } = useGetAdminOverview();
  const { data: users, isLoading: usersLoading } = useListAdminUsers();
  const { data: apps, isLoading: appsLoading } = useListAdminApps();

  const [adjustUser, setAdjustUser] = useState<{ id: string; email: string } | null>(null);
  const [delta, setDelta] = useState("10");
  const [reason, setReason] = useState("");

  const adjustMutation = useAdjustUserCredits({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListAdminUsersQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetAdminOverviewQueryKey() });
        toast({ title: "Créditos actualizados", description: `Se ajustaron los créditos correctamente.` });
        setAdjustUser(null);
        setReason("");
        setDelta("10");
      },
      onError: (err: any) => {
        toast({ title: "Error", description: err.message, variant: "destructive" });
      },
    },
  });

  const submitAdjust = (sign: 1 | -1) => {
    if (!adjustUser) return;
    const n = Math.abs(parseInt(delta, 10) || 0) * sign;
    if (!n) {
      toast({ title: "Cantidad inválida", description: "Ingresa un número distinto de cero.", variant: "destructive" });
      return;
    }
    adjustMutation.mutate({ id: adjustUser.id, data: { delta: n, reason: reason || undefined } });
  };

  return (
    <Layout>
      <div className="container max-w-7xl mx-auto px-4 py-10 space-y-10">
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div className="flex items-center gap-3">
            <div className="h-12 w-12 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center">
              <Shield className="h-6 w-6 text-primary" />
            </div>
            <div>
              <h1 className="text-3xl font-bold tracking-tight text-white">Panel de administrador</h1>
              <p className="text-muted-foreground">Control total de usuarios, créditos y aplicaciones generadas.</p>
            </div>
          </div>
          <Badge variant="outline" className="border-primary/30 text-primary bg-primary/10 font-mono text-xs uppercase">
            <ShieldCheck className="h-3 w-3 mr-1" /> Modo propietario
          </Badge>
        </div>

        {/* Estadísticas globales */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatCard label="Usuarios totales" value={overview?.totalUsers} loading={overviewLoading} icon={Users} />
          <StatCard label="Apps generadas" value={overview?.totalApps} loading={overviewLoading} icon={Code2} />
          <StatCard label="Apps últimos 7 días" value={overview?.appsLast7Days} loading={overviewLoading} icon={Sparkles} />
          <StatCard label="Créditos en circulación" value={overview?.creditsOutstanding} loading={overviewLoading} icon={CreditCard} />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <StatCard label="Créditos consumidos" value={overview?.creditsSpentTotal} loading={overviewLoading} icon={Sparkles} subtle />
          <StatCard label="Créditos comprados" value={overview?.creditsPurchasedTotal} loading={overviewLoading} icon={CreditCard} subtle />
          <StatCard label="Ingresos totales" value={overview ? `$${(overview.revenueCentsTotal / 100).toFixed(2)}` : undefined} loading={overviewLoading} icon={CreditCard} subtle />
        </div>

        {/* Usuarios */}
        <Card className="bg-card/40 border-white/5">
          <CardHeader>
            <CardTitle className="text-lg flex items-center"><Users className="h-5 w-5 mr-2 text-muted-foreground" /> Usuarios ({users?.length ?? 0})</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {usersLoading ? (
              <div className="p-6 space-y-3">{[1,2,3].map(i => <Skeleton key={i} className="h-10 w-full" />)}</div>
            ) : users && users.length > 0 ? (
              <Table>
                <TableHeader className="bg-black/20">
                  <TableRow className="border-white/5 hover:bg-transparent">
                    <TableHead>Usuario</TableHead>
                    <TableHead>Correo</TableHead>
                    <TableHead className="text-right">Créditos</TableHead>
                    <TableHead className="text-right">Apps</TableHead>
                    <TableHead>Registrado</TableHead>
                    <TableHead className="text-right">Acciones</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {users.map(u => (
                    <TableRow key={u.id} className="border-white/5 hover:bg-white/[0.02]">
                      <TableCell className="font-medium">
                        <div className="flex items-center gap-2">
                          {u.fullName || "—"}
                          {u.isAdmin && <Badge className="bg-primary/20 text-primary text-[10px] font-mono uppercase border border-primary/30">Admin</Badge>}
                        </div>
                      </TableCell>
                      <TableCell className="text-muted-foreground text-sm font-mono">{u.email}</TableCell>
                      <TableCell className="text-right font-mono text-primary">{u.credits}</TableCell>
                      <TableCell className="text-right font-mono">{u.appsGenerated}</TableCell>
                      <TableCell className="text-muted-foreground text-xs">
                        {format(new Date(u.createdAt), "d MMM yyyy", { locale: es })}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setAdjustUser({ id: u.id, email: u.email })}
                        >
                          Ajustar créditos
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <p className="p-6 text-sm text-muted-foreground">Aún no hay usuarios registrados.</p>
            )}
          </CardContent>
        </Card>

        {/* Apps generadas */}
        <Card className="bg-card/40 border-white/5">
          <CardHeader>
            <CardTitle className="text-lg flex items-center"><Code2 className="h-5 w-5 mr-2 text-muted-foreground" /> Aplicaciones generadas ({apps?.length ?? 0})</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {appsLoading ? (
              <div className="p-6 space-y-3">{[1,2,3].map(i => <Skeleton key={i} className="h-10 w-full" />)}</div>
            ) : apps && apps.length > 0 ? (
              <Table>
                <TableHeader className="bg-black/20">
                  <TableRow className="border-white/5 hover:bg-transparent">
                    <TableHead>Título</TableHead>
                    <TableHead>Propietario</TableHead>
                    <TableHead>Stack</TableHead>
                    <TableHead>Creado</TableHead>
                    <TableHead className="text-right">Acción</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {apps.map(a => (
                    <TableRow key={a.id} className="border-white/5 hover:bg-white/[0.02]">
                      <TableCell className="font-medium max-w-xs truncate">{a.title}</TableCell>
                      <TableCell className="text-muted-foreground text-sm font-mono">{a.userEmail || a.userId.slice(0, 12)}</TableCell>
                      <TableCell>
                        <div className="flex gap-1 flex-wrap">
                          {a.techStack?.slice(0,3).map(t => <Badge key={t} variant="outline" className="text-[10px] font-mono border-white/10">{t}</Badge>)}
                        </div>
                      </TableCell>
                      <TableCell className="text-muted-foreground text-xs">
                        {format(new Date(a.createdAt), "d MMM yyyy HH:mm", { locale: es })}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button variant="ghost" size="sm" onClick={() => setLocation(`/app/${a.id}`)}>Ver código</Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <p className="p-6 text-sm text-muted-foreground">Aún no hay aplicaciones generadas.</p>
            )}
          </CardContent>
        </Card>

        {/* Diálogo ajustar créditos */}
        <Dialog open={!!adjustUser} onOpenChange={(open) => !open && setAdjustUser(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Ajustar créditos</DialogTitle>
              <DialogDescription>
                Modifica el saldo de <span className="font-mono text-primary">{adjustUser?.email}</span>.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <div className="space-y-2">
                <Label htmlFor="delta">Cantidad</Label>
                <Input
                  id="delta"
                  type="number"
                  value={delta}
                  onChange={(e) => setDelta(e.target.value)}
                  placeholder="10"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="reason">Motivo (opcional)</Label>
                <Input
                  id="reason"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="ej. Compensación por error"
                />
              </div>
            </div>
            <DialogFooter className="flex sm:justify-between gap-2">
              <Button
                variant="outline"
                className="border-destructive/30 text-destructive hover:bg-destructive/10"
                onClick={() => submitAdjust(-1)}
                disabled={adjustMutation.isPending}
              >
                <Minus className="h-4 w-4 mr-1" /> Restar
              </Button>
              <Button
                className="bg-primary hover:bg-primary/90 text-white"
                onClick={() => submitAdjust(1)}
                disabled={adjustMutation.isPending}
              >
                <Plus className="h-4 w-4 mr-1" /> Sumar
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </Layout>
  );
}

function StatCard({
  label,
  value,
  loading,
  icon: Icon,
  subtle,
}: {
  label: string;
  value: number | string | undefined;
  loading?: boolean;
  icon: any;
  subtle?: boolean;
}) {
  return (
    <Card className={subtle ? "bg-card/30 border-white/5" : "bg-card/50 border-white/5"}>
      <CardHeader className="pb-2 flex flex-row items-center justify-between">
        <CardTitle className="text-sm font-medium text-muted-foreground">{label}</CardTitle>
        <Icon className={`h-4 w-4 ${subtle ? "text-muted-foreground" : "text-primary"}`} />
      </CardHeader>
      <CardContent>
        {loading ? <Skeleton className="h-8 w-16" /> : (
          <div className={`text-3xl font-bold font-mono ${subtle ? "text-muted-foreground" : "text-foreground"}`}>
            {value ?? 0}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
