import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import {
  apiFetch,
  useGetAdminOverview,
  useListAdminUsers,
  useAdminPresence,
  useListAdminApps,
  useListAdminJobs,
  useAdjustUserCredits,
  useRetryAdminJob,
  useDeleteApp,
  useAdminSuspendUser,
  useAdminBanUser,
  useAdminBlockIp,
  useAdminRefundCredits,
  useAdminStripeRefund,
  useAdminAddNote,
  useAdminUserTransactions,
  useAdminUserApps,
  getListAdminUsersQueryKey,
  getListAdminJobsQueryKey,
  getGetAdminOverviewQueryKey,
  getListAdminAppsQueryKey,
  getAdminUserTransactionsQueryKey,
  getAdminUserAppsQueryKey,
} from "@/lib/api-client";
import { useQueryClient } from "@tanstack/react-query";
import { Layout } from "@/components/layout";
import { AdminTicketsPanel } from "@/components/admin-tickets-panel";
import { AdminPaymentsPanel } from "@/components/admin-payments-panel";
import { ErrorFrequencyDiagnostic } from "@/components/error-frequency-diagnostic";
import { ProjectPlaybooksCard } from "@/components/project-playbooks-card";
import { AdminNewsEditor } from "@/components/admin-news-editor";
import { AdminPresencePanel } from "@/components/admin-presence-panel";
import { CommercialCatalogPanel } from "@/components/commercial-catalog-panel";
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
import { ScrollArea } from "@/components/ui/scroll-area";
import { format, formatDistanceToNow } from "date-fns";
import { es } from "date-fns/locale";
import {
  Shield, Users, Code2, Sparkles, CreditCard, Plus, Minus, ShieldCheck,
  RefreshCw, Activity, AlertTriangle, CheckCircle2, Clock, BarChart3,
  MessageSquare, X, Ban, WifiOff, UserX, RotateCcw, Eye, Search,
  ChevronDown, ChevronUp, History, DollarSign, Lock, Unlock, Loader2,
  StickyNote, Send, ExternalLink, Wallet, ArrowUpRight, ArrowDownRight,
  Globe, Mail, Calendar, Hash, Cpu, ChevronRight, AlertCircle, CheckCircle,
  Zap, TrendingUp, TrendingDown, Star, Wifi, Paperclip, BriefcaseBusiness,
} from "lucide-react";

type AdminTab = "users" | "apps" | "queue" | "memory" | "tickets" | "news" | "presence" | "payments" | "catalog";

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
  imageUrl?: string;
  credits: number;
  appsGenerated: number;
  createdAt: string;
  isAdmin?: boolean;
  isSuspended?: boolean;
  isBanned?: boolean;
  blockedIps?: string[];
  suspendReason?: string | null;
  banReason?: string | null;
  registrationIp?: string | null;
  lastLoginIp?: string | null;
  lastLoginAt?: string | null;
  phoneNumber?: string | null;
  totalSpent?: number;
  plan?: string;
}

interface Transaction {
  id: string;
  kind: string;
  amount: number;
  description?: string;
  stripeSessionId?: string | null;
  createdAt: string;
}

type UserDetailTab = "overview" | "apps" | "transactions" | "moderation" | "notes";

export default function AdminPage({ initialTab = "users" }: { initialTab?: AdminTab } = {}) {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: overview, isLoading: overviewLoading } = useGetAdminOverview();
  const { data: users, isLoading: usersLoading, refetch: refetchUsers } = useListAdminUsers({ query: { refetchInterval: 30_000 } });
  // A petición explícita del usuario: la columna "Estado" mostraba siempre
  // "Activo" para cualquier cuenta no baneada/suspendida (un estado
  // ADMINISTRATIVO de la cuenta, no si el usuario está conectado ahora
  // mismo). Refresco cada 5s — más frecuente que la lista de usuarios
  // porque la presencia cambia en segundos, no en minutos.
  const { data: presenceData } = useAdminPresence({ query: { refetchInterval: 5_000 } });
  const onlineUserIds = new Set<string>((presenceData?.online ?? []).map((o: any) => String(o.userId)));
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
      onSuccess: (data: any) => {
        queryClient.invalidateQueries({ queryKey: getListAdminUsersQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetAdminOverviewQueryKey() });
        if (selectedUser) {
          queryClient.invalidateQueries({ queryKey: getAdminUserTransactionsQueryKey(selectedUser.id) });
          // Actualizar el usuario seleccionado inmediatamente con el nuevo balance
          if (data?.credits !== undefined) {
            setSelectedUser(prev => prev ? { ...prev, credits: data.credits } : prev);
          }
        }
        toast({ title: "✅ Créditos actualizados", description: data?.credits !== undefined ? `Nuevo balance: ${data.credits} créditos` : undefined });
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
      },
      onError: (err: unknown) => {
        const e = err as { message?: string };
        toast({ title: "Error", description: e?.message ?? "Error desconocido", variant: "destructive" });
      },
    },
  });

  const refundMutation = useAdminRefundCredits({
    mutation: {
      onSuccess: (data: any) => {
        queryClient.invalidateQueries({ queryKey: getListAdminUsersQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetAdminOverviewQueryKey() });
        if (selectedUser) {
          queryClient.invalidateQueries({ queryKey: getAdminUserTransactionsQueryKey(selectedUser.id) });
          // Actualizar el balance del panel inmediatamente
          if (data?.newBalance !== undefined) {
            setSelectedUser(prev => prev ? { ...prev, credits: data.newBalance } : prev);
          }
        }
        toast({ title: "✅ Reembolso procesado", description: data?.newBalance !== undefined ? `Nuevo balance: ${data.newBalance} créditos` : "Los créditos han sido reembolsados." });
        setRefundDialog(null);
      },
      onError: (err: unknown) => {
        const e = err as { message?: string };
        toast({ title: "Error en reembolso", description: e?.message ?? "Error desconocido", variant: "destructive" });
      },
    },
  });

  const stripeRefundMutation = useAdminStripeRefund({
    mutation: {
      onSuccess: (data: any) => {
        toast({
          title: data.refundId ? "✅ Reembolso Stripe procesado" : "⚠️ Reembolso parcial",
          description: data.message || `Reembolso de $${(data.amountRefunded / 100).toFixed(2)} procesado.`,
        });
        setStripeRefundDialog(null);
      },
      onError: (err: unknown) => {
        const e = err as { message?: string };
        toast({ title: "Error en reembolso Stripe", description: e?.message ?? "No se pudo procesar el reembolso a tarjeta.", variant: "destructive" });
      },
    },
  });

  const addNoteMutation = useAdminAddNote({
    mutation: {
      onSuccess: () => {
        if (selectedUser) queryClient.invalidateQueries({ queryKey: getListAdminUsersQueryKey() });
        toast({ title: "Nota añadida" });
        setNewNote("");
      },
      onError: (err: unknown) => {
        const e = err as { message?: string };
        toast({ title: "Error", description: e?.message ?? "Error desconocido", variant: "destructive" });
      },
    },
  });

  const adminDeleteMutation = useDeleteApp({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListAdminAppsQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetAdminOverviewQueryKey() });
        if (selectedUser) queryClient.invalidateQueries({ queryKey: getAdminUserAppsQueryKey(selectedUser.id) });
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
  const [appsDebugResult, setAppsDebugResult] = useState<any>(null);
  const [appsDebugLoading, setAppsDebugLoading] = useState(false);
  const [moderationReason, setModerationReason] = useState("");
  const [ipToBlock, setIpToBlock] = useState("");
  const [refundDialog, setRefundDialog] = useState<{ user: AdminUser; amount: number; reason: string } | null>(null);
  const [stripeRefundDialog, setStripeRefundDialog] = useState<{ user: AdminUser; sessionId: string; amount: number; reason: string } | null>(null);
  const [expandedJobId, setExpandedJobId] = useState<string | null>(null);
  const [emailDialog, setEmailDialog] = useState<{ user: AdminUser; subject: string; message: string; creditsAdded: number; attachment?: { filename: string; content: string } } | null>(null);
  const [emailSending, setEmailSending] = useState(false);
  const [newNote, setNewNote] = useState("");

  const MEMORY_PAGE_SIZE = 25;
  const [memory, setMemory] = useState<
    { total: number; limit: number; offset: number; q: string; entries: MemoryEntry[] } | null
  >(null);
  const [memoryLoading, setMemoryLoading] = useState(false);
  const [memoryQuery, setMemoryQuery] = useState("");
  const [memoryOffset, setMemoryOffset] = useState(0);

  // ── Queries for selected user ──────────────────────────────────────────────
  const { data: userTransactions, isLoading: txLoading } = useAdminUserTransactions(
    selectedUser?.id ?? "",
    { query: { enabled: !!selectedUser && userDetailTab === "transactions" } }
  );
  const { data: userAppsData, isLoading: userAppsLoading, refetch: refetchUserApps } = useAdminUserApps(
    selectedUser?.id ?? "",
    selectedUser?.email ?? "",
    { query: { enabled: !!selectedUser && userDetailTab === "apps", staleTime: 0, refetchOnMount: true } }
  );

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

  const openUserDetail = (u: AdminUser) => {
    setSelectedUser(u);
    setUserDetailTab("overview");
    setModerationReason("");
    setIpToBlock((u.blockedIps ?? [])[0] || "");
    setNewNote("");
  };

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

        <ErrorFrequencyDiagnostic />

        {/* Tabs */}
        <Tabs defaultValue={initialTab} className="w-full">
          <TabsList className="bg-card/40 border border-white/5 flex-wrap h-auto gap-1 p-1">
            <TabsTrigger value="users"><Users className="h-4 w-4 mr-2" /> Usuarios</TabsTrigger>
            <TabsTrigger value="presence"><Wifi className="h-4 w-4 mr-2" /> Clientes en vivo</TabsTrigger>
            <TabsTrigger value="apps"><Code2 className="h-4 w-4 mr-2" /> Apps</TabsTrigger>
            <TabsTrigger value="catalog"><BriefcaseBusiness className="h-4 w-4 mr-2" /> Catálogo privado</TabsTrigger>
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
            <TabsTrigger value="payments"><CreditCard className="h-4 w-4 mr-2" /> Pagos</TabsTrigger>
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
                <div className="text-2xl font-bold font-mono text-orange-400">{filteredUsers.filter(u => (u.blockedIps ?? []).length > 0).length}</div>
                <div className="text-xs text-orange-400/70 mt-1">IP bloqueada</div>
              </div>
            </div>

            <Card className="bg-card/40 border-white/5">
              <CardHeader>
                <CardTitle className="text-lg flex items-center">
                  <Users className="h-5 w-5 mr-2 text-muted-foreground" />
                  Usuarios ({filteredUsers.length}) <button onClick={() => refetchUsers()} className="ml-1 text-xs opacity-50 hover:opacity-100" title="Actualizar">↻</button>
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
                        <TableHead>IP</TableHead>
                        <TableHead>Registrado</TableHead>
                        <TableHead className="text-right">Acciones</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredUsers.map(u => (
                        <TableRow
                          key={u.id}
                          className={`border-white/5 hover:bg-white/[0.02] cursor-pointer ${u.isBanned ? "opacity-50" : ""}`}
                          onClick={() => openUserDetail(u)}
                        >
                          <TableCell className="font-medium">
                            <div className="flex items-center gap-2">
                              <div className="h-7 w-7 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center text-primary text-xs font-bold flex-shrink-0">
                                {(u.fullName || u.email)[0].toUpperCase()}
                              </div>
                              <span className="truncate max-w-[120px]">{u.fullName || "—"}</span>
                              {u.isAdmin && <Badge className="bg-primary/20 text-primary text-[10px] font-mono uppercase border border-primary/30">Admin</Badge>}
                            </div>
                          </TableCell>
                          <TableCell className="text-muted-foreground text-sm font-mono">{u.email}</TableCell>
                          <TableCell className="text-right font-mono text-primary font-bold">{u.credits}</TableCell>
                          <TableCell className="text-right font-mono">{u.appsGenerated}</TableCell>
                          <TableCell>
                            <div className="flex flex-wrap items-center gap-1">
                              {onlineUserIds.has(String(u.id)) ? (
                                <span className="flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-400" title="Conectado ahora mismo">
                                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
                                  En línea
                                </span>
                              ) : (
                                <span className="flex items-center gap-1 rounded-full border border-red-500/30 bg-red-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-red-400" title="Sin conexión activa ahora mismo">
                                  <span className="h-1.5 w-1.5 rounded-full bg-red-400" />
                                  Offline
                                </span>
                              )}
                              {u.isBanned && <Badge className="bg-red-500/10 text-red-400 border-red-500/30 text-[10px]">Baneado</Badge>}
                              {u.isSuspended && !u.isBanned && <Badge className="bg-amber-500/10 text-amber-400 border-amber-500/30 text-[10px]">Suspendido</Badge>}
                              {(u.blockedIps ?? []).length > 0 && <Badge className="bg-orange-500/10 text-orange-400 border-orange-500/30 text-[10px]">IP bloqueada</Badge>}
                              {!u.isBanned && !u.isSuspended && (u.blockedIps ?? []).length === 0 && (
                                <Badge className="bg-white/[0.04] text-white/40 border-white/10 text-[10px]">Activo</Badge>
                              )}
                            </div>
                          </TableCell>
                          <TableCell className="text-xs font-mono text-muted-foreground/70">
                            {u.lastLoginIp || u.registrationIp
                              ? <span title={u.lastLoginIp ? `Última IP: ${u.lastLoginIp}` : `IP registro: ${u.registrationIp}`}>
                                  {u.lastLoginIp || u.registrationIp}
                                </span>
                              : <span className="text-white/20">—</span>
                            }
                          </TableCell>
                          <TableCell className="text-muted-foreground text-xs">{format(new Date(u.createdAt), "d MMM yyyy", { locale: es })}</TableCell>
                          <TableCell className="text-right">
                            <Button
                              variant="ghost"
                              size="sm"
                              className="gap-1 text-xs"
                              onClick={(e) => { e.stopPropagation(); openUserDetail(u); }}
                            >
                              <Eye className="h-3.5 w-3.5" /> Ver perfil
                              <ChevronRight className="h-3 w-3 text-muted-foreground" />
                            </Button>
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

          {/* ── PRESENCE TAB ── */}
          <TabsContent value="presence" className="mt-4">
            <AdminPresencePanel />
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
                          <TableCell className="text-muted-foreground text-sm font-mono">{a.userEmail || a.userId}</TableCell>
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

          {/* ── CATÁLOGO COMERCIAL PRIVADO ── */}
          <TabsContent value="catalog" className="mt-4">
            <CommercialCatalogPanel />
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

            <ProjectPlaybooksCard />
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
                              <TableCell className="font-mono text-xs text-muted-foreground">{j.id.slice(0, 8)}…</TableCell>
                              <TableCell><JobStatusBadge status={j.status} stale={isStale} /></TableCell>
                              <TableCell className="font-mono text-xs text-muted-foreground">{j.phase}</TableCell>
                              <TableCell className="font-mono text-xs text-muted-foreground max-w-[160px] truncate">{j.userEmail || j.userId}</TableCell>
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

          <TabsContent value="payments" className="mt-4">
            <AdminPaymentsPanel />
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

        {/* ── DIALOG: User Detail (Full Professional Panel) ── */}
        <Dialog open={!!selectedUser} onOpenChange={(open) => !open && setSelectedUser(null)}>
          <DialogContent className="max-w-3xl h-[92vh] max-h-[92vh] p-0 overflow-hidden flex flex-col">
            {selectedUser && (
              <>
                {/* User Header */}
                <div className="flex items-start gap-4 p-6 border-b border-white/5 bg-gradient-to-r from-primary/5 to-transparent">
                  <div className="h-14 w-14 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center text-primary text-xl font-bold flex-shrink-0">
                    {(selectedUser.fullName || selectedUser.email)[0].toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h2 className="text-xl font-bold text-white">{selectedUser.fullName || "Sin nombre"}</h2>
                      {selectedUser.isAdmin && <Badge className="bg-primary/20 text-primary border-primary/30 text-[10px]">Admin</Badge>}
                      {selectedUser.isBanned && <Badge className="bg-red-500/10 text-red-400 border-red-500/30 text-[10px]">Baneado</Badge>}
                      {selectedUser.isSuspended && !selectedUser.isBanned && <Badge className="bg-amber-500/10 text-amber-400 border-amber-500/30 text-[10px]">Suspendido</Badge>}
                      {(selectedUser.blockedIps ?? []).length > 0 && <Badge className="bg-orange-500/10 text-orange-400 border-orange-500/30 text-[10px]">IP bloqueada</Badge>}
                      {!selectedUser.isBanned && !selectedUser.isSuspended && (selectedUser.blockedIps ?? []).length === 0 && (
                        <Badge className="bg-emerald-500/10 text-emerald-400 border-emerald-500/30 text-[10px]">Activo</Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-1 text-sm text-muted-foreground font-mono mt-1">
                      <Mail className="h-3.5 w-3.5" />
                      {selectedUser.email}
                    </div>
                    <div className="flex items-center gap-4 mt-2 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1"><Calendar className="h-3 w-3" /> Registrado {format(new Date(selectedUser.createdAt), "d MMM yyyy", { locale: es })}</span>
                      <span
                        className="flex items-center gap-1 font-mono cursor-pointer hover:text-white transition-colors"
                        title="Clic para copiar ID"
                        onClick={() => { navigator.clipboard.writeText(selectedUser.id); toast({ title: "ID copiado", description: selectedUser.id }); }}
                      ><Hash className="h-3 w-3" /> {selectedUser.id}</span>
                    </div>
                  </div>
                  {/* Quick stats */}
                  <div className="flex gap-3 flex-shrink-0">
                    <div className="text-center">
                      <div className="text-2xl font-bold font-mono text-primary">{selectedUser.credits}</div>
                      <div className="text-[10px] text-muted-foreground">créditos</div>
                    </div>
                    <div className="text-center">
                      <div className="text-2xl font-bold font-mono text-white">{selectedUser.appsGenerated}</div>
                      <div className="text-[10px] text-muted-foreground">apps</div>
                    </div>
                  </div>
                </div>

                {/* Quick Actions Bar */}
                <div className="flex gap-2 px-6 py-3 border-b border-white/5 bg-black/20 flex-wrap">
                  <Button
                    size="sm"
                    variant="outline"
                    className="gap-1.5 text-xs"
                    onClick={() => { setAdjustUser({ id: selectedUser.id, email: selectedUser.email }); }}
                  >
                    <CreditCard className="h-3.5 w-3.5" /> Ajustar créditos
                  </Button>
                  <span className="inline-flex items-center rounded-md border border-amber-500/30 px-3 py-1.5 text-xs text-amber-200">
                    Compensaciones: solo mediante ticket de soporte
                  </span>
                  <Button
                    size="sm"
                    variant="outline"
                    className="gap-1.5 text-xs border-blue-500/30 text-blue-400 hover:bg-blue-500/10"
                    onClick={() => setEmailDialog({ user: selectedUser, subject: `Actualización sobre tu incidencia — Maris AI`, message: `Hemos revisado tu incidencia. Si deseas solicitar una compensación, abre un ticket de soporte para que el equipo pueda evaluarla manualmente.`, creditsAdded: 0 })}
                  >
                    <Mail className="h-3.5 w-3.5" /> Email compensación
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="gap-1.5 text-xs border-violet-500/30 text-violet-400 hover:bg-violet-500/10"
                    onClick={async () => {
                      if (!confirm(`¿Regenerar la última app de ${selectedUser.email} y enviarle email de disculpas con 10 créditos de compensación?`)) return;
                      try {
                        const d = await apiFetch<any>(`/api/admin/users/${selectedUser.id}/regenerate-and-apologize`, {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ compensationCredits: 10 }),
                        });
                        toast({ title: "✅ Regeneración iniciada", description: d.message });
                      } catch (e: any) {
                        toast({ title: "Error", description: e.message, variant: "destructive" });
                      }
                    }}
                  >
                    <RotateCcw className="h-3.5 w-3.5" /> Regenerar + disculpa
                  </Button>
                </div>

                {/* Tabs */}
                <div className="flex-1 min-h-0 flex flex-col">
                  <Tabs value={userDetailTab} onValueChange={(v) => setUserDetailTab(v as UserDetailTab)} className="flex-1 min-h-0 flex flex-col">
                    <TabsList className="bg-transparent border-b border-white/5 rounded-none px-6 h-10 gap-0 flex-shrink-0">
                      <TabsTrigger value="overview" className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent text-xs">Resumen</TabsTrigger>
                      <TabsTrigger value="transactions" className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent text-xs">Transacciones</TabsTrigger>
                      <TabsTrigger value="apps" className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent text-xs">Apps</TabsTrigger>
                      <TabsTrigger value="moderation" className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent text-xs">Moderación</TabsTrigger>
                      <TabsTrigger value="notes" className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent text-xs">Notas</TabsTrigger>
                    </TabsList>

                    <ScrollArea className="flex-1 min-h-0">
                      {/* Overview */}
                      <TabsContent value="overview" className="mt-0 p-6 space-y-4">
                        <div className="grid grid-cols-3 gap-3">
                          <div className="rounded-lg border border-white/5 bg-card/30 p-3 text-center">
                            <div className="text-2xl font-bold font-mono text-primary">{selectedUser.credits}</div>
                            <div className="text-xs text-muted-foreground mt-1">Créditos actuales</div>
                          </div>
                          <div className="rounded-lg border border-white/5 bg-card/30 p-3 text-center">
                            <div className="text-2xl font-bold font-mono text-white">{selectedUser.appsGenerated}</div>
                            <div className="text-xs text-muted-foreground mt-1">Apps generadas</div>
                          </div>
                          <div className="rounded-lg border border-emerald-500/10 bg-emerald-500/5 p-3 text-center">
                            <div className="text-2xl font-bold font-mono text-emerald-400">${((selectedUser.totalSpent ?? 0) / 100).toFixed(2)}</div>
                            <div className="text-xs text-emerald-400/70 mt-1">Total gastado</div>
                          </div>
                        </div>

                        <div className="space-y-0 rounded-lg border border-white/5 overflow-hidden">
                          <InfoRow label="ID de usuario" value={<span className="font-mono text-xs">{selectedUser.id}</span>} />
                          <InfoRow label="Email" value={selectedUser.email} />
                          {selectedUser.phoneNumber && (
                            <InfoRow label="Teléfono" value={<span className="font-mono text-xs">{selectedUser.phoneNumber}</span>} />
                          )}
                          <InfoRow label="Plan" value={<Badge variant="outline" className="text-[10px] border-white/10">{selectedUser.plan || "free"}</Badge>} />
                          <InfoRow label="Registrado" value={format(new Date(selectedUser.createdAt), "d MMM yyyy 'a las' HH:mm", { locale: es })} />
                          {selectedUser.lastLoginIp && (
                            <InfoRow label="Última IP" value={<span className="font-mono text-xs">{selectedUser.lastLoginIp}</span>} />
                          )}
                          {selectedUser.registrationIp && (
                            <InfoRow label="IP de registro" value={<span className="font-mono text-xs">{selectedUser.registrationIp}</span>} />
                          )}
                          {(selectedUser.blockedIps ?? []).length > 0 && (
                            <InfoRow label="IPs bloqueadas" value={
                              <div className="flex flex-wrap gap-1">
                                {(selectedUser.blockedIps ?? []).map(ip => (
                                  <Badge key={ip} className="bg-orange-500/10 text-orange-400 border-orange-500/30 text-[10px] font-mono">{ip}</Badge>
                                ))}
                              </div>
                            } />
                          )}
                          {selectedUser.suspendReason && (
                            <InfoRow label="Motivo suspensión" value={<span className="text-amber-400 text-xs">{selectedUser.suspendReason}</span>} />
                          )}
                          {selectedUser.banReason && (
                            <InfoRow label="Motivo ban" value={<span className="text-red-400 text-xs">{selectedUser.banReason}</span>} />
                          )}
                        </div>
                      </TabsContent>

                      {/* Transactions */}
                      <TabsContent value="transactions" className="mt-0 p-6 space-y-3">
                        {txLoading ? (
                          <div className="space-y-2">{[1,2,3,4].map(i => <Skeleton key={i} className="h-12 w-full" />)}</div>
                        ) : (userTransactions as Transaction[] | undefined)?.length ? (
                          <div className="space-y-2">
                            {(userTransactions as Transaction[]).map(tx => {
                              const isPositive = tx.amount > 0;
                              return (
                                <div key={tx.id} className="rounded-lg border border-white/5 bg-card/20 p-3 flex items-center gap-3">
                                  <div className={`h-8 w-8 rounded-full flex items-center justify-center flex-shrink-0 ${isPositive ? "bg-emerald-500/10" : "bg-red-500/10"}`}>
                                    {isPositive ? <ArrowUpRight className="h-4 w-4 text-emerald-400" /> : <ArrowDownRight className="h-4 w-4 text-red-400" />}
                                  </div>
                                  <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2">
                                      <span className="text-sm font-medium text-white">{tx.description || tx.kind}</span>
                                      <Badge variant="outline" className="text-[10px] border-white/10 font-mono">{tx.kind}</Badge>
                                    </div>
                                    <div className="text-xs text-muted-foreground mt-0.5">
                                      {format(new Date(tx.createdAt), "d MMM yyyy HH:mm", { locale: es })}
                                      {tx.stripeSessionId && (
                                        <span className="ml-2 font-mono text-blue-400/70">#{tx.stripeSessionId.slice(0, 16)}…</span>
                                      )}
                                    </div>
                                  </div>
                                  <div className="flex items-center gap-2 flex-shrink-0">
                                    <span className={`font-bold font-mono text-sm ${isPositive ? "text-emerald-400" : "text-red-400"}`}>
                                      {isPositive ? "+" : ""}{tx.amount}
                                    </span>
                                    {tx.stripeSessionId && (
                                      <Button
                                        size="sm"
                                        variant="ghost"
                                        className="h-7 px-2 text-xs text-blue-400 hover:bg-blue-500/10"
                                        onClick={() => setStripeRefundDialog({ user: selectedUser, sessionId: tx.stripeSessionId!, amount: 0, reason: "" })}
                                      >
                                        <Wallet className="h-3 w-3 mr-1" /> Reembolso Stripe
                                      </Button>
                                    )}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        ) : (
                          <div className="text-center py-12 text-muted-foreground">
                            <History className="h-8 w-8 mx-auto mb-2 opacity-30" />
                            <p className="text-sm">Sin transacciones registradas</p>
                          </div>
                        )}
                      </TabsContent>

                      {/* Apps */}
                      <TabsContent value="apps" className="mt-0 p-6">
                        <div className="flex items-center justify-between mb-3">
                          <p className="text-xs text-white/40">{(userAppsData as any[])?.length ?? 0} app(s) encontrada(s)</p>
                          <button onClick={() => refetchUserApps()} className="text-xs text-white/40 hover:text-white flex items-center gap-1 transition">
                            <RotateCcw className="h-3 w-3" /> Recargar
                          </button>
                        </div>
                        {userAppsLoading ? (
                          <div className="space-y-2">{[1,2,3].map(i => <Skeleton key={i} className="h-14 w-full" />)}</div>
                        ) : (userAppsData as any[])?.length ? (
                          <div className="space-y-2">
                            {(userAppsData as any[]).map((a: any) => (
                              <div key={a.id} className="rounded-lg border border-white/5 bg-card/20 p-3 flex items-center gap-3">
                                <div className="h-9 w-9 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center flex-shrink-0">
                                  <Code2 className="h-4 w-4 text-primary" />
                                </div>
                                <div className="flex-1 min-w-0">
                                  <div className="font-medium text-sm truncate">{a.title}</div>
                                  <div className="flex items-center gap-2 mt-0.5">
                                    <span className="text-xs text-muted-foreground">{format(new Date(a.createdAt), "d MMM yyyy HH:mm", { locale: es })}</span>
                                    <div className="flex gap-1">
                                      {a.techStack?.slice(0, 2).map((t: string) => (
                                        <Badge key={t} variant="outline" className="text-[10px] border-white/10">{t}</Badge>
                                      ))}
                                    </div>
                                  </div>
                                </div>
                                <div className="flex gap-1">
                                  <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={() => setLocation(`/app/${a.id}`)}>
                                    <ExternalLink className="h-3.5 w-3.5" />
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="h-8 w-8 p-0 text-red-400 hover:bg-red-500/10"
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
                        ) : (
                          <div className="text-center py-8 text-muted-foreground">
                            <Code2 className="h-8 w-8 mx-auto mb-2 opacity-30" />
                            <p className="text-sm">Este usuario no tiene apps generadas</p>
                            <p className="text-xs mt-1 opacity-60">Si sabes que tiene apps, usa el diagnóstico para ver qué pasa</p>
                            <Button
                              size="sm"
                              variant="outline"
                              className="mt-3 text-xs border-amber-500/30 text-amber-400 hover:bg-amber-500/10"
                              disabled={appsDebugLoading}
                              onClick={async () => {
                                if (!selectedUser) return;
                                setAppsDebugLoading(true);
                                setAppsDebugResult(null);
                                try {
                                  const r = await apiFetch<any>(`/api/admin/users/${selectedUser.id}/apps-debug`);
                                  setAppsDebugResult(r);
                                } catch (e: any) {
                                  setAppsDebugResult({ error: e?.message });
                                } finally {
                                  setAppsDebugLoading(false);
                                }
                              }}
                            >
                              {appsDebugLoading ? "Diagnosticando…" : "🔍 Diagnosticar discrepancia"}
                            </Button>
                            {appsDebugResult && (
                              <div className="mt-4 text-left rounded-lg border border-amber-500/20 bg-amber-500/5 p-3 text-xs font-mono space-y-1 max-h-64 overflow-y-auto">
                                <div><span className="text-amber-400">ID buscado:</span> {appsDebugResult.searchedId}</div>
                                <div><span className="text-amber-400">Email:</span> {appsDebugResult.userEmail}</div>
                                <div><span className="text-amber-400">Apps por ID exacto:</span> {appsDebugResult.appsByExactId?.length ?? 0}</div>
                                <div><span className="text-amber-400">Jobs encontrados:</span> {appsDebugResult.jobCount}</div>
                                <div><span className="text-amber-400">AppIds en jobs:</span> {JSON.stringify(appsDebugResult.jobAppIds)}</div>
                                <div><span className="text-amber-400">Apps vía jobs:</span> {appsDebugResult.appsByJobs?.length ?? 0}</div>
                                {appsDebugResult.appsByJobs?.map((a: any, i: number) => (
                                  <div key={i} className="pl-2 text-white/60">
                                    • {a.title} — userId en BD: <span className={a.userId === selectedUser?.id ? "text-green-400" : "text-red-400"}>{a.userId}</span>
                                  </div>
                                ))}
                                <div><span className="text-amber-400">¿ID coincide con userId en BD?:</span> <span className={appsDebugResult.idMatchesAppUserId ? "text-green-400" : "text-red-400"}>{appsDebugResult.idMatchesAppUserId ? "SÍ ✓" : "NO ✗ — AHÍ ESTÁ EL BUG"}</span></div>
                                {/* Botón de reasignación cuando hay apps via jobs pero con userId incorrecto */}
                                {!appsDebugResult.idMatchesAppUserId && appsDebugResult.appsByJobs?.length > 0 && selectedUser && (
                                  <div className="mt-2 pt-2 border-t border-red-500/20">
                                    <p className="text-red-400 mb-2">Las apps tienen un userId diferente al esperado. Pulsa para corregirlo automáticamente:</p>
                                    <button
                                      className="w-full rounded bg-red-500/20 border border-red-500/30 text-red-300 text-xs py-1.5 hover:bg-red-500/30 transition"
                                      onClick={async () => {
                                        if (!confirm(`¿Reasignar ${appsDebugResult.appsByJobs.length} app(s) al usuario ${selectedUser.email}?`)) return;
                                        let ok = 0;
                                        for (const app of appsDebugResult.appsByJobs) {
                                          try {
                                            await apiFetch(`/api/admin/apps/${app.id}/reassign-user`, {
                                              method: "POST",
                                              headers: { "Content-Type": "application/json" },
                                              body: JSON.stringify({ targetUserId: selectedUser.id }),
                                            });
                                            ok++;
                                          } catch {}
                                        }
                                        toast({ title: `✅ ${ok} app(s) reasignadas`, description: "Cierra y vuelve a abrir la pestaña Apps." });
                                        setAppsDebugResult(null);
                                        await refetchUserApps();
                                      }}
                                    >
                                      🔧 Reasignar {appsDebugResult.appsByJobs.length} app(s) a este usuario
                                    </button>
                                  </div>
                                )}
                                {appsDebugResult.recentAppsInDB?.length > 0 && (
                                  <div className="mt-2 pt-2 border-t border-white/10">
                                    <div className="text-amber-400 mb-1">Formato userId en otras apps de la BD:</div>
                                    {appsDebugResult.recentAppsInDB?.map((a: any, i: number) => (
                                      <div key={i} className="pl-2 text-white/50">{a.title?.slice(0,20)}: {a.userId}</div>
                                    ))}
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        )}
                      </TabsContent>

                      {/* Moderation */}
                      <TabsContent value="moderation" className="mt-0 p-6 space-y-4">
                        <div className="space-y-2">
                          <Label>Motivo de la acción</Label>
                          <Textarea
                            placeholder="Describe el motivo de la acción de moderación..."
                            value={moderationReason}
                            onChange={e => setModerationReason(e.target.value)}
                            className="bg-black/20 border-white/10 resize-none"
                            rows={2}
                          />
                        </div>

                        <Separator className="bg-white/5" />

                        {/* Suspend / Unsuspend */}
                        <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-4 space-y-3">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <Lock className="h-4 w-4 text-amber-400" />
                              <span className="font-medium text-amber-400">Suspensión temporal</span>
                            </div>
                            {selectedUser.isSuspended && (
                              <Badge className="bg-amber-500/10 text-amber-400 border-amber-500/30 text-[10px]">Activa</Badge>
                            )}
                          </div>
                          <p className="text-xs text-muted-foreground">El usuario no podrá acceder a la plataforma pero sus datos se conservan.</p>
                          {selectedUser.suspendReason && (
                            <p className="text-xs text-amber-400/70 italic">Motivo actual: {selectedUser.suspendReason}</p>
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
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <Ban className="h-4 w-4 text-red-400" />
                              <span className="font-medium text-red-400">Ban permanente</span>
                            </div>
                            {selectedUser.isBanned && (
                              <Badge className="bg-red-500/10 text-red-400 border-red-500/30 text-[10px]">Activo</Badge>
                            )}
                          </div>
                          <p className="text-xs text-muted-foreground">Bloquea al usuario de forma permanente. Puede revertirse manualmente.</p>
                          {selectedUser.banReason && (
                            <p className="text-xs text-red-400/70 italic">Motivo actual: {selectedUser.banReason}</p>
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
                          </div>
                          <p className="text-xs text-muted-foreground">Bloquea el acceso desde una IP específica. Útil para evitar cuentas múltiples.</p>
                          {(selectedUser.blockedIps ?? []).length > 0 && (
                            <div className="flex flex-wrap gap-1">
                              {(selectedUser.blockedIps ?? []).map(ip => (
                                <Badge key={ip} className="bg-orange-500/10 text-orange-400 border-orange-500/30 text-xs font-mono">{ip}</Badge>
                              ))}
                            </div>
                          )}
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
                              disabled={blockIpMutation.isPending || !ipToBlock.trim()}
                              onClick={() => blockIpMutation.mutate({ id: selectedUser.id, data: { ip: ipToBlock.trim() } })}
                            >
                              <WifiOff className="h-3.5 w-3.5 mr-1" /> Bloquear IP
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
                            onClick={async () => {
                              if (!confirm(`¿Eliminar PERMANENTEMENTE la cuenta de ${selectedUser.email}?\n\nEsto borrará todas sus apps, jobs y créditos. No se puede deshacer.`)) return;
                              if (!confirm(`Segunda confirmación: ¿estás seguro de eliminar a ${selectedUser.email}?`)) return;
                              try {
                                const d = await apiFetch<any>(`/api/admin/users/${selectedUser.id}`, { method: "DELETE" });
                                toast({ title: "Cuenta eliminada", description: `${d.email} eliminado. ${d.appsDeleted} apps y ${d.jobsDeleted} jobs borrados.` });
                                setSelectedUser(null);
                                queryClient.invalidateQueries({ queryKey: getListAdminUsersQueryKey() });
                              } catch (e: any) {
                                toast({ title: "Error al eliminar", description: e.message, variant: "destructive" });
                              }
                            }}
                          >
                            <UserX className="h-3.5 w-3.5 mr-1" /> Eliminar cuenta
                          </Button>
                        </div>
                      </TabsContent>

                      {/* Notes */}
                      <TabsContent value="notes" className="mt-0 p-6 space-y-4">
                        <div className="space-y-2">
                          <Label>Nueva nota interna</Label>
                          <div className="flex gap-2">
                            <Textarea
                              placeholder="Añade una nota interna sobre este usuario..."
                              value={newNote}
                              onChange={e => setNewNote(e.target.value)}
                              className="bg-black/20 border-white/10 resize-none flex-1"
                              rows={3}
                            />
                          </div>
                          <Button
                            size="sm"
                            className="gap-1.5"
                            disabled={!newNote.trim() || addNoteMutation.isPending}
                            onClick={() => addNoteMutation.mutate({ id: selectedUser.id, data: { text: newNote.trim() } })}
                          >
                            {addNoteMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <StickyNote className="h-3.5 w-3.5" />}
                            Guardar nota
                          </Button>
                        </div>
                        <Separator className="bg-white/5" />
                        <div className="text-center py-8 text-muted-foreground">
                          <StickyNote className="h-8 w-8 mx-auto mb-2 opacity-30" />
                          <p className="text-sm">Las notas se guardan en el perfil del usuario</p>
                          <p className="text-xs mt-1 opacity-60">Solo visibles para administradores</p>
                        </div>
                      </TabsContent>
                    </ScrollArea>
                  </Tabs>
                </div>
              </>
            )}
          </DialogContent>
        </Dialog>


        {/* ── DIALOG: Stripe Card Refund ── */}
        <Dialog open={!!stripeRefundDialog} onOpenChange={(open) => !open && setStripeRefundDialog(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Wallet className="h-5 w-5 text-blue-400" />
                Reembolso a tarjeta (Stripe)
              </DialogTitle>
              <DialogDescription>
                Reembolso real a la tarjeta de crédito de <span className="font-mono text-primary">{stripeRefundDialog?.user.email}</span>
              </DialogDescription>
            </DialogHeader>
            {stripeRefundDialog && (
              <div className="space-y-4 py-2">
                <div className="rounded-lg border border-blue-500/20 bg-blue-500/5 p-3 text-sm">
                  <div className="flex items-center gap-2 text-blue-400 mb-1">
                    <AlertCircle className="h-4 w-4" />
                    <span className="font-medium">Reembolso real a tarjeta</span>
                  </div>
                  <p className="text-xs text-muted-foreground">Este reembolso se procesará directamente a través de Stripe y devolverá el dinero a la tarjeta del cliente. Puede tardar 5-10 días hábiles.</p>
                </div>
                <div className="space-y-1.5">
                  <Label>ID de sesión Stripe</Label>
                  <Input
                    value={stripeRefundDialog.sessionId}
                    readOnly
                    className="bg-black/20 border-white/10 font-mono text-xs"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Importe a reembolsar (en céntimos, 0 = reembolso total)</Label>
                  <Input
                    type="number"
                    min="0"
                    value={stripeRefundDialog.amount || ""}
                    onChange={e => setStripeRefundDialog({ ...stripeRefundDialog, amount: parseInt(e.target.value) || 0 })}
                    placeholder="0 = reembolso total"
                    className="bg-black/20 border-white/10"
                  />
                  <p className="text-xs text-muted-foreground">Ejemplo: 999 = $9.99. Deja en 0 para reembolso total del pago.</p>
                </div>
                <div className="space-y-1.5">
                  <Label>Motivo del reembolso</Label>
                  <Textarea
                    placeholder="ej. Error en la generación, problema técnico..."
                    value={stripeRefundDialog.reason}
                    onChange={e => setStripeRefundDialog({ ...stripeRefundDialog, reason: e.target.value })}
                    className="bg-black/20 border-white/10 resize-none"
                    rows={2}
                  />
                </div>
              </div>
            )}
            <DialogFooter>
              <Button variant="ghost" onClick={() => setStripeRefundDialog(null)}>Cancelar</Button>
              <Button
                className="bg-blue-600 hover:bg-blue-700 text-white"
                disabled={stripeRefundMutation.isPending}
                onClick={() => {
                  if (!stripeRefundDialog) return;
                  stripeRefundMutation.mutate({
                    id: stripeRefundDialog.user.id,
                    data: {
                      stripeSessionId: stripeRefundDialog.sessionId,
                      amountCents: stripeRefundDialog.amount || undefined,
                      reason: stripeRefundDialog.reason || undefined,
                    }
                  });
                }}
              >
                {stripeRefundMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Wallet className="h-4 w-4 mr-2" />}
                Procesar reembolso Stripe
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* ── DIALOG: Email Compensation ── */}
        <Dialog open={!!emailDialog} onOpenChange={(open) => !open && setEmailDialog(null)}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Mail className="h-5 w-5 text-violet-400" />
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
                <div className="space-y-1.5">
                  <Label>Captura de pantalla (opcional)</Label>
                  {emailDialog.attachment ? (
                    <div className="flex items-center justify-between gap-2 bg-black/20 border border-white/10 rounded-md px-3 py-2">
                      <span className="flex items-center gap-2 text-sm text-white truncate">
                        <Paperclip className="h-4 w-4 text-violet-400 shrink-0" />
                        {emailDialog.attachment.filename}
                      </span>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-7 w-7 p-0 shrink-0"
                        onClick={() => setEmailDialog({ ...emailDialog, attachment: undefined })}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  ) : (
                    <label className="flex items-center justify-center gap-2 bg-black/20 border border-dashed border-white/15 hover:border-violet-500/50 rounded-md px-3 py-3 text-sm text-muted-foreground cursor-pointer transition-colors">
                      <Plus className="h-4 w-4" />
                      Adjuntar captura de la app generada (máx. 1.5MB)
                      <input
                        type="file"
                        accept="image/png,image/jpeg,image/webp"
                        className="hidden"
                        onChange={async (e) => {
                          const file = e.target.files?.[0];
                          e.target.value = "";
                          if (!file) return;
                          // Límite real del servidor: express.json() está
                          // configurado con limit:"2mb" para TODO el body de
                          // la petición (admin.ts) — 1.5MB de margen aquí
                          // evita que el cliente acepte un archivo que el
                          // servidor luego rechazaría.
                          if (file.size > 1.5 * 1024 * 1024) {
                            toast({ title: 'Archivo demasiado grande', description: 'Máximo 1.5MB para la captura.', variant: 'destructive' });
                            return;
                          }
                          const reader = new FileReader();
                          reader.onload = () => {
                            const dataUrl = reader.result as string;
                            // dataUrl viene como "data:image/png;base64,XXXX" — Resend
                            // solo quiere el contenido base64 puro, sin el prefijo.
                            const base64Content = dataUrl.split(',')[1] || '';
                            setEmailDialog((prev) => prev ? {
                              ...prev,
                              attachment: { filename: file.name, content: base64Content },
                            } : prev);
                          };
                          reader.readAsDataURL(file);
                        }}
                      />
                    </label>
                  )}
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
                    const result = await apiFetch<{ emailSent?: boolean; note?: string }>(`/api/admin/users/${emailDialog.user.id}/send-compensation-email`, {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({
                        subject: emailDialog.subject,
                        message: emailDialog.message,
                        creditsAdded: emailDialog.creditsAdded || undefined,
                        attachment: emailDialog.attachment || undefined,
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
                {emailSending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Send className="h-4 w-4 mr-2" />}
                Enviar email
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </Layout>
  );
}

function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between px-4 py-2.5 border-b border-white/5 last:border-0 bg-card/10 hover:bg-card/20 transition-colors">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-sm text-white">{value}</span>
    </div>
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
  const displayValue = typeof value === "number" && Number.isFinite(value)
    ? new Intl.NumberFormat("es-ES", { maximumFractionDigits: 2 }).format(value)
    : value ?? 0;

  return (
    <Card className={subtle ? "bg-card/30 border-white/5" : "bg-card/50 border-white/5"}>
      <CardHeader className="pb-2 flex flex-row items-center justify-between">
        <CardTitle className="text-sm font-medium text-muted-foreground">{label}</CardTitle>
        <Icon className={`h-4 w-4 ${subtle ? "text-muted-foreground" : "text-primary"}`} />
      </CardHeader>
      <CardContent>
        {loading ? <Skeleton className="h-8 w-16" /> : <div className={`text-3xl font-bold font-mono ${subtle ? "text-muted-foreground" : "text-foreground"}`}>{displayValue}</div>}
      </CardContent>
    </Card>
  );
}
