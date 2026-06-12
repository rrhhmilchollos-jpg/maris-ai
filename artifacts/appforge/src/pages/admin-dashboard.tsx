import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, PieChart, Pie, Cell, Legend,
} from "recharts";
import { parseISO } from "date-fns";
import { Layout } from "@/components/layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { useState, useEffect, useRef } from "react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  CreditCard,
  Globe,
  Users,
  Clock,
  Loader2,
  ArrowLeft,
  RefreshCw,
  ChevronDown,
  ChevronRight,
  Search,
  Filter,
  TrendingUp,
  TrendingDown,
  Zap,
  Server,
  Bug,
  Eye,
  BarChart3,
  AlertCircle,
  XCircle,
  Terminal,
  Cpu,
  Database,
  Shield,
} from "lucide-react";
import { apiFetch, useListAdminJobs, getListAdminJobsQueryKey, getGenerationJobLogs, useRetryAdminJob } from "@/lib/api-client";
import { format, formatDistanceToNow } from "date-fns";
import { es } from "date-fns/locale";
import { useLocation } from "wouter";

interface E2BToggleResponse {
  configured: boolean;
  effective: boolean;
  validateOnGenerate: boolean;
}

interface E2BSmokeResponse {
  ok: boolean;
  durationMs: number;
  output: string;
  reason?: string;
}

interface MetricsResponse {
  generatedAt: string;
  jobs24h: {
    total: number;
    succeeded: number;
    failed: number;
    successRate: number | null;
    avgDurationMs: number;
  };
  topFailingPhases: Array<{ phase: string; count: number }>;
  credits: { today: number; month: number };
  topUsers: Array<{ userId: string; email: string; creditsUsed: number }>;
  publishedApps: { today: number; total: number };
  jobs7dChart?: Array<{ date: string; succeeded: number; failed: number; total: number }>;
  credits7dChart?: Array<{ date: string; credits: number }>;
  server?: { memUsedMb: number; memTotalMb: number; uptimeSeconds: number; requestsTotal: number; errors5xx: number };
  redis?: { connected: boolean; latencyMs: number };
  queue?: { ready: boolean };
  overview?: { totalUsers: number; totalApps: number; newUsers7d: number };
  e2b?: {
    configured: boolean;
    validateOnGenerate: boolean;
    effective: boolean;
  };
}

async function fetchMetrics(): Promise<MetricsResponse> {
  return apiFetch<MetricsResponse>("/api/admin/metrics");
}

async function toggleE2B(enabled: boolean): Promise<E2BToggleResponse> {
  return apiFetch<E2BToggleResponse>("/api/admin/e2b-toggle", {
    method: "POST",
    body: JSON.stringify({ enabled }),
  });
}

async function runE2BSmoke(): Promise<E2BSmokeResponse> {
  return apiFetch<E2BSmokeResponse>("/api/admin/e2b-smoke", {
    method: "POST",
  });
}

function formatDuration(ms: number): string {
  if (!ms || ms <= 0) return "—";
  if (ms < 1000) return `${ms} ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)} s`;
  const m = Math.floor(s / 60);
  const rs = Math.round(s % 60);
  return `${m}m ${rs}s`;
}

function StatusBadge({ status }: { status: string }) {
  const variants: Record<string, { color: string; icon: React.ReactNode }> = {
    succeeded: { color: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30", icon: <CheckCircle2 className="h-3 w-3" /> },
    failed: { color: "bg-red-500/15 text-red-400 border-red-500/30", icon: <XCircle className="h-3 w-3" /> },
    running: { color: "bg-blue-500/15 text-blue-400 border-blue-500/30", icon: <Loader2 className="h-3 w-3 animate-spin" /> },
    queued: { color: "bg-yellow-500/15 text-yellow-400 border-yellow-500/30", icon: <Clock className="h-3 w-3" /> },
    generating: { color: "bg-purple-500/15 text-purple-400 border-purple-500/30", icon: <Zap className="h-3 w-3" /> },
  };
  const v = variants[status] ?? { color: "bg-white/10 text-white/60 border-white/10", icon: null };
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border ${v.color}`}>
      {v.icon}{status}
    </span>
  );
}

function JobLogsPanel({ jobId }: { jobId: string }) {
  const [logs, setLogs] = useState<Array<{ id: string; agent: string; level: string; message: string; createdAt: string }>>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    getGenerationJobLogs(jobId, {})
      .then((res) => setLogs(res.logs))
      .catch(() => setLogs([]))
      .finally(() => setLoading(false));
  }, [jobId]);

  if (loading) return <div className="p-3 text-xs text-muted-foreground flex items-center gap-2"><Loader2 className="h-3 w-3 animate-spin" />Cargando logs…</div>;
  if (!logs.length) return <div className="p-3 text-xs text-muted-foreground">Sin logs disponibles para este job.</div>;

  return (
    <ScrollArea className="h-48 w-full">
      <div className="p-2 space-y-0.5 font-mono text-xs">
        {logs.map((log) => (
          <div key={log.id} className={`flex gap-2 py-0.5 ${log.level === "error" ? "text-red-400" : log.level === "warn" ? "text-yellow-400" : "text-white/70"}`}>
            <span className="text-white/30 shrink-0">{format(new Date(log.createdAt), "HH:mm:ss")}</span>
            <span className={`shrink-0 px-1 rounded text-[10px] ${log.level === "error" ? "bg-red-500/20" : "bg-white/5"}`}>{log.agent}</span>
            <span className="break-all">{log.message}</span>
          </div>
        ))}
      </div>
    </ScrollArea>
  );
}

function LiveMonitorPanel() {
  const { toast } = useToast();
  const [jobs, setJobs] = useState<any[]>([]);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const [expandedJob, setExpandedJob] = useState<string | null>(null);
  const [logs, setLogs] = useState<Record<string, any[]>>({});
  const [repairPrompt, setRepairPrompt] = useState<Record<string, string>>({});
  const [actionLoading, setActionLoading] = useState<Record<string, boolean>>({});
  const [previewAppId, setPreviewAppId] = useState<string | null>(null);
  const pollRef = useRef<NodeJS.Timeout | null>(null);

  const fetchJobs = async () => {
    try {
      const d = await apiFetch<any>("/api/admin/jobs?limit=200");
      const active = (d.jobs ?? [])
        .map((j: any) => ({ ...j, id: String(j.id ?? j._id ?? ""), userId: String(j.userId ?? "") }))
        .filter((j: any) =>
          j.id && j.id !== "undefined" && (
            j.status === "running" ||
            j.status === "queued" ||
            j.status === "failed" ||    // failed SIEMPRE visible — sin límite de tiempo
            j.status === "reviewing" || // reviewing SIEMPRE visible
            (j.status !== "succeeded" && j.ageMs < 48 * 60 * 60 * 1000) // otros: 48h
          )
        )
        .sort((a: any, b: any) => {
          // Primero running, luego queued, luego failed/reviewing por más reciente
          const order: Record<string, number> = { running: 0, queued: 1, failed: 2, reviewing: 3 };
          const ao = order[a.status] ?? 4;
          const bo = order[b.status] ?? 4;
          if (ao !== bo) return ao - bo;
          return b.ageMs - a.ageMs; // más reciente primero
        });
      setJobs(active);
      setFetchError(null);
      setLastUpdate(new Date());
    } catch (e: any) {
      setFetchError(e?.message ?? "Error de red");
    }
  };

  const fetchLogs = async (jobId: string) => {
    try {
      const d = await apiFetch<any>(`/api/admin/jobs/${jobId}/logs?limit=100`);
      setLogs(prev => ({ ...prev, [jobId]: d.logs ?? [] }));
    } catch { /* silent */ }
  };

  useEffect(() => {
    fetchJobs();
    pollRef.current = setInterval(fetchJobs, 3000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, []);

  useEffect(() => {
    if (expandedJob) {
      fetchLogs(expandedJob);
      const t = setInterval(() => fetchLogs(expandedJob), 2000);
      return () => clearInterval(t);
    }
  }, [expandedJob]);

  const forceRetry = async (jobId: string) => {
    setActionLoading(p => ({ ...p, [jobId]: true }));
    try {
      await apiFetch<any>(`/api/admin/jobs/${jobId}/retry`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ force: true }),
      });
      toast({ title: "✅ Job reiniciado", description: `Job #${jobId.slice(-8)} vuelve a la cola.` });
      await fetchJobs();
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    } finally {
      setActionLoading(p => ({ ...p, [jobId]: false }));
    }
  };

  const injectRepair = async (jobId: string, userId: string) => {
    const prompt = repairPrompt[jobId]?.trim();
    if (!prompt) {
      toast({ title: "Escribe una instrucción de reparación", variant: "destructive" });
      return;
    }
    setActionLoading(p => ({ ...p, [`repair_${jobId}`]: true }));
    try {
      const d = await apiFetch<any>(`/api/admin/users/${userId}/generate-app`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: `[ADMIN REPAIR] ${prompt}` }),
      });
      toast({ title: "✅ Reparación inyectada", description: d.message ?? "Nuevo job de reparación en cola." });
      setRepairPrompt(p => ({ ...p, [jobId]: "" }));
      await fetchJobs();
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    } finally {
      setActionLoading(p => ({ ...p, [`repair_${jobId}`]: false }));
    }
  };

  const statusColor: Record<string, string> = {
    running: "text-emerald-400 border-emerald-500/30 bg-emerald-500/10",
    queued:  "text-yellow-400 border-yellow-500/30 bg-yellow-500/10",
    failed:  "text-red-400 border-red-500/30 bg-red-500/10",
  };
  const statusDot: Record<string, string> = {
    running: "bg-emerald-400 animate-pulse",
    queued:  "bg-yellow-400",
    failed:  "bg-red-400",
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse inline-block" />
          <span className="text-sm font-medium">Monitorización en vivo</span>
          <span className="text-xs text-muted-foreground">· actualiza cada 3s</span>
          {lastUpdate && (
            <span className="text-xs text-white/30">· última: {lastUpdate.toLocaleTimeString("es-ES")}</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="text-xs">{jobs.length} activos</Badge>
          <Button size="sm" variant="outline" className="h-6 px-2 text-xs border-violet-500/30 text-violet-400 hover:bg-violet-500/10"
            onClick={async () => {
              const email = window.prompt("Email del usuario — recupera su último proyecto fallido (funciona aunque tenga 48h):");
              if (!email) return;
              try {
                const d = await apiFetch<any>("/api/admin/recover-by-email", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ email: email.trim() }),
                });
                toast({ title: "✅ Recuperando proyecto", description: d.message });
                await fetchJobs();
              } catch (e: any) {
                // Si falla recover, intentar generar desde 0
                try {
                  const d2 = await apiFetch<any>("/api/admin/generate-for-email", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ email: email.trim() }),
                  });
                  toast({ title: "🔄 Generando nuevo proyecto", description: d2.message });
                  await fetchJobs();
                } catch (e2: any) {
                  toast({ title: "Error", description: e2.message, variant: "destructive" });
                }
              }
            }}
          >
            <Zap className="h-3 w-3 mr-1" />
            Recuperar para usuario
          </Button>
          <Button size="sm" variant="outline" className="h-6 px-2 text-xs" onClick={fetchJobs}>
            <RefreshCw className="h-3 w-3" />
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-6 px-2 text-xs border-orange-500/30 text-orange-400 hover:bg-orange-500/10"
            title="Limpiar todos los jobs 'reviewing' atascados más de 2h"
            onClick={async () => {
              if (!window.confirm("¿Limpiar todos los jobs 'reviewing' atascados? Se marcarán como fallidos.")) return;
              try {
                const d = await apiFetch<any>("/api/admin/jobs/cleanup-reviewing", { method: "POST" });
                toast({ title: "🧹 Limpieza completada", description: `${d.cleaned} job(s) limpiado(s)` });
                await fetchJobs();
              } catch (e: any) {
                toast({ title: "Error", description: e.message, variant: "destructive" });
              }
            }}
          >
            🧹 Limpiar reviewing
          </Button>
        </div>
      </div>

      {fetchError && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-400 flex items-center gap-2">
          <AlertCircle className="h-4 w-4 shrink-0" />
          {fetchError} — verifica que estás autenticado como admin
        </div>
      )}

      {!fetchError && jobs.length === 0 ? (
        <div className="rounded-lg border border-white/5 bg-white/[0.02] p-8 text-center">
          <CheckCircle2 className="h-8 w-8 text-emerald-400 mx-auto mb-2" />
          <p className="text-sm text-muted-foreground">Sin jobs activos ahora mismo.</p>
          <p className="text-xs text-muted-foreground mt-1">Cuando un usuario genere una app aparecerá aquí en tiempo real.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {jobs.map((job) => {
            const isExpanded = expandedJob === job.id;
            const jobLogs = logs[job.id] ?? [];
            const ageMin = Math.round((Date.now() - new Date(job.updatedAt).getTime()) / 60000);

            return (
              <div key={job.id} className={`rounded-lg border ${job.status === "failed" ? "border-red-500/30" : job.status === "running" ? "border-emerald-500/20" : "border-yellow-500/20"} bg-card/40 overflow-hidden`}>
                {/* Job header */}
                <div
                  className="flex items-center gap-3 p-3 cursor-pointer hover:bg-white/[0.02] transition-colors"
                  onClick={() => setExpandedJob(isExpanded ? null : job.id)}
                >
                  <span className={`w-2 h-2 rounded-full shrink-0 ${statusDot[job.status] ?? "bg-gray-400"}`} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded border ${statusColor[job.status] ?? ""}`}>
                        {job.status} · {job.phase}
                      </span>
                      <span className="text-xs text-muted-foreground font-mono truncate max-w-[200px]">
                        {job.userEmail ?? job.userId?.slice(0, 12)}
                      </span>
                      <span className="text-xs text-white/30">hace {ageMin}min</span>
                      {job.progress > 0 && (
                        <span className="text-xs text-violet-400">{job.progress}%</span>
                      )}
                    </div>
                    <p className="text-xs text-white/60 truncate mt-0.5 max-w-[400px]">
                      {job.prompt?.replace(/\[MARIS AI REQUEST LOCALE\][^\n]*\n?/, "").slice(0, 100)}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 px-2 text-xs border-yellow-500/30 text-yellow-400 hover:bg-yellow-500/10"
                      onClick={e => { e.stopPropagation(); forceRetry(job.id); }}
                      disabled={actionLoading[job.id]}
                      title="Forzar reintentar"
                    >
                      {actionLoading[job.id] ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 px-2 text-xs border-blue-500/30 text-blue-400 hover:bg-blue-500/10"
                      title="Cancelar — el cliente ve 'Nuestro equipo lo está revisando'"
                      disabled={actionLoading[`cancel_${job.id}`]}
                      onClick={async e => {
                        e.stopPropagation();
                        const msg = window.prompt(
                          "Mensaje para el cliente:",
                          "Nuestro equipo está revisando tu solicitud para ofrecerte el mejor resultado. En breve tendrás tu app lista. ✨"
                        );
                        if (msg === null) return;
                        setActionLoading(p => ({ ...p, [`cancel_${job.id}`]: true }));
                        try {
                          await apiFetch<any>(`/api/admin/jobs/${job.id}/cancel`, {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ message: msg || undefined }),
                          });
                          toast({ title: "✅ Cancelado", description: "Cliente ve: 'Nuestro equipo lo está revisando'" });
                          await fetchJobs();
                        } catch (err: any) {
                          toast({ title: "Error", description: err.message, variant: "destructive" });
                        } finally {
                          setActionLoading(p => ({ ...p, [`cancel_${job.id}`]: false }));
                        }
                      }}
                    >
                      {actionLoading[`cancel_${job.id}`] ? <Loader2 className="h-3 w-3 animate-spin" /> : <XCircle className="h-3 w-3" />}
                    </Button>
                    {isExpanded ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
                  </div>
                </div>

                {/* Expanded: logs + repair */}
                {isExpanded && (
                  <div className="border-t border-white/5">
                    {/* Progress bar */}
                    {job.progress > 0 && (
                      <div className="h-1 bg-white/5">
                        <div
                          className="h-full bg-violet-500 transition-all duration-500"
                          style={{ width: `${job.progress}%` }}
                        />
                      </div>
                    )}

                    {/* Live logs */}
                    <div className="p-3 border-b border-white/5">
                      <p className="text-[10px] text-muted-foreground mb-2 font-mono uppercase tracking-wider">Logs en vivo</p>
                      <div className="bg-black/40 rounded-lg p-2 h-40 overflow-y-auto font-mono text-xs space-y-0.5">
                        {jobLogs.length === 0 ? (
                          <span className="text-white/30">Sin logs todavía…</span>
                        ) : (
                          [...jobLogs].reverse().map((log: any, i: number) => (
                            <div key={i} className={`flex gap-2 ${log.level === "error" ? "text-red-400" : log.level === "warn" ? "text-yellow-400" : "text-white/60"}`}>
                              <span className="text-white/20 shrink-0">{format(new Date(log.createdAt), "HH:mm:ss")}</span>
                              <span className={`shrink-0 px-1 rounded text-[9px] uppercase ${log.level === "error" ? "bg-red-500/20 text-red-400" : log.level === "warn" ? "bg-yellow-500/20 text-yellow-400" : "bg-white/5 text-white/40"}`}>{log.agent}</span>
                              <span className="break-all">{log.message}</span>
                            </div>
                          ))
                        )}
                      </div>
                    </div>

                    {/* Recover + AI repair injection */}
                    <div className="p-3 space-y-2">
                      <p className="text-[10px] text-muted-foreground font-mono uppercase tracking-wider flex items-center gap-1">
                        <Zap className="h-3 w-3 text-violet-400" />
                        Acciones de recuperación
                      </p>
                      {/* Borrar todos los jobs fallidos/reviewing de este usuario */}
                      <Button
                        size="sm"
                        variant="outline"
                        className="w-full h-7 text-xs border-red-900/40 text-red-500/70 hover:bg-red-500/10 hover:text-red-400"
                        onClick={async e => {
                          e.stopPropagation();
                          if (!window.confirm(`¿Borrar TODOS los jobs failed/reviewing de ${job.userEmail}? Esta acción no se puede deshacer.`)) return;
                          setActionLoading(p => ({ ...p, [`deljobs_${job.id}`]: true }));
                          try {
                            const d = await apiFetch<any>(`/api/admin/users/${job.userId}/jobs`, {
                              method: "DELETE",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({ statuses: ["failed", "reviewing"] }),
                            });
                            toast({ title: "🗑️ Jobs eliminados", description: `${d.deleted} job(s) de ${job.userEmail} eliminados` });
                            await fetchJobs();
                          } catch (e: any) {
                            toast({ title: "Error", description: e.message, variant: "destructive" });
                          } finally {
                            setActionLoading(p => ({ ...p, [`deljobs_${job.id}`]: false }));
                          }
                        }}
                        disabled={actionLoading[`deljobs_${job.id}`]}
                      >
                        {actionLoading[`deljobs_${job.id}`]
                          ? <><Loader2 className="h-3 w-3 animate-spin mr-1" />Eliminando…</>
                          : `🗑️ Borrar todos los jobs de ${job.userEmail?.split("@")[0]}`
                        }
                      </Button>
                      <div className="grid grid-cols-2 gap-2">
                        <Button
                          size="sm"
                          className="h-8 text-xs bg-emerald-600 hover:bg-emerald-700 text-white"
                          onClick={async () => {
                            setActionLoading(p => ({ ...p, [`recover_${job.id}`]: true }));
                            try {
                              const d = await apiFetch<any>(`/api/admin/jobs/${job.id}/recover`, { method: "POST" });
                              toast({ title: "✅ Recuperando app", description: d.message });
                              await fetchJobs();
                            } catch (e: any) {
                              toast({ title: "Sin código parcial", description: e.message, variant: "destructive" });
                            } finally {
                              setActionLoading(p => ({ ...p, [`recover_${job.id}`]: false }));
                            }
                          }}
                          disabled={actionLoading[`recover_${job.id}`]}
                        >
                          {actionLoading[`recover_${job.id}`]
                            ? <><Loader2 className="h-3 w-3 animate-spin mr-1" />Recuperando…</>
                            : <><RefreshCw className="h-3 w-3 mr-1" />Recuperar y continuar</>
                          }
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-8 text-xs border-red-500/30 text-red-400 hover:bg-red-500/10"
                          onClick={async () => {
                            if (!window.confirm("¿Regenerar desde 0? Se perderá el progreso actual.")) return;
                            setActionLoading(p => ({ ...p, [`regen_${job.id}`]: true }));
                            try {
                              const d = await apiFetch<any>(`/api/admin/users/${job.userId}/generate-app`, {
                                method: "POST",
                                headers: { "Content-Type": "application/json" },
                                body: JSON.stringify({ prompt: job.prompt?.replace(/\[MARIS AI REQUEST LOCALE\][^\n]*\n?/, "").trim() || "" }),
                              });
                              toast({ title: "🔄 Regenerando desde 0", description: d.message });
                              await fetchJobs();
                            } catch (e: any) {
                              toast({ title: "Error", description: e.message, variant: "destructive" });
                            } finally {
                              setActionLoading(p => ({ ...p, [`regen_${job.id}`]: false }));
                            }
                          }}
                          disabled={actionLoading[`regen_${job.id}`]}
                        >
                          {actionLoading[`regen_${job.id}`]
                            ? <><Loader2 className="h-3 w-3 animate-spin mr-1" />Generando…</>
                            : "Regenerar desde 0"
                          }
                        </Button>
                      </div>
                      {/* Vista previa — siempre visible */}
                      <Button
                        size="sm"
                        variant="outline"
                        className="w-full h-8 text-xs border-sky-500/30 text-sky-400 hover:bg-sky-500/10"
                        disabled={actionLoading[`preview_${job.id}`]}
                        onClick={async () => {
                          const currentPreview = previewAppId === `job_${job.id}`;
                          if (currentPreview) { setPreviewAppId(null); return; }
                          if (job.appId) {
                            setPreviewAppId(`job_${job.id}`);
                            return;
                          }
                          setActionLoading(p => ({ ...p, [`preview_${job.id}`]: true }));
                          try {
                            const d = await apiFetch<any>(`/api/admin/users/${job.userId}/apps?limit=1`);
                            const apps = d.apps ?? [];
                            const firstApp = Array.isArray(apps) ? apps[0] : null;
                            if (firstApp?.id || firstApp?._id) {
                              setPreviewAppId(`job_${job.id}`);
                            } else {
                              toast({ title: "Sin app generada", description: "Este usuario aún no tiene ninguna app creada.", variant: "destructive" });
                            }
                          } catch {
                            toast({ title: "No se pudo cargar la vista previa", variant: "destructive" });
                          } finally {
                            setActionLoading(p => ({ ...p, [`preview_${job.id}`]: false }));
                          }
                        }}
                      >
                        {actionLoading[`preview_${job.id}`]
                          ? <><Loader2 className="h-3 w-3 animate-spin mr-1" />Buscando app…</>
                          : previewAppId === `job_${job.id}`
                            ? <><Eye className="h-3 w-3 mr-1" />Cerrar vista previa</>
                            : <><Eye className="h-3 w-3 mr-1" />Vista previa de la app generada</>
                        }
                      </Button>
                      {/* Panel de vista previa — solo para este job */}
                      {previewAppId === `job_${job.id}` && (job.appId) && (
                        <div className="rounded-lg border border-sky-500/20 overflow-hidden">
                          <div className="flex items-center justify-between px-3 py-1.5 bg-sky-500/10 border-b border-sky-500/20">
                            <span className="text-[10px] text-sky-400 font-mono truncate max-w-[200px]">
                              {job.userEmail}
                            </span>
                            <a
                              href={`/api/admin/apps/${job.appId}/preview`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-[10px] text-sky-400 hover:text-sky-300 underline shrink-0 ml-2"
                            >
                              Abrir en pestaña ↗
                            </a>
                          </div>
                          <iframe
                            src={`/api/admin/apps/${job.appId}/preview`}
                            className="w-full bg-white"
                            style={{ height: 480, border: "none" }}
                            title={`Preview ${job.userEmail}`}
                            sandbox="allow-scripts allow-same-origin allow-forms"
                          />
                        </div>
                      )}
                      <p className="text-[10px] text-muted-foreground font-mono uppercase tracking-wider flex items-center gap-1 pt-1">
                        <Zap className="h-3 w-3 text-violet-400" />
                        O inyecta instrucción específica
                      </p>
                      <div className="flex gap-2">
                        <Input
                          placeholder="Ej: Completa las páginas de reservas que faltan"
                          value={repairPrompt[job.id] ?? ""}
                          onChange={e => setRepairPrompt(p => ({ ...p, [job.id]: e.target.value }))}
                          className="text-xs h-8 bg-black/20"
                          onKeyDown={e => e.key === "Enter" && injectRepair(job.id, job.userId)}
                        />
                        <Button
                          size="sm"
                          className="h-8 shrink-0 bg-violet-600 hover:bg-violet-700 text-white text-xs px-3"
                          onClick={() => injectRepair(job.id, job.userId)}
                          disabled={actionLoading[`repair_${job.id}`]}
                        >
                          {actionLoading[`repair_${job.id}`]
                            ? <Loader2 className="h-3 w-3 animate-spin" />
                            : <><Zap className="h-3 w-3 mr-1" />Aplicar</>
                          }
                        </Button>
                      </div>
                      <div className="flex gap-1 flex-wrap">
                        {[
                          "Completa las páginas que faltan",
                          "Genera solo la landing page sin backend",
                          "Simplifica la app a las funciones básicas",
                          "Corrige errores de TypeScript del frontend",
                        ].map(s => (
                          <button
                            key={s}
                            className="text-[10px] px-2 py-1 rounded border border-violet-500/20 text-violet-400 hover:bg-violet-500/10 transition-colors"
                            onClick={() => setRepairPrompt(p => ({ ...p, [job.id]: s }))}
                          >
                            {s}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function GenerateForUserPanel() {
  const { toast } = useToast();
  const [email, setEmail] = useState("");
  const [prompt, setPrompt] = useState("");
  const [loading, setLoading] = useState(false);
  const [foundUser, setFoundUser] = useState<{ id: string; email: string } | null>(null);
  const [searching, setSearching] = useState(false);

  const searchUser = async () => {
    if (!email.trim()) return;
    setSearching(true);
    setFoundUser(null);
    try {
      const d = await apiFetch<any>(`/api/admin/users/search?email=${encodeURIComponent(email.trim())}`);
      setFoundUser({ id: d.id, email: d.email });
    } catch (e: any) {
      toast({ title: "Usuario no encontrado", description: e?.message ?? "No existe ninguna cuenta con ese email.", variant: "destructive" });
    } finally {
      setSearching(false);
    }
  };

  const generateApp = async () => {
    if (!foundUser) return;
    setLoading(true);
    try {
      const d = await apiFetch<any>(`/api/admin/users/${foundUser.id}/generate-app`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: prompt.trim() || "" }),
      });
      toast({ title: "✅ Landing page en cola", description: d.message ?? `Generando para ${foundUser.email}` });
      setFoundUser(null);
      setEmail("");
      setPrompt("");
    } catch (e: any) {
      toast({ title: "Error", description: e?.message ?? "No se pudo generar la app", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <Input
          placeholder="email del usuario (ej: cliente@gmail.com)"
          value={email}
          onChange={e => setEmail(e.target.value)}
          onKeyDown={e => e.key === "Enter" && searchUser()}
          className="text-sm h-8"
        />
        <Button size="sm" variant="outline" onClick={searchUser} disabled={searching} className="h-8 shrink-0">
          {searching ? <Loader2 className="h-3 w-3 animate-spin" /> : <Search className="h-3 w-3" />}
        </Button>
      </div>
      {foundUser && (
        <div className="rounded-lg border border-purple-500/30 bg-purple-500/5 p-3 space-y-3">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-purple-400" />
            <span className="text-sm font-medium text-purple-300">{foundUser.email}</span>
            <span className="text-xs text-muted-foreground font-mono">{foundUser.id.slice(0, 12)}…</span>
          </div>
          <Input
            placeholder="Prompt personalizado (opcional — deja vacío para landing page por defecto)"
            value={prompt}
            onChange={e => setPrompt(e.target.value)}
            className="text-xs h-8"
          />
          <Button
            size="sm"
            onClick={generateApp}
            disabled={loading}
            className="w-full h-8 bg-purple-600 hover:bg-purple-700 text-white text-xs"
          >
            {loading ? <><Loader2 className="h-3 w-3 animate-spin mr-2" />Generando…</> : <><Zap className="h-3 w-3 mr-2" />Generar landing page para este usuario</>}
          </Button>
        </div>
      )}
    </div>
  );
}

export default function AdminDashboardPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [, setLocation] = useLocation();
  const [smokeResult, setSmokeResult] = useState<E2BSmokeResponse | null>(null);
  const [smokeRunning, setSmokeRunning] = useState(false);
  const [expandedJob, setExpandedJob] = useState<string | null>(null);
  const [jobFilter, setJobFilter] = useState<"all" | "failed" | "running" | "queued">("all");
  const [jobSearch, setJobSearch] = useState("");
  const [autoRefresh, setAutoRefresh] = useState(true);

  const { data, isLoading, isFetching: metricsFetching, error, dataUpdatedAt, refetch } = useQuery({
    queryKey: ["admin", "metrics"],
    queryFn: fetchMetrics,
    refetchInterval: autoRefresh ? 30_000 : false,
    refetchOnWindowFocus: true,
  });

  const { data: jobsData, isLoading: jobsLoading, isFetching: jobsFetching, refetch: refetchJobs } = useListAdminJobs({
    query: {
      refetchInterval: autoRefresh ? 15_000 : false,
    },
  });

  const retryJob = useRetryAdminJob({
    onSuccess: () => {
      toast({ title: "Job reintentado", description: "El job ha sido re-encolado correctamente." });
      queryClient.invalidateQueries({ queryKey: ["admin", "jobs"] });
    },
    onError: (err: any) => {
      toast({ title: "Error al reintentar", description: err?.message ?? "Error desconocido", variant: "destructive" });
    },
  });

  const e2bToggle = useMutation({
    mutationFn: toggleE2B,
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ["admin", "metrics"] });
      toast({
        title: res.effective ? "E2B activado" : "E2B desactivado",
        description: res.effective
          ? "Cada generación verificará el bundle con un build real en microVM."
          : "El pipeline ya no llamará a E2B.",
      });
    },
    onError: (err) => {
      toast({ title: "Error al cambiar E2B", description: err instanceof Error ? err.message : String(err), variant: "destructive" });
    },
  });

  const filteredJobs = (jobsData?.jobs ?? []).filter((job: any) => {
    if (jobFilter !== "all" && job.status !== jobFilter) return false;
    if (jobSearch && !job.userEmail?.toLowerCase().includes(jobSearch.toLowerCase()) && !job.prompt?.toLowerCase().includes(jobSearch.toLowerCase())) return false;
    return true;
  });

  const successRate = data?.jobs24h.successRate ?? 0;
  const failRate = 100 - successRate;

  // Chart data
  const jobs7dChart = (data?.jobs7dChart ?? []).map((d: any) => ({
    ...d,
    label: d.date ? format(parseISO(d.date), "dd MMM", { locale: es }) : d.date,
  }));
  const credits7dChart = (data?.credits7dChart ?? []).map((d: any) => ({
    ...d,
    label: d.date ? format(parseISO(d.date), "dd MMM", { locale: es }) : d.date,
  }));
  const jobStatusPie = [
    { name: "Completados", value: data?.jobs24h?.succeeded ?? 0, color: "#10b981" },
    { name: "Fallidos", value: data?.jobs24h?.failed ?? 0, color: "#ef4444" },
    { name: "En cola", value: jobsData?.queued ?? 0, color: "#f59e0b" },
    { name: "Ejecutando", value: jobsData?.running ?? 0, color: "#0ea5e9" },
  ].filter(d => d.value > 0);

  const CustomTooltip = ({ active, payload, label }: any) => {
    if (!active || !payload?.length) return null;
    return (
      <div className="bg-[#16161e] border border-white/10 rounded-lg p-3 shadow-xl text-xs">
        <p className="text-muted-foreground mb-1 font-medium">{label}</p>
        {payload.map((p: any, i: number) => (
          <div key={i} className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full" style={{ background: p.color }} />
            <span className="text-white/70">{p.name}:</span>
            <span className="font-bold text-white">{p.value}</span>
          </div>
        ))}
      </div>
    );
  };

  return (
    <Layout>
      <div className="container mx-auto px-4 py-8 space-y-6 max-w-screen-2xl">
        {/* Header */}
        <header className="flex items-center justify-between flex-wrap gap-4">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="icon" className="rounded-full hover:bg-white/10" onClick={() => window.history.back()}>
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <div>
              <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
                <BarChart3 className="h-6 w-6 text-primary" />
                Panel de métricas
              </h1>
              <p className="text-xs text-muted-foreground mt-0.5">
                Monitorización en tiempo real · Se actualiza cada {autoRefresh ? "30s" : "manual"}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span>Auto-refresh</span>
              <Switch checked={autoRefresh} onCheckedChange={setAutoRefresh} />
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={async () => {
                await Promise.all([refetch(), refetchJobs()]);
              }}
              disabled={metricsFetching || jobsFetching}
              className="gap-2"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${(metricsFetching || jobsFetching) ? "animate-spin" : ""}`} />
              {(metricsFetching || jobsFetching) ? "Actualizando…" : "Actualizar"}
            </Button>
            {dataUpdatedAt > 0 && (
              <Badge variant="outline" className="gap-1 text-xs">
                <Clock className="h-3 w-3" />
                {new Date(dataUpdatedAt).toLocaleTimeString("es-ES")}
              </Badge>
            )}
          </div>
        </header>

        {error && (
          <Card className="border-destructive/50 bg-destructive/5">
            <CardContent className="pt-4 text-sm text-destructive flex items-center gap-2">
              <AlertCircle className="h-4 w-4" />
              No se han podido cargar las métricas: {(error as Error).message}
            </CardContent>
          </Card>
        )}

        {isLoading || !data ? (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-28" />)}
          </div>
        ) : (
          <>
            {/* KPI Row 1 */}
            <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <MetricCard
                icon={<Activity className="h-4 w-4 text-blue-400" />}
                title="Generaciones (24h)"
                value={data.jobs24h.total.toString()}
                hint={data.jobs24h.successRate !== null ? `${data.jobs24h.successRate}% éxito` : "Sin datos"}
                trend={data.jobs24h.total > 0 ? "up" : "neutral"}
                color="blue"
              />
              <MetricCard
                icon={<CheckCircle2 className="h-4 w-4 text-emerald-400" />}
                title="Generaciones OK (24h)"
                value={data.jobs24h.succeeded.toString()}
                hint={`Tiempo medio: ${formatDuration(data.jobs24h.avgDurationMs)}`}
                trend="up"
                color="emerald"
              />
              <MetricCard
                icon={<AlertTriangle className="h-4 w-4 text-red-400" />}
                title="Generaciones falladas (24h)"
                value={data.jobs24h.failed.toString()}
                hint={data.topFailingPhases[0] ? `Fase crítica: ${data.topFailingPhases[0].phase}` : "Sin fallos"}
                trend={data.jobs24h.failed > 0 ? "down" : "neutral"}
                color="red"
              />
              <MetricCard
                icon={<Globe className="h-4 w-4 text-sky-400" />}
                title="Apps publicadas"
                value={data.publishedApps.total.toString()}
                hint={`Hoy: ${data.publishedApps.today} nuevas`}
                trend="up"
                color="sky"
              />
            </section>

            {/* KPI Row 2 */}
            <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <MetricCard
                icon={<CreditCard className="h-4 w-4 text-violet-400" />}
                title="Créditos hoy"
                value={data.credits.today.toLocaleString("es-ES")}
                hint="Consumidos en las últimas 24h"
                color="violet"
              />
              <MetricCard
                icon={<CreditCard className="h-4 w-4 text-violet-400" />}
                title="Créditos este mes"
                value={data.credits.month > 1_000_000 
                  ? <span className="text-red-400 flex items-center gap-2">
                      {data.credits.month.toLocaleString("es-ES")}
                      <button
                        className="text-[10px] px-2 py-0.5 rounded bg-red-500/20 border border-red-500/30 text-red-300 hover:bg-red-500/30 transition-colors"
                        onClick={async () => {
                          if (!window.confirm("¿Eliminar transacciones corruptas del mes? Esto limpiará el contador.")) return;
                          try {
                            const r = await apiFetch<any>("/api/admin/metrics/reset-monthly-credits", { method: "POST" });
                            alert(r.message);
                            refetch?.();
                          } catch (e: any) { alert("Error: " + e.message); }
                        }}
                      >
                        🧹 Limpiar
                      </button>
                    </span>
                  : data.credits.month.toLocaleString("es-ES")
                }
                hint="Consumidos en el mes actual"
                color="violet"
              />
              <MetricCard
                icon={<Server className="h-4 w-4 text-orange-400" />}
                title="Jobs en cola"
                value={(jobsData?.queued ?? 0).toString()}
                hint={`${jobsData?.running ?? 0} en ejecución ahora`}
                trend={(jobsData?.queued ?? 0) > 5 ? "down" : "neutral"}
                color="orange"
              />
              <MetricCard
                icon={<Users className="h-4 w-4 text-pink-400" />}
                title="Tasa de éxito"
                value={`${successRate ?? 0}%`}
                hint={`${failRate ?? 0}% de fallos en 24h`}
                trend={(successRate ?? 0) >= 80 ? "up" : "down"}
                color={successRate >= 80 ? "emerald" : "red"}
              />
            </section>

            {/* Main content tabs */}
            <Tabs defaultValue="live" className="space-y-4">
              <TabsList className="bg-black/20 border border-white/10">
                <TabsTrigger value="live" className="gap-2">
                  <Activity className="h-3.5 w-3.5 text-emerald-400" />
                  En vivo
                  {(jobsData?.jobs?.filter((j: any) => j.status === "running").length ?? 0) > 0 && (
                    <span className="ml-1 px-1.5 py-0.5 rounded-full bg-emerald-500 text-white text-[10px] font-bold animate-pulse">
                      {jobsData?.jobs?.filter((j: any) => j.status === "running").length}
                    </span>
                  )}
                </TabsTrigger>
                <TabsTrigger value="charts" className="gap-2">
                  <BarChart3 className="h-3.5 w-3.5" />
                  Gráficas
                </TabsTrigger>
                <TabsTrigger value="jobs" className="gap-2">
                  <Terminal className="h-3.5 w-3.5" />
                  Jobs & Errores
                  {(jobsData?.failedLast24h ?? 0) > 0 && (
                    <span className="ml-1 px-1.5 py-0.5 rounded-full bg-red-500 text-white text-[10px] font-bold">
                      {jobsData?.failedLast24h}
                    </span>
                  )}
                </TabsTrigger>
                <TabsTrigger value="phases" className="gap-2">
                  <Bug className="h-3.5 w-3.5" />
                  Fases con fallos
                </TabsTrigger>
                <TabsTrigger value="users" className="gap-2">
                  <Users className="h-3.5 w-3.5" />
                  Top usuarios
                </TabsTrigger>
                <TabsTrigger value="system" className="gap-2">
                  <Cpu className="h-3.5 w-3.5" />
                  Sistema
                </TabsTrigger>
              </TabsList>

              {/* LIVE MONITOR TAB */}
              <TabsContent value="live" className="space-y-4">
                <LiveMonitorPanel />
              </TabsContent>

              {/* CHARTS TAB */}
              <TabsContent value="charts" className="space-y-4">
                <div className="grid md:grid-cols-2 gap-4">
                  {/* Jobs 7-day area chart */}
                  <Card className="bg-card/40 border-white/5">
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm font-medium flex items-center gap-2">
                        <Activity className="h-4 w-4 text-violet-400" />
                        Jobs últimos 7 días
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      {jobs7dChart.length === 0 ? (
                        <div className="h-48 flex items-center justify-center text-muted-foreground text-sm">Sin datos históricos aún</div>
                      ) : (
                        <ResponsiveContainer width="100%" height={200}>
                          <AreaChart data={jobs7dChart} margin={{ top: 5, right: 5, bottom: 0, left: -20 }}>
                            <defs>
                              <linearGradient id="gradSucceeded" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%" stopColor="#10b981" stopOpacity={0.3} />
                                <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                              </linearGradient>
                              <linearGradient id="gradFailed" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%" stopColor="#ef4444" stopOpacity={0.3} />
                                <stop offset="95%" stopColor="#ef4444" stopOpacity={0} />
                              </linearGradient>
                            </defs>
                            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                            <XAxis dataKey="label" tick={{ fontSize: 10, fill: "#64748b" }} axisLine={false} tickLine={false} />
                            <YAxis tick={{ fontSize: 10, fill: "#64748b" }} axisLine={false} tickLine={false} />
                            <Tooltip content={<CustomTooltip />} />
                            <Area type="monotone" dataKey="succeeded" name="Completados" stroke="#10b981" fill="url(#gradSucceeded)" strokeWidth={2} dot={false} />
                            <Area type="monotone" dataKey="failed" name="Fallidos" stroke="#ef4444" fill="url(#gradFailed)" strokeWidth={2} dot={false} />
                          </AreaChart>
                        </ResponsiveContainer>
                      )}
                    </CardContent>
                  </Card>

                  {/* Credits 7-day bar chart */}
                  <Card className="bg-card/40 border-white/5">
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm font-medium flex items-center gap-2">
                        <CreditCard className="h-4 w-4 text-pink-400" />
                        Créditos consumidos (7 días)
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      {credits7dChart.length === 0 ? (
                        <div className="h-48 flex items-center justify-center text-muted-foreground text-sm">Sin datos históricos aún</div>
                      ) : (
                        <ResponsiveContainer width="100%" height={200}>
                          <BarChart data={credits7dChart} margin={{ top: 5, right: 5, bottom: 0, left: -20 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                            <XAxis dataKey="label" tick={{ fontSize: 10, fill: "#64748b" }} axisLine={false} tickLine={false} />
                            <YAxis tick={{ fontSize: 10, fill: "#64748b" }} axisLine={false} tickLine={false} />
                            <Tooltip content={<CustomTooltip />} />
                            <Bar dataKey="credits" name="Créditos" fill="#7c3aed" radius={[4, 4, 0, 0]} />
                          </BarChart>
                        </ResponsiveContainer>
                      )}
                    </CardContent>
                  </Card>
                </div>

                <div className="grid md:grid-cols-3 gap-4">
                  {/* Pie chart job status */}
                  <Card className="bg-card/40 border-white/5">
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm font-medium flex items-center gap-2">
                        <Cpu className="h-4 w-4 text-sky-400" />
                        Estado de jobs (24h)
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      {jobStatusPie.length === 0 ? (
                        <div className="h-40 flex items-center justify-center text-muted-foreground text-sm">Sin jobs en 24h</div>
                      ) : (
                        <ResponsiveContainer width="100%" height={160}>
                          <PieChart>
                            <Pie data={jobStatusPie} cx="50%" cy="50%" innerRadius={35} outerRadius={60} paddingAngle={3} dataKey="value">
                              {jobStatusPie.map((entry, index) => (
                                <Cell key={index} fill={entry.color} />
                              ))}
                            </Pie>
                            <Tooltip contentStyle={{ background: "#16161e", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, fontSize: 12 }} />
                            <Legend iconSize={8} wrapperStyle={{ fontSize: 11 }} />
                          </PieChart>
                        </ResponsiveContainer>
                      )}
                    </CardContent>
                  </Card>

                  {/* Top failing phases bar */}
                  <Card className="bg-card/40 border-white/5">
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm font-medium flex items-center gap-2">
                        <AlertTriangle className="h-4 w-4 text-red-400" />
                        Fases con más errores (24h)
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      {data.topFailingPhases.length === 0 ? (
                        <div className="h-40 flex items-center justify-center text-emerald-400 text-sm gap-2">
                          <CheckCircle2 className="h-4 w-4" />Sin errores
                        </div>
                      ) : (
                        <ResponsiveContainer width="100%" height={160}>
                          <BarChart
                            data={data.topFailingPhases.map((p) => ({ phase: p.phase.slice(0, 10), errores: p.count }))}
                            layout="vertical"
                            margin={{ top: 0, right: 10, bottom: 0, left: 5 }}
                          >
                            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" horizontal={false} />
                            <XAxis type="number" tick={{ fontSize: 10, fill: "#64748b" }} axisLine={false} tickLine={false} />
                            <YAxis type="category" dataKey="phase" tick={{ fontSize: 10, fill: "#94a3b8" }} axisLine={false} tickLine={false} width={70} />
                            <Tooltip content={<CustomTooltip />} />
                            <Bar dataKey="errores" fill="#ef4444" radius={[0, 4, 4, 0]} />
                          </BarChart>
                        </ResponsiveContainer>
                      )}
                    </CardContent>
                  </Card>

                  {/* System health summary */}
                  <Card className="bg-card/40 border-white/5">
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm font-medium flex items-center gap-2">
                        <Shield className="h-4 w-4 text-violet-400" />
                        Salud del sistema
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      {[
                        { label: "Tasa de éxito 24h", value: `${successRate}%`, ok: successRate >= 80, bar: successRate },
                        { label: "Jobs completados", value: String(data.jobs24h.succeeded), ok: true, bar: 100 },
                        { label: "Jobs fallidos", value: String(data.jobs24h.failed), ok: data.jobs24h.failed === 0, bar: data.jobs24h.total > 0 ? (100 - successRate) : 0 },
                        { label: "Base de datos", value: "Operativa", ok: true, bar: 100 },
                        { label: "E2B Sandbox", value: data.e2b?.effective ? "Activo" : "Inactivo", ok: data.e2b?.effective ?? false, bar: data.e2b?.effective ? 100 : 0 },
                      ].map((item, i) => (
                        <div key={i} className="flex items-center justify-between text-xs">
                          <span className="text-white/60">{item.label}</span>
                          <span className={`font-bold ${item.ok ? "text-emerald-400" : "text-red-400"}`}>{item.value}</span>
                        </div>
                      ))}
                    </CardContent>
                  </Card>
                </div>
              </TabsContent>

              {/* JOBS TAB */}
              <TabsContent value="jobs" className="space-y-4">
                <Card className="bg-card/40 border-white/5">
                  <CardHeader className="pb-3">
                    <div className="flex items-center justify-between flex-wrap gap-3">
                      <CardTitle className="text-base flex items-center gap-2">
                        <Terminal className="h-4 w-4 text-muted-foreground" />
                        Cola de generación
                        <Badge variant="outline" className="text-xs ml-1">
                          {jobsData?.jobs?.length ?? 0} jobs
                        </Badge>
                      </CardTitle>
                      <div className="flex items-center gap-2">
                        <div className="relative">
                          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                          <Input
                            placeholder="Buscar por usuario o prompt…"
                            value={jobSearch}
                            onChange={(e) => setJobSearch(e.target.value)}
                            className="pl-8 h-8 text-xs w-56 bg-black/20 border-white/10"
                          />
                        </div>
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-8 px-2 gap-1.5 text-xs border-white/10 hover:border-white/20"
                          disabled={jobsFetching}
                          onClick={async () => {
                            await refetchJobs();
                            toast({ title: "✅ Jobs actualizados", description: `${jobsData?.jobs?.length ?? 0} jobs cargados.` });
                          }}
                        >
                          <RefreshCw className={`h-3.5 w-3.5 ${jobsFetching ? "animate-spin" : ""}`} />
                          {jobsFetching ? "Cargando…" : "Actualizar jobs"}
                        </Button>
                        <div className="flex items-center gap-1">
                          {(["all", "running", "failed", "queued"] as const).map((f) => (
                            <Button
                              key={f}
                              variant={jobFilter === f ? "default" : "ghost"}
                              size="sm"
                              className="h-7 text-xs px-2"
                              onClick={() => setJobFilter(f)}
                            >
                              {f === "all" ? "Todos" : f === "running" ? "Activos" : f === "failed" ? "Fallados" : "En cola"}
                            </Button>
                          ))}
                        </div>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="p-0">
                    {jobsLoading ? (
                      <div className="p-6 space-y-2">{[1,2,3].map(i => <Skeleton key={i} className="h-12 w-full" />)}</div>
                    ) : filteredJobs.length === 0 ? (
                      <p className="p-6 text-sm text-muted-foreground text-center">No hay jobs que coincidan con los filtros.</p>
                    ) : (
                      <Table>
                        <TableHeader className="bg-black/20">
                          <TableRow className="border-white/5 hover:bg-transparent">
                            <TableHead className="w-8"></TableHead>
                            <TableHead>Usuario</TableHead>
                            <TableHead>Prompt</TableHead>
                            <TableHead>Estado</TableHead>
                            <TableHead>Fase</TableHead>
                            <TableHead>Modelo</TableHead>
                            <TableHead>Reintentos</TableHead>
                            <TableHead>Creado</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {filteredJobs.map((job: any) => (
                            <>
                              <TableRow
                                key={job.id}
                                className={`border-white/5 hover:bg-white/[0.02] cursor-pointer ${job.status === "failed" ? "bg-red-500/5" : ""}`}
                                onClick={() => setExpandedJob(expandedJob === String(job.id) ? null : String(job.id))}
                              >
                                <TableCell>
                                  {expandedJob === String(job.id)
                                    ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                                    : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />}
                                </TableCell>
                                <TableCell className="text-xs font-mono text-muted-foreground max-w-[140px] truncate">
                                  {job.userEmail ?? job.userId?.slice(0, 10)}
                                </TableCell>
                                <TableCell className="text-sm max-w-xs">
                                  <span className="truncate block max-w-[200px]" title={job.prompt}>{job.prompt}</span>
                                  {job.errorMessage && (
                                    <span className="text-red-400 text-xs block truncate max-w-[200px]" title={job.errorMessage}>
                                      ⚠ {job.errorMessage}
                                    </span>
                                  )}
                                </TableCell>
                                <TableCell><StatusBadge status={job.status} /></TableCell>
                                <TableCell className="text-xs font-mono text-muted-foreground">{job.phase}</TableCell>
                                <TableCell className="text-xs text-muted-foreground">{job.coderModel}</TableCell>
                                <TableCell>
                                  {job.retryCount > 0 ? (
                                    <Badge variant="outline" className="text-xs border-yellow-500/30 text-yellow-400">{job.retryCount}x</Badge>
                                  ) : <span className="text-xs text-muted-foreground">—</span>}
                                </TableCell>
                                <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                                  {formatDistanceToNow(new Date(job.createdAt), { addSuffix: true, locale: es })}
                                </TableCell>
                              </TableRow>
                              {expandedJob === String(job.id) && (
                                <TableRow key={`${job.id}-logs`} className="border-white/5 bg-black/30">
                                  <TableCell colSpan={8} className="p-0">
                                    <div className="border-t border-white/5">
                                      <div className="flex items-center gap-2 px-4 py-2 text-xs text-muted-foreground border-b border-white/5">
                                        <Terminal className="h-3 w-3" />
                                        <span className="font-medium">Logs del job #{job.id}</span>
                                        {job.appId && (
                                          <Button
                                            variant="ghost"
                                            size="sm"
                                            className="h-5 text-xs ml-auto gap-1"
                                            onClick={(e) => { e.stopPropagation(); setLocation(`/app/${job.appId}`); }}
                                          >
                                            <Eye className="h-3 w-3" />
                                            Ver app
                                          </Button>
                                        )}
                                      </div>
                                      {job.errorMessage && (
                                        <div className="mx-4 my-2 p-2 rounded bg-red-500/10 border border-red-500/20 text-xs text-red-400">
                                          <span className="font-semibold">Error:</span> {job.errorMessage}
                                        </div>
                                      )}
                                      <JobLogsPanel jobId={String(job.id)} />
                                    </div>
                                  </TableCell>
                                </TableRow>
                              )}
                            </>
                          ))}
                        </TableBody>
                      </Table>
                    )}
                  </CardContent>
                </Card>
              </TabsContent>

              {/* PHASES TAB */}
              <TabsContent value="phases">
                <Card className="bg-card/40 border-white/5">
                  <CardHeader>
                    <CardTitle className="text-base flex items-center gap-2">
                      <Bug className="h-4 w-4 text-muted-foreground" />
                      Fases con más fallos (últimas 24h)
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    {data.topFailingPhases.length === 0 ? (
                      <div className="flex flex-col items-center justify-center py-8 text-muted-foreground gap-2">
                        <CheckCircle2 className="h-8 w-8 text-emerald-500/50" />
                        <p className="text-sm">Ninguna fase ha fallado en las últimas 24 horas.</p>
                      </div>
                    ) : (
                      <div className="space-y-3">
                        {data.topFailingPhases.map((p, i) => {
                          const maxCount = data.topFailingPhases[0].count;
                          const pct = Math.round((p.count / maxCount) * 100);
                          return (
                            <div key={p.phase} className="space-y-1">
                              <div className="flex items-center justify-between text-sm">
                                <div className="flex items-center gap-2">
                                  <span className="text-xs text-muted-foreground w-4">{i + 1}.</span>
                                  <span className="font-mono text-xs bg-white/5 px-2 py-0.5 rounded">{p.phase}</span>
                                </div>
                                <Badge variant="destructive" className="text-xs">{p.count} fallos</Badge>
                              </div>
                              <div className="w-full bg-white/5 rounded-full h-1.5">
                                <div
                                  className="bg-red-500/70 h-1.5 rounded-full transition-all"
                                  style={{ width: `${pct}%` }}
                                />
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </CardContent>
                </Card>
              </TabsContent>

              {/* TOP USERS TAB */}
              <TabsContent value="users">
                <Card className="bg-card/40 border-white/5">
                  <CardHeader>
                    <CardTitle className="text-base flex items-center gap-2">
                      <Users className="h-4 w-4 text-muted-foreground" />
                      Top usuarios por créditos consumidos
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    {data.topUsers.length === 0 ? (
                      <p className="text-sm text-muted-foreground">Sin datos de uso.</p>
                    ) : (
                      <div className="space-y-3">
                        {data.topUsers.map((u, i) => (
                          <div key={u.userId} className="flex items-center gap-3 p-3 rounded-lg bg-white/[0.02] border border-white/5 hover:border-white/10 transition-colors">
                            <span className={`text-lg font-bold w-6 text-center ${i === 0 ? "text-yellow-400" : i === 1 ? "text-white/60" : i === 2 ? "text-orange-400" : "text-white/30"}`}>
                              {i + 1}
                            </span>
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium truncate">{u.email}</p>
                              <p className="text-xs text-muted-foreground font-mono">{u.userId.slice(0, 16)}…</p>
                            </div>
                            <div className="flex items-center gap-2">
                              <div className="text-right">
                                <p className="text-lg font-bold text-primary">{u.creditsUsed}</p>
                                <p className="text-xs text-muted-foreground">créditos</p>
                              </div>
                              <Button
                                size="sm"
                                variant="outline"
                                className="text-xs h-7 px-2 border-purple-500/30 text-purple-400 hover:bg-purple-500/10"
                                onClick={async () => {
                                  try {
                                    const d = await apiFetch<any>(`/api/admin/users/${u.userId}/generate-app`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt: "" }) });
                                    toast({ title: "✅ App en cola", description: d.message ?? "Landing page generándose para " + u.email });
                                  } catch {
                                    toast({ title: "Error", description: "No se pudo generar la app", variant: "destructive" });
                                  }
                                }}
                              >
                                <Zap className="h-3 w-3 mr-1" />
                                Generar
                              </Button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>
              </TabsContent>

              {/* GENERAR APP PARA USUARIO — dentro del tab users */}
              <TabsContent value="users" className="space-y-4 pt-0">
                <Card className="bg-card/40 border-white/5">
                  <CardHeader>
                    <CardTitle className="text-base flex items-center gap-2">
                      <Zap className="h-4 w-4 text-purple-400" />
                      Generar landing page para un usuario
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <GenerateForUserPanel />
                  </CardContent>
                </Card>
              </TabsContent>

              {/* SYSTEM TAB */}
              <TabsContent value="system" className="space-y-4">
                {/* Email Alerts Card */}
                <Card className="bg-card/40 border-white/5">
                  <CardHeader>
                    <CardTitle className="text-base flex items-center gap-2">
                      <span className="text-lg">📧</span>
                      Alertas por email al admin
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="text-sm text-muted-foreground space-y-1">
                      <p>Recibes email automático en estos eventos:</p>
                      <ul className="list-none space-y-1 mt-2">
                        {[
                          ["🔴", "Job fallido 2+ veces seguidas", "Urgente"],
                          ["🔴", "Pago o suscripción fallida en Stripe", "Urgente"],
                          ["🔴", "Error en webhook de Stripe", "Urgente"],
                          ["🎫", "Nuevo ticket de soporte", "Aviso"],
                        ].map(([emoji, desc, level]) => (
                          <li key={desc} className="flex items-center gap-2 text-xs">
                            <span>{emoji}</span>
                            <span className="text-white/70">{desc}</span>
                            <span className="text-white/30">— {level}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                    <div className="flex items-center gap-3 pt-2 flex-wrap">
                      <div className="flex gap-1 flex-wrap">
                        {["soportemarisai@gmail.com", "rrhh.milchollos@gmail.com"].map(email => (
                          <span key={email} className="text-[11px] px-2 py-0.5 rounded-full bg-violet-500/20 border border-violet-500/30 text-violet-300">{email}</span>
                        ))}
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 text-xs border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/10 ml-auto"
                        onClick={async () => {
                          try {
                            const d = await apiFetch<any>("/api/admin/test-email-alert", { method: "POST" });
                            toast({ title: "📧 Email de prueba enviado", description: d.message });
                          } catch (e: any) {
                            toast({ title: "Error", description: e.message + " — ¿RESEND_API_KEY configurada en Railway?", variant: "destructive" });
                          }
                        }}
                      >
                        📧 Enviar email de prueba
                      </Button>
                    </div>
                  </CardContent>
                </Card>
                <Card className="bg-card/40 border-white/5">
                  <CardHeader>
                    <CardTitle className="text-base flex items-center gap-2">
                      <Server className="h-4 w-4 text-muted-foreground" />
                      Validación E2B (build real en microVM)
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="flex items-start justify-between gap-4">
                      <div className="space-y-1 flex-1">
                        <p className="text-sm text-muted-foreground">
                          Tras la validación in-memory, el pipeline arranca un sandbox Linux y ejecuta{" "}
                          <code className="text-xs bg-muted px-1 rounded">npm install && npm run build</code>{" "}
                          para detectar paquetes inexistentes, errores de Vite y otros fallos que el AST no ve.
                          Si falla, intenta una ronda extra de auto-reparación usando el error real.
                        </p>
                        <p className="text-xs text-muted-foreground">
                          Coste: ~30-90 s extra por generación + créditos E2B. Recomendado para producción de pago.
                        </p>
                        <div className="flex items-center gap-2 pt-2">
                          <Badge variant={data.e2b?.configured ? "secondary" : "outline"} className="text-xs">
                            {data.e2b?.configured ? "✓ API key OK" : "✗ Falta E2B_API_KEY"}
                          </Badge>
                          <Badge variant={data.e2b?.effective ? "default" : "outline"} className="text-xs">
                            {data.e2b?.effective ? "Activo en pipeline" : "Inactivo en pipeline"}
                          </Badge>
                        </div>
                      </div>
                      <div className="flex flex-col items-end gap-3 shrink-0">
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-muted-foreground">Activar</span>
                          <Switch
                            checked={Boolean(data.e2b?.validateOnGenerate)}
                            disabled={!data.e2b?.configured || e2bToggle.isPending}
                            onCheckedChange={(checked) => e2bToggle.mutate(checked)}
                          />
                        </div>
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={smokeRunning}
                          onClick={async () => {
                            setSmokeRunning(true);
                            setSmokeResult(null);
                            try {
                              const res = await runE2BSmoke();
                              setSmokeResult(res);
                            } catch (err) {
                              setSmokeResult({ ok: false, durationMs: 0, output: "", reason: err instanceof Error ? err.message : String(err) });
                            } finally {
                              setSmokeRunning(false);
                            }
                          }}
                          className="gap-2"
                        >
                          {smokeRunning ? <><Loader2 className="h-3 w-3 animate-spin" />Probando…</> : <><Zap className="h-3 w-3" />Smoke test</>}
                        </Button>
                      </div>
                    </div>
                    {smokeResult && (
                      <div className={`text-xs rounded-lg border px-3 py-2 ${smokeResult.ok ? "border-emerald-500/40 bg-emerald-500/10" : "border-red-500/40 bg-red-500/10"}`}>
                        <div className="font-medium">
                          {smokeResult.ok ? `✓ Smoke OK · ${smokeResult.durationMs} ms` : `✗ Smoke falló${smokeResult.reason ? ` · ${smokeResult.reason}` : ""}`}
                        </div>
                        {smokeResult.output && <pre className="mt-1 whitespace-pre-wrap text-muted-foreground">{smokeResult.output}</pre>}
                      </div>
                    )}
                  </CardContent>
                </Card>

                {/* System Health */}
                <div className="grid gap-4 md:grid-cols-3">
                  <Card className="bg-card/40 border-white/5">
                    <CardContent className="pt-4">
                      <div className="flex items-center gap-3">
                        <div className="p-2 rounded-lg bg-emerald-500/10">
                          <Database className="h-5 w-5 text-emerald-400" />
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground">Base de datos</p>
                          <p className="text-sm font-medium text-emerald-400">Operativa</p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                  <Card className="bg-card/40 border-white/5">
                    <CardContent className="pt-4">
                      <div className="flex items-center gap-3">
                        <div className="p-2 rounded-lg bg-blue-500/10">
                          <Zap className="h-5 w-5 text-blue-400" />
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground">Pipeline de agentes</p>
                          <p className="text-sm font-medium text-blue-400">{(jobsData?.running ?? 0) > 0 ? `${jobsData?.running} activos` : "En espera"}</p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                  <Card className="bg-card/40 border-white/5">
                    <CardContent className="pt-4">
                      <div className="flex items-center gap-3">
                        <div className="p-2 rounded-lg bg-violet-500/10">
                          <Shield className="h-5 w-5 text-violet-400" />
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground">E2B Sandbox</p>
                          <p className={`text-sm font-medium ${data.e2b?.effective ? "text-emerald-400" : "text-muted-foreground"}`}>
                            {data.e2b?.effective ? "Activo" : data.e2b?.configured ? "Configurado (inactivo)" : "Sin configurar"}
                          </p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                </div>
              </TabsContent>
            </Tabs>
          </>
        )}
      </div>
    </Layout>
  );
}

function MetricCard({
  icon,
  title,
  value,
  hint,
  trend,
  color = "white",
}: {
  icon: React.ReactNode;
  title: string;
  value: string;
  hint: string;
  trend?: "up" | "down" | "neutral";
  color?: string;
}) {
  const colorMap: Record<string, string> = {
    blue: "from-blue-500/10 to-transparent border-blue-500/20",
    emerald: "from-emerald-500/10 to-transparent border-emerald-500/20",
    red: "from-red-500/10 to-transparent border-red-500/20",
    sky: "from-sky-500/10 to-transparent border-sky-500/20",
    violet: "from-violet-500/10 to-transparent border-violet-500/20",
    orange: "from-orange-500/10 to-transparent border-orange-500/20",
    pink: "from-pink-500/10 to-transparent border-pink-500/20",
    white: "from-white/5 to-transparent border-white/10",
  };

  return (
    <Card className={`bg-gradient-to-br ${colorMap[color] ?? colorMap.white} border`}>
      <CardHeader className="pb-2">
        <CardTitle className="text-xs font-medium text-muted-foreground flex items-center justify-between">
          <span className="flex items-center gap-1.5">{icon}{title}</span>
          {trend === "up" && <TrendingUp className="h-3 w-3 text-emerald-400" />}
          {trend === "down" && <TrendingDown className="h-3 w-3 text-red-400" />}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="text-3xl font-bold tracking-tight">{value}</div>
        <p className="text-xs text-muted-foreground mt-1">{hint}</p>
      </CardContent>
    </Card>
  );
}
