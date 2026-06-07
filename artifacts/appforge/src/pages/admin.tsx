import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import {
  apiFetch,
  useGetAdminOverview,
  useListAdminUsers,
  useListAdminApps,
  useListAdminJobs,
  useAdjustUserCredits,
  useRetryAdminJob,
  useDeleteApp,
  useAdminSuspendUser,
  useAdminBanUser,
  useAdminBlockIp,
  useAdminRefundCredits,
  getListAdminUsersQueryKey,
  getListAdminJobsQueryKey,
  getGetAdminOverviewQueryKey,
  getListAdminAppsQueryKey,
} from "@/lib/api-client";
import { useQueryClient } from "@tanstack/react-query";
import { Layout } from "@/components/layout";
import { AdminTicketsPanel } from "@/components/admin-tickets-panel";
import { AdminNewsEditor } from "@/components/admin-news-editor";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
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
import { Separator } from "@/components/ui/separator";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import {
  Shield, Users, Code2, Sparkles, CreditCard, Plus, Minus, ShieldCheck,
  RefreshCw, Activity, AlertTriangle, CheckCircle2, Clock, BarChart3,
  MessageSquare, X, Ban, WifiOff, UserX, RotateCcw, Eye, Search,
  ChevronDown, ChevronUp, History, DollarSign, Lock, Unlock, Loader2,
} from "lucide-react";

type AdminTab = "users" | "apps" | "queue" | "memory" | "tickets" | "news";

interface MemoryEntry {
  id: string;
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

interface AdminUser {
  id: string;
  email: string;
  fullName?: string;
  credits: number;
  appsGenerated: number;
  createdAt: string;
  isAdmin?: boolean;
  isSuspended?: boolean;
  isBanned?: boolean;
  blockedIp?: string | null;
  suspendedReason?: string | null;
  bannedReason?: string | null;
  lastLoginAt?: string | null;
  totalSpent?: number;
}

type UserDetailTab = "overview" | "apps" | "transactions" | "moderation";

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

  // ── Mutations ──────────────────────────────────────────────────────────────
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

  const adjustMutation = useAdjustUserCredits({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListAdminUsersQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetAdminOverviewQueryKey() });
        toast({ title: "Créditos actualizados" });
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

  const suspendMutation = useAdminSuspendUser({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListAdminUsersQueryKey() });
        toast({ title: "Usuario actualizado", description: "El estado de suspensión ha cambiado." });
        setSelectedUser(null);
      },
      onError: (err: unknown) => {
        const e = err as { message?: string };
        toast({ title: "Error", description: e?.message ?? "Error desconocido", variant: "destructive" });
      },
    },
  });

  const banMutation = useAdminBanUser({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListAdminUsersQueryKey() });
        toast({ title: "Usuario actualizado", description: "El estado de ban ha cambiado." });
        setSelectedUser(null);
      },
      onError: (err: unknown) => {
        const e = err as { message?: string };
        toast({ title: "Error", description: e?.message ?? "Error desconocido", variant: "destructive" });
      },
    },
  });

  const blockIpMutation = useAdminBlockIp({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListAdminUsersQueryKey() });
        toast({ title: "IP actualizada", description: "El bloqueo de IP ha sido aplicado." });
        setSelectedUser(null);
      },
      onError: (err: unknown) => {
        const e = err as { message?: string };
        toast({ title: "Error", description: e?.message ?? "Error desconocido", variant: "destructive" });
      },
    },
  });

  const refundMutation = useAdminRefundCredits({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListAdminUsersQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetAdminOverviewQueryKey() });
        toast({ title: "Reembolso procesado", description: "Los créditos han sido reembolsados." });
        setRefundDialog(null);
      },
      onError: (err: unknown) => {
        const e = err as { message?: string };
        toast({ title: "Error en reembolso", description: e?.message ?? "Error desconocido", variant: "destructive" });
      },
    },
  });

  const adminDeleteMutation = useDeleteApp({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListAdminAppsQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetAdminOverviewQueryKey() });
        toast({ title: "App eliminada" });
      },
      onError: (err: unknown) => {
        const e = err as { message?: string };
        toast({ title: "Error al eliminar", description: e?.message ?? "No se pudo eliminar la aplicación.", variant: "destructive" });
      },
    },
  });

  // ── State ──────────────────────────────────────────────────────────────────
  const [adjustUser, setAdjustUser] = useState<{ id: string; email: string } | null>(null);
  const [delta, setDelta] = useState("10");
  const [reason, setReason] = useState("");
  const [userSearch, setUserSearch] = useState("");
  const [selectedUser, setSelectedUser] = useState<AdminUser | null>(null);
  const [userDetailTab, setUserDetailTab] = useState<UserDetailTab>("overview");
  const [moderationReason, setModerationReason] = useState("");
  const [ipToBlock, setIpToBlock] = useState("");
  const [refundDialog, setRefundDialog] = useState<{ user: AdminUser; amount: number; reason: string } | null>(null);
  const [expandedJobId, setExpandedJobId] = useState<string | null>(null);
  const [emailDialog, setEmailDialog] = useState<{ user: AdminUser; subject: string; message: string; creditsAdded: number } | null>(null);
  const [emailSending, setEmailSending] = useState(false);

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
      setMemory(await apiFetch(`/api/admin/memory?${params.toString()}`));
    } catch (e) {
      toast({ title: "No se pudo cargar la memoria", description: e instanceof Error ? e.message : "Error desconocido", variant: "destructive" });
    } finally {
      setMemoryLoading(false);
    }
  };

  const deleteMemoryEntry = async (id: string) => {
    try {
      await apiFetch(`/api/admin/memory/${id}`, { method: "DELETE" });
      toast({ title: "Entrada eliminada" });
      await loadMemory();
    } catch (e) {
      toast({ title: "No se pudo borrar", description: e instanceof Error ? e.message : "Error desconocido", variant: "destructive" });
    }
  };

  useEffect(() => {
    if (initialTab === "memory") void loadMemory();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialTab]);

  const submitAdjust = (sign: 1 | -1) => {
    if (!adjustUser) return;
    const n = Math.abs(parseInt(delta, 10) || 0) * sign;
    if (!n) {
      toast({ title: "Cantidad inválida", variant: "destructive" });
      return;
    }
    adjustMutation.mutate({ id: adjustUser.id, data: { delta: n, reason: reason || undefined } });
  };

  // Filtered users
  const filteredUsers = (users as AdminUser[] | undefined)?.filter(u =>
    !userSearch ||
    u.email.toLowerCase().includes(userSearch.toLowerCase()) ||
    (u.fullName?.toLowerCase().includes(userSearch.toLowerCase()))
  ) ?? [];

  const userApps = (apps as any[] | undefined)?.filter(a => selectedUser && a.userId === selectedUser.id) ?? [];

  return (
    <Layout>
      <div className="container max-w-7xl mx-auto px-4 py-10 space-y-10">
        {/* Header */}
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

        {/* KPI Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatCard label="Usuarios totales" value={overview?.totalUsers} loading={overviewLoading} icon={Users} />
          <StatCard label="Apps generadas" value={overview?.totalApps} loading={overviewLoading} icon={Code2} />
          <StatCard label="Apps últimos 7 días" value={overview?.appsLast7Days} loading={overviewLoading} icon={Sparkles} />
          <StatCard label="Créditos en circulación" value={overview?.creditsOutstanding} loading={overviewLoading} icon={CreditCard} />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <StatCard label="Créditos consumidos" value={overview?.creditsSpentTotal} loading={overviewLoading} icon={Sparkles} subtle />
          <StatCard label="Créditos comprados" value={overview?.creditsPurchasedTotal} loading={overviewLoading} icon={CreditCard} subtle />
          <StatCard label="Ingresos totales" value={overview ? `$${(overview.revenueCentsTotal / 100).toFixed(2)}` : undefined} loading={overviewLoading} icon={DollarSign} subtle />
        </div>

        <div className="flex justify-end">
          <Button variant="outline" size="sm" onClick={() => setLocation("/admin/dashboard")} className="gap-2">
            <BarChart3 className="h-4 w-4" /> Panel de métricas avanzado
          </Button>
        </div>

        {/* Tabs */}
        <Tabs defaultValue={initialTab} className="w-full">
          <TabsList className="bg-card/40 border border-white/5 flex-wrap h-auto gap-1 p-1">
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
            <TabsTrigger value="tickets"><MessageSquare className="h-4 w-4 mr-2" /> Tickets</TabsTrigger>
            <TabsTrigger value="news"><Sparkles className="h-4 w-4 mr-2" /> Noticias</TabsTrigger>
          </TabsList>

          {/* ── USERS TAB ── */}
          <TabsContent value="users" className="mt-4 space-y-4">
            {/* Search bar */}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Buscar por email o nombre..."
                value={userSearch}
                onChange={e => setUserSearch(e.target.value)}
                className="pl-9 bg-card/40 border-white/10"
              />
            </div>

            {/* User status summary */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div className="rounded-lg border border-white/5 bg-card/30 p-3 text-center">
                <div className="text-2xl font-bold font-mono text-white">{filteredUsers.length}</div>
                <div className="text-xs text-muted-foreground mt-1">Usuarios encontrados</div>
              </div>
              <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-3 text-center">
                <div className="text-2xl font-bold font-mono text-amber-400">{filteredUsers.filter(u => u.isSuspended).length}</div>
                <div className="text-xs text-amber-400/70 mt-1">Suspendidos</div>
              </div>
              <div className="rounded-lg border border-red-500/20 bg-red-500/5 p-3 text-center">
                <div className="text-2xl font-bold font-mono text-red-400">{filteredUsers.filter(u => u.isBanned).length}</div>
                <div className="text-xs text-red-400/70 mt-1">Baneados</div>
              </div>
              <div className="rounded-lg border border-orange-500/20 bg-orange-500/5 p-3 text-center">
                <div className="text-2xl font-bold font-mono text-orange-400">{filteredUsers.filter(u => u.blockedIp).length}</div>
                <div className="text-xs text-orange-400/70 mt-1">IP bloqueada</div>
              </div>
            </div>

            <Card className="bg-card/40 border-white/5">
              <CardHeader>
                <CardTitle className="text-lg flex items-center">
                  <Users className="h-5 w-5 mr-2 text-muted-foreground" />
                  Usuarios ({filteredUsers.length})
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                {usersLoading ? (
                  <div className="p-6 space-y-3">{[1,2,3].map(i => <Skeleton key={i} className="h-10 w-full" />)}</div>
                ) : filteredUsers.length > 0 ? (
                  <Table>
                    <TableHeader className="bg-black/20">
                      <TableRow className="border-white/5 hover:bg-transparent">
                        <TableHead>Usuario</TableHead>
                        <TableHead>Email</TableHead>
                        <TableHead className="text-right">Créditos</TableHead>
                        <TableHead className="text-right">Apps</TableHead>
                        <TableHead>Estado</TableHead>
                        <TableHead>Registrado</TableHead>
                        <TableHead className="text-right">Acciones</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredUsers.map(u => (
                        <TableRow key={u.id} className={`border-white/5 hover:bg-white/[0.02] ${u.isBanned ? "opacity-50" : ""}`}>
                          <TableCell className="font-medium">
                            <div className="flex items-center gap-2">
                              {u.fullName || "—"}
                              {u.isAdmin && <Badge className="bg-primary/20 text-primary text-[10px] font-mono uppercase border border-primary/30">Admin</Badge>}
                            </div>
                          </TableCell>
                          <TableCell className="text-muted-foreground text-sm font-mono">{u.email}</TableCell>
                          <TableCell className="text-right font-mono text-primary">{u.credits}</TableCell>
                          <TableCell className="text-right font-mono">{u.appsGenerated}</TableCell>
                          <TableCell>
                            <div className="flex flex-wrap gap-1">
                              {u.isBanned && <Badge className="bg-red-500/10 text-red-400 border-red-500/30 text-[10px]">Baneado</Badge>}
                              {u.isSuspended && !u.isBanned && <Badge className="bg-amber-500/10 text-amber-400 border-amber-500/30 text-[10px]">Suspendido</Badge>}
                              {u.blockedIp && <Badge className="bg-orange-500/10 text-orange-400 border-orange-500/30 text-[10px]">IP bloqueada</Badge>}
                              {!u.isBanned && !u.isSuspended && !u.blockedIp && (
                                <Badge className="bg-emerald-500/10 text-emerald-400 border-emerald-500/30 text-[10px]">Activo</Badge>
                              )}
                            </div>
                          </TableCell>
                          <TableCell className="text-muted-foreground text-xs">{format(new Date(u.createdAt), "d MMM yyyy", { locale: es })}</TableCell>
                          <TableCell className="text-right">
                            <div className="flex items-center justify-end gap-1">
                              <Button
                                variant="ghost"
                                size="sm"
                                className="gap-1 text-xs"
                                onClick={() => {
                                  setSelectedUser(u);
                                  setUserDetailTab("overview");
                                  setModerationReason("");
                                  setIpToBlock(u.blockedIp || "");
                                }}
                              >
                                <Eye className="h-3.5 w-3.5" /> Ver
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="gap-1 text-xs"
                                onClick={() => setAdjustUser({ id: u.id, email: u.email })}
                              >
                                <CreditCard className="h-3.5 w-3.5" /> Créditos
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                ) : (
                  <p className="p-6 text-sm text-muted-foreground">No se encontraron usuarios.</p>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* ── APPS TAB ── */}
          <TabsContent value="apps" className="mt-4">
            <Card className="bg-card/40 border-white/5">
              <CardHeader>
                <CardTitle className="text-lg flex items-center"><Code2 className="h-5 w-5 mr-2 text-muted-foreground" /> Aplicaciones generadas ({apps?.length ?? 0})</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                {appsLoading ? (
                  <div className="p-6 space-y-3">{[1,2,3].map(i => <Skeleton key={i} className="h-10 w-full" />)}</div>
                ) : (apps as any[])?.length > 0 ? (
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
                      {(apps as any[]).map(a => (
                        <TableRow key={a.id} className="border-white/5 hover:bg-white/[0.02]">
                          <TableCell className="font-medium max-w-xs truncate">{a.title}</TableCell>
                          <TableCell className="text-muted-foreground text-sm font-mono">{a.userEmail || a.userId.slice(0, 12)}</TableCell>
                          <TableCell>
                            <div className="flex gap-1 flex-wrap">{a.techStack?.slice(0,3).map((t: string) => <Badge key={t} variant="outline" className="text-[10px] font-mono border-white/10">{t}</Badge>)}</div>
                          </TableCell>
                          <TableCell className="text-muted-foreground text-xs">{format(new Date(a.createdAt), "d MMM yy HH:mm", { locale: es })}</TableCell>
                          <TableCell className="text-right">
                            <div className="flex items-center justify-end gap-1">
                              <Button variant="ghost" size="sm" onClick={() => setLocation(`/app/${a.id}`)}>Ver código</Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="text-muted-foreground hover:text-red-400 hover:bg-red-500/10"
                                onClick={() => {
                                  if (confirm(`¿Eliminar permanentemente "${a.title}"?`)) {
                                    adminDeleteMutation.mutate({ id: a.id });
                                  }
                                }}
                                disabled={adminDeleteMutation.isPending}
                              >
                                <X className="h-4 w-4" />
                              </Button>
                            </div>
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

          {/* ── MEMORY TAB ── */}
          <TabsContent value="memory" className="mt-4 space-y-4">
            <Card className="bg-card/40 border-white/5">
              <CardHeader className="flex flex-row items-center justify-between space-y-0">
                <div>
                  <CardTitle className="text-white flex items-center gap-2">
                    <Sparkles className="h-5 w-5 text-purple-300" />
                    Memoria del agente
                  </CardTitle>
                  <p className="text-sm text-white/60 mt-1">Parches que la IA ha aplicado con éxito y reutiliza cuando vuelve a ver el mismo error.</p>
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
                    {memory && memory.q ? `Sin coincidencias para "${memory.q}".` : "Aún no hay nada en memoria."}
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

          {/* ── QUEUE TAB ── */}
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
                        <TableHead>#</TableHead>
                        <TableHead>Estado</TableHead>
                        <TableHead>Fase</TableHead>
                        <TableHead>Usuario</TableHead>
                        <TableHead className="max-w-xs">Prompt</TableHead>
                        <TableHead className="text-right">Reintentos</TableHead>
                        <TableHead>Edad</TableHead>
                        <TableHead className="text-right">Acción</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {jobsData.jobs.map((j: any) => {
                        const ageMs = j.ageMs;
                        const ageStr = ageMs < 60_000 ? `${Math.round(ageMs / 1000)}s` : ageMs < 3_600_000 ? `${Math.round(ageMs / 60_000)}m` : `${Math.round(ageMs / 3_600_000)}h`;
                        const isStale = (j.status === "running" || j.status === "queued") && ageMs > 15 * 60 * 1000;
                        const retryable = j.status === "failed" || ((j.status === "running" || j.status === "queued") && isStale);
                        const isExpanded = expandedJobId === j.id;
                        return (
                          <>
                            <TableRow key={j.id} className="border-white/5 hover:bg-white/[0.02]">
                              <TableCell className="font-mono text-xs text-muted-foreground">{j.id}</TableCell>
                              <TableCell><JobStatusBadge status={j.status} stale={isStale} /></TableCell>
                              <TableCell className="font-mono text-xs text-muted-foreground">{j.phase}</TableCell>
                              <TableCell className="font-mono text-xs text-muted-foreground max-w-[160px] truncate">{j.userEmail || j.userId?.slice(0, 12)}</TableCell>
                              <TableCell className="max-w-xs truncate text-sm">{j.prompt}</TableCell>
                              <TableCell className="text-right font-mono text-xs">{j.retryCount}</TableCell>
                              <TableCell className="text-muted-foreground text-xs font-mono">{ageStr}</TableCell>
                              <TableCell className="text-right">
                                <div className="flex items-center justify-end gap-1">
                                  {j.errorMessage && (
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      className="text-amber-400 hover:text-amber-300"
                                      onClick={() => setExpandedJobId(isExpanded ? null : j.id)}
                                    >
                                      {isExpanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                                      Error
                                    </Button>
                                  )}
                                  <Button variant="ghost" size="sm" disabled={!retryable || retryMutation.isPending} onClick={() => retryMutation.mutate({ id: j.id })}>
                                    <RefreshCw className="h-3.5 w-3.5 mr-1" /> Reintentar
                                  </Button>
                                </div>
                              </TableCell>
                            </TableRow>
                            {isExpanded && j.errorMessage && (
                              <TableRow className="border-white/5 bg-red-500/5">
                                <TableCell colSpan={8} className="py-3 px-4">
                                  <div className="rounded-lg bg-red-500/10 border border-red-500/20 p-3">
                                    <div className="flex items-center gap-2 mb-2">
                                      <AlertTriangle className="h-4 w-4 text-red-400" />
                                      <span className="text-sm font-medium text-red-400">Error en fase: {j.phase}</span>
                                    </div>
                                    <pre className="text-xs text-red-300/80 whitespace-pre-wrap break-all max-h-48 overflow-y-auto">{j.errorMessage}</pre>
                                  </div>
                                </TableCell>
                              </TableRow>
                            )}
                          </>
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

          <TabsContent value="news" className="mt-4">
            <AdminNewsEditor />
          </TabsContent>
        </Tabs>

        {/* ── DIALOG: Adjust Credits ── */}
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

        {/* ── DIALOG: User Detail ── */}
        <Dialog open={!!selectedUser} onOpenChange={(open) => !open && setSelectedUser(null)}>
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
            {selectedUser && (
              <>
                <DialogHeader>
                  <DialogTitle className="flex items-center gap-3">
                    <div className="h-10 w-10 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center text-primary font-bold">
                      {(selectedUser.fullName || selectedUser.email)[0].toUpperCase()}
                    </div>
                    <div>
                      <div className="text-white">{selectedUser.fullName || "Sin nombre"}</div>
                      <div className="text-sm font-normal text-muted-foreground font-mono">{selectedUser.email}</div>
                    </div>
                  </DialogTitle>
                </DialogHeader>

                <Tabs value={userDetailTab} onValueChange={(v) => setUserDetailTab(v as UserDetailTab)}>
                  <TabsList className="bg-card/40 border border-white/5 w-full">
                    <TabsTrigger value="overview" className="flex-1">Resumen</TabsTrigger>
                    <TabsTrigger value="apps" className="flex-1">Apps ({userApps.length})</TabsTrigger>
                    <TabsTrigger value="moderation" className="flex-1">Moderación</TabsTrigger>
                  </TabsList>

                  {/* Overview */}
                  <TabsContent value="overview" className="mt-4 space-y-4">
                    <div className="grid grid-cols-3 gap-3">
                      <div className="rounded-lg border border-white/5 bg-card/30 p-3 text-center">
                        <div className="text-2xl font-bold font-mono text-primary">{selectedUser.credits}</div>
                        <div className="text-xs text-muted-foreground mt-1">Créditos</div>
                      </div>
                      <div className="rounded-lg border border-white/5 bg-card/30 p-3 text-center">
                        <div className="text-2xl font-bold font-mono text-white">{selectedUser.appsGenerated}</div>
                        <div className="text-xs text-muted-foreground mt-1">Apps generadas</div>
                      </div>
                      <div className="rounded-lg border border-white/5 bg-card/30 p-3 text-center">
                        <div className="text-2xl font-bold font-mono text-emerald-400">${((selectedUser.totalSpent ?? 0) / 100).toFixed(2)}</div>
                        <div className="text-xs text-muted-foreground mt-1">Total gastado</div>
                      </div>
                    </div>
                    <div className="space-y-2 text-sm">
                      <div className="flex justify-between py-2 border-b border-white/5">
                        <span className="text-muted-foreground">ID</span>
                        <span className="font-mono text-xs">{selectedUser.id}</span>
                      </div>
                      <div className="flex justify-between py-2 border-b border-white/5">
                        <span className="text-muted-foreground">Registrado</span>
                        <span>{format(new Date(selectedUser.createdAt), "d MMM yyyy HH:mm", { locale: es })}</span>
                      </div>
                      {selectedUser.lastLoginAt && (
                        <div className="flex justify-between py-2 border-b border-white/5">
                          <span className="text-muted-foreground">Último acceso</span>
                          <span>{format(new Date(selectedUser.lastLoginAt), "d MMM yyyy HH:mm", { locale: es })}</span>
                        </div>
                      )}
                      <div className="flex justify-between py-2 border-b border-white/5">
                        <span className="text-muted-foreground">Estado</span>
                        <div className="flex gap-1">
                          {selectedUser.isBanned && <Badge className="bg-red-500/10 text-red-400 border-red-500/30 text-[10px]">Baneado</Badge>}
                          {selectedUser.isSuspended && !selectedUser.isBanned && <Badge className="bg-amber-500/10 text-amber-400 border-amber-500/30 text-[10px]">Suspendido</Badge>}
                          {selectedUser.blockedIp && <Badge className="bg-orange-500/10 text-orange-400 border-orange-500/30 text-[10px]">IP: {selectedUser.blockedIp}</Badge>}
                          {!selectedUser.isBanned && !selectedUser.isSuspended && !selectedUser.blockedIp && (
                            <Badge className="bg-emerald-500/10 text-emerald-400 border-emerald-500/30 text-[10px]">Activo</Badge>
                          )}
                        </div>
                      </div>
                      {selectedUser.isAdmin && (
                        <div className="flex justify-between py-2 border-b border-white/5">
                          <span className="text-muted-foreground">Rol</span>
                          <Badge className="bg-primary/20 text-primary border-primary/30 text-[10px]">Administrador</Badge>
                        </div>
                      )}
                    </div>
                    <div className="flex gap-2 pt-2">
                      <Button
                        variant="outline"
                        size="sm"
                        className="flex-1"
                        onClick={() => {
                          setSelectedUser(null);
                          setAdjustUser({ id: selectedUser.id, email: selectedUser.email });
                        }}
                      >
                        <CreditCard className="h-4 w-4 mr-2" /> Ajustar créditos
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="flex-1 border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/10"
                        onClick={() => setRefundDialog({ user: selectedUser, amount: 0, reason: "" })}
                      >
                        <RotateCcw className="h-4 w-4 mr-2" /> Reembolsar
                      </Button>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      className="w-full mt-2 border-violet-500/30 text-violet-400 hover:bg-violet-500/10"
                      onClick={() => setEmailDialog({ user: selectedUser, subject: `Compensación por el inconveniente — Maris AI`, message: `Hemos detectado un error en tu generación reciente y lo hemos solucionado. Sentimos las molestias causadas.`, creditsAdded: 20 })}
                    >
                      <MessageSquare className="h-4 w-4 mr-2" /> Enviar email de compensación
                    </Button>
                  </TabsContent>

                  {/* Apps */}
                  <TabsContent value="apps" className="mt-4">
                    {userApps.length === 0 ? (
                      <p className="text-sm text-muted-foreground text-center py-8">Este usuario no tiene apps generadas.</p>
                    ) : (
                      <div className="space-y-2">
                        {userApps.map((a: any) => (
                          <div key={a.id} className="rounded-lg border border-white/5 bg-card/30 p-3 flex items-center justify-between gap-3">
                            <div className="flex-1 min-w-0">
                              <div className="font-medium text-sm truncate">{a.title}</div>
                              <div className="text-xs text-muted-foreground mt-0.5">{format(new Date(a.createdAt), "d MMM yyyy HH:mm", { locale: es })}</div>
                            </div>
                            <div className="flex gap-1">
                              <Button variant="ghost" size="sm" onClick={() => setLocation(`/app/${a.id}`)}>
                                <Eye className="h-3.5 w-3.5" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="text-red-400 hover:bg-red-500/10"
                                onClick={() => {
                                  if (confirm(`¿Eliminar "${a.title}"?`)) {
                                    adminDeleteMutation.mutate({ id: a.id });
                                  }
                                }}
                              >
                                <X className="h-3.5 w-3.5" />
                              </Button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </TabsContent>

                  {/* Moderation */}
                  <TabsContent value="moderation" className="mt-4 space-y-4">
                    <div className="space-y-2">
                      <Label>Motivo de la acción</Label>
                      <Textarea
                        placeholder="Describe el motivo de la acción de moderación..."
                        value={moderationReason}
                        onChange={e => setModerationReason(e.target.value)}
                        className="bg-black/20 border-white/10 resize-none"
                        rows={3}
                      />
                    </div>

                    <Separator className="bg-white/5" />

                    {/* Suspend / Unsuspend */}
                    <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-4 space-y-3">
                      <div className="flex items-center gap-2">
                        <Lock className="h-4 w-4 text-amber-400" />
                        <span className="font-medium text-amber-400">Suspensión temporal</span>
                        {selectedUser.isSuspended && (
                          <Badge className="bg-amber-500/10 text-amber-400 border-amber-500/30 text-[10px] ml-auto">Activa</Badge>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground">El usuario no podrá acceder a la plataforma pero sus datos se conservan.</p>
                      {selectedUser.suspendedReason && (
                        <p className="text-xs text-amber-400/70 italic">Motivo actual: {selectedUser.suspendedReason}</p>
                      )}
                      <div className="flex gap-2">
                        {!selectedUser.isSuspended ? (
                          <Button
                            variant="outline"
                            size="sm"
                            className="border-amber-500/30 text-amber-400 hover:bg-amber-500/10"
                            disabled={suspendMutation.isPending}
                            onClick={() => suspendMutation.mutate({ id: selectedUser.id, data: { suspend: true, reason: moderationReason || undefined } })}
                          >
                            <Lock className="h-3.5 w-3.5 mr-1" /> Suspender
                          </Button>
                        ) : (
                          <Button
                            variant="outline"
                            size="sm"
                            className="border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/10"
                            disabled={suspendMutation.isPending}
                            onClick={() => suspendMutation.mutate({ id: selectedUser.id, data: { suspend: false } })}
                          >
                            <Unlock className="h-3.5 w-3.5 mr-1" /> Levantar suspensión
                          </Button>
                        )}
                      </div>
                    </div>

                    {/* Ban / Unban */}
                    <div className="rounded-lg border border-red-500/20 bg-red-500/5 p-4 space-y-3">
                      <div className="flex items-center gap-2">
                        <Ban className="h-4 w-4 text-red-400" />
                        <span className="font-medium text-red-400">Ban permanente</span>
                        {selectedUser.isBanned && (
                          <Badge className="bg-red-500/10 text-red-400 border-red-500/30 text-[10px] ml-auto">Activo</Badge>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground">Bloquea al usuario de forma permanente. Puede revertirse manualmente.</p>
                      {selectedUser.bannedReason && (
                        <p className="text-xs text-red-400/70 italic">Motivo actual: {selectedUser.bannedReason}</p>
                      )}
                      <div className="flex gap-2">
                        {!selectedUser.isBanned ? (
                          <Button
                            variant="outline"
                            size="sm"
                            className="border-red-500/30 text-red-400 hover:bg-red-500/10"
                            disabled={banMutation.isPending}
                            onClick={() => {
                              if (confirm(`¿Banear permanentemente a ${selectedUser.email}?`)) {
                                banMutation.mutate({ id: selectedUser.id, data: { ban: true, reason: moderationReason || undefined } });
                              }
                            }}
                          >
                            <Ban className="h-3.5 w-3.5 mr-1" /> Banear
                          </Button>
                        ) : (
                          <Button
                            variant="outline"
                            size="sm"
                            className="border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/10"
                            disabled={banMutation.isPending}
                            onClick={() => banMutation.mutate({ id: selectedUser.id, data: { ban: false } })}
                          >
                            <Unlock className="h-3.5 w-3.5 mr-1" /> Levantar ban
                          </Button>
                        )}
                      </div>
                    </div>

                    {/* Block IP */}
                    <div className="rounded-lg border border-orange-500/20 bg-orange-500/5 p-4 space-y-3">
                      <div className="flex items-center gap-2">
                        <WifiOff className="h-4 w-4 text-orange-400" />
                        <span className="font-medium text-orange-400">Bloqueo por IP</span>
                        {selectedUser.blockedIp && (
                          <Badge className="bg-orange-500/10 text-orange-400 border-orange-500/30 text-[10px] ml-auto">{selectedUser.blockedIp}</Badge>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground">Bloquea el acceso desde una IP específica. Útil para evitar cuentas múltiples.</p>
                      <div className="flex gap-2">
                        <Input
                          placeholder="ej. 192.168.1.1"
                          value={ipToBlock}
                          onChange={e => setIpToBlock(e.target.value)}
                          className="bg-black/20 border-white/10 flex-1 text-sm"
                        />
                        <Button
                          variant="outline"
                          size="sm"
                          className="border-orange-500/30 text-orange-400 hover:bg-orange-500/10"
                          disabled={blockIpMutation.isPending}
                          onClick={() => blockIpMutation.mutate({ id: selectedUser.id, data: { ip: ipToBlock || null } })}
                        >
                          {selectedUser.blockedIp ? <Unlock className="h-3.5 w-3.5 mr-1" /> : <WifiOff className="h-3.5 w-3.5 mr-1" />}
                          {selectedUser.blockedIp ? "Desbloquear" : "Bloquear IP"}
                        </Button>
                      </div>
                    </div>

                    {/* Delete user */}
                    <div className="rounded-lg border border-white/5 bg-card/20 p-4 space-y-3">
                      <div className="flex items-center gap-2">
                        <UserX className="h-4 w-4 text-muted-foreground" />
                        <span className="font-medium text-muted-foreground">Eliminar cuenta</span>
                      </div>
                      <p className="text-xs text-muted-foreground">Elimina permanentemente al usuario y todos sus datos. Esta acción no se puede deshacer.</p>
                      <Button
                        variant="outline"
                        size="sm"
                        className="border-destructive/30 text-destructive hover:bg-destructive/10"
                        onClick={() => {
                          if (confirm(`¿Eliminar PERMANENTEMENTE la cuenta de ${selectedUser.email}? Esta acción no se puede deshacer.`)) {
                            toast({ title: "Función en desarrollo", description: "La eliminación de cuentas requiere confirmación adicional.", variant: "destructive" });
                          }
                        }}
                      >
                        <UserX className="h-3.5 w-3.5 mr-1" /> Eliminar cuenta
                      </Button>
                    </div>
                  </TabsContent>
                </Tabs>
              </>
            )}
          </DialogContent>
        </Dialog>

        {/* ── DIALOG: Refund ── */}
        <Dialog open={!!refundDialog} onOpenChange={(open) => !open && setRefundDialog(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <RotateCcw className="h-5 w-5 text-emerald-400" />
                Procesar reembolso
              </DialogTitle>
              <DialogDescription>
                Reembolso para <span className="font-mono text-primary">{refundDialog?.user.email}</span>
              </DialogDescription>
            </DialogHeader>
            {refundDialog && (
              <div className="space-y-4 py-2">
                <div className="rounded-lg border border-white/5 bg-card/30 p-3 grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <div className="text-muted-foreground text-xs">Créditos actuales</div>
                    <div className="font-mono font-bold text-primary">{refundDialog.user.credits}</div>
                  </div>
                  <div>
                    <div className="text-muted-foreground text-xs">Total gastado</div>
                    <div className="font-mono font-bold text-white">${((refundDialog.user.totalSpent ?? 0) / 100).toFixed(2)}</div>
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>Créditos a reembolsar</Label>
                  <Input
                    type="number"
                    min="1"
                    value={refundDialog.amount || ""}
                    onChange={e => setRefundDialog({ ...refundDialog, amount: parseInt(e.target.value) || 0 })}
                    placeholder="ej. 10"
                    className="bg-black/20 border-white/10"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Motivo del reembolso</Label>
                  <Textarea
                    placeholder="ej. Error en la generación, problema técnico..."
                    value={refundDialog.reason}
                    onChange={e => setRefundDialog({ ...refundDialog, reason: e.target.value })}
                    className="bg-black/20 border-white/10 resize-none"
                    rows={3}
                  />
                </div>
              </div>
            )}
            <DialogFooter>
              <Button variant="ghost" onClick={() => setRefundDialog(null)}>Cancelar</Button>
              <Button
                className="bg-emerald-600 hover:bg-emerald-700 text-white"
                disabled={!refundDialog?.amount || refundMutation.isPending}
                onClick={() => {
                  if (!refundDialog) return;
                  refundMutation.mutate({
                    id: refundDialog.user.id,
                    data: { credits: refundDialog.amount, reason: refundDialog.reason || undefined }
                  });
                }}
              >
                <RotateCcw className="h-4 w-4 mr-2" />
                Confirmar reembolso ({refundDialog?.amount ?? 0} créditos)
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* ─── Email Compensation Dialog ───────────────────────────────── */}
        <Dialog open={!!emailDialog} onOpenChange={(open) => !open && setEmailDialog(null)}>
          <DialogContent className="bg-[#0d0d12] border-white/10 max-w-lg">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <MessageSquare className="h-5 w-5 text-violet-400" />
                Email de compensación
              </DialogTitle>
              <DialogDescription>
                Enviar email a <span className="font-mono text-primary">{emailDialog?.user.email}</span>
              </DialogDescription>
            </DialogHeader>
            {emailDialog && (
              <div className="space-y-4 py-2">
                <div className="space-y-1.5">
                  <Label>Asunto</Label>
                  <Input
                    value={emailDialog.subject}
                    onChange={e => setEmailDialog({ ...emailDialog, subject: e.target.value })}
                    className="bg-black/20 border-white/10"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Mensaje</Label>
                  <Textarea
                    value={emailDialog.message}
                    onChange={e => setEmailDialog({ ...emailDialog, message: e.target.value })}
                    className="bg-black/20 border-white/10 resize-none min-h-[100px]"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Créditos de compensación (0 = no incluir)</Label>
                  <Input
                    type="number"
                    value={emailDialog.creditsAdded}
                    onChange={e => setEmailDialog({ ...emailDialog, creditsAdded: parseInt(e.target.value) || 0 })}
                    className="bg-black/20 border-white/10"
                    min={0}
                  />
                </div>
              </div>
            )}
            <DialogFooter>
              <Button variant="ghost" onClick={() => setEmailDialog(null)}>Cancelar</Button>
              <Button
                className="bg-violet-600 hover:bg-violet-700 text-white"
                disabled={emailSending}
                onClick={async () => {
                  if (!emailDialog) return;
                  setEmailSending(true);
                  try {
                    const result = await apiFetch(`/api/admin/users/${emailDialog.user.id}/send-compensation-email`, {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({
                        subject: emailDialog.subject,
                        message: emailDialog.message,
                        creditsAdded: emailDialog.creditsAdded || undefined,
                      }),
                    });
                    toast({
                      title: result.emailSent ? '✅ Email enviado' : '📬 Email registrado',
                      description: result.note,
                    });
                    setEmailDialog(null);
                  } catch (e: any) {
                    toast({ title: 'Error', description: e.message, variant: 'destructive' });
                  } finally {
                    setEmailSending(false);
                  }
                }}
              >
                {emailSending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <MessageSquare className="h-4 w-4 mr-2" />}
                Enviar email
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
