import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import {
  useGetAdminOverview,
  useListAdminUsers,
  useListAdminApps,
  useListAdminJobs,
  useAdjustUserCredits,
  useRetryAdminJob,
  getListAdminUsersQueryKey,
  getListAdminJobsQueryKey,
  getGetAdminOverviewQueryKey,
} from "@/lib/api-client";
import { useQueryClient } from "@tanstack/react-query";
import { Layout } from "@/components/layout";
import { AdminTicketsPanel } from "@/components/admin-tickets-panel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
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
import {
  Shield, Users, Code2, Sparkles, CreditCard, Plus, Minus, ShieldCheck,
  RefreshCw, Activity, AlertTriangle, CheckCircle2, Clock, BarChart3, MessageSquare,
} from "lucide-react";

type AdminTab = "users" | "apps" | "queue" | "memory" | "tickets";

interface MemoryEntry {
  id: number;
  errorMessage: string;
  errorContext: string;
  patchPreview: string;
  patchLength: number;
  language: string;
  framework: string;
  successCount: number;
  createdAt: string;
  updatedAt: string;
}

export default function AdminPage({ initialTab = "users" }: { initialTab?: AdminTab } = {}) {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: overview, isLoading: overviewLoading } = useGetAdminOverview();
  const { data: users, isLoading: usersLoading } = useListAdminUsers();
  const { data: apps, isLoading: appsLoading } = useListAdminApps();
  const {
    data: jobsData,
    isLoading: jobsLoading,
    refetch: refetchJobs,
    isFetching: jobsFetching,
  } = useListAdminJobs({
    query: {
      refetchInterval: 5_000,
      queryKey: getListAdminJobsQueryKey(),
    },
  });

  const retryMutation = useRetryAdminJob({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListAdminJobsQueryKey() });
        toast({ title: "Job re-encolado", description: "El trabajo se reintentará en breve." });
      },
      onError: (err: unknown) => {
        const e = err as { response?: { data?: { error?: string } }; message?: string };
        toast({ title: "No se pudo reintentar", description: e?.response?.data?.error ?? e?.message ?? "Error desconocido", variant: "destructive" });
      },
    },
  });

  const [adjustUser, setAdjustUser] = useState<{ id: string; email: string } | null>(null);
  const [delta, setDelta] = useState("10");
  const [reason, setReason] = useState("");

  const MEMORY_PAGE_SIZE = 25;
  const [memory, setMemory] = useState<
    { total: number; limit: number; offset: number; q: string; entries: MemoryEntry[] } | null
  >(null);
  const [memoryLoading, setMemoryLoading] = useState(false);
  const [memoryQuery, setMemoryQuery] = useState("");
  const [memoryOffset, setMemoryOffset] = useState(0);

  const loadMemory = async (overrides?: { q?: string; offset?: number }) => {
    const q = overrides?.q ?? memoryQuery;
    const offset = overrides?.offset ?? memoryOffset;
    setMemoryLoading(true);
    try {
      const params = new URLSearchParams({ limit: String(MEMORY_PAGE_SIZE), offset: String(offset) });
      if (q.trim()) params.set("q", q.trim());
      const r = await fetch(`/api/admin/memory?${params.toString()}`, { credentials: "include" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setMemory(await r.json());
    } catch (e) {
      toast({ title: "No se pudo cargar la memoria", description: e instanceof Error ? e.message : "Error desconocido", variant: "destructive" });
    } finally {
      setMemoryLoading(false);
    }
  };

  const deleteMemoryEntry = async (id: number) => {
    try {
      const r = await fetch(`/api/admin/memory/${id}`, { method: "DELETE", credentials: "include" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      toast({ title: "Entrada eliminada", description: `id ${id} borrada de la memoria.` });
      await loadMemory();
    } catch (e) {
      toast({ title: "No se pudo borrar", description: e instanceof Error ? e.message : "Error desconocido", variant: "destructive" });
    }
  };

  useEffect(() => {
    if (initialTab === "memory") void loadMemory();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialTab]);

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
      onError: (err: unknown) => {
        const e = err as { message?: string };
        toast({ title: "Error", description: e?.message ?? "Error desconocido", variant: "destructive" });
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

        <div className="flex justify-end">
          <Button variant="outline" size="sm" onClick={() => setLocation("/admin/dashboard")} className="gap-2">
            <BarChart3 className="h-4 w-4" /> Panel de métricas
          </Button>
        </div>

        <Tabs defaultValue={initialTab} className="w-full">
          <TabsList className="bg-card/40 border border-white/5">
            <TabsTrigger value="users"><Users className="h-4 w-4 mr-2" /> Usuarios</TabsTrigger>
            <TabsTrigger value="apps"><Code2 className="h-4 w-4 mr-2" /> Apps</TabsTrigger>
            <TabsTrigger value="memory" onClick={() => { if (!memory) void loadMemory(); }}>
              <Sparkles className="h-4 w-4 mr-2" /> Memoria
              {memory && memory.total > 0 && (
                <Badge variant="secondary" className="ml-2 bg-purple-500/15 text-purple-300 border-purple-500/30">{memory.total}</Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="queue">
              <Activity className="h-4 w-4 mr-2" /> Cola
              {(jobsData?.queued ?? 0) + (jobsData?.running ?? 0) > 0 && (
                <Badge className="ml-2 bg-primary/20 text-primary border-primary/30 text-[10px] font-mono">
                  {(jobsData?.queued ?? 0) + (jobsData?.running ?? 0)}
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="tickets">
              <MessageSquare className="h-4 w-4 mr-2" /> Tickets
            </TabsTrigger>
          </TabsList>

          <TabsContent value="users" className="mt-4">
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
                          <TableCell className="text-muted-foreground text-xs">{format(new Date(u.createdAt), "d MMM yyyy", { locale: es })}</TableCell>
                          <TableCell className="text-right">
                            <Button variant="ghost" size="sm" onClick={() => setAdjustUser({ id: u.id, email: u.email })}>Ajustar créditos</Button>
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
          </TabsContent>

          <TabsContent value="apps" className="mt-4">
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
                            <div className="flex gap-1 flex-wrap">{a.techStack?.slice(0,3).map(t => <Badge key={t} variant="outline" className="text-[10px] font-mono border-white/10">{t}</Badge>)}</div>
                          </TableCell>
                          <TableCell className="text-muted-foreground text-xs">{format(new Date(a.createdAt), "d MMM yyyy HH:mm", { locale: es })}</TableCell>
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
          </TabsContent>

          <TabsContent value="memory" className="mt-4 space-y-4">
            <Card className="bg-card/40 border-white/5">
              <CardHeader className="flex flex-row items-center justify-between space-y-0">
                <div>
                  <CardTitle className="text-white flex items-center gap-2">
                    <Sparkles className="h-5 w-5 text-purple-300" />
                    Memoria del agente
                  </CardTitle>
                  <p className="text-sm text-white/60 mt-1">Parches que la IA ha aplicado con éxito y reutiliza cuando vuelve a ver el mismo error o petición.</p>
                </div>
                <Button variant="outline" size="sm" onClick={() => loadMemory()} disabled={memoryLoading}>
                  <RefreshCw className={`h-4 w-4 mr-2 ${memoryLoading ? "animate-spin" : ""}`} />
                  Refrescar
                </Button>
              </CardHeader>
              <CardContent>
                <form className="flex gap-2 mb-4" onSubmit={(e) => { e.preventDefault(); setMemoryOffset(0); void loadMemory({ offset: 0 }); }}>
                  <Input placeholder="Buscar en mensaje de error o parche…" value={memoryQuery} onChange={(ev) => setMemoryQuery(ev.target.value)} className="bg-black/20 border-white/10 text-white" />
                  <Button type="submit" variant="secondary" disabled={memoryLoading}>Buscar</Button>
                  {memoryQuery && (
                    <Button type="button" variant="ghost" onClick={() => { setMemoryQuery(""); setMemoryOffset(0); void loadMemory({ q: "", offset: 0 }); }}>Limpiar</Button>
                  )}
                </form>
                {memoryLoading && !memory ? (
                  <Skeleton className="h-32 w-full" />
                ) : !memory || memory.entries.length === 0 ? (
                  <p className="text-sm text-white/50 py-8 text-center">
                    {memory && memory.q ? `Sin coincidencias para "${memory.q}".` : "Aún no hay nada en memoria. Se irá llenando a medida que la IA repare bundles y aplique parches."}
                  </p>
                ) : (
                  <div className="space-y-3">
                    {memory.entries.map((e) => (
                      <div key={e.id} className="rounded-lg border border-white/5 bg-black/20 p-3 space-y-2">
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 text-xs text-white/50 mb-1">
                              <span className="font-mono">#{e.id}</span>
                              <Badge variant="secondary" className="bg-white/5 text-white/70 border-white/10">{e.language}</Badge>
                              <Badge variant="secondary" className="bg-emerald-500/10 text-emerald-300 border-emerald-500/20">×{e.successCount}</Badge>
                              <span>{format(new Date(e.updatedAt), "d MMM HH:mm", { locale: es })}</span>
                            </div>
                            <p className="text-sm text-white/90 break-words">{e.errorMessage}</p>
                          </div>
                          <Button variant="ghost" size="sm" className="text-red-400 hover:text-red-300 hover:bg-red-500/10" onClick={() => deleteMemoryEntry(e.id)}>
                            <Minus className="h-4 w-4" />
                          </Button>
                        </div>
                        <details className="text-xs">
                          <summary className="cursor-pointer text-white/50 hover:text-white/70">Ver parche ({e.patchLength.toLocaleString("es")} caracteres)</summary>
                          <pre className="mt-2 p-2 rounded bg-black/40 overflow-x-auto text-white/70 max-h-64">{e.patchPreview}{e.patchLength > e.patchPreview.length ? "\n…" : ""}</pre>
                        </details>
                      </div>
                    ))}
                  </div>
                )}
                {memory && memory.total > MEMORY_PAGE_SIZE && (
                  <div className="mt-4 flex items-center justify-between text-sm text-white/60">
                    <span>Mostrando {memory.offset + 1}–{Math.min(memory.offset + memory.entries.length, memory.total)} de {memory.total.toLocaleString("es")}</span>
                    <div className="flex gap-2">
                      <Button variant="outline" size="sm" disabled={memoryLoading || memory.offset === 0} onClick={() => { const next = Math.max(0, memory.offset - MEMORY_PAGE_SIZE); setMemoryOffset(next); void loadMemory({ offset: next }); }}>← Anterior</Button>
                      <Button variant="outline" size="sm" disabled={memoryLoading || memory.offset + memory.entries.length >= memory.total} onClick={() => { const next = memory.offset + MEMORY_PAGE_SIZE; setMemoryOffset(next); void loadMemory({ offset: next }); }}>Siguiente →</Button>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="queue" className="mt-4 space-y-4">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <StatCard label="En cola" value={jobsData?.queued} loading={jobsLoading} icon={Clock} />
              <StatCard label="Ejecutándose" value={jobsData?.running} loading={jobsLoading} icon={Activity} />
              <StatCard label="Fallidos (24h)" value={jobsData?.failedLast24h} loading={jobsLoading} icon={AlertTriangle} subtle />
              <StatCard label="Completados (24h)" value={jobsData?.succeededLast24h} loading={jobsLoading} icon={CheckCircle2} subtle />
            </div>
            <Card className="bg-card/40 border-white/5">
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle className="text-lg flex items-center"><Activity className="h-5 w-5 mr-2 text-muted-foreground" />Trabajos recientes ({jobsData?.jobs?.length ?? 0})</CardTitle>
                <Button variant="ghost" size="sm" onClick={() => refetchJobs()} disabled={jobsFetching}>
                  <RefreshCw className={`h-4 w-4 mr-1 ${jobsFetching ? "animate-spin" : ""}`} />Actualizar
                </Button>
              </CardHeader>
              <CardContent className="p-0">
                {jobsLoading ? (
                  <div className="p-6 space-y-3">{[1,2,3].map(i => <Skeleton key={i} className="h-10 w-full" />)}</div>
                ) : jobsData?.jobs && jobsData.jobs.length > 0 ? (
                  <Table>
                    <TableHeader className="bg-black/20">
                      <TableRow className="border-white/5 hover:bg-transparent">
                        <TableHead>#</TableHead><TableHead>Estado</TableHead><TableHead>Fase</TableHead><TableHead>Usuario</TableHead><TableHead className="max-w-xs">Prompt</TableHead><TableHead className="text-right">Reintentos</TableHead><TableHead>Edad</TableHead><TableHead className="text-right">Acción</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {jobsData.jobs.map((j: any) => {
                        const ageMs = j.ageMs;
                        const ageStr = ageMs < 60_000 ? `${Math.round(ageMs / 1000)}s` : ageMs < 3_600_000 ? `${Math.round(ageMs / 60_000)}m` : `${Math.round(ageMs / 3_600_000)}h`;
                        const isStale = (j.status === "running" || j.status === "queued") && ageMs > 15 * 60 * 1000;
                        const retryable = j.status === "failed" || ((j.status === "running" || j.status === "queued") && isStale);
                        return (
                          <TableRow key={j.id} className="border-white/5 hover:bg-white/[0.02]">
                            <TableCell className="font-mono text-xs text-muted-foreground">{j.id}</TableCell>
                            <TableCell><JobStatusBadge status={j.status} stale={isStale} /></TableCell>
                            <TableCell className="font-mono text-xs text-muted-foreground">{j.phase}</TableCell>
                            <TableCell className="font-mono text-xs text-muted-foreground max-w-[160px] truncate">{j.userEmail || j.userId.slice(0, 12)}</TableCell>
                            <TableCell className="max-w-xs truncate text-sm">{j.prompt}</TableCell>
                            <TableCell className="text-right font-mono text-xs">{j.retryCount}</TableCell>
                            <TableCell className="text-muted-foreground text-xs font-mono">{ageStr}</TableCell>
                            <TableCell className="text-right">
                              <Button variant="ghost" size="sm" disabled={!retryable || retryMutation.isPending} onClick={() => retryMutation.mutate({ id: j.id })}>
                                <RefreshCw className="h-3.5 w-3.5 mr-1" /> Reintentar
                              </Button>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                ) : (
                  <p className="p-6 text-sm text-muted-foreground">Sin trabajos recientes.</p>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="tickets" className="mt-4">
            <AdminTicketsPanel />
          </TabsContent>
        </Tabs>

        <Dialog open={!!adjustUser} onOpenChange={(open) => !open && setAdjustUser(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Ajustar créditos</DialogTitle>
              <DialogDescription>Modifica el saldo de <span className="font-mono text-primary">{adjustUser?.email}</span>.</DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <div className="space-y-2">
                <Label htmlFor="delta">Cantidad</Label>
                <Input id="delta" type="number" value={delta} onChange={(e) => setDelta(e.target.value)} placeholder="10" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="reason">Motivo (opcional)</Label>
                <Input id="reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="ej. Compensación por error" />
              </div>
            </div>
            <DialogFooter className="flex sm:justify-between gap-2">
              <Button variant="outline" className="border-destructive/30 text-destructive hover:bg-destructive/10" onClick={() => submitAdjust(-1)} disabled={adjustMutation.isPending}>
                <Minus className="h-4 w-4 mr-1" /> Restar
              </Button>
              <Button className="bg-primary hover:bg-primary/90 text-white" onClick={() => submitAdjust(1)} disabled={adjustMutation.isPending}>
                <Plus className="h-4 w-4 mr-1" /> Sumar
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </Layout>
  );
}

function JobStatusBadge({ status, stale }: { status: string; stale: boolean }) {
  let cls = "bg-muted/30 text-muted-foreground border-white/10";
  let label = status;
  switch (status) {
    case "queued": cls = "bg-blue-500/10 text-blue-400 border-blue-500/30"; label = "en cola"; break;
    case "running": cls = "bg-amber-500/10 text-amber-400 border-amber-500/30"; label = "ejecutando"; break;
    case "succeeded": cls = "bg-emerald-500/10 text-emerald-400 border-emerald-500/30"; label = "completado"; break;
    case "failed": cls = "bg-destructive/10 text-destructive border-destructive/30"; label = "fallido"; break;
  }
  return (
    <div className="flex items-center gap-1">
      <Badge className={`${cls} text-[10px] font-mono uppercase border`}>{label}</Badge>
      {stale && <Badge className="bg-destructive/10 text-destructive border border-destructive/30 text-[10px] font-mono uppercase">estancado</Badge>}
    </div>
  );
}

function StatCard({ label, value, loading, icon: Icon, subtle }: { label: string; value: number | string | undefined; loading?: boolean; icon: any; subtle?: boolean }) {
  return (
    <Card className={subtle ? "bg-card/30 border-white/5" : "bg-card/50 border-white/5"}>
      <CardHeader className="pb-2 flex flex-row items-center justify-between">
        <CardTitle className="text-sm font-medium text-muted-foreground">{label}</CardTitle>
        <Icon className={`h-4 w-4 ${subtle ? "text-muted-foreground" : "text-primary"}`} />
      </CardHeader>
      <CardContent>
        {loading ? <Skeleton className="h-8 w-16" /> : <div className={`text-3xl font-bold font-mono ${subtle ? "text-muted-foreground" : "text-foreground"}`}>{value ?? 0}</div>}
      </CardContent>
    </Card>
  );
}
