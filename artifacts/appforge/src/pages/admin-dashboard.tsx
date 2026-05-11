/**
 * artifacts/appforge/src/pages/admin-dashboard.tsx
 * Estructura de datos adaptada a la respuesta REAL de /api/admin/metrics
 */

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import {
  LayoutDashboard, Users, AppWindow, Coins, ListOrdered, Settings,
  LogOut, Crown, RefreshCw, Trash2, Edit3, ChevronUp, ChevronDown,
  Minus, CheckCircle2, XCircle, Clock, AlertTriangle, Zap, TrendingUp,
  Server, Globe, BarChart3, ShieldCheck, RotateCcw, X, Save, Plus,
  Wifi,
} from "lucide-react";

// ─── Types — estructura REAL del backend ─────────────────────────────────────

interface AdminMetrics {
  generatedAt: string;
  jobs24h: {
    total: number;
    succeeded: number;
    failed: number;
    successRate: number | null;
    avgDurationMs: number;
  };
  topFailingPhases: { phase: string; count: number }[];
  credits: { today: number; month: number };
  topUsers: { userId: string; email: string; creditsUsed: number }[];
  publishedApps: { today: number; total: number };
  server: {
    requests: number;
    errors: number;
    avgDurationMs: number;
  };
  queue: {
    ready: boolean;
    jobs24hByStatus: Record<string, number>;
  };
  redis: { connected: boolean };
  e2b: { configured: boolean; validateOnGenerate: boolean; effective: boolean };
  revenueCentsTotal?: number;
  openTicketsCount?: number;
}

interface AdminUser {
  id: string;
  email: string;
  name: string | null;
  credits: number;
  plan: "free" | "pro" | "team" | "owner";
  status: "active" | "suspended";
  appsCount: number;
  revenueCentsTotal?: number;
  createdAt: string;
  lastActiveAt: string | null;
}

interface AdminApp {
  id: string;
  title: string;
  kind: string;
  userEmail: string;
  status: "generating" | "done" | "error" | "needs_review";
  publicSlug: string | null;
  createdAt: string;
  creditsCost: number;
}

interface AdminJob {
  id: string;
  appId: string;
  appTitle: string;
  userEmail: string;
  state: "created" | "active" | "completed" | "failed" | "cancelled";
  startedOn: string | null;
  completedOn: string | null;
  output: string | null;
}

// ─── API helpers ─────────────────────────────────────────────────────────────

const apiFetch = async <T,>(path: string, init?: RequestInit): Promise<T> => {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    ...init,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(text || `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
};

// ─── Constants ───────────────────────────────────────────────────────────────

const OWNER_EMAIL = "rrhh.milchollos@gmail.com";

const NAV_ITEMS = [
  { id: "overview", label: "Resumen", icon: LayoutDashboard },
  { id: "users", label: "Usuarios", icon: Users },
  { id: "apps", label: "Apps", icon: AppWindow },
  { id: "credits", label: "Créditos", icon: Coins },
  { id: "payments", label: "Pagos", icon: Zap },
  { id: "support", label: "Soporte", icon: ShieldCheck },
  { id: "queue", label: "Cola", icon: ListOrdered },
  { id: "settings", label: "Configuración", icon: Settings },
] as const;

type NavId = (typeof NAV_ITEMS)[number]["id"];

const PLAN_COLORS: Record<AdminUser["plan"], string> = {
  free: "text-slate-400 bg-slate-800/60 border-slate-700",
  pro: "text-emerald-300 bg-emerald-900/40 border-emerald-700",
  team: "text-violet-300 bg-violet-900/40 border-violet-700",
  owner: "text-amber-300 bg-amber-900/40 border-amber-600",
};

const STATUS_COLORS: Record<AdminUser["status"], string> = {
  active: "text-emerald-400 bg-emerald-900/30 border-emerald-700",
  suspended: "text-red-400 bg-red-900/30 border-red-700",
};

const JOB_COLORS: Record<AdminJob["state"], string> = {
  created: "text-slate-400 bg-slate-800/60",
  active: "text-cyan-300 bg-cyan-900/40",
  completed: "text-emerald-300 bg-emerald-900/40",
  failed: "text-red-300 bg-red-900/40",
  cancelled: "text-orange-300 bg-orange-900/40",
};

const APP_STATUS_ICON: Record<AdminApp["status"], React.ReactNode> = {
  generating: <Clock size={14} className="text-cyan-400 animate-spin" />,
  done: <CheckCircle2 size={14} className="text-emerald-400" />,
  error: <XCircle size={14} className="text-red-400" />,
  needs_review: <AlertTriangle size={14} className="text-amber-400" />,
};

// ─── Shared UI ───────────────────────────────────────────────────────────────

const Badge = ({ children, className = "" }: { children: React.ReactNode; className?: string }) => (
  <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-medium border ${className}`}>
    {children}
  </span>
);

const Card = ({ children, className = "" }: { children: React.ReactNode; className?: string }) => (
  <div className={`bg-[#0f1117] border border-[#1e2030] rounded-xl p-4 ${className}`}>
    {children}
  </div>
);

const MetricCard = ({ label, value, sub, icon: Icon, trend, accent = "violet" }: {
  label: string; value: string | number; sub?: string;
  icon: React.ElementType; trend?: "up" | "down" | "neutral";
  accent?: "violet" | "cyan" | "emerald" | "amber";
}) => {
  const accents = {
    violet: "text-violet-400 bg-violet-900/30",
    cyan: "text-cyan-400 bg-cyan-900/30",
    emerald: "text-emerald-400 bg-emerald-900/30",
    amber: "text-amber-400 bg-amber-900/30",
  };
  const TrendIcon = trend === "up" ? ChevronUp : trend === "down" ? ChevronDown : Minus;
  const trendColor = trend === "up" ? "text-emerald-400" : trend === "down" ? "text-red-400" : "text-slate-500";
  return (
    <Card className="flex items-start gap-3">
      <div className={`p-2 rounded-lg ${accents[accent]}`}><Icon size={18} /></div>
      <div className="min-w-0 flex-1">
        <p className="text-xs text-slate-500 mb-0.5">{label}</p>
        <p className="text-2xl font-semibold text-white tracking-tight">{value}</p>
        {sub && (
          <p className={`text-xs mt-0.5 flex items-center gap-1 ${trendColor}`}>
            {trend && <TrendIcon size={11} />}{sub}
          </p>
        )}
      </div>
    </Card>
  );
};

const SectionTitle = ({ children }: { children: React.ReactNode }) => (
  <h2 className="text-sm font-semibold text-slate-300 mb-3 flex items-center gap-2">{children}</h2>
);

const Spinner = () => (
  <div className="flex items-center justify-center py-16">
    <RefreshCw size={22} className="text-violet-400 animate-spin" />
  </div>
);

const EmptyState = ({ message }: { message: string }) => (
  <div className="flex flex-col items-center justify-center py-14 text-slate-600">
    <Server size={32} className="mb-3 opacity-40" />
    <p className="text-sm">{message}</p>
  </div>
);

// ─── Toast ───────────────────────────────────────────────────────────────────

type ToastType = "success" | "error" | "info";
interface ToastItem { id: number; message: string; type: ToastType; }

let _toastId = 0;
let _setToasts: React.Dispatch<React.SetStateAction<ToastItem[]>> | null = null;

const toast = (message: string, type: ToastType = "info") => {
  const id = ++_toastId;
  _setToasts?.((prev) => [...prev, { id, message, type }]);
  setTimeout(() => _setToasts?.((prev) => prev.filter((t) => t.id !== id)), 3500);
};

const ToastContainer = () => {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  _setToasts = setToasts;
  const colors: Record<ToastType, string> = {
    success: "border-emerald-700 text-emerald-300 bg-emerald-950/90",
    error: "border-red-700 text-red-300 bg-red-950/90",
    info: "border-violet-700 text-violet-300 bg-violet-950/90",
  };
  return (
    <div className="fixed bottom-5 right-5 z-50 flex flex-col gap-2">
      {toasts.map((t) => (
        <div key={t.id} className={`flex items-center gap-2 px-4 py-2.5 rounded-lg border text-sm backdrop-blur-sm shadow-xl ${colors[t.type]}`}>
          {t.type === "success" && <CheckCircle2 size={14} />}
          {t.type === "error" && <XCircle size={14} />}
          {t.type === "info" && <Zap size={14} />}
          {t.message}
          <button onClick={() => setToasts((prev) => prev.filter((x) => x.id !== t.id))} className="ml-2 opacity-60 hover:opacity-100">
            <X size={12} />
          </button>
        </div>
      ))}
    </div>
  );
};

// ─── Overview ────────────────────────────────────────────────────────────────

const OverviewSection = () => {
  const { data, isLoading, refetch, isFetching } = useQuery<AdminMetrics>({
    queryKey: ["admin-metrics"],
    queryFn: () => apiFetch("/api/admin/metrics"),
    refetchInterval: 30_000,
  });

  if (isLoading) return <Spinner />;
  if (!data) return <EmptyState message="No se pudieron cargar las métricas" />;

  const fmtMs = (ms: number) =>
    ms >= 60_000 ? `${(ms / 60_000).toFixed(1)}m` : ms >= 1_000 ? `${(ms / 1_000).toFixed(1)}s` : `${Math.round(ms)}ms`;

  const successRate = data.jobs24h.successRate ?? 0;

  return (
    <div className="space-y-5">
      {/* Owner banner */}
      <div className="flex items-center gap-3 bg-gradient-to-r from-amber-950/60 to-violet-950/60 border border-amber-800/50 rounded-xl px-4 py-3">
        <Crown size={18} className="text-amber-400 flex-shrink-0" />
        <div>
          <p className="text-sm font-semibold text-amber-300">Propietario · Maris AI</p>
          <p className="text-xs text-amber-600">{OWNER_EMAIL} · Créditos ∞ · Todos los permisos</p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <Badge className={`${data.queue.ready ? "text-emerald-300 bg-emerald-900/40 border-emerald-700" : "text-red-300 bg-red-900/40 border-red-700"}`}>
            <Wifi size={10} /> {data.queue.ready ? "Cola activa" : "Cola inactiva"}
          </Badge>
          <Badge className={`${data.redis.connected ? "text-cyan-300 bg-cyan-900/40 border-cyan-700" : "text-slate-400 bg-slate-800 border-slate-700"}`}>
            Redis {data.redis.connected ? "✓" : "✗"}
          </Badge>
          <button onClick={() => refetch()} className="p-1.5 rounded-lg text-slate-500 hover:text-violet-400 hover:bg-violet-900/30 transition-colors">
            <RefreshCw size={14} className={isFetching ? "animate-spin" : ""} />
          </button>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3">
        <MetricCard label="Apps publicadas" value={data.publishedApps.total.toLocaleString()} sub={`+${data.publishedApps.today} hoy`} icon={AppWindow} 
          accent="violet" />
        <MetricCard label="Jobs (24h)" value={data.jobs24h.total} sub={`${(successRate * 100).toFixed(0)}% éxito`} icon={BarChart3} 
          trend={successRate > 0.8 ? "up" : "down"} accent="cyan" />
        <MetricCard label="Créditos (mes)" value={data.credits.month.toLocaleString()} sub={`${data.credits.today} hoy`} icon={Coins} 
          accent="amber" />
        <MetricCard label="Ingresos Totales" value={`${((data.revenueCentsTotal || 0) / 100).toFixed(2)}€`} sub="Ventas acumuladas" icon={Zap} 
          accent="emerald" />
        <MetricCard label="Soporte" value={data.openTicketsCount || 0} sub="Tickets abiertos" icon={ShieldCheck} 
          accent="violet" trend={(data.openTicketsCount || 0) > 0 ? "down" : "up"} />
        <MetricCard label="Servidor" value={data.server.requests.toLocaleString()} sub={`${data.server.errors} errores`} icon={Server} 
          trend={data.server.errors === 0 ? "neutral" : "down"} accent="cyan" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <SectionTitle><TrendingUp size={14} className="text-violet-400" /> Pipeline de generación (24h)</SectionTitle>
          <div className="grid grid-cols-3 gap-3 mb-4">
            {[
              { label: "Exitosos", value: data.jobs24h.succeeded, cls: "text-emerald-400" },
              { label: "Fallidos", value: data.jobs24h.failed, cls: "text-red-400" },
              { label: "Tiempo medio", value: fmtMs(data.jobs24h.avgDurationMs), cls: "text-cyan-400" },
            ].map((s) => (
              <div key={s.label} className="text-center bg-[#161820] rounded-lg py-3">
                <p className={`text-xl font-semibold ${s.cls}`}>{s.value}</p>
                <p className="text-xs text-slate-600 mt-0.5">{s.label}</p>
              </div>
            ))}
          </div>
          <div>
            <div className="flex justify-between text-xs text-slate-500 mb-1">
              <span>Tasa de éxito</span><span>{successRate}%</span>
            </div>
            <div className="h-1.5 bg-[#1e2030] rounded-full overflow-hidden">
              <div className="h-full bg-gradient-to-r from-violet-500 to-cyan-400 rounded-full transition-all" style={{ width: `${successRate}%` }} />
            </div>
          </div>
        </Card>

        <Card>
          <SectionTitle><AlertTriangle size={14} className="text-amber-400" /> Fases con más errores</SectionTitle>
          {data.topFailingPhases.length === 0 ? (
            <p className="text-sm text-slate-600 py-4 text-center">Sin errores recientes 🎉</p>
          ) : (
            <div className="space-y-2 mb-4">
              {data.topFailingPhases.map((p, i) => (
                <div key={p.phase} className="flex items-center gap-3">
                  <span className="text-xs text-slate-600 w-4">{i + 1}</span>
                  <div className="flex-1 bg-[#161820] rounded-lg px-3 py-2 flex justify-between">
                    <span className="text-sm text-slate-300 font-mono">{p.phase}</span>
                    <span className="text-sm text-red-400 font-medium">{p.count}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
          <div className="border-t border-[#1e2030] pt-4">
            <SectionTitle><Crown size={13} className="text-amber-400" /> Top usuarios por créditos</SectionTitle>
            <div className="space-y-1.5">
              {data.topUsers.map((u) => (
                <div key={u.userId} className="flex items-center justify-between text-sm">
                  <span className="text-slate-400 truncate max-w-[200px]">{u.email}</span>
                  <span className="text-violet-300 font-medium tabular-nums">{u.creditsUsed.toLocaleString()} cr</span>
                </div>
              ))}
            </div>
          </div>
        </Card>
      </div>

      {/* E2B + Queue status */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {Object.entries(data.queue.jobs24hByStatus).map(([state, count]) => (
          <div key={state} className="bg-[#0f1117] border border-[#1e2030] rounded-xl px-4 py-3 text-center">
            <p className="text-xl font-bold text-white">{count}</p>
            <p className="text-xs text-slate-500 mt-1">{state}</p>
          </div>
        ))}
      </div>
    </div>
  );
};

// ─── Users ───────────────────────────────────────────────────────────────────

const UsersSection = () => {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<AdminUser | null>(null);
  const [editForm, setEditForm] = useState({ credits: 0, plan: "free" as AdminUser["plan"], status: "active" as AdminUser["status"] });
  const [search, setSearch] = useState("");

  const { data: users = [], isLoading } = useQuery<AdminUser[]>({
    queryKey: ["admin-users"],
    queryFn: () => apiFetch("/api/admin/users"),
  });

  const updateMutation = useMutation({
    mutationFn: (vars: { id: string; body: Partial<AdminUser> }) =>
      apiFetch(`/api/admin/users/${vars.id}`, { method: "PATCH", body: JSON.stringify(vars.body) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["admin-users"] }); setEditing(null); toast("Usuario actualizado", "success"); },
    onError: (e: Error) => toast(e.message, "error"),
  });

  const filtered = users.filter((u) =>
    u.email.toLowerCase().includes(search.toLowerCase()) ||
    (u.name ?? "").toLowerCase().includes(search.toLowerCase())
  );

  if (isLoading) return <Spinner />;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar por email o nombre…"
          className="flex-1 bg-[#0f1117] border border-[#1e2030] rounded-lg px-3 py-2 text-sm text-slate-300 placeholder-slate-600 focus:outline-none focus:border-violet-600" />
        <Badge className="text-slate-400 bg-slate-800/60 border-slate-700">{filtered.length} usuarios</Badge>
      </div>
      <Card className="p-0 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[#1e2030]">
              {["Usuario", "Plan", "Créditos", "Apps", "Ingresos", "Estado", "Acciones"].map((h) => (
                <th key={h} className="text-left px-4 py-3 text-xs font-medium text-slate-500 uppercase tracking-wider">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.map((u) => (
              <tr key={u.id} className="border-b border-[#1a1c28] hover:bg-[#161820] transition-colors">
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <div className="w-7 h-7 rounded-full bg-violet-900/60 border border-violet-700 flex items-center justify-center text-xs font-medium text-violet-300">
                      {(u.name ?? u.email)[0].toUpperCase()}
                    </div>
                    <div>
                      <p className="text-slate-200 font-medium leading-none">{u.name ?? "—"}</p>
                      <p className="text-slate-500 text-xs mt-0.5">{u.email}</p>
                    </div>
                    {u.email === OWNER_EMAIL && <Crown size={12} className="text-amber-400" />}
                  </div>
                </td>
                <td className="px-4 py-3"><Badge className={PLAN_COLORS[u.plan] ?? PLAN_COLORS.free}>{u.plan ?? "free"}</Badge></td>
                <td className="px-4 py-3 text-slate-300 tabular-nums">
                  {u.email === OWNER_EMAIL ? <span className="text-amber-400 font-semibold">∞</span> : u.credits.toLocaleString()}
                </td>
                <td className="px-4 py-3 text-slate-400">{u.appsCount}</td>
                <td className="px-4 py-3 text-emerald-400 font-mono text-xs tabular-nums">
                  {((u.revenueCentsTotal || 0) / 100).toFixed(2)}€
                </td>
                <td className="px-4 py-3"><Badge className={STATUS_COLORS[u.status] ?? STATUS_COLORS.active}>{u.status ?? "active"}</Badge></td>
                <td className="px-4 py-3">
                  <button onClick={() => { setEditing(u); setEditForm({ credits: u.credits, plan: u.plan ?? "free", status: u.status ?? "active" }); }}
                    className="p-1.5 rounded-lg text-slate-500 hover:text-violet-400 hover:bg-violet-900/20 transition-colors">
                    <Edit3 size={14} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {filtered.length === 0 && <EmptyState message="No se encontraron usuarios" />}
      </Card>

      {editing && (
        <div className="fixed inset-0 z-40 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <Card className="w-full max-w-sm space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-200">Editar usuario</h3>
              <button onClick={() => setEditing(null)} className="text-slate-500 hover:text-slate-300"><X size={16} /></button>
            </div>
            <p className="text-xs text-slate-500">{editing.email}</p>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-slate-500 block mb-1">Créditos</label>
                <input type="number" value={editForm.credits}
                  onChange={(e) => setEditForm((f) => ({ ...f, credits: Number(e.target.value) }))}
                  className="w-full bg-[#161820] border border-[#1e2030] rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-violet-600" />
              </div>
              <div>
                <label className="text-xs text-slate-500 block mb-1">Plan</label>
                <select value={editForm.plan} onChange={(e) => setEditForm((f) => ({ ...f, plan: e.target.value as AdminUser["plan"] }))}
                  className="w-full bg-[#161820] border border-[#1e2030] rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-violet-600">
                  <option value="free">Free</option>
                  <option value="pro">Pro</option>
                  <option value="team">Team</option>
                  <option value="owner">Owner</option>
                </select>
              </div>
              <div>
                <label className="text-xs text-slate-500 block mb-1">Estado</label>
                <select value={editForm.status} onChange={(e) => setEditForm((f) => ({ ...f, status: e.target.value as AdminUser["status"] }))}
                  className="w-full bg-[#161820] border border-[#1e2030] rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-violet-600">
                  <option value="active">Activo</option>
                  <option value="suspended">Suspendido</option>
                </select>
              </div>
            </div>
            <div className="flex gap-2 pt-2">
              <button onClick={() => updateMutation.mutate({ id: editing.id, body: editForm })} disabled={updateMutation.isPending}
                className="flex-1 flex items-center justify-center gap-2 bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white text-sm font-medium py-2 rounded-lg transition-colors">
                <Save size={14} />{updateMutation.isPending ? "Guardando…" : "Guardar"}
              </button>
              <button onClick={() => setEditing(null)} className="px-4 py-2 border border-[#1e2030] text-slate-400 hover:text-slate-200 rounded-lg text-sm transition-colors">
                Cancelar
              </button>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
};

// ─── Apps ────────────────────────────────────────────────────────────────────

const AppsSection = () => {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");

  const { data: apps = [], isLoading } = useQuery<AdminApp[]>({
    queryKey: ["admin-apps"],
    queryFn: () => apiFetch("/api/admin/apps"),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiFetch(`/api/admin/apps/${id}`, { method: "DELETE" }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["admin-apps"] }); toast("App eliminada", "success"); },
    onError: (e: Error) => toast(e.message, "error"),
  });

  const filtered = apps.filter((a) =>
    a.title.toLowerCase().includes(search.toLowerCase()) ||
    a.userEmail?.toLowerCase().includes(search.toLowerCase())
  );

  if (isLoading) return <Spinner />;

  return (
    <div className="space-y-4">
      <div className="flex gap-3">
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar por título o usuario…"
          className="flex-1 bg-[#0f1117] border border-[#1e2030] rounded-lg px-3 py-2 text-sm text-slate-300 placeholder-slate-600 focus:outline-none focus:border-violet-600" />
        <Badge className="text-slate-400 bg-slate-800/60 border-slate-700">{filtered.length} apps</Badge>
      </div>
      <Card className="p-0 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[#1e2030]">
              {["App", "Tipo", "Usuario", "Estado", "Slug", "Créditos", ""].map((h) => (
                <th key={h} className="text-left px-4 py-3 text-xs font-medium text-slate-500 uppercase tracking-wider">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.map((app) => (
              <tr key={app.id} className="border-b border-[#1a1c28] hover:bg-[#161820] transition-colors">
                <td className="px-4 py-3">
                  <p className="text-slate-200 font-medium">{app.title}</p>
                  <p className="text-slate-600 text-xs font-mono">{app.id.slice(0, 8)}</p>
                </td>
                <td className="px-4 py-3"><Badge className="text-violet-300 bg-violet-900/30 border-violet-700">{app.kind}</Badge></td>
                <td className="px-4 py-3 text-slate-400 text-xs">{app.userEmail}</td>
                <td className="px-4 py-3">
                  <span className="flex items-center gap-1.5">
                    {APP_STATUS_ICON[app.status]}
                    <span className="text-slate-400 text-xs">{app.status}</span>
                  </span>
                </td>
                <td className="px-4 py-3">
                  {app.publicSlug
                    ? <a href={`/p/${app.publicSlug}`} target="_blank" rel="noreferrer" className="text-cyan-400 hover:text-cyan-300 text-xs flex items-center gap-1"><Globe size={11} />{app.publicSlug}</a>
                    : <span className="text-slate-600 text-xs">—</span>}
                </td>
                <td className="px-4 py-3 text-slate-400 tabular-nums">{app.creditsCost}</td>
                <td className="px-4 py-3">
                  <button onClick={() => { if (confirm(`¿Eliminar "${app.title}"?`)) deleteMutation.mutate(app.id); }}
                    className="p-1.5 rounded-lg text-slate-600 hover:text-red-400 hover:bg-red-900/20 transition-colors">
                    <Trash2 size={14} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {filtered.length === 0 && <EmptyState message="No se encontraron apps" />}
      </Card>
    </div>
  );
};

// ─── Credits ─────────────────────────────────────────────────────────────────

const CreditsSection = () => {
  const qc = useQueryClient();
  const { data: users = [], isLoading } = useQuery<AdminUser[]>({
    queryKey: ["admin-users"],
    queryFn: () => apiFetch("/api/admin/users"),
  });
  const [selectedId, setSelectedId] = useState("");
  const [amount, setAmount] = useState("");

  const grantMutation = useMutation({
    mutationFn: () => apiFetch(`/api/admin/users/${selectedId}`, {
      method: "PATCH",
      body: JSON.stringify({ credits: (users.find((u) => u.id === selectedId)?.credits ?? 0) + Number(amount) }),
    }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["admin-users"] }); setAmount(""); toast(`Créditos actualizados (+${amount})`, "success"); },
    onError: (e: Error) => toast(e.message, "error"),
  });

  const sorted = [...users].sort((a, b) => b.credits - a.credits);
  if (isLoading) return <Spinner />;

  return (
    <div className="space-y-4">
      <Card className="flex items-center gap-4">
        <div className="w-12 h-12 rounded-full bg-amber-900/40 border border-amber-700 flex items-center justify-center">
          <Crown size={20} className="text-amber-400" />
        </div>
        <div>
          <p className="text-sm font-semibold text-slate-200">{OWNER_EMAIL}</p>
          <p className="text-xs text-slate-500">Propietario · Maris AI</p>
        </div>
        <div className="ml-auto text-right">
          <p className="text-2xl font-bold text-amber-400">∞</p>
          <p className="text-xs text-slate-600">créditos ilimitados</p>
        </div>
      </Card>
      <Card>
        <SectionTitle><Plus size={14} className="text-cyan-400" /> Ajustar créditos</SectionTitle>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <select value={selectedId} onChange={(e) => setSelectedId(e.target.value)}
            className="bg-[#161820] border border-[#1e2030] rounded-lg px-3 py-2 text-sm text-slate-300 focus:outline-none focus:border-violet-600">
            <option value="">Selecciona usuario…</option>
            {users.filter((u) => u.email !== OWNER_EMAIL).map((u) => (
              <option key={u.id} value={u.id}>{u.email} ({u.credits} cr)</option>
            ))}
          </select>
          <input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="Ej: 100 o -50"
            className="bg-[#161820] border border-[#1e2030] rounded-lg px-3 py-2 text-sm text-slate-300 placeholder-slate-600 focus:outline-none focus:border-violet-600" />
          <button onClick={() => grantMutation.mutate()} disabled={!selectedId || !amount || grantMutation.isPending}
            className="flex items-center justify-center gap-2 bg-violet-600 hover:bg-violet-500 disabled:opacity-40 text-white text-sm font-medium py-2 rounded-lg transition-colors">
            <Coins size={14} />{grantMutation.isPending ? "Aplicando…" : "Aplicar"}
          </button>
        </div>
      </Card>
      <Card>
        <SectionTitle><BarChart3 size={14} className="text-violet-400" /> Ranking de créditos</SectionTitle>
        <div className="space-y-2">
          {sorted.slice(0, 15).map((u, i) => (
            <div key={u.id} className="flex items-center gap-3 text-sm py-1">
              <span className="text-xs text-slate-600 w-5 text-right">{i + 1}</span>
              <div className="flex-1 min-w-0"><p className="text-slate-300 truncate">{u.email}</p></div>
              <Badge className={PLAN_COLORS[u.plan] ?? PLAN_COLORS.free}>{u.plan ?? "free"}</Badge>
              <span className="text-violet-300 font-semibold tabular-nums w-20 text-right">
                {u.email === OWNER_EMAIL ? "∞" : u.credits.toLocaleString()}
              </span>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
};

// ─── Queue ───────────────────────────────────────────────────────────────────

const QueueSection = () => {
  const qc = useQueryClient();
  const { data: jobs = [], isLoading, refetch, isFetching } = useQuery<AdminJob[]>({
    queryKey: ["admin-jobs"],
    queryFn: () => apiFetch("/api/admin/jobs"),
    refetchInterval: 10_000,
  });

  const retryMutation = useMutation({
    mutationFn: (id: string) => apiFetch(`/api/admin/jobs/${id}/retry`, { method: "POST" }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["admin-jobs"] }); toast("Job reencolado", "success"); },
    onError: (e: Error) => toast(e.message, "error"),
  });

  if (isLoading) return <Spinner />;

  const counts = jobs.reduce((acc, j) => ({ ...acc, [j.state]: (acc[j.state as keyof typeof acc] ?? 0) + 1 }),
    { created: 0, active: 0, completed: 0, failed: 0, cancelled: 0 });

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-5 gap-2">
        {(["created", "active", "completed", "failed", "cancelled"] as AdminJob["state"][]).map((state) => (
          <div key={state} className={`rounded-lg px-3 py-2 text-center text-xs font-medium ${JOB_COLORS[state]}`}>
            <div className="text-lg font-bold">{counts[state]}</div>{state}
          </div>
        ))}
      </div>
      <div className="flex justify-end">
        <button onClick={() => refetch()} className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-violet-400 transition-colors">
          <RefreshCw size={12} className={isFetching ? "animate-spin" : ""} />Actualizar
        </button>
      </div>
      <Card className="p-0 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[#1e2030]">
              {["Job ID", "App", "Usuario", "Estado", "Duración", ""].map((h) => (
                <th key={h} className="text-left px-4 py-3 text-xs font-medium text-slate-500 uppercase tracking-wider">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {jobs.map((job) => {
              const dur = job.startedOn && job.completedOn
                ? Math.round((new Date(job.completedOn).getTime() - new Date(job.startedOn).getTime()) / 1000) + "s"
                : "—";
              return (
                <tr key={job.id} className="border-b border-[#1a1c28] hover:bg-[#161820] transition-colors">
                  <td className="px-4 py-3 font-mono text-xs text-slate-500">{job.id.slice(0, 12)}…</td>
                  <td className="px-4 py-3">
                    <p className="text-slate-300">{job.appTitle}</p>
                    <p className="text-xs text-slate-600 font-mono">{job.appId?.slice(0, 8)}</p>
                  </td>
                  <td className="px-4 py-3 text-slate-400 text-xs">{job.userEmail}</td>
                  <td className="px-4 py-3">
                    <Badge className={JOB_COLORS[job.state]}>
                      {job.state === "active" && <RefreshCw size={10} className="animate-spin" />}{job.state}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-slate-500 tabular-nums text-xs">{dur}</td>
                  <td className="px-4 py-3">
                    {job.state === "failed" && (
                      <button onClick={() => retryMutation.mutate(job.id)} disabled={retryMutation.isPending}
                        className="flex items-center gap-1 text-xs text-amber-400 hover:text-amber-300 disabled:opacity-50">
                        <RotateCcw size={12} />Reintentar
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {jobs.length === 0 && <EmptyState message="Cola vacía" />}
      </Card>
    </div>
  );
};

// ─── Payments ────────────────────────────────────────────────────────────────

const PaymentsSection = () => {
  const qc = useQueryClient();
  const { data: txns = [], isLoading } = useQuery<any[]>({
    queryKey: ["admin-transactions"],
    queryFn: () => apiFetch("/api/admin/transactions"),
  });

  const refundMutation = useMutation({
    mutationFn: (vars: { userId: string; amount: number; reason: string }) =>
      apiFetch("/api/admin/refund", { method: "POST", body: JSON.stringify(vars) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["admin-transactions"] }); toast("Reembolso procesado", "success"); },
    onError: (e: Error) => toast(e.message, "error"),
  });

  if (isLoading) return <Spinner />;

  return (
    <div className="space-y-4">
      <Card className="p-0 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[#1e2030]">
              {["Usuario", "Cantidad", "Tipo", "Descripción", "Fecha", "Acciones"].map((h) => (
                <th key={h} className="text-left px-4 py-3 text-xs font-medium text-slate-500 uppercase tracking-wider">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {txns.map((t) => (
              <tr key={t.id} className="border-b border-[#1a1c28] hover:bg-[#161820] transition-colors">
                <td className="px-4 py-3 text-slate-400 text-xs">{t.userEmail}</td>
                <td className={`px-4 py-3 font-mono font-medium ${t.amount > 0 ? "text-emerald-400" : "text-red-400"}`}>
                  {t.amount > 0 ? "+" : ""}{t.amount}
                </td>
                <td className="px-4 py-3"><Badge className="text-slate-400 border-slate-800">{t.kind}</Badge></td>
                <td className="px-4 py-3 text-slate-500 text-xs truncate max-w-[150px]">{t.description}</td>
                <td className="px-4 py-3 text-slate-500 text-xs">{new Date(t.createdAt).toLocaleDateString()}</td>
                <td className="px-4 py-3">
                  {t.kind === "purchase" && (
                    <button onClick={() => {
                      const reason = prompt("Motivo del reembolso:");
                      if (reason) refundMutation.mutate({ userId: t.userId, amount: t.amount, reason });
                    }} className="text-red-400 hover:text-red-300 text-xs font-medium flex items-center gap-1">
                      <RotateCcw size={12} /> Reembolsar
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {txns.length === 0 && <EmptyState message="No hay transacciones registradas" />}
      </Card>
    </div>
  );
};

// ─── Support ─────────────────────────────────────────────────────────────────

const SupportSection = () => {
  const qc = useQueryClient();
  const { data: tickets = [], isLoading } = useQuery<any[]>({
    queryKey: ["admin-tickets"],
    queryFn: () => apiFetch("/api/admin/tickets"),
  });

  const replyMutation = useMutation({
    mutationFn: (vars: { id: string; body: any }) =>
      apiFetch(`/api/admin/tickets/${vars.id}`, { method: "PATCH", body: JSON.stringify(vars.body) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["admin-tickets"] }); toast("Respuesta enviada", "success"); },
    onError: (e: Error) => toast(e.message, "error"),
  });

  if (isLoading) return <Spinner />;

  return (
    <div className="space-y-4">
      <Card className="p-0 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[#1e2030]">
              {["Usuario", "Asunto", "Estado", "Creado", "Acciones"].map((h) => (
                <th key={h} className="text-left px-4 py-3 text-xs font-medium text-slate-500 uppercase tracking-wider">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {tickets.map((t) => (
              <tr key={t._id} className="border-b border-[#1a1c28] hover:bg-[#161820] transition-colors">
                <td className="px-4 py-3 text-slate-400 text-xs">{t.email}</td>
                <td className="px-4 py-3">
                  <p className="text-slate-200 font-medium">{t.subject}</p>
                  <p className="text-slate-500 text-xs truncate max-w-xs">{t.message}</p>
                </td>
                <td className="px-4 py-3">
                  <Badge className={t.status === "open" ? "text-amber-400 border-amber-800" : "text-emerald-400 border-emerald-800"}>
                    {t.status}
                  </Badge>
                </td>
                <td className="px-4 py-3 text-slate-500 text-xs">{new Date(t.createdAt).toLocaleDateString()}</td>
                <td className="px-4 py-3">
                  <button onClick={() => {
                    const reply = prompt("Respuesta para el cliente:", t.adminReply || "");
                    if (reply !== null) replyMutation.mutate({ id: t._id, body: { adminReply: reply, status: "resolved" } });
                  }} className="text-violet-400 hover:text-violet-300 text-xs font-medium">Responder</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {tickets.length === 0 && <EmptyState message="No hay tickets de soporte" />}
      </Card>
    </div>
  );
};

// ─── Settings ────────────────────────────────────────────────────────────────

const SettingsSection = () => {
  const [saved, setSaved] = useState(false);
  const [form, setForm] = useState({
    platformName: "Maris AI", supportEmail: OWNER_EMAIL, domain: "maris-ai.shop",
    maintenanceMode: false, openRegistration: true, ownerAlerts: true, creditEnforcement: true,
  });

  return (
    <div className="space-y-4 max-w-xl">
      <Card>
        <SectionTitle><Globe size={14} className="text-cyan-400" /> Datos de la plataforma</SectionTitle>
        <div className="space-y-3">
          {[{ label: "Nombre", key: "platformName" }, { label: "Email de soporte", key: "supportEmail" }, { label: "Dominio", key: "domain" }].map(({ label, key }) => (
            <div key={key}>
              <label className="text-xs text-slate-500 block mb-1">{label}</label>
              <input value={form[key as keyof typeof form] as string} onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
                className="w-full bg-[#161820] border border-[#1e2030] rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-violet-600" />
            </div>
          ))}
        </div>
      </Card>
      <Card>
        <SectionTitle><ShieldCheck size={14} className="text-violet-400" /> Controles de plataforma</SectionTitle>
        <div className="divide-y divide-[#1e2030]">
          {([
            { key: "maintenanceMode", label: "Modo mantenimiento", desc: "Desactiva el acceso público.", danger: true },
            { key: "openRegistration", label: "Registro abierto", desc: "Permite nuevos registros." },
            { key: "ownerAlerts", label: "Alertas al propietario", desc: `Notificaciones a ${OWNER_EMAIL}` },
            { key: "creditEnforcement", label: "Bloqueo por créditos", desc: "Bloquea al llegar a 0." },
          ] as const).map(({ key, label, desc, danger }) => (
            <div key={key} className="flex items-center justify-between py-3.5">
              <div>
                <p className={`text-sm font-medium ${danger && form[key] ? "text-red-400" : "text-slate-200"}`}>{label}</p>
                <p className="text-xs text-slate-500 mt-0.5">{desc}</p>
              </div>
              <button onClick={() => setForm((f) => ({ ...f, [key]: !f[key as keyof typeof f] }))}
                className={`relative w-11 h-6 rounded-full transition-colors ${form[key as keyof typeof form] ? (danger ? "bg-red-600" : "bg-violet-600") : "bg-slate-700"}`}>
                <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${form[key as keyof typeof form] ? "translate-x-5" : "translate-x-0"}`} />
              </button>
            </div>
          ))}
        </div>
      </Card>
      <button onClick={() => { setSaved(true); toast("Configuración guardada", "success"); setTimeout(() => setSaved(false), 2000); }}
        className="flex items-center gap-2 bg-violet-600 hover:bg-violet-500 text-white text-sm font-medium px-5 py-2.5 rounded-lg transition-colors">
        <Save size={14} />{saved ? "¡Guardado!" : "Guardar cambios"}
      </button>
    </div>
  );
};

// ─── Main ─────────────────────────────────────────────────────────────────────

export default function AdminDashboard() {
  const [, navigate] = useLocation();
  const [activeSection, setActiveSection] = useState<NavId>("overview");

  const sections: Record<NavId, React.ReactNode> = {
    overview: <OverviewSection />,
    users: <UsersSection />,
    apps: <AppsSection />,
    credits: <CreditsSection />,
    payments: <PaymentsSection />,
    support: <SupportSection />,
    queue: <QueueSection />,
    settings: <SettingsSection />,
  };

  return (
    <div className="flex min-h-screen bg-[#080a10] text-white font-sans">
      <aside className="w-56 flex-shrink-0 border-r border-[#1e2030] flex flex-col py-5">
        <div className="px-4 mb-6">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-violet-600 to-cyan-500 flex items-center justify-center text-white font-bold text-sm">M</div>
            <span className="text-sm font-semibold text-slate-200">Maris AI</span>
          </div>
          <p className="text-xs text-slate-600 mt-1 ml-9">Admin Panel</p>
        </div>
        <nav className="flex-1 px-2 space-y-0.5">
          <p className="text-[10px] uppercase tracking-widest text-slate-600 px-2 pb-1 pt-2">Principal</p>
          {NAV_ITEMS.slice(0, 6).map(({ id, label, icon: Icon }) => (
            <button key={id} onClick={() => setActiveSection(id)}
              className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-sm transition-all ${activeSection === id ? "bg-violet-900/50 text-violet-300 border border-violet-800/60" : "text-slate-500 hover:text-slate-300 hover:bg-[#161820]"}`}>
              <Icon size={15} />{label}
            </button>
          ))}
          <p className="text-[10px] uppercase tracking-widest text-slate-600 px-2 pb-1 pt-3">Sistema</p>
          {NAV_ITEMS.slice(6).map(({ id, label, icon: Icon }) => (
            <button key={id} onClick={() => setActiveSection(id)}
              className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-sm transition-all ${activeSection === id ? "bg-violet-900/50 text-violet-300 border border-violet-800/60" : "text-slate-500 hover:text-slate-300 hover:bg-[#161820]"}`}>
              <Icon size={15} />{label}
            </button>
          ))}
        </nav>
        <div className="px-3 mt-4">
          <div className="bg-[#0f1117] border border-[#1e2030] rounded-xl p-3">
            <div className="flex items-center gap-2 mb-2">
              <Crown size={12} className="text-amber-400" />
              <span className="text-xs font-medium text-amber-400">Propietario</span>
            </div>
            <p className="text-[11px] text-slate-500 break-all leading-relaxed">{OWNER_EMAIL}</p>
            <div className="flex items-center gap-1 mt-2">
              <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              <span className="text-[10px] text-emerald-500">Online</span>
            </div>
          </div>
          <button onClick={() => navigate("/dashboard")}
            className="w-full flex items-center gap-2 px-2.5 py-2 mt-2 rounded-lg text-xs text-slate-600 hover:text-slate-400 hover:bg-[#161820] transition-colors">
            <LogOut size={13} />Volver al dashboard
          </button>
        </div>
      </aside>

      <main className="flex-1 flex flex-col min-w-0">
        <header className="border-b border-[#1e2030] px-6 py-4 flex items-center justify-between bg-[#080a10]/80 backdrop-blur sticky top-0 z-10">
          <h1 className="text-base font-semibold text-slate-200">
            {NAV_ITEMS.find((n) => n.id === activeSection)?.label}
          </h1>
          <div className="flex items-center gap-2">
            <Badge className="text-emerald-300 bg-emerald-900/30 border-emerald-800"><ShieldCheck size={11} /> Admin</Badge>
            <Badge className="text-violet-300 bg-violet-900/30 border-violet-800"><Zap size={11} /> ∞ créditos</Badge>
          </div>
        </header>
        <div className="flex-1 p-6 overflow-y-auto">{sections[activeSection]}</div>
      </main>

      <ToastContainer />
    </div>
  );
}
