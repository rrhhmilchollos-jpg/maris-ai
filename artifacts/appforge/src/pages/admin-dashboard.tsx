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
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuPortal,
} from "@/components/ui/dropdown-menu";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { Command, CommandInput, CommandList, CommandEmpty, CommandGroup, CommandItem } from "@/components/ui/command";
import { useToast } from "@/hooks/use-toast";
import React, { useState, useEffect, useRef } from "react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Activity,
  AlertTriangle,
  DollarSign,
  TrendingUp,
  TrendingDown,
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
  Zap,
  Server,
  Bug,
  Eye,
  BarChart3,
  AlertCircle,
  XCircle,
  Terminal,
  Cpu,
  Code2,
  Database,
  Shield,
  Trash2,
  Monitor,
  Bell,
  Package,
  LayoutDashboard,
} from "lucide-react";
import { apiFetch, getApiBaseUrl, useListAdminJobs, getListAdminJobsQueryKey, getGenerationJobLogs, useRetryAdminJob } from "@/lib/api-client";
import { JOB_POLLING } from "@/lib/job-polling";
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
  topUsers: Array<{ userId: string; email: string; totalSpentCents: number }>;
  publishedApps: { today: number; total: number };
  jobs7dChart?: Array<{ date: string; succeeded: number; failed: number; total: number }>;
  credits7dChart?: Array<{ date: string; credits: number }>;
  server?: { memUsedMb: number; memTotalMb: number; uptimeSeconds: number; requestsTotal: number; errors5xx: number };
  redis?: { connected: boolean; latencyMs: number };
  queue?: { ready: boolean };
  overview?: { totalUsers: number; totalApps: number; newUsers7d: number };
  revenueCentsTotal?: number;
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

async function backfillTopUpExpiry(): Promise<{ ok: boolean; usersUpdated: number; expiresAt: string }> {
  return apiFetch<{ ok: boolean; usersUpdated: number; expiresAt: string }>("/api/admin/migrations/backfill-topup-expiry", { method: "POST" });
}

async function runE2BSmoke(): Promise<E2BSmokeResponse> {
  return apiFetch<E2BSmokeResponse>("/api/admin/e2b-smoke", {
    method: "POST",
  });
}

interface E2BTemplateBuildResponse {
  ok: boolean;
  alias?: string;
  reason?: string;
}

async function buildE2BImportTemplate(): Promise<E2BTemplateBuildResponse> {
  return apiFetch<E2BTemplateBuildResponse>("/api/admin/e2b-build-import-template", {
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

// Etiquetas legibles para cada categoría de problema real detectada por el
// backend (jobDiagnosis.ts) — basadas en los patrones reales investigados
// y corregidos hoy (404 persistente, archivos vacíos, límite de tokens,
// clasificación frontend/backend equivocada, regresión visual, build roto,
// transacciones de dinero sin proteger).
const DIAGNOSIS_CATEGORY_LABELS: Record<string, { label: string; icon: string; color: string }> = {
  router_404: { label: "Router / 404 persistente", icon: "🧭", color: "text-red-400 bg-red-500/10 border-red-500/20" },
  archivo_vacio_o_incompleto: { label: "Archivo vacío o incompleto", icon: "📄", color: "text-orange-400 bg-orange-500/10 border-orange-500/20" },
  limite_de_tokens: { label: "Límite de tokens (cambio demasiado grande)", icon: "✂️", color: "text-amber-400 bg-amber-500/10 border-amber-500/20" },
  clasificacion_frontend_backend: { label: "Archivo en el bundle equivocado", icon: "🔀", color: "text-purple-400 bg-purple-500/10 border-purple-500/20" },
  regresion_visual: { label: "Regresión visual (empeoró tras el arreglo)", icon: "📉", color: "text-pink-400 bg-pink-500/10 border-pink-500/20" },
  build_roto: { label: "Build roto (error de sintaxis)", icon: "🛑", color: "text-red-400 bg-red-500/10 border-red-500/20" },
  transaccion_atomica: { label: "Transacción de dinero/saldo", icon: "💰", color: "text-yellow-400 bg-yellow-500/10 border-yellow-500/20" },
  otro: { label: "Otro problema", icon: "⚠️", color: "text-white/60 bg-white/5 border-white/10" },
};

interface DiagnosisFinding {
  file?: string;
  agent: string;
  level: "warn" | "error";
  message: string;
  category: string;
  createdAt: string;
}
interface JobDiagnosisResult {
  jobId: string;
  hasFailed: boolean;
  finalErrorMessage?: string;
  findings: DiagnosisFinding[];
  topSuspect: DiagnosisFinding | null;
}

function JobDiagnosisPanel({ jobId }: { jobId: string }) {
  const [diagnosis, setDiagnosis] = useState<JobDiagnosisResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    setLoading(true);
    apiFetch<JobDiagnosisResult>(`/api/admin/jobs/${jobId}/diagnosis`)
      .then(setDiagnosis)
      .catch(() => setDiagnosis(null))
      .finally(() => setLoading(false));
  }, [jobId]);

  if (loading) return <div className="px-4 py-2 text-xs text-muted-foreground flex items-center gap-2"><Loader2 className="h-3 w-3 animate-spin" />Diagnosticando…</div>;
  if (!diagnosis || diagnosis.findings.length === 0) return null;

  const { topSuspect, findings } = diagnosis;
  const cat = topSuspect ? DIAGNOSIS_CATEGORY_LABELS[topSuspect.category] : null;

  return (
    <div className="mx-4 my-2">
      {topSuspect && cat && (
        <div className={`p-3 rounded border ${cat.color}`}>
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-xs font-semibold">
              <span>{cat.icon}</span>
              <span>Diagnóstico: {cat.label}</span>
              {topSuspect.file && <code className="px-1.5 py-0.5 rounded bg-black/30 text-[11px]">{topSuspect.file}</code>}
            </div>
            {findings.length > 1 && (
              <button onClick={() => setExpanded(!expanded)} className="text-[11px] underline opacity-70 hover:opacity-100">
                {expanded ? "Ocultar" : `Ver los ${findings.length} problema(s) detectados`}
              </button>
            )}
          </div>
          <p className="text-xs mt-1.5 opacity-90">{topSuspect.message}</p>
          <p className="text-[10px] mt-1 opacity-60">Agente: {topSuspect.agent} · {format(new Date(topSuspect.createdAt), "HH:mm:ss")}</p>
        </div>
      )}
      {expanded && (
        <div className="mt-2 space-y-1.5">
          {findings.map((f, i) => {
            const fCat = DIAGNOSIS_CATEGORY_LABELS[f.category];
            return (
              <div key={i} className={`p-2 rounded border text-[11px] ${fCat.color}`}>
                <div className="flex items-center gap-1.5 font-medium">
                  <span>{fCat.icon}</span>
                  <span>{fCat.label}</span>
                  {f.file && <code className="px-1 rounded bg-black/30">{f.file}</code>}
                </div>
                <p className="mt-0.5 opacity-80">{f.message}</p>
              </div>
            );
          })}
        </div>
      )}
    </div>
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

// Catálogo de instrucciones de reparación/mejora para el panel de soporte,
// organizado por categoría. Antes solo había 4 chips planos — esto da al
// equipo de soporte un vocabulario completo y consistente para dirigir a los
// agentes de reparación (autoRepairBundle), sin tener que escribir cada
// instrucción desde cero cada vez.
const REPAIR_INSTRUCTION_CATEGORIES: Array<{ label: string; icon: string; options: string[] }> = [
  {
    label: "Contenido y páginas",
    icon: "📄",
    options: [
      "Completa las páginas que faltan según el plan original",
      "Rellena los textos de marcador de posición (lorem ipsum) con contenido real en español",
      "Añade la sección de FAQ que falta",
      "Completa el footer con enlaces reales (legal, contacto, redes sociales)",
      "Genera solo la landing page sin backend",
      "Añade página 404 personalizada con enlace de vuelta al inicio",
      "Añade página de política de privacidad y aviso legal básicos",
      "Completa las páginas de error de estado (403, 500) con mensajes claros",
      "Añade breadcrumbs (migas de pan) de navegación en páginas internas",
      "Completa el contenido de la sección \"Sobre nosotros\" / \"Quiénes somos\"",
      "Añade testimonios o casos de uso de ejemplo si el proyecto es una landing comercial",
      "Revisa y corrige toda la ortografía y gramática del texto en español",
      "Añade textos de estado vacío (\"no hay resultados\", \"aún no tienes X\") en listas vacías",
      "Completa los formularios de contacto con validación y mensaje de confirmación",
    ],
  },
  {
    label: "Diseño y UI",
    icon: "🎨",
    options: [
      "Corrige el espaciado y alineación de los componentes principales",
      "Hace que el diseño sea coherente entre todas las páginas",
      "Mejora el contraste de colores para accesibilidad (WCAG AA mínimo)",
      "Corrige el menú de navegación para que funcione en móvil",
      "Simplifica la app a las funciones básicas",
      "Adapta el diseño a pantallas pequeñas (responsive real, no solo desktop)",
      "Añade estados hover/focus/active visibles en todos los botones y enlaces",
      "Corrige el z-index de modales/dropdowns que quedan detrás de otros elementos",
      "Unifica la tipografía y los tamaños de fuente en toda la app",
      "Añade indicadores de foco visibles para navegación por teclado (accesibilidad)",
      "Corrige el desbordamiento (overflow) de texto o imágenes en tarjetas y contenedores",
      "Añade dark mode / light mode si el diseño original lo contempla",
      "Revisa que los formularios muestren errores de validación de forma clara y visible",
      "Añade animaciones de transición suaves entre estados (sin exagerar)",
    ],
  },
  {
    label: "Backend y datos",
    icon: "🗄️",
    options: [
      "Completa los endpoints del backend que faltan",
      "Corrige los modelos de datos para que coincidan con el frontend",
      "Añade validación de formularios en el backend (no solo en el cliente)",
      "Corrige la autenticación de usuarios",
      "Conecta el frontend con los endpoints reales del backend",
      "Añade manejo de errores consistente en todas las rutas de la API",
      "Añade paginación real en el backend para listas grandes",
      "Corrige las relaciones entre colecciones/tablas que no coinciden",
      "Añade índices a los campos de base de datos más consultados",
      "Corrige permisos de acceso (un usuario no debe poder ver/editar datos de otro)",
      "Añade variables de entorno que falten y su documentación básica",
      "Corrige el manejo de fechas y zonas horarias entre frontend y backend",
      "Añade rate limiting básico a endpoints públicos sensibles",
      "Sanea las entradas de usuario contra inyección antes de guardarlas en base de datos",
    ],
  },
  {
    label: "Errores técnicos",
    icon: "🐛",
    options: [
      "Corrige errores de TypeScript del frontend",
      "Corrige imports rotos o componentes faltantes",
      "Corrige errores de consola del navegador",
      "Corrige rutas de navegación que no funcionan",
      "Corrige el botón o formulario que no responde",
      "Corrige el catch-all de rutas (404) que está capturando rutas válidas",
      "Corrige advertencias de React (keys duplicadas, hooks fuera de orden, etc.)",
      "Corrige memory leaks — listeners o intervalos que no se limpian al desmontar",
      "Corrige llamadas a la API que fallan por CORS o headers mal configurados",
      "Corrige el manejo de estados de carga que se quedan colgados indefinidamente",
      "Corrige condiciones de carrera (race conditions) entre peticiones asíncronas",
      "Corrige el manejo de errores no capturados que rompen la app entera",
      "Revisa y corrige cualquier bucle infinito o de renderizado excesivo",
    ],
  },
  {
    label: "Rendimiento",
    icon: "⚡",
    options: [
      "Optimiza las imágenes para que carguen más rápido (formato, tamaño, lazy loading)",
      "Añade paginación a las listas largas",
      "Elimina renders innecesarios y mejora la fluidez",
      "Añade estados de carga (loading) donde falten",
      "Añade code splitting / carga diferida de componentes pesados",
      "Reduce el tamaño del bundle eliminando dependencias no usadas",
      "Añade memoización (useMemo/useCallback) en cálculos costosos repetidos",
      "Optimiza las consultas a la base de datos que tardan más de lo esperado",
      "Añade compresión de assets estáticos (gzip/brotli)",
      "Reduce el Cumulative Layout Shift (CLS) fijando dimensiones de imágenes y contenedores",
      "Mejora el Largest Contentful Paint (LCP) priorizando la carga del contenido visible",
      "Añade caché en peticiones que no cambian con frecuencia",
    ],
  },
  {
    label: "SEO y metadatos",
    icon: "🔎",
    options: [
      "Añade título y meta descripción únicos y optimizados a cada página",
      "Añade textos alternativos (alt) descriptivos a todas las imágenes",
      "Añade datos estructurados Schema.org (Organization, WebSite, BreadcrumbList) según el tipo de página",
      "Añade Schema.org Product/Offer con precio, disponibilidad y política de devolución si vende productos",
      "Añade Schema.org FAQPage si la página tiene preguntas frecuentes",
      "Añade etiquetas Open Graph y Twitter Card completas para que se vea bien al compartir en redes",
      "Añade enlace canónico (canonical) correcto en cada página para evitar contenido duplicado",
      "Genera y añade sitemap.xml con todas las páginas indexables",
      "Genera robots.txt permitiendo el rastreo de páginas públicas y bloqueando rutas privadas/admin",
      "Añade jerarquía correcta de encabezados (un solo H1 por página, H2/H3 en orden lógico)",
      "Añade atributos hreflang si la app tiene versiones en varios idiomas",
      "Añade favicon, apple-touch-icon y manifest.json con iconos reales (no el genérico por defecto)",
      "Optimiza las Core Web Vitals (LCP, CLS, INP) para el ranking de Google",
      "Añade breadcrumbs con su correspondiente Schema.org BreadcrumbList",
      "Añade texto semántico visible en el HTML inicial (antes de hidratar) para que Google y las IA vean contenido real, no una pantalla vacía",
      "Añade archivo llms.txt describiendo el sitio para que ChatGPT, Claude, Perplexity y otras IA lo entiendan y citen correctamente",
      "Verifica que el contenido crítico no dependa solo de JavaScript — debe ser legible en el HTML plano para crawlers que no ejecutan JS",
      "Añade URLs limpias y descriptivas (sin IDs crípticos) en rutas públicas indexables",
      "Añade enlazado interno entre páginas relacionadas para reforzar la arquitectura del sitio",
      "Revisa que no haya contenido duplicado entre páginas (mismos títulos, mismas descripciones)",
      "Añade marcado de idioma correcto (lang=\"es\" u otro) en la etiqueta html",
    ],
  },
];

function AppsClientesPanel({ apiBase }: { apiBase: string }) {
  const { toast } = useToast();
  const [email, setEmail] = useState("faquiunmen@gmail.com");
  const [apps, setApps] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [previewAppId, setPreviewAppId] = useState<string | null>(null);
  const [apologyLoading, setApologyLoading] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<Record<string, boolean>>({});
  // Lista de clientes para el desplegable de selección rápida — antes había
  // que escribir el email a mano cada vez, sin ninguna lista visible.
  const [clientList, setClientList] = useState<Array<{ email: string; appsGenerated: number }>>([]);
  const [clientListLoading, setClientListLoading] = useState(false);
  const [clientPickerOpen, setClientPickerOpen] = useState(false);
  // Texto de reparación por app (sustituye al window.prompt() ambiguo que se
  // confundía fácilmente con "introduce el email del cliente").
  const [repairText, setRepairText] = useState<Record<string, string>>({});
  const [repairPopoverOpen, setRepairPopoverOpen] = useState<Record<string, boolean>>({});
  const [expandedPromptIds, setExpandedPromptIds] = useState<Record<string, boolean>>({});

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setClientListLoading(true);
      try {
        const users = await apiFetch<any[]>("/api/admin/users");
        if (!cancelled && Array.isArray(users)) {
          setClientList(
            users
              .filter((u) => !!u.email)
              .map((u) => ({ email: u.email as string, appsGenerated: u.appsGenerated ?? 0 }))
              .sort((a, b) => b.appsGenerated - a.appsGenerated),
          );
        }
      } catch {
        // best-effort — si falla, el campo sigue funcionando como input libre
      } finally {
        if (!cancelled) setClientListLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const searchApps = async (searchEmail?: string) => {
    const target = (searchEmail || email).trim();
    if (!target) return;
    setLoading(true);
    setApps([]);
    const timer = setTimeout(() => {
      setLoading(false);
      toast({ title: "Timeout", description: "Coolify tardó demasiado. Espera 10s y reintenta.", variant: "destructive" });
    }, 20000);
    try {
      const userData = await apiFetch<any>(`/api/admin/users/search?email=${encodeURIComponent(target)}`);
      if (!userData?.id) { toast({ title: "Usuario no encontrado", description: target, variant: "destructive" }); return; }
      const appsData = await apiFetch<any>(`/api/admin/users/${userData.id}/apps?limit=20&email=${encodeURIComponent(target)}`);
      const list = appsData.apps ?? [];
      setApps(list.map((a: any) => ({ ...a, userEmail: target, userId: userData.id })));
      if (list.length === 0) toast({ title: "Sin apps", description: `${target} no tiene apps aún` });
    } catch (e: any) {
      toast({ title: "Error", description: e.message || "Error de conexión", variant: "destructive" });
    } finally {
      clearTimeout(timer);
      setLoading(false);
    }
  };

  // Sin autoload — el usuario pulsa el botón

  return (
    <div className="space-y-4">
      {/* Búsqueda por email */}
      <Card className="bg-card/40 border-white/5">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Eye className="h-4 w-4 text-sky-400" />
            Vista previa de apps por cliente
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex gap-2">
            <div className="flex-1 flex gap-2">
              <Input
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="Email del cliente…"
                className="bg-black/20 border-white/10 text-sm flex-1"
                onKeyDown={e => e.key === "Enter" && searchApps()}
              />
              {/* Desplegable real con buscador — lista completa de clientes
                  visible de un vistazo, en vez de depender del autocompletado
                  nativo del navegador (poco visible y poco práctico). */}
              <Popover open={clientPickerOpen} onOpenChange={setClientPickerOpen}>
                <PopoverTrigger asChild>
                  <Button size="sm" variant="outline" className="shrink-0 border-violet-500/30 text-violet-400 hover:bg-violet-500/10" disabled={clientListLoading}>
                    {clientListLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ChevronDown className="h-3.5 w-3.5" />}
                  </Button>
                </PopoverTrigger>
                <PopoverContent align="end" className="w-80 p-0">
                  <Command>
                    <CommandInput placeholder="Buscar cliente por email…" />
                    <CommandList className="max-h-72">
                      <CommandEmpty>Sin clientes que coincidan.</CommandEmpty>
                      <CommandGroup heading={`${clientList.length} cliente(s) — ordenados por nº de apps`}>
                        {clientList.map((c) => (
                          <CommandItem
                            key={c.email}
                            value={c.email}
                            onSelect={() => {
                              setEmail(c.email);
                              setClientPickerOpen(false);
                              searchApps(c.email);
                            }}
                            className="cursor-pointer flex items-center justify-between gap-2"
                          >
                            <span className="truncate">{c.email}</span>
                            <Badge variant="outline" className="text-[10px] shrink-0">{c.appsGenerated} app{c.appsGenerated === 1 ? "" : "s"}</Badge>
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
            </div>
            <Button size="sm" onClick={() => searchApps()} disabled={loading} className="shrink-0">
              {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
              {loading ? "Buscando…" : "Ver apps"}
            </Button>
            <Button size="sm" variant="outline" className="shrink-0 text-[10px] border-yellow-500/30 text-yellow-400"
              onClick={async () => {
                const target = email.trim();
                if (!target) return;
                try {
                  const userData = await apiFetch<any>(`/api/admin/users/search?email=${encodeURIComponent(target)}`);
                  const debug = await apiFetch<any>(`/api/admin/users/${userData.id}/apps-debug`);
                  toast({ title: "🔍 Debug", description: `userId:${userData.id} | appsByUserId:${debug.appsByUserId} | viaJobs:${debug.recentJobs?.length ?? 0}` });
                  console.log("APPS DEBUG:", debug);
                } catch (e: any) { toast({ title: "Debug error", description: e.message, variant: "destructive" }); }
              }}>
              🔍
            </Button>
          </div>
          {/* Accesos rápidos a clientes activos */}
          <div className="flex gap-2 mt-3 flex-wrap">
            {[
              "rrhh.milchollos@gmail.com",
              "faquiunmen@gmail.com",
              "deliodiazmejia@gmail.com",
              "fedeler.correo@gmail.com",
              "alejandronopez@gmail.com"
            ].map(e => (
              <button key={e} onClick={() => { setEmail(e); searchApps(e); }}
                className="text-[10px] px-2 py-1 rounded bg-white/5 hover:bg-white/10 text-white/50 hover:text-white/80 transition-colors border border-white/10">
                {e.split("@")[0]}
              </button>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Lista de apps */}
      {apps.length === 0 && !loading && (
        <div className="text-center text-sm text-muted-foreground py-8">Sin apps generadas para este usuario</div>
      )}
      {apps.map((app: any) => {
        const appId = app.id || app._id;
        const isPreviewOpen = previewAppId === appId;
        return (
          <Card key={appId} className="bg-card/40 border-white/5 overflow-hidden">
            <CardContent className="p-0">
              {/* App header */}
              <div className="flex items-center justify-between p-4 gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-sm font-semibold text-white/90 truncate">{app.title || "Sin título"}</p>
                    {app.kind && (
                      <Badge variant="outline" className="text-[9px] h-4 px-1.5 border-sky-500/30 text-sky-400 shrink-0">
                        {app.kind}
                      </Badge>
                    )}
                  </div>
                  {/* Prompt original del cliente — antes se cortaba a 80
                      caracteres y ni siquiera limpiaba el prefijo técnico
                      interno ([MARIS AI REQUEST LOCALE]...), dejando muy
                      poco (o nada) del texto real que escribió el cliente.
                      Ahora: prefijo limpio siempre, y expandible con un clic
                      si es largo, en vez de cortarlo a ciegas. */}
                  {(() => {
                    const cleanedAppPrompt = (app.prompt || "").replace(/^\[MARIS AI REQUEST LOCALE\][^\n]*\n?/i, "").trim();
                    const isLong = cleanedAppPrompt.length > 140;
                    const isExpanded = !!expandedPromptIds[appId];
                    return (
                      <p
                        className={`text-[10px] text-white/40 mt-0.5 ${isExpanded ? "" : "truncate"} ${isLong ? "cursor-pointer hover:text-white/60" : ""}`}
                        onClick={isLong ? () => setExpandedPromptIds(p => ({ ...p, [appId]: !p[appId] })) : undefined}
                        title={isLong ? (isExpanded ? "Clic para contraer" : "Clic para ver el prompt completo") : undefined}
                      >
                        {cleanedAppPrompt || "(sin prompt registrado)"}
                        {isLong && <span className="text-violet-400 ml-1">{isExpanded ? "▲" : "▼"}</span>}
                      </p>
                    );
                  })()}
                  <div className="flex items-center gap-3 mt-1">
                    <span className="text-[9px] font-mono text-white/25 cursor-pointer hover:text-white/50"
                      onClick={() => navigator.clipboard?.writeText(appId)}
                      title="Click para copiar App ID">
                      📦 {appId}
                    </span>
                    <span className="text-[9px] text-white/20">
                      {app.createdAt ? new Date(app.createdAt).toLocaleDateString("es-ES") : ""}
                    </span>
                    {app.frontendCode && (
                      <span className="text-[9px] text-emerald-400/60">
                        {Math.round(app.frontendCode.length / 1024)} KB
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0 flex-wrap justify-end">
                  {/* Abrir en nueva pestaña */}
                  <Button size="sm" variant="outline"
                    className="h-7 text-[10px] border-sky-500/30 text-sky-400 hover:bg-sky-500/10"
                    onClick={() => window.open(`${apiBase}/api/apps/${appId}/preview`, "_blank", "noopener,noreferrer")}>
                    🔗 Nueva pestaña
                  </Button>
                  {/* Toggle preview inline */}
                  <Button size="sm" variant="outline"
                    className="h-7 text-[10px] border-sky-500/20 text-sky-300 hover:bg-sky-500/10"
                    onClick={() => setPreviewAppId(isPreviewOpen ? null : appId)}>
                    {isPreviewOpen ? "Cerrar" : <><Eye className="h-3 w-3 mr-1" />Preview</>}
                  </Button>
                  {/* Desbloquear ESTA app por su ID — quita pendingAdminApproval SOLO de
                      esta app (no a nivel global) y notifica al cliente al instante.
                      Muestra un indicador de si la app está oculta al cliente. */}
                  <Button size="sm" variant="outline"
                    className={`h-7 text-[10px] ${app.pendingAdminApproval
                      ? "border-red-500/40 text-red-400 hover:bg-red-500/10"
                      : "border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/10"}`}
                    disabled={actionLoading[`unblock_${appId}`]}
                    title={app.pendingAdminApproval
                      ? "Esta app está OCULTA al cliente (en revisión). Clícala para desbloquearla y hacerla visible."
                      : "Esta app ya es visible para el cliente. Puedes forzar el desbloqueo y reenviar la notificación."}
                    onClick={async (e) => {
                      e.stopPropagation();
                      if (!window.confirm(`¿Desbloquear la app "${app.title}" (ID ${appId}) y mostrarla al cliente ${app.userEmail}?\n\nSe quitará el estado "soporte revisando" SOLO de esta app y el cliente recibirá el aviso al instante.`)) return;
                      setActionLoading(p => ({ ...p, [`unblock_${appId}`]: true }));
                      try {
                        const d = await apiFetch<any>(`/api/admin/apps/${appId}/unblock`, { method: "POST" });
                        toast({ title: "🔓 App desbloqueada", description: d.message || `"${app.title}" ya es visible para el cliente.` });
                        await searchApps(app.userEmail);
                      } catch (err: any) {
                        toast({ title: "Error al desbloquear", description: err.message, variant: "destructive" });
                      } finally {
                        setActionLoading(p => ({ ...p, [`unblock_${appId}`]: false }));
                      }
                    }}>
                    {actionLoading[`unblock_${appId}`]
                      ? <Loader2 className="h-3 w-3 animate-spin" />
                      : app.pendingAdminApproval
                        ? <>🔒 Oculta — Desbloquear</>
                        : <>🔓 Visible</>}
                  </Button>
                  {/* Editar código — eliminar textos del footer */}
                  <Button size="sm" variant="outline"
                    className="h-7 text-[10px] border-orange-500/30 text-orange-400 hover:bg-orange-500/10"
                    onClick={async () => {
                      const search = window.prompt(
                        "Texto a eliminar del código de la app (exacto):",
                        " | Configurar dominio | Error en Google"
                      );
                      if (!search) return;
                      try {
                        const d = await apiFetch<any>(`/api/admin/apps/${appId}/patch-code`, {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ search, replace: "" }),
                        });
                        if (d.ok) {
                          toast({ title: "✅ Código parcheado", description: d.message });
                          setPreviewAppId(null);
                          setTimeout(() => setPreviewAppId(appId), 100);
                        } else {
                          toast({ title: "⚠️ No encontrado", description: d.message, variant: "destructive" });
                        }
                      } catch (e: any) {
                        toast({ title: "Error", description: e.message, variant: "destructive" });
                      }
                    }}>
                    ✂️ Editar código
                  </Button>
                  {/* Limpiar — conservar esta app, eliminar el resto */}
                  <Button size="sm" variant="outline"
                    className="h-7 text-[10px] border-orange-500/30 text-orange-400 hover:bg-orange-500/10"
                    disabled={actionLoading[`cleanup_${appId}`]}
                    title="Renombrar esta app y eliminar todas las demás del usuario"
                    onClick={async () => {
                      const newTitle = window.prompt("Nuevo nombre para esta app:", app.title || "");
                      if (!newTitle) return;
                      if (!window.confirm(`¿Conservar "${newTitle}" y eliminar TODAS las demás apps de ${app.userEmail}?\n\nEsta acción no se puede deshacer.`)) return;
                      setActionLoading(p => ({ ...p, [`cleanup_${appId}`]: true }));
                      try {
                        const d = await apiFetch<any>("/api/admin/apps/cleanup", {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ userEmail: app.userEmail, keepAppId: appId, newTitle }),
                        });
                        toast({ title: "✅ Limpieza completada", description: d.message });
                        await searchApps(app.userEmail);
                      } catch (e: any) {
                        toast({ title: "Error", description: e.message, variant: "destructive" });
                      } finally {
                        setActionLoading(p => ({ ...p, [`cleanup_${appId}`]: false }));
                      }
                    }}>
                    {actionLoading[`cleanup_${appId}`] ? <Loader2 className="h-3 w-3 animate-spin" /> : "🧹 Conservar esta"}
                  </Button>
                  {/* Eliminar esta app */}
                  <Button size="sm" variant="outline"
                    className="h-7 text-[10px] border-red-600/40 text-red-400 hover:bg-red-600/20 hover:border-red-600/60"
                    disabled={actionLoading[`delapp_${appId}`]}
                    title="Eliminar esta app definitivamente"
                    onClick={async e => {
                      e.stopPropagation();
                      if (!window.confirm(`¿Eliminar la app "${app.title}" de ${app.userEmail}?\n\nEsta acción no se puede deshacer.`)) return;
                      setActionLoading(p => ({ ...p, [`delapp_${appId}`]: true }));
                      try {
                        await apiFetch<any>(`/api/admin/apps/${appId}`, { method: "DELETE" });
                        toast({ title: "🗑️ App eliminada", description: `"${app.title}" eliminada correctamente` });
                        await searchApps(app.userEmail);
                      } catch (e: any) {
                        toast({ title: "Error al eliminar", description: e.message, variant: "destructive" });
                      } finally {
                        setActionLoading(p => ({ ...p, [`delapp_${appId}`]: false }));
                      }
                    }}>
                    {actionLoading[`delapp_${appId}`] ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
                  </Button>
                  {/* Reparar y continuar — usa el flujo in-situ (autoRepairBundle), NO crea
                      una generación nueva. Antes usaba window.prompt(), que se confundía
                      fácilmente con "introduce el email del cliente" (otros botones de esta
                      misma tarjeta SÍ piden un email) — ahora es un panel explícito que solo
                      puede rellenarse con una INSTRUCCIÓN DE REPARACIÓN, nunca un email. */}
                  <Popover
                    open={!!repairPopoverOpen[appId]}
                    onOpenChange={(open) => setRepairPopoverOpen(p => ({ ...p, [appId]: open }))}
                  >
                    <PopoverTrigger asChild>
                      <Button size="sm" variant="outline"
                        className="h-7 text-[10px] border-amber-500/30 text-amber-400 hover:bg-amber-500/10"
                        disabled={actionLoading[`repairapp_${appId}`]}
                      >
                        {actionLoading[`repairapp_${appId}`] ? <Loader2 className="h-3 w-3 animate-spin" /> : "🔧 Reparar y continuar"}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent align="start" className="w-96 p-3 space-y-2">
                      <p className="text-xs font-medium text-white">
                        ¿Qué hay que reparar o completar en "{app.title}"?
                      </p>
                      <p className="text-[10px] text-muted-foreground">
                        Esto NO es el email del cliente — escribe aquí la instrucción técnica.
                        Se aplica sobre la app existente, sin regenerarla desde 0.
                      </p>
                      <Input
                        autoFocus
                        value={repairText[appId] ?? ""}
                        onChange={e => setRepairText(p => ({ ...p, [appId]: e.target.value }))}
                        placeholder="Ej: Completa las páginas de reservas que faltan"
                        className="text-xs h-8 bg-black/20"
                      />
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <button className="text-[10px] px-2 py-1 rounded border border-violet-500/40 bg-violet-500/10 text-violet-300 hover:bg-violet-500/20 transition-colors font-medium flex items-center gap-1">
                            Catálogo de instrucciones <ChevronDown className="h-3 w-3" />
                          </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="start" className="w-64 max-h-[60vh] overflow-y-auto">
                          {REPAIR_INSTRUCTION_CATEGORIES.map(category => (
                            <DropdownMenuSub key={category.label}>
                              <DropdownMenuSubTrigger className="text-xs">
                                <span className="mr-2">{category.icon}</span>
                                {category.label}
                              </DropdownMenuSubTrigger>
                              <DropdownMenuPortal>
                                <DropdownMenuSubContent className="w-72">
                                  {category.options.map(option => (
                                    <DropdownMenuItem
                                      key={option}
                                      className="text-xs cursor-pointer"
                                      onClick={() => setRepairText(p => ({ ...p, [appId]: option }))}
                                    >
                                      {option}
                                    </DropdownMenuItem>
                                  ))}
                                </DropdownMenuSubContent>
                              </DropdownMenuPortal>
                            </DropdownMenuSub>
                          ))}
                        </DropdownMenuContent>
                      </DropdownMenu>
                      <Button
                        size="sm"
                        className="w-full h-8 bg-amber-600 hover:bg-amber-700 text-white text-xs"
                        disabled={actionLoading[`repairapp_${appId}`] || !repairText[appId]?.trim()}
                        onClick={async () => {
                          const instruction = repairText[appId]?.trim();
                          if (!instruction) return;
                          setActionLoading(p => ({ ...p, [`repairapp_${appId}`]: true }));
                          try {
                            const d = await apiFetch<any>(`/api/admin/users/${app.userId}/generate-app`, {
                              method: "POST",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({ prompt: `[ADMIN REPAIR] ${instruction}`, appId }),
                            });
                            toast({ title: "🔧 Reparando en sitio", description: d.message || "Aplicando la instrucción sobre la app existente." });
                            setRepairText(p => ({ ...p, [appId]: "" }));
                            setRepairPopoverOpen(p => ({ ...p, [appId]: false }));
                          } catch (e: any) {
                            toast({ title: "Error al reparar", description: e.message, variant: "destructive" });
                          } finally {
                            setActionLoading(p => ({ ...p, [`repairapp_${appId}`]: false }));
                          }
                        }}
                      >
                        {actionLoading[`repairapp_${appId}`] ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Zap className="h-3 w-3 mr-1" />}
                        Aplicar reparación
                      </Button>
                    </PopoverContent>
                  </Popover>
                  {/* Regenerar desde 0 con selector de tipo:
                      - Básico (MVP): scope-cut a 7 hitos — siempre funciona, ideal para recuperar clientes free
                      - Completo: plan ilimitado para clientes de pago que necesitan la app entera */}
                  <div className="flex gap-1 w-full">
                    <Button size="sm" variant="outline"
                      className="h-7 text-[10px] flex-1 border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/10"
                      disabled={actionLoading[`regenapp_${appId}`]}
                      title="Genera un MVP funcional de 7 módulos máximo — siempre funciona, ideal para recuperar clientes con apps fallidas"
                      onClick={async () => {
                        const cleanPrompt = (app.prompt || "").replace(/\[MARIS AI REQUEST LOCALE\][^\n]*\n?/, "").trim();
                        const promptToUse = window.prompt("Prompt para regenerar (puedes editarlo):", cleanPrompt);
                        if (!promptToUse) return;
                        if (!window.confirm(`¿Regenerar "${app.title}" en modo BÁSICO (7 módulos)?\n\n✅ Garantiza preview funcional al instante\n⚡ Ideal para clientes free con apps fallidas`)) return;
                        setActionLoading(p => ({ ...p, [`regenapp_${appId}`]: true }));
                        try {
                          const d = await apiFetch<any>(`/api/admin/users/${app.userId}/generate-app`, {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ prompt: promptToUse, model: "zoco-plus", skipGating: true, forceBasicGeneration: true }),
                          });
                          toast({ title: "⚡ Regeneración básica iniciada", description: d.message });
                        } catch (e: any) {
                          toast({ title: "Error", description: e.message, variant: "destructive" });
                        } finally {
                          setActionLoading(p => ({ ...p, [`regenapp_${appId}`]: false }));
                        }
                      }}
                    >
                      {actionLoading[`regenapp_${appId}`] ? <Loader2 className="h-3 w-3 animate-spin" /> : "⚡ MVP (7 módulos)"}
                    </Button>
                    <Button size="sm" variant="outline"
                      className="h-7 text-[10px] flex-1 border-violet-500/30 text-violet-400 hover:bg-violet-500/10"
                      disabled={actionLoading[`regenapp_${appId}`]}
                      title="Genera la app completa sin límite de módulos — para clientes de pago que necesitan todo"
                      onClick={async () => {
                        const cleanPrompt = (app.prompt || "").replace(/\[MARIS AI REQUEST LOCALE\][^\n]*\n?/, "").trim();
                        const promptToUse = window.prompt("Prompt para regenerar COMPLETO (puedes editarlo):", cleanPrompt);
                        if (!promptToUse) return;
                        if (!window.confirm(`¿Regenerar "${app.title}" en modo COMPLETO (sin límite de módulos)?\n\n⚠️ Solo para clientes premium — puede tardar más`)) return;
                        setActionLoading(p => ({ ...p, [`regenapp_${appId}`]: true }));
                        try {
                          const d = await apiFetch<any>(`/api/admin/users/${app.userId}/generate-app`, {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ prompt: promptToUse, model: "zoco-plus", skipGating: true, forceBasicGeneration: false }),
                          });
                          toast({ title: "🏗️ Regeneración completa iniciada", description: d.message });
                        } catch (e: any) {
                          toast({ title: "Error", description: e.message, variant: "destructive" });
                        } finally {
                          setActionLoading(p => ({ ...p, [`regenapp_${appId}`]: false }));
                        }
                      }}
                    >
                      {actionLoading[`regenapp_${appId}`] ? <Loader2 className="h-3 w-3 animate-spin" /> : "🏗️ Completo"}
                    </Button>
                  </div>
                  {/* Disculpas */}
                  <Button size="sm" variant="outline"
                    className="h-7 text-[10px] border-violet-500/30 text-violet-400 hover:bg-violet-500/10"
                    disabled={apologyLoading === appId}
                    onClick={async () => {
                      const recipient = window.prompt("Email del cliente:", app.userEmail || email);
                      if (!recipient) return;
                      if (!window.confirm(`¿Enviar email de disculpas a ${recipient}?`)) return;
                      setApologyLoading(appId);
                      try {
                        const jobsData = await apiFetch<any>(`/api/admin/jobs?userId=${app.userId}&limit=1&status=failed`);
                        const lastJob = (jobsData.jobs ?? [])[0];
                        if (lastJob) {
                          await apiFetch<any>(`/api/admin/jobs/${lastJob.id || lastJob._id}/send-apology`, {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ recipientEmail: recipient, appTitle: app.title }),
                          });
                        }
                        toast({ title: "💜 Email enviado", description: `Disculpas enviadas a ${recipient}` });
                      } catch (e: any) {
                        toast({ title: "Error", description: e.message, variant: "destructive" });
                      } finally { setApologyLoading(null); }
                    }}>
                    {apologyLoading === appId ? <Loader2 className="h-3 w-3 animate-spin" /> : "💜 Disculpas"}
                  </Button>
                  {/* A petición explícita del usuario: desplegable con plantillas de correo
                      adicionales (bienvenida, app lista, créditos añadidos, seguimiento...) */}
                  <EmailTemplateMenu
                    recipientEmail={app.userEmail || email}
                    userName={app.userName}
                    appTitle={cleanJobPrompt(app.title) || cleanJobPrompt(app.prompt)}
                    userId={app.userId}
                  />
                </div>
              </div>
              {/* Preview — iframe inline con botones externos */}
              {isPreviewOpen && (
                <div className="border-t border-white/5 bg-black/30">
                  {/* Barra de controles */}
                  <div className="flex items-center justify-between px-3 py-1.5 bg-black/40 border-b border-white/5">
                    <span className="text-[10px] text-white/30 font-mono truncate max-w-[50%]">
                      preview • {appId}
                    </span>
                    <div className="flex gap-1.5 shrink-0">
                      <Button size="sm" variant="outline"
                        className="h-6 px-2 text-[10px] border-white/10 text-white/50 hover:text-white/80"
                        onClick={() => {
                          const url = `${apiBase}/api/apps/${appId}/preview`;
                          const w = window.open(url, `preview_${appId}`, "width=430,height=750,left=100,top=50,resizable=yes,scrollbars=yes");
                          if (!w) window.open(url, "_blank");
                        }}>
                        📱 Móvil
                      </Button>
                      <Button size="sm" variant="outline"
                        className="h-6 px-2 text-[10px] border-white/10 text-white/50 hover:text-white/80"
                        onClick={() => window.open(`${apiBase}/api/apps/${appId}/preview`, "_blank", "noopener,noreferrer")}>
                        🖥️ Nueva pestaña
                      </Button>
                    </div>
                  </div>
                  {/* iframe directo */}
                  <iframe
                    src={`${apiBase}/api/apps/${appId}/preview`}
                    className="w-full border-0"
                    style={{ height: "600px", background: "#0a0a0f" }}
                    title={`Preview ${appId}`}
                    sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals"
                    allow="clipboard-read; clipboard-write"
                  />
                </div>
              )}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// PANEL DE DASHBOARDS REMOTOS — vista de solo lectura del panel de cada cliente
// Replica lo que ve el cliente (stats, créditos, apps, notificaciones activas)
// y permite probar cada app en vivo (preview) y desbloquearla por ID.
// ═══════════════════════════════════════════════════════════════════════════
function RemoteDashboardPanel({ apiBase, onAppsChange }: { apiBase: string; onAppsChange?: (apps: any[]) => void }) {
  const { toast } = useToast();
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<any>(null);
  const [previewAppId, setPreviewAppId] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<Record<string, boolean>>({});
  const [clientList, setClientList] = useState<Array<{ email: string; appsGenerated: number }>>([]);
  const [clientPickerOpen, setClientPickerOpen] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [expandedJob, setExpandedJob] = useState<string | null>(null);
  const [jobLogs, setJobLogs] = useState<Record<string, any[]>>({});
  const [previewJobAppId, setPreviewJobAppId] = useState<string | null>(null);

  // Cargar los logs (consola en vivo) de un job concreto.
  const fetchJobLogs = async (jobId: string) => {
    try {
      const d = await apiFetch<any>(`/api/admin/jobs/${jobId}/logs?limit=150`);
      setJobLogs(prev => ({ ...prev, [jobId]: d.logs ?? [] }));
    } catch { /* silent */ }
  };

  // Refrescar los logs del job expandido cada 3s mientras esté abierto.
  useEffect(() => {
    if (!expandedJob) return;
    fetchJobLogs(expandedJob);
    const t = setInterval(() => fetchJobLogs(expandedJob), 3000);
    return () => clearInterval(t);
  }, [expandedJob]);

  // Cargar la lista de clientes para el selector rápido.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const users = await apiFetch<any[]>("/api/admin/users");
        if (!cancelled && Array.isArray(users)) {
          setClientList(
            users
              .filter((u) => !!u.email)
              .map((u) => ({ email: u.email as string, appsGenerated: u.appsGenerated ?? 0 }))
              .sort((a, b) => b.appsGenerated - a.appsGenerated),
          );
        }
      } catch { /* best-effort */ }
    })();
    return () => { cancelled = true; };
  }, []);

  const loadDashboard = async (searchEmail?: string) => {
    const target = (searchEmail || email).trim();
    if (!target) return;
    setLoading(true);
    try {
      const userData = await apiFetch<any>(`/api/admin/users/search?email=${encodeURIComponent(target)}`);
      if (!userData?.id) { toast({ title: "Usuario no encontrado", description: target, variant: "destructive" }); setLoading(false); return; }
      const view = await apiFetch<any>(`/api/admin/users/${userData.id}/dashboard-view?email=${encodeURIComponent(target)}`);
      setData(view);
      if ((view.apps ?? []).length === 0) toast({ title: "Sin apps", description: `${target} no tiene apps generadas.` });
    } catch (e: any) {
      toast({ title: "Error", description: e.message || "Error de conexión", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  // Auto-refresco cada 5s para ver cambios en vivo mientras se prueba.
  useEffect(() => {
    if (!autoRefresh || !data?.user?.email) return;
    const iv = setInterval(() => { loadDashboard(data.user.email); }, 5000);
    return () => clearInterval(iv);
  }, [autoRefresh, data?.user?.email]);

  const unblockApp = async (appId: string, title: string) => {
    if (!window.confirm(`¿Desbloquear la app "${title}" (ID ${appId}) y mostrarla al cliente?\n\nSe quitará el estado "soporte revisando" SOLO de esta app y el cliente recibirá el aviso al instante.`)) return;
    setActionLoading(p => ({ ...p, [`unblock_${appId}`]: true }));
    try {
      const d = await apiFetch<any>(`/api/admin/apps/${appId}/unblock`, { method: "POST" });
      toast({ title: "🔓 App desbloqueada", description: d.message || `"${title}" ya es visible para el cliente.` });
      await loadDashboard(data?.user?.email);
    } catch (e: any) {
      toast({ title: "Error al desbloquear", description: e.message, variant: "destructive" });
    } finally {
      setActionLoading(p => ({ ...p, [`unblock_${appId}`]: false }));
    }
  };

  const stats = data?.stats;
  const user = data?.user;
  const apps: any[] = data?.apps ?? [];
  // Notificar al padre cuando cambien las apps (para el desplegable del candado)
  useEffect(() => { onAppsChange?.(apps); }, [apps.length]);
  const notifications: any[] = data?.notifications ?? [];
  const unreadNotifs = notifications.filter((n) => !n.read);
  const jobs: any[] = data?.jobs ?? [];
  // Trabajos "a medias": jobs que NO terminaron correctamente y que no tienen
  // una app publicada visible (justo los que soporte necesita revisar en vivo).
  const inProgressJobs = jobs.filter((j) => j.isInProgress || !j.hasPublishedApp);

  const JOB_STATUS_LABEL: Record<string, string> = {
    queued: "En cola", running: "Generando", reviewing: "En revisi\u00f3n",
    repairing: "Reparando", "repaired-pending-review": "Reparado \u2014 pendiente de revisi\u00f3n",
    awaiting_approval: "Esperando aprobaci\u00f3n", awaiting_technical_clarification: "Esperando aclaraci\u00f3n",
    paused: "Pausado", failed: "Fallido", succeeded: "Completado", done: "Completado", cancelled: "Cancelado",
  };
  const jobStatusLabel = (s: string) => JOB_STATUS_LABEL[s] ?? s;
  const jobStatusColor = (s: string) => {
    if (s === "failed" || s === "cancelled") return "border-red-500/30 text-red-400";
    if (s === "succeeded" || s === "done") return "border-emerald-500/30 text-emerald-400";
    if (s === "running" || s === "queued" || s === "repairing") return "border-sky-500/30 text-sky-400";
    return "border-amber-500/30 text-amber-400";
  };

  return (
    <div className="space-y-4">
      {/* Selector de cliente */}
      <Card className="bg-card/40 border-white/5">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Monitor className="h-4 w-4 text-violet-400" />
            Dashboards remotos — ve y prueba el panel de cada cliente
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex gap-2">
            <div className="flex-1 flex gap-2">
              <Input
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="Email del cliente…"
                className="bg-black/20 border-white/10 text-sm flex-1"
                onKeyDown={e => e.key === "Enter" && loadDashboard()}
              />
              <Popover open={clientPickerOpen} onOpenChange={setClientPickerOpen}>
                <PopoverTrigger asChild>
                  <Button size="sm" variant="outline" className="shrink-0 border-violet-500/30 text-violet-400 hover:bg-violet-500/10">
                    <ChevronDown className="h-3.5 w-3.5" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent align="end" className="w-80 p-0">
                  <Command>
                    <CommandInput placeholder="Buscar cliente por email…" />
                    <CommandList className="max-h-72">
                      <CommandEmpty>Sin clientes que coincidan.</CommandEmpty>
                      <CommandGroup heading={`${clientList.length} cliente(s)`}>
                        {clientList.map((c) => (
                          <CommandItem key={c.email} value={c.email}
                            onSelect={() => { setEmail(c.email); setClientPickerOpen(false); loadDashboard(c.email); }}
                            className="cursor-pointer flex items-center justify-between gap-2">
                            <span className="truncate">{c.email}</span>
                            <Badge variant="outline" className="text-[10px] shrink-0">{c.appsGenerated} app{c.appsGenerated === 1 ? "" : "s"}</Badge>
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
            </div>
            <Button size="sm" onClick={() => loadDashboard()} disabled={loading} className="shrink-0">
              {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Monitor className="h-3.5 w-3.5" />}
              {loading ? "Cargando…" : "Ver dashboard"}
            </Button>
            {data && (
              <Button size="sm" variant="outline" className={`shrink-0 text-[10px] ${autoRefresh ? "border-emerald-500/40 text-emerald-400" : "border-white/10 text-white/50"}`}
                onClick={() => setAutoRefresh(v => !v)} title="Refrescar automáticamente cada 5s">
                <RefreshCw className={`h-3.5 w-3.5 ${autoRefresh ? "animate-spin" : ""}`} />
                {autoRefresh ? "En vivo" : "Auto"}
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {!data && !loading && (
        <div className="text-center text-sm text-muted-foreground py-12">
          Selecciona un cliente para ver su dashboard tal y como lo ve él.
        </div>
      )}

      {data && user && (
        <div className="space-y-4">
          {/* Cabecera del cliente — simula la vista del panel del cliente */}
          <Card className="bg-gradient-to-br from-violet-500/10 to-transparent border-violet-500/20">
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                {user.imageUrl
                  ? <img src={user.imageUrl} alt="" className="h-11 w-11 rounded-full border border-white/10" />
                  : <div className="h-11 w-11 rounded-full bg-violet-500/20 flex items-center justify-center text-violet-300 font-semibold">{(user.fullName || user.email || "?").charAt(0).toUpperCase()}</div>}
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-white/90 truncate">{user.fullName || user.email}</p>
                  <p className="text-[11px] text-white/40 truncate">{user.email} · {user.marisId || "sin ID"}</p>
                </div>
                <div className="ml-auto flex gap-1.5 flex-wrap justify-end">
                  {user.isAdmin && <Badge variant="outline" className="text-[9px] border-amber-500/30 text-amber-400">admin</Badge>}
                  {user.isPremium && <Badge variant="outline" className="text-[9px] border-emerald-500/30 text-emerald-400">premium</Badge>}
                  {user.isSuspended && <Badge variant="outline" className="text-[9px] border-red-500/30 text-red-400">suspendido</Badge>}
                  {user.isBanned && <Badge variant="outline" className="text-[9px] border-red-600/40 text-red-500">baneado</Badge>}
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Tarjetas de stats — mismas métricas que ve el cliente en su panel */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { label: "Créditos", value: stats?.credits ?? 0, icon: CreditCard, color: "text-emerald-400" },
              { label: "Apps generadas", value: stats?.appsGenerated ?? 0, icon: Package, color: "text-sky-400" },
              { label: "Apps esta semana", value: stats?.appsThisWeek ?? 0, icon: TrendingUp, color: "text-violet-400" },
              { label: "Créditos gastados", value: stats?.creditsSpentTotal ?? 0, icon: Zap, color: "text-amber-400" },
            ].map((s) => (
              <Card key={s.label} className="bg-card/40 border-white/5">
                <CardContent className="p-3">
                  <div className="flex items-center gap-2 text-[10px] text-white/40"><s.icon className={`h-3.5 w-3.5 ${s.color}`} />{s.label}</div>
                  <p className="text-xl font-bold text-white/90 mt-1">{s.value}</p>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Notificaciones activas del cliente (banner de soporte) */}
          {unreadNotifs.length > 0 && (
            <Card className="bg-violet-500/10 border-violet-500/30">
              <CardContent className="p-3 space-y-2">
                <div className="flex items-center gap-2 text-xs font-medium text-violet-300">
                  <Bell className="h-3.5 w-3.5" />
                  {unreadNotifs.length} notificación(es) de soporte activas que ve el cliente
                </div>
                {unreadNotifs.map((n) => (
                  <div key={n.id} className="text-[11px] text-white/70 bg-black/20 rounded px-2 py-1.5">
                    <span className="text-violet-400 font-mono mr-1">[{n.type}]</span>{n.message}
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          {/* Generaciones / trabajos del cliente — incluye los que están A MEDIAS
              (en curso, pausados, en revisión o fallidos) que NO aparecen como apps
              terminadas. Aquí soporte puede ver su consola en vivo y probar el preview. */}
          {inProgressJobs.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold text-white/70 mb-2 flex items-center gap-2">
                <Loader2 className="h-4 w-4 text-amber-400" />
                Generaciones / trabajos en curso ({inProgressJobs.length})
                <span className="text-[10px] font-normal text-white/30">— apps a medias que el cliente aún no ve terminadas</span>
              </h3>
              <div className="space-y-3">
                {inProgressJobs.map((job) => {
                  const jid = job.id;
                  const isJobOpen = expandedJob === jid;
                  const linkedAppId = job.linkedAppId;
                  const isJobPreviewOpen = previewJobAppId === linkedAppId && !!linkedAppId;
                  const jlogs = jobLogs[jid] ?? [];
                  return (
                    <Card key={jid} className="bg-card/40 border-amber-500/10 overflow-hidden">
                      <CardContent className="p-0">
                        <div className="flex items-center justify-between p-3 gap-3">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <Badge variant="outline" className={`text-[9px] ${jobStatusColor(job.status)}`}>{jobStatusLabel(job.status)}</Badge>
                              {typeof job.progress === "number" && job.progress > 0 && (
                                <span className="text-[10px] text-white/40">{job.progress}%</span>
                              )}
                              {job.retryCount > 0 && <span className="text-[9px] text-white/30">· {job.retryCount} reintento(s)</span>}
                            </div>
                            <p className="text-[11px] text-white/60 truncate mt-1" title={job.prompt}>{job.prompt || "(sin prompt)"}</p>
                            {(job.errorMessage || job.internalErrorMessage) && (
                              <p className="text-[10px] text-red-400/80 truncate mt-0.5">⚠ {job.errorMessage || job.internalErrorMessage}</p>
                            )}
                            <span className="text-[9px] font-mono text-white/25 cursor-pointer hover:text-white/50"
                              onClick={() => { navigator.clipboard?.writeText(jid); toast({ title: "Job ID copiado", description: jid }); }}
                              title="Click para copiar Job ID">🧩 job {jid}{linkedAppId ? ` · 📦 app ${linkedAppId}` : ""}</span>
                          </div>
                          <div className="flex items-center gap-1.5 shrink-0 flex-wrap justify-end">
                            <Button size="sm" variant="outline" className="h-7 text-[10px] border-white/10 text-white/60 hover:bg-white/5"
                              onClick={() => setExpandedJob(isJobOpen ? null : jid)}>
                              {isJobOpen ? "Cerrar consola" : <>🖥️ Consola en vivo</>}
                            </Button>
                            {linkedAppId && (
                              <>
                                <Button size="sm" variant="outline" className="h-7 text-[10px] border-sky-500/20 text-sky-300 hover:bg-sky-500/10"
                                  onClick={() => setPreviewJobAppId(isJobPreviewOpen ? null : linkedAppId)}>
                                  {isJobPreviewOpen ? "Cerrar" : <><Eye className="h-3 w-3 mr-1" />Probar</>}
                                </Button>
                                <Button size="sm" variant="outline" className="h-7 text-[10px] border-sky-500/30 text-sky-400 hover:bg-sky-500/10"
                                  onClick={() => window.open(`${apiBase}/api/admin/apps/${linkedAppId}/preview`, "_blank", "noopener,noreferrer")}>
                                  🔗 Abrir
                                </Button>
                                <Button size="sm" variant="outline"
                                  className="h-7 text-[10px] border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/10"
                                  disabled={actionLoading[`unblock_${linkedAppId}`]}
                                  onClick={() => unblockApp(linkedAppId, job.prompt?.slice(0, 40) || "app")}>
                                  {actionLoading[`unblock_${linkedAppId}`] ? <Loader2 className="h-3 w-3 animate-spin" /> : <>🔓 Desbloquear</>}
                                </Button>
                              </>
                            )}
                            {/* Papelera individual por job — borra solo este job */}
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 w-7 p-0 border-red-500/20 text-red-400/50 hover:border-red-500/50 hover:text-red-400 hover:bg-red-500/10"
                              disabled={actionLoading[`deljob1_${jid}`]}
                              title="Eliminar este job"
                              onClick={async () => {
                                if (!window.confirm(`¿Eliminar este job?\n${job.prompt?.slice(0, 80) || jid}`)) return;
                                setActionLoading(p => ({ ...p, [`deljob1_${jid}`]: true }));
                                try {
                                  await apiFetch<any>(`/api/admin/jobs/${jid}`, { method: "DELETE" });
                                  toast({ title: "🗑️ Job eliminado" });
                                  if (data?.user?.email) await loadDashboard(data.user.email);
                                } catch (e: any) {
                                  toast({ title: "Error", description: e.message, variant: "destructive" });
                                } finally {
                                  setActionLoading(p => ({ ...p, [`deljob1_${jid}`]: false }));
                                }
                              }}
                            >
                              {actionLoading[`deljob1_${jid}`] ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
                            </Button>
                          </div>
                        </div>
                        {isJobOpen && (
                          <div className="border-t border-white/5 bg-black/40 p-3">
                            <div className="text-[10px] text-white/40 mb-1.5 flex items-center gap-1.5">
                              <RefreshCw className="h-3 w-3 animate-spin" /> Consola en vivo (actualiza cada 3s)
                            </div>
                            <div className="font-mono text-[10px] leading-relaxed max-h-64 overflow-auto bg-black/50 rounded p-2 space-y-0.5">
                              {jlogs.length === 0
                                ? <span className="text-white/30">Sin logs disponibles para este job todavía…</span>
                                : jlogs.map((l: any, i: number) => (
                                  <div key={i} className="text-white/70">
                                    <span className="text-white/30 mr-2">{l.createdAt ? new Date(l.createdAt).toLocaleTimeString() : ""}</span>
                                    <span className={l.level === "error" ? "text-red-400" : l.level === "warn" ? "text-amber-400" : "text-white/70"}>{l.message ?? JSON.stringify(l)}</span>
                                  </div>
                                ))}
                            </div>
                          </div>
                        )}
                        {isJobPreviewOpen && linkedAppId && (
                          <div className="border-t border-white/5 bg-black/30">
                            <iframe
                              src={`${apiBase}/api/admin/apps/${linkedAppId}/preview`}
                              className="w-full border-0"
                              style={{ height: "600px", background: "#0a0a0f" }}
                              title={`Preview job ${jid}`}
                              sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals"
                              allow="clipboard-read; clipboard-write"
                            />
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            </div>
          )}

          {/* Apps generadas del cliente — igual que su sección "Apps generadas" */}
          <div>
            <h3 className="text-sm font-semibold text-white/70 mb-2 flex items-center gap-2">
              <LayoutDashboard className="h-4 w-4 text-sky-400" />
              Apps generadas ({apps.length})
            </h3>

            {/* Banner de alerta cuando hay apps bloqueadas */}
            {apps.filter((a: any) => a.pendingAdminApproval).length > 0 && (
              <div className="mb-3 rounded-lg border border-red-500/30 bg-red-500/10 p-3 flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <span className="text-red-400 text-sm">🔒</span>
                  <div>
                    <p className="text-xs font-semibold text-red-400">
                      {apps.filter((a: any) => a.pendingAdminApproval).length} app(s) bloqueada(s) — el cliente no las ve
                    </p>
                    <p className="text-[10px] text-red-400/60">Pulsa el botón "Desbloquear" en cada app para que el cliente pueda verla</p>
                  </div>
                </div>
                <Button
                  size="sm"
                  className="h-7 text-[10px] bg-red-600 hover:bg-red-700 text-white shrink-0"
                  onClick={async () => {
                    try {
                      const blockedApps = apps.filter((a: any) => a.pendingAdminApproval);
                      for (const a of blockedApps) {
                        const id = a.id || a._id;
                        await apiFetch<any>(`/api/admin/apps/${id}/unblock`, { method: "POST" });
                      }
                      toast({ title: `✅ ${blockedApps.length} app(s) desbloqueadas`, description: "El cliente ya puede verlas en su panel." });
                      // Recargar datos del dashboard remoto
                      if (data?.user?.email) await loadDashboard(data.user.email);
                    } catch (e: any) {
                      toast({ title: "Error", description: e.message, variant: "destructive" });
                    }
                  }}
                >
                  🔓 Desbloquear todas las de este cliente
                </Button>
              </div>
            )}

            {apps.length === 0 ? (
              <div className="space-y-3">
                <div className="text-center text-xs text-muted-foreground py-3">Este cliente no tiene apps.</div>
                {/* Botones de generación directa cuando no hay apps */}
                {data?.user?.id && (
                  <div className="space-y-2">
                    <p className="text-[10px] text-white/40 text-center">Genera una app nueva para este cliente:</p>
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        className="flex-1 h-8 text-xs bg-emerald-700 hover:bg-emerald-600 text-white"
                        onClick={async () => {
                          const prompt = window.prompt("Prompt para generar la app (MVP básico — 7 módulos garantizados):", "");
                          if (!prompt?.trim()) return;
                          try {
                            const d = await apiFetch<any>(`/api/admin/users/${data.user.id}/generate-app`, {
                              method: "POST",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({ prompt, skipGating: true, forceBasicGeneration: true }),
                            });
                            toast({ title: "⚡ MVP iniciado", description: d.message });
                            setTimeout(() => loadDashboard(data.user.email), 2000);
                          } catch (e: any) {
                            toast({ title: "Error", description: e.message, variant: "destructive" });
                          }
                        }}
                      >
                        ⚡ Generar MVP (7 módulos)
                      </Button>
                      <Button
                        size="sm"
                        className="flex-1 h-8 text-xs bg-violet-700 hover:bg-violet-600 text-white"
                        onClick={async () => {
                          const prompt = window.prompt("Prompt para generar app COMPLETA:", "");
                          if (!prompt?.trim()) return;
                          try {
                            const d = await apiFetch<any>(`/api/admin/users/${data.user.id}/generate-app`, {
                              method: "POST",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({ prompt, skipGating: true, forceBasicGeneration: false }),
                            });
                            toast({ title: "🏗️ Generación completa iniciada", description: d.message });
                            setTimeout(() => loadDashboard(data.user.email), 2000);
                          } catch (e: any) {
                            toast({ title: "Error", description: e.message, variant: "destructive" });
                          }
                        }}
                      >
                        🏗️ Generar completa
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="space-y-3">
                {apps.map((app) => {
                  const appId = app.id || app._id;
                  const isPreviewOpen = previewAppId === appId;
                  return (
                    <Card key={appId} className="bg-card/40 border-white/5 overflow-hidden">
                      <CardContent className="p-0">
                        <div className="flex items-center justify-between p-3 gap-3">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <p className="text-sm font-semibold text-white/90 truncate">{app.title || "Sin título"}</p>
                              {app.pendingAdminApproval
                                ? <Badge variant="outline" className="text-[9px] border-red-500/30 text-red-400">🔒 oculta al cliente</Badge>
                                : <Badge variant="outline" className="text-[9px] border-emerald-500/30 text-emerald-400">🔓 visible</Badge>}
                            </div>
                            <p className="text-[10px] text-white/40 truncate mt-0.5">{app.description || "(sin descripción)"}</p>
                            <span className="text-[9px] font-mono text-white/25 cursor-pointer hover:text-white/50"
                              onClick={() => { navigator.clipboard?.writeText(appId); toast({ title: "ID copiado", description: appId }); }}
                              title="Click para copiar App ID">📦 {appId}</span>
                          </div>
                          <div className="flex items-center gap-1.5 shrink-0 flex-wrap justify-end">
                            <Button size="sm" variant="outline" className="h-7 text-[10px] border-sky-500/20 text-sky-300 hover:bg-sky-500/10"
                              onClick={() => setPreviewAppId(isPreviewOpen ? null : appId)}>
                              {isPreviewOpen ? "Cerrar" : <><Eye className="h-3 w-3 mr-1" />Probar app</>}
                            </Button>
                            <Button size="sm" variant="outline" className="h-7 text-[10px] border-sky-500/30 text-sky-400 hover:bg-sky-500/10"
                              onClick={() => window.open(`${apiBase}/api/apps/${appId}/preview`, "_blank", "noopener,noreferrer")}>
                              🔗 Nueva pestaña
                            </Button>
                            <Button size="sm" variant="outline"
                              className={`h-7 text-[10px] ${app.pendingAdminApproval ? "border-red-500/40 text-red-400 hover:bg-red-500/10" : "border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/10"}`}
                              disabled={actionLoading[`unblock_${appId}`]}
                              onClick={() => unblockApp(appId, app.title)}>
                              {actionLoading[`unblock_${appId}`] ? <Loader2 className="h-3 w-3 animate-spin" /> : app.pendingAdminApproval ? <>🔒 Desbloquear</> : <>🔓 Visible</>}
                            </Button>
                            {/* Botón de eliminar app — solo visible para admin */}
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 w-7 p-0 border-red-500/20 text-red-400/60 hover:border-red-500/50 hover:text-red-400 hover:bg-red-500/10"
                              disabled={actionLoading[`delapp_${appId}`]}
                              title={`Eliminar app "${app.title || appId}" permanentemente`}
                              onClick={async () => {
                                if (!window.confirm(`¿Eliminar la app "${app.title || appId}" del cliente?\n\nEsta acción es permanente y no se puede deshacer.`)) return;
                                setActionLoading(p => ({ ...p, [`delapp_${appId}`]: true }));
                                try {
                                  await apiFetch(`/api/admin/apps/${appId}`, { method: "DELETE" });
                                  toast({ title: "🗑️ App eliminada", description: `"${app.title || appId}" eliminada correctamente` });
                                  // Recargar el dashboard del cliente
                                  if (data?.user?.email) await loadDashboard(data.user.email);
                                } catch (e: any) {
                                  toast({ title: "Error al eliminar", description: e.message, variant: "destructive" });
                                } finally {
                                  setActionLoading(p => ({ ...p, [`delapp_${appId}`]: false }));
                                }
                              }}
                            >
                              {actionLoading[`delapp_${appId}`]
                                ? <Loader2 className="h-3 w-3 animate-spin" />
                                : <Trash2 className="h-3 w-3" />
                              }
                            </Button>
                          </div>
                        </div>
                        {isPreviewOpen && (
                          <div className="border-t border-white/5 bg-black/30">
                            <iframe
                              src={`${apiBase}/api/apps/${appId}/preview`}
                              className="w-full border-0"
                              style={{ height: "600px", background: "#0a0a0f" }}
                              title={`Preview ${appId}`}
                              sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals"
                              allow="clipboard-read; clipboard-write"
                            />
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
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
      
      // Contar failed por usuario para limitar a los 5 más recientes por usuario
      const failedCountByUser: Record<string, number> = {};
      
      const active = (d.jobs ?? [])
        .map((j: any) => ({ ...j, id: String(j.id ?? j._id ?? ""), userId: String(j.userId ?? "") }))
        .filter((j: any) => {
          if (!j.id || j.id === "undefined") return false;
          if (j.status === "running" || j.status === "queued") return true;
          if (j.status === "reviewing") return true; // reviewing siempre visible
          if (j.status === "repairing" || j.status === "repaired-pending-review") return true; // flujo de soporte/recovery — siempre visible hasta aprobación manual
          if (j.status === "failed") {
            // Máximo 5 failed por usuario para no llenar el panel
            const key = j.userId || j.userEmail || "unknown";
            failedCountByUser[key] = (failedCountByUser[key] || 0) + 1;
            return failedCountByUser[key] <= 5;
          }
          // otros: 48h
          return j.status !== "succeeded" && j.ageMs < 48 * 60 * 60 * 1000;
        })
        .sort((a: any, b: any) => {
          const order: Record<string, number> = { running: 0, repairing: 0, queued: 1, "repaired-pending-review": 1, reviewing: 2, failed: 3 };
          const ao = order[a.status] ?? 4;
          const bo = order[b.status] ?? 4;
          if (ao !== bo) return ao - bo;
          return a.ageMs - b.ageMs; // más reciente primero dentro de cada grupo
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
    // El panel ya consulta métricas y logs por otras vías. A 3 s, varias
    // pestañas exceden el límite compartido por usuario y producen 429.
    pollRef.current = setInterval(fetchJobs, JOB_POLLING.adminJobs);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, []);

  useEffect(() => {
    if (expandedJob) {
      fetchLogs(expandedJob);
      const t = setInterval(() => fetchLogs(expandedJob), JOB_POLLING.adminLogs);
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
          <Badge variant="outline" className="text-xs">
            {jobs.filter((j: any) => j.status === "running" || j.status === "queued" || j.status === "repairing").length} activos
            {jobs.filter((j: any) => j.status === "failed").length > 0 && (
              <span className="text-red-400 ml-1">· {jobs.filter((j: any) => j.status === "failed").length} fallidos</span>
            )}
          </Badge>
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
          <Button
            size="sm"
            variant="outline"
            className="h-6 px-2 text-xs border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/10"
            title="Corregir jobs que muestran 'failed' pero completaron correctamente (failed·done → succeeded)"
            onClick={async () => {
              try {
                const d = await apiFetch<any>("/api/admin/jobs/fix-false-failed", { method: "POST" });
                toast({ title: "✅ Corrección completada", description: d.message });
                await fetchJobs();
              } catch (e: any) {
                toast({ title: "Error", description: e.message, variant: "destructive" });
              }
            }}
          >
            ✅ Corregir failed·done
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-6 px-2 text-xs border-red-500/30 text-red-400 hover:bg-red-500/10"
            title="Borra todos los jobs en estado 'failed' de la lista"
            onClick={async () => {
              if (!confirm("¿Borrar todos los jobs fallidos? Esta acción no se puede deshacer.")) return;
              try {
                const d = await apiFetch<any>("/api/admin/jobs/delete-failed", { method: "POST" });
                toast({ title: "🗑️ Limpieza completada", description: `${d.deleted} job(s) fallido(s) eliminado(s)` });
                await fetchJobs();
              } catch (e: any) {
                toast({ title: "Error", description: e.message, variant: "destructive" });
              }
            }}
          >
            🗑️ Borrar jobs fallidos
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-6 px-2 text-xs border-amber-500/30 text-amber-400 hover:bg-amber-500/10"
            title="Detecta jobs del mismo usuario con el mismo prompt creados con minutos de diferencia (reintentos) y elimina los duplicados, conservando siempre el más reciente"
            onClick={async () => {
              if (!confirm("¿Eliminar jobs repetidos (mismo usuario, mismo prompt, creados con minutos de diferencia)? Se conservará siempre el más reciente de cada grupo.")) return;
              try {
                const d = await apiFetch<any>("/api/admin/jobs/delete-duplicates", { method: "POST" });
                toast({ title: "🧹 Duplicados eliminados", description: `${d.deleted} job(s) repetido(s) eliminado(s)` });
                await fetchJobs();
              } catch (e: any) {
                toast({ title: "Error", description: e.message, variant: "destructive" });
              }
            }}
          >
            🧹 Eliminar jobs repetidos
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-6 px-2 text-xs border-green-500/30 text-green-400 hover:bg-green-500/10"
            title="Desbloquea todas las apps con pendingAdminApproval que llevan más de 10 min ocultas. Para desbloquear la app de un cliente específico, ve a la pestaña Dashboards Remotos."
            onClick={async () => {
              try {
                const d = await apiFetch<any>("/api/admin/apps/unblock-all", { method: "POST" });
                toast({ title: "✅ Apps desbloqueadas", description: d.message });
              } catch (e: any) {
                toast({ title: "Error", description: e.message, variant: "destructive" });
              }
            }}
          >
            🔓 Desbloquear ocultas
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
                    {/* IDs siempre visibles — para soporte */}
                    <div className="flex items-center gap-3 mt-1 flex-wrap">
                      <span
                        className="text-[9px] font-mono text-white/25 hover:text-white/60 cursor-pointer transition-colors"
                        title={`Job ID completo: ${job.id}`}
                        onClick={e => { e.stopPropagation(); navigator.clipboard?.writeText(job.id); }}
                      >
                        🔧 Job: {job.id}
                      </span>
                      {job.userId && (
                        <span
                          className="text-[9px] font-mono text-white/25 hover:text-white/60 cursor-pointer transition-colors"
                          title={`User ID completo: ${job.userId}`}
                          onClick={e => { e.stopPropagation(); navigator.clipboard?.writeText(job.userId); }}
                        >
                          👤 User: {job.userId.slice(0, 16)}…
                        </span>
                      )}
                      {job.appId && (
                        <span
                          className="text-[9px] font-mono text-white/25 hover:text-white/60 cursor-pointer transition-colors"
                          title={`App ID completo: ${job.appId}`}
                          onClick={e => { e.stopPropagation(); navigator.clipboard?.writeText(job.appId); }}
                        >
                          📦 App: {job.appId}
                        </span>
                      )}
                    </div>
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
                    {(job.status === "failed" || job.status === "reviewing") && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 px-2 text-xs border-red-500/40 text-red-400 hover:bg-red-500/20 hover:border-red-500/60"
                        title="Eliminar este job definitivamente"
                        disabled={actionLoading[`del1_${job.id}`]}
                        onClick={async e => {
                          e.stopPropagation();
                          if (!window.confirm(`¿Eliminar este job de ${job.userEmail}?\n\n"${job.prompt?.slice(0, 80)}..."\n\nEsta acción no se puede deshacer.`)) return;
                          setActionLoading(p => ({ ...p, [`del1_${job.id}`]: true }));
                          try {
                            const d = await apiFetch<any>("/api/admin/jobs/bulk", {
                              method: "DELETE",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({ jobIds: [job.id] }),
                            });
                            toast({ title: "🗑️ Job eliminado", description: `Job de ${job.userEmail} eliminado correctamente` });
                            await fetchJobs();
                          } catch (err: any) {
                            toast({ title: "Error al eliminar", description: err.message, variant: "destructive" });
                          } finally {
                            setActionLoading(p => ({ ...p, [`del1_${job.id}`]: false }));
                          }
                        }}
                      >
                        {actionLoading[`del1_${job.id}`] ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
                      </Button>
                    )}
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

                    {/* Alerta de jobs duplicados */}
                    {jobs.filter((j: any) => j.userId === job.userId && (j.status === "running" || j.status === "queued")).length > 1 && (
                      <div className="mx-3 mt-2 p-2 rounded bg-yellow-500/10 border border-yellow-500/20 flex items-center justify-between gap-2">
                        <span className="text-[10px] text-yellow-400">
                          ⚠️ {jobs.filter((j: any) => j.userId === job.userId && (j.status === "running" || j.status === "queued")).length} jobs corriendo en paralelo para este usuario
                        </span>
                        <Button
                          size="sm"
                          className="h-6 text-[10px] bg-yellow-600 hover:bg-yellow-700 text-white shrink-0"
                          onClick={async e => {
                            e.stopPropagation();
                            try {
                              const d = await apiFetch<any>(`/api/admin/users/${job.userId}/kill-duplicates`, { method: "POST" });
                              toast({ title: "✅ Duplicados cancelados", description: d.message });
                              await fetchJobs();
                            } catch (e: any) {
                              toast({ title: "Error", description: e.message, variant: "destructive" });
                            }
                          }}
                        >
                          Cancelar duplicados
                        </Button>
                      </div>
                    )}
                    {/* Job pausado esperando confirmación del admin (ej. "El backend se
                        ha pausado para tu revisión. Dime 'Continúa con el backend'") —
                        esto NO es un fallo que reparar, es el pipeline esperando la
                        palabra exacta que activa la siguiente fase. Botón directo en
                        vez de tener que escribirla a mano cada vez. */}
                    {(() => {
                      const pauseLog = [...jobLogs].reverse().find((l: any) =>
                        /se ha pausado para tu revisión/i.test(l.message || ""),
                      );
                      if (!pauseLog) return null;
                      const suggestedInstruction = /backend/i.test(pauseLog.message)
                        ? "Continúa con el backend"
                        : "Continúa con la siguiente fase";
                      return (
                        <div className="p-3 border-t border-amber-500/20 bg-amber-500/5">
                          <p className="text-xs text-amber-300 mb-2">
                            ⏸️ Este job está pausado esperando tu confirmación — no es un fallo.
                          </p>
                          <Button
                            size="sm"
                            className="w-full h-8 bg-amber-600 hover:bg-amber-700 text-white text-xs"
                            disabled={actionLoading[`continue_${job.id}`]}
                            onClick={async () => {
                              setActionLoading(p => ({ ...p, [`continue_${job.id}`]: true }));
                              try {
                                const d = await apiFetch<any>(`/api/admin/jobs/${job.id}/continue`, {
                                  method: "POST",
                                  headers: { "Content-Type": "application/json" },
                                  body: JSON.stringify({ instruction: suggestedInstruction }),
                                });
                                toast({ title: "▶️ Continuando", description: d.message });
                                await fetchJobs();
                              } catch (e: any) {
                                toast({ title: "Error", description: e.message, variant: "destructive" });
                              } finally {
                                setActionLoading(p => ({ ...p, [`continue_${job.id}`]: false }));
                              }
                            }}
                          >
                            {actionLoading[`continue_${job.id}`] ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : "▶️"} {suggestedInstruction}
                          </Button>
                        </div>
                      );
                    })()}
                    <div className="p-3 space-y-2">
                      <p className="text-[10px] text-muted-foreground font-mono uppercase tracking-wider flex items-center gap-1">
                        <Zap className="h-3 w-3 text-violet-400" />
                        Acciones de recuperación
                      </p>

                      {/* ── Prompt original completo del cliente ── */}
                      {job.prompt && (() => {
                        const fullPrompt = cleanJobPrompt(job.prompt, 9999);
                        return fullPrompt && fullPrompt !== "tu proyecto" ? (
                          <div className="rounded-lg border border-white/[0.07] bg-black/30 p-2.5 space-y-2">
                            <div className="flex items-center justify-between">
                              <span className="text-[10px] font-mono text-violet-400 uppercase tracking-wider">📋 Prompt original del cliente</span>
                              <button
                                className="text-[10px] text-white/40 hover:text-white transition px-2 py-0.5 rounded border border-white/10 hover:border-white/30"
                                onClick={e => { e.stopPropagation(); navigator.clipboard?.writeText(fullPrompt); }}
                              >
                                Copiar
                              </button>
                            </div>
                            <p className="text-[11px] text-white/70 leading-relaxed whitespace-pre-wrap break-words max-h-40 overflow-y-auto">
                              {fullPrompt}
                            </p>
                            <div className="flex gap-2 pt-1">
                              <button
                                className="text-[10px] text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/10 rounded px-2 py-1 transition"
                                onClick={e => {
                                  e.stopPropagation();
                                  setRepairPrompt(p => ({ ...p, [job.id]: fullPrompt }));
                                }}
                              >
                                ✏️ Editar y regenerar
                              </button>
                              <button
                                className="text-[10px] text-blue-400 border border-blue-500/30 hover:bg-blue-500/10 rounded px-2 py-1 transition"
                                onClick={async e => {
                                  e.stopPropagation();
                                  if (!window.confirm(`¿Regenerar desde 0 con el prompt original de ${job.userEmail}?`)) return;
                                  setActionLoading(p => ({ ...p, [`regenoriginal_${job.id}`]: true }));
                                  try {
                                    await apiFetch<any>(`/api/admin/users/${job.userId}/generate-app`, {
                                      method: "POST",
                                      headers: { "Content-Type": "application/json" },
                                      body: JSON.stringify({ prompt: fullPrompt, isRepair: false }),
                                    });
                                    toast({ title: "🚀 Regenerando con prompt original", description: `Job lanzado para ${job.userEmail}` });
                                    await fetchJobs();
                                  } catch (err: any) {
                                    toast({ title: "Error", description: err?.message, variant: "destructive" });
                                  } finally {
                                    setActionLoading(p => ({ ...p, [`regenoriginal_${job.id}`]: false }));
                                  }
                                }}
                              >
                                {actionLoading[`regenoriginal_${job.id}`]
                                  ? <Loader2 className="h-3 w-3 animate-spin inline" />
                                  : "🔄 Regenerar con este prompt"}
                              </button>
                            </div>
                          </div>
                        ) : null;
                      })()}
                      {/* Borrar todos los jobs fallidos/reviewing de este usuario */}
                      <Button
                        size="sm"
                        variant="outline"
                        className="w-full h-7 text-xs border-red-900/40 text-red-500/70 hover:bg-red-500/10 hover:text-red-400"
                        onClick={async e => {
                          e.stopPropagation();
                          const isOwnJob = job.userEmail === "rrhh.milchollos@gmail.com" || job.userEmail === "soportemarisai@gmail.com";
                          const who = isOwnJob ? `tus propios jobs (${job.userEmail})` : `los jobs del cliente ${job.userEmail}`;
                          if (!window.confirm(`¿Borrar TODOS los jobs failed/reviewing de ${who}? Esta acción no se puede deshacer.`)) return;
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
                          : `🗑️ Limpiar historial de jobs — ${job.userEmail?.split("@")[0]}`
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
                            ? <><Loader2 className="h-3 w-3 animate-spin mr-1" />Reparando…</>
                            : <><RefreshCw className="h-3 w-3 mr-1" />Reparar en sitio</>
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
                      {/* Botón para saltar las preguntas técnicas cuando el admin generó
                          la app y el job quedó pausado en awaiting_technical_clarification.
                          El cliente nunca verá las preguntas — la generación continúa directo. */}
                      {(job.status === "awaiting_approval" || job.phase === "awaiting_technical_clarification") && (
                        <Button
                          size="sm"
                          className="w-full h-9 text-xs bg-emerald-600 hover:bg-emerald-700 text-white font-bold"
                          onClick={async () => {
                            setActionLoading(p => ({ ...p, [`skipgating_${job.id}`]: true }));
                            try {
                              const d = await apiFetch<any>(`/api/admin/jobs/${job.id}/skip-gating`, { method: "POST" });
                              toast({ title: "⏩ Generación reanudada", description: d.message });
                              await fetchJobs();
                            } catch (e: any) {
                              toast({ title: "Error", description: e.message, variant: "destructive" });
                            } finally {
                              setActionLoading(p => ({ ...p, [`skipgating_${job.id}`]: false }));
                            }
                          }}
                          disabled={actionLoading[`skipgating_${job.id}`]}
                          title="Salta las preguntas técnicas y reanuda la generación directamente. El cliente verá el preview cuando esté listo."
                        >
                          {actionLoading[`skipgating_${job.id}`]
                            ? <><Loader2 className="h-3 w-3 animate-spin mr-1" />Reanudando…</>
                            : <>⏩ Saltar preguntas y generar para el cliente</>
                          }
                        </Button>
                      )}

                      {job.status === "repaired-pending-review" && (
                        <Button
                          size="sm"
                          className="w-full h-9 text-xs bg-violet-600 hover:bg-violet-700 text-white"
                          onClick={async () => {
                            setActionLoading(p => ({ ...p, [`approve_${job.id}`]: true }));
                            try {
                              const d = await apiFetch<any>(`/api/admin/jobs/${job.id}/approve-for-client`, { method: "POST" });
                              toast({ title: "✅ App aprobada", description: d.message });
                              await fetchJobs();
                            } catch (e: any) {
                              toast({ title: "Error", description: e.message, variant: "destructive" });
                            } finally {
                              setActionLoading(p => ({ ...p, [`approve_${job.id}`]: false }));
                            }
                          }}
                          disabled={actionLoading[`approve_${job.id}`]}
                        >
                          {actionLoading[`approve_${job.id}`]
                            ? <><Loader2 className="h-3 w-3 animate-spin mr-1" />Aprobando…</>
                            : <>✅ Reparación revisada — mostrar al cliente</>
                          }
                        </Button>
                      )}
                      {/* Vista previa — dos botones: iframe inline + abrir en nueva pestaña */}
                      <div className="grid grid-cols-2 gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-8 text-xs border-sky-500/30 text-sky-400 hover:bg-sky-500/10"
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
                            ? <><Loader2 className="h-3 w-3 animate-spin mr-1" />Buscando…</>
                            : previewAppId === `job_${job.id}`
                              ? <><Eye className="h-3 w-3 mr-1" />Cerrar preview</>
                              : <><Eye className="h-3 w-3 mr-1" />Preview inline</>
                          }
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-8 text-xs border-sky-400/40 text-sky-300 hover:bg-sky-500/15 font-semibold"
                          disabled={actionLoading[`previewtab_${job.id}`]}
                          onClick={async () => {
                            const apiBase = getApiBaseUrl();
                            // Obtener appId — del job o buscando en BD
                            let appId = job.appId;
                            if (!appId) {
                              setActionLoading(p => ({ ...p, [`previewtab_${job.id}`]: true }));
                              try {
                                const d = await apiFetch<any>(`/api/admin/users/${job.userId}/apps?limit=1`);
                                const firstApp = (d.apps ?? [])[0];
                                appId = firstApp?.id || firstApp?._id || null;
                              } catch { /* swallow */ } finally {
                                setActionLoading(p => ({ ...p, [`previewtab_${job.id}`]: false }));
                              }
                            }
                            if (appId) {
                              window.open(`${apiBase}/api/admin/apps/${appId}/preview`, "_blank", "noopener,noreferrer");
                            } else {
                              toast({ title: "Sin app generada", description: "Este usuario no tiene apps creadas.", variant: "destructive" });
                            }
                          }}
                        >
                          {actionLoading[`previewtab_${job.id}`]
                            ? <><Loader2 className="h-3 w-3 animate-spin mr-1" />Buscando…</>
                            : <>🔗 Abrir en nueva pestaña</>
                          }
                        </Button>
                      </div>
                      {/* Panel de vista previa inline — solo para este job */}
                      {previewAppId === `job_${job.id}` && job.appId && (
                        <div className="rounded-lg border border-sky-500/20 overflow-hidden">
                          <div className="flex items-center justify-between px-3 py-1.5 bg-sky-500/10 border-b border-sky-500/20">
                            <span className="text-[10px] text-sky-400 font-mono truncate max-w-[200px]">
                              {job.userEmail}
                            </span>
                            <button
                              className="text-[10px] text-sky-400 hover:text-sky-300 underline shrink-0 ml-2"
                              onClick={() => {
                                const apiBase = getApiBaseUrl();
                                window.open(`${apiBase}/api/admin/apps/${job.appId}/preview`, "_blank", "noopener,noreferrer");
                              }}
                            >
                              Abrir en pestaña ↗
                            </button>
                          </div>
                          <iframe
                            src={`${getApiBaseUrl()}/api/apps/${job.appId}/preview`}
                            className="w-full bg-white"
                            style={{ height: 480, border: "none" }}
                            title={`Preview ${job.userEmail}`}
                          />
                        </div>
                      )}
                      {/* Botón enviar disculpas al cliente */}
                      <Button
                        size="sm"
                        variant="outline"
                        className="w-full h-8 text-xs border-violet-500/30 text-violet-400 hover:bg-violet-500/10"
                        disabled={actionLoading[`apology_${job.id}`]}
                        onClick={async e => {
                          e.stopPropagation();
                          const recipient = window.prompt(
                            "Email del cliente al que enviar las disculpas:",
                            job.userEmail !== "rrhh.milchollos@gmail.com" && job.userEmail !== "soportemarisai@gmail.com"
                              ? job.userEmail
                              : "faquiunmen@gmail.com"
                          );
                          if (!recipient) return;
                          if (!window.confirm(`¿Enviar email de disculpas a ${recipient}?\n\nSolo envíalo si has verificado que su app se ve correctamente.`)) return;
                          setActionLoading(p => ({ ...p, [`apology_${job.id}`]: true }));
                          try {
                            const d = await apiFetch<any>(`/api/admin/jobs/${job.id}/send-apology`, {
                              method: "POST",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({ recipientEmail: recipient }),
                            });
                            toast({ title: "💜 Email de disculpas enviado", description: d.message });
                          } catch (e: any) {
                            toast({ title: "Error al enviar", description: e.message, variant: "destructive" });
                          } finally {
                            setActionLoading(p => ({ ...p, [`apology_${job.id}`]: false }));
                          }
                        }}
                      >
                        {actionLoading[`apology_${job.id}`]
                          ? <><Loader2 className="h-3 w-3 animate-spin mr-1" />Enviando…</>
                          : <>💜 Enviar disculpas al cliente</>
                        }
                      </Button>
                      {/* Plantillas de correo de reactivación/seguimiento desde el panel en vivo */}
                      <EmailTemplateMenu
                        recipientEmail={job.userEmail || ""}
                        userName={undefined}
                        appTitle={cleanJobPrompt(job.prompt)}
                        userId={job.userId}
                      />
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
                      <div className="flex items-center gap-1 flex-wrap">
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
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <button className="text-[10px] px-2 py-1 rounded border border-violet-500/40 bg-violet-500/10 text-violet-300 hover:bg-violet-500/20 transition-colors font-medium flex items-center gap-1">
                              Más opciones <ChevronDown className="h-3 w-3" />
                            </button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="start" className="w-64 max-h-[70vh] overflow-y-auto">
                            <DropdownMenuLabel className="text-xs text-muted-foreground">
                              Catálogo de instrucciones por categoría
                            </DropdownMenuLabel>
                            <DropdownMenuSeparator />
                            {REPAIR_INSTRUCTION_CATEGORIES.map(category => (
                              <DropdownMenuSub key={category.label}>
                                <DropdownMenuSubTrigger className="text-xs">
                                  <span className="mr-2">{category.icon}</span>
                                  {category.label}
                                </DropdownMenuSubTrigger>
                                <DropdownMenuPortal>
                                  <DropdownMenuSubContent className="w-72">
                                    {category.options.map(option => (
                                      <DropdownMenuItem
                                        key={option}
                                        className="text-xs cursor-pointer"
                                        onClick={() => setRepairPrompt(p => ({ ...p, [job.id]: option }))}
                                      >
                                        {option}
                                      </DropdownMenuItem>
                                    ))}
                                  </DropdownMenuSubContent>
                                </DropdownMenuPortal>
                              </DropdownMenuSub>
                            ))}
                          </DropdownMenuContent>
                        </DropdownMenu>
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
  const [launchingSeguxat, setLaunchingSeguxat] = useState<string | null>(null);

  const SEGUXAT_USER_EMAIL = "rrhh.milchollos@gmail.com";

  const SEGUXAT_PROJECTS = [
    {
      id: "cra",
      label: "🚨 CRA Alarmas Seguxat",
      kind: "fullstack",
      prompt: `Crea una aplicación web profesional completa llamada "Seguxat CRA — Central Receptora de Alarmas" con diseño oscuro premium igual que seguxat.es (colores: rojo #e63946, negro #0a0a0a, blanco). FUNCIONALIDADES COMPLETAS:

1. DASHBOARD PRINCIPAL: Mapa interactivo de Valencia con pins de alarmas activas, contadores en tiempo real (Alarmas nuevas/En gestión/Resueltas/Falsas alarmas), gráficas del día por tipo de alarma y hora, estado de operadores en turno.

2. PANEL ALARMAS EN TIEMPO REAL: Tabla de señales recibidas con columnas (ID zona, Cliente, Dirección, Tipo alarma: intrusión/fuego/pánico/técnica, Hora recepción, Estado, Operador asignado), botones de acción: Verificar llamando, Despachar policía/bomberos, Marcar falsa alarma, Cerrar incidencia, campo de notas.

3. GESTIÓN DE CLIENTES: Ficha completa con datos personales, dirección instalación, teléfonos de contacto ordenados por prioridad, código personal de verificación, zona y dispositivos instalados, historial de incidencias, estado del contrato, tipo de servicio (hogar/negocio/GPS/Escudo Vecinal).

4. GESTIÓN DE OPERADORES Y TURNOS: Registro completo de trabajadores con nombre, DNI, email, teléfono, rol (Operador CRA / Supervisor / Técnico / Administrador), turno asignado (mañana 06-14h / tarde 14-22h / noche 22-06h), estado activo/inactivo, historial de incidencias gestionadas, estadísticas de rendimiento.

5. REGISTRO DE INCIDENCIAS: Log completo con filtros por fecha, cliente, tipo, operador, estado. Cada incidencia con timeline completo de acciones tomadas. Exportación a PDF y Excel.

6. CONFIGURACIÓN: Zonas de cobertura, tipos de dispositivos, protocolos de actuación, umbrales de alarma.

LOGIN con roles diferenciados. Backend con base de datos MongoDB. Interfaz responsive con sidebar de navegación.`,
    },
    {
      id: "crm",
      label: "💼 CRM Ventas Seguxat",
      kind: "fullstack",
      prompt: `Crea una aplicación web profesional completa llamada "Seguxat CRM — Gestión Comercial" con diseño igual que seguxat.es (rojo #e63946, negro, blanco). FUNCIONALIDADES COMPLETAS:

1. DASHBOARD VENTAS: KPIs principales (contratos firmados hoy/semana/mes, facturación acumulada, tasa de conversión por comercial, objetivos vs real), gráficas de rendimiento por comercial y zona geográfica, pipeline visual de oportunidades, próximas visitas del día.

2. PIPELINE COMERCIAL: Vista Kanban con columnas (Nuevo lead → Contactado → Visita agendada → Presupuesto enviado → Negociación → Contrato firmado / Perdido). Cada tarjeta con datos del lead, valor estimado, comercial asignado, días en fase.

3. GESTIÓN DE LEADS: Ficha completa (nombre, empresa, teléfono, email, dirección, origen del lead: web/referido/puerta fría/evento, producto de interés: alarma hogar/negocio/GPS SOS Sentinel/Escudo Vecinal/pack completo, temperatura: frío/tibio/caliente, notas de seguimiento, historial de contactos).

4. CLIENTES ACTIVOS: Contrato activo con fecha inicio/fin, productos instalados, facturación mensual, historial de pagos, renovaciones pendientes, satisfacción del cliente (NPS), tickets de soporte abiertos.

5. EQUIPO COMERCIAL: Registro de trabajadores (nombre completo, DNI, email corporativo, teléfono, zona asignada en Valencia/Comunitat, objetivos mensuales en número de contratos y €, comisión por tipo de producto, historial de ventas mes a mes, ranking en el equipo).

6. AGENDA Y VISITAS: Calendario de visitas asignadas por comercial, confirmación de citas, registro de resultado de visita, generación automática de seguimiento.

7. PRESUPUESTOS: Generador de presupuestos PDF con productos Seguxat (alarma hogar desde 9€/mes, alarma negocio, GPS SOS Sentinel, Escudo Vecinal), personalizable con datos del cliente, firma digital.

8. INFORMES: Ventas por comercial/zona/producto/período, comparativas mensuales, exportación Excel/PDF.

LOGIN con roles: Comercial / Supervisor de zona / Director comercial / Administrador. Backend MongoDB completo.`,
    },
    {
      id: "revista",
      label: "📰 Revista Digital Seguxat",
      kind: "fullstack",
      prompt: `Crea una revista digital online completa y profesional llamada "Seguxat Magazine" con el subtítulo "Seguridad Real para tu Hogar y Negocio" con diseño premium idéntico a seguxat.es (rojo #e63946, negro profundo, blanco, tipografía moderna Inter/Montserrat). La revista debe ser tan profesional como las de Securitas Direct o Verisure. ESTRUCTURA COMPLETA:

1. PORTADA: Header animado con logo Seguxat, fecha del número actual, imagen hero de portada impactante, titular principal del mes, 6 miniaturas de artículos destacados con categoría y titular.

2. SECCIÓN "SEGURIDAD EN EL HOGAR" (4 artículos completos): "10 puntos débiles de tu casa que los ladrones conocen", "Cómo preparar tu hogar antes de vacaciones", "Alarmas vs cámaras: qué necesitas realmente", "El protocolo que siguen nuestros operadores cuando salta tu alarma".

3. SECCIÓN "SEGURIDAD EMPRESARIAL" (3 artículos): "Normativa de seguridad obligatoria para negocios en Valencia 2025", "Cómo una alarma evitó el robo de una joyería en Xàtiva", "ROI de instalar un sistema de seguridad en tu local".

4. SECCIÓN "TECNOLOGÍA SEGUXAT" (3 artículos con infografías): "GPS SOS Sentinel: así funciona la localización en tiempo real", "Escudo Vecinal: la seguridad colectiva que cambia los barrios", "Nuestra CRA: 24/7 y en menos de 45 segundos respondemos".

5. SECCIÓN "COMUNITAT VALENCIANA": Noticias de seguridad locales, estadísticas de robos en Valencia/Alicante/Castellón, reportaje de barrio protegido por Escudo Vecinal.

6. COMPARATIVA: Tabla detallada Seguxat vs Securitas Direct vs Verisure (precio, permanencia, respuesta CRA, cobertura, valoraciones clientes). Seguxat destaca en sin permanencia y precio.

7. "CÓMO FUNCIONA": Infografías animadas del proceso de instalación (3 pasos), cómo funciona la CRA, cómo funciona el GPS SOS.

8. SUSCRIPCIÓN: Formulario de suscripción a la revista con email, CTA para solicitar presupuesto gratuito.

Contenido 100% real y coherente con seguxat.es. Todos los artículos con texto completo de al menos 300 palabras. Diseño de revista real con tipografía editorial, fotografías de placeholder profesionales, numeración de páginas.`,
    },
  ];

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

  const launchSeguxatProject = async (project: typeof SEGUXAT_PROJECTS[0]) => {
    setLaunchingSeguxat(project.id);
    try {
      // Buscar usuario de Seguxat
      const userData = await apiFetch<any>(`/api/admin/users/search?email=${encodeURIComponent(SEGUXAT_USER_EMAIL)}`);
      const d = await apiFetch<any>(`/api/admin/users/${userData.id}/launch-project`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: project.prompt, kind: project.kind }),
      });
      toast({ title: `🚀 ${project.label} en cola`, description: d.message });
    } catch (e: any) {
      toast({ title: "Error", description: e?.message, variant: "destructive" });
    } finally {
      setLaunchingSeguxat(null); }
  };

  const generateApp = async () => {
    if (!foundUser) return;
    setLoading(true);
    try {
      const d = await apiFetch<any>(`/api/admin/users/${foundUser.id}/launch-project`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: prompt.trim() || "", kind: "fullstack" }),
      });
      toast({ title: "✅ Proyecto en cola", description: d.message ?? `Generando para ${foundUser.email}` });
      setFoundUser(null); setEmail(""); setPrompt("");
    } catch (e: any) {
      toast({ title: "Error", description: e?.message ?? "No se pudo generar la app", variant: "destructive" });
    } finally { setLoading(false); }
  };

  return (
    <div className="space-y-4">
      {/* Proyectos Seguxat — lanzamiento rápido */}
      <div className="rounded-lg border border-red-500/20 bg-red-500/5 p-4 space-y-3">
        <p className="text-xs font-semibold text-red-400 uppercase tracking-wider flex items-center gap-2">
          <span className="text-lg">🔴</span> Proyectos Seguxat — Lanzamiento directo
        </p>
        <p className="text-xs text-white/40">Se generan en tu cuenta (rrhh.milchollos@gmail.com) con Sonnet completo</p>
        <div className="grid gap-2">
          {SEGUXAT_PROJECTS.map(project => (
            <Button
              key={project.id}
              variant="outline"
              className="w-full h-10 text-sm border-red-500/30 text-white hover:bg-red-500/10 justify-start gap-3"
              disabled={launchingSeguxat !== null}
              onClick={() => launchSeguxatProject(project)}
            >
              {launchingSeguxat === project.id
                ? <><Loader2 className="h-4 w-4 animate-spin" />Lanzando…</>
                : <>{project.label}</>
              }
            </Button>
          ))}
        </div>
      </div>

      <div className="border-t border-white/5 pt-4">
        <p className="text-xs text-muted-foreground mb-3">O genera un proyecto personalizado para cualquier usuario:</p>
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
            {loading ? <><Loader2 className="h-3 w-3 animate-spin mr-2" />Generando…</> : <><Zap className="h-3 w-3 mr-2" />Generar proyecto para este usuario</>}
          </Button>
        </div>
      )}
      </div>
    </div>
  );
}




// A petición explícita del usuario: "desplegable con clichés ya añadidos"
// para enviar correos a clientes de forma rápida desde el panel de admin,
// sin tener que escribir el texto desde cero cada vez. Cada plantilla
// rellena asunto + cuerpo automáticamente (con el nombre/título de la app
// ya sustituidos), y el admin puede editar el texto en el Dialog antes de
// confirmar el envío — nunca se manda nada sin que el admin lo vea primero.
interface EmailTemplateDef {
  id: string;
  label: string;
  icon: string;
  subject: (ctx: { appTitle: string; userName: string }) => string;
  body: (ctx: { appTitle: string; userName: string }) => string;
  defaultCredits?: number;
}

// Limpia el prompt técnico interno para mostrar solo lo que el cliente escribió.
// El prefijo [MARIS AI REQUEST LOCALE] puede ir seguido del texto real del cliente
// en la misma línea (source=admin-inject. Texto real aquí) o en línea aparte.
function cleanJobPrompt(raw: string | undefined, maxLen = 60): string {
  if (!raw) return "tu proyecto";
  const cleaned = raw
    // Caso 1: prefijo + "Use this for all..." + texto real en la misma cadena
    .replace(/\[MARIS AI REQUEST LOCALE\].*?(?:Use this for all user-visible copy[^.]*\.\s*)/is, "")
    // Caso 2: prefijo hasta el primer punto + espacio (source=admin-inject. Texto real)
    .replace(/\[MARIS AI REQUEST LOCALE\][^.]*\.\s*/i, "")
    // Otros prefijos de sistema que ocupan toda su línea
    .replace(/\[ADMIN REPAIR\][^\n]*/gi, "")
    .replace(/\[EXTRAS CONFIRMADOS[^\]]*\][^\n]*/gi, "")
    .replace(/\[DETALLES ADICIONALES[^\]]*\][^\n]*/gi, "")
    .replace(/\[IMPORTADO\][^\n]*/gi, "")
    .replace(/\[MARIS_ENGINE[^\]]*\][^\n]*/gi, "")
    .replace(/^[\s.\-]+/, "")
    .trim();
  return cleaned.slice(0, maxLen).trim() || "tu proyecto";
}

const EMAIL_TEMPLATES: EmailTemplateDef[] = [
  {
    id: "apology",
    label: "Disculpas — problema resuelto",
    icon: "💜",
    subject: ({ appTitle }) => `✅ "${appTitle}" lista — problema resuelto por soporte`,
    body: ({ appTitle }) => `Queremos pedirte disculpas sinceras por la experiencia que has tenido con "${appTitle}". Nuestro equipo de soporte ha revisado el problema, aplicado las correcciones necesarias y verificado que todo funciona correctamente.\n\nTu app ya está disponible en tu panel, lista para que la explores, edites y publiques.\n\nSi tienes cualquier otra duda, responde a este email y te atendemos de inmediato.`,
    defaultCredits: 10,
  },
  {
    id: "incident_resolved",
    label: "Incidencia técnica resuelta",
    icon: "🔧",
    subject: ({ appTitle }) => `🔧 Hemos resuelto la incidencia en "${appTitle}"`,
    body: ({ appTitle }) => `Te escribimos para confirmarte que la incidencia técnica detectada en "${appTitle}" ya ha sido corregida por nuestro equipo.\n\nPuedes volver a tu panel y comprobar que todo funciona con normalidad. Si notas cualquier otro comportamiento extraño, no dudes en escribirnos.`,
    defaultCredits: 0,
  },
  {
    id: "credits_added",
    label: "Créditos añadidos manualmente",
    icon: "🎁",
    subject: () => `🎁 Hemos añadido créditos a tu cuenta de Maris AI`,
    body: () => `Queríamos avisarte de que hemos añadido créditos extra a tu cuenta de Maris AI.\n\nYa están disponibles para que sigas creando o editando tus apps.`,
    defaultCredits: 20,
  },
  {
    id: "low_credits_reminder",
    label: "Recordatorio: pocos créditos",
    icon: "⚡",
    subject: () => `⚡ Te quedan pocos créditos en Maris AI`,
    body: () => `Hemos visto que tu saldo de créditos en Maris AI está bajo.\n\nSi quieres seguir creando o editando tus apps sin interrupciones, puedes activar un plan desde la sección de precios — los paquetes empiezan desde 20€ por 160 créditos, válidos durante 30 días.`,
    defaultCredits: 0,
  },
  {
    id: "follow_up",
    label: "Seguimiento — ¿cómo va todo?",
    icon: "👋",
    subject: ({ appTitle }) => `👋 ¿Qué tal va "${appTitle}"?`,
    body: ({ appTitle, userName }) => `Hola${userName ? ` ${userName}` : ""},

Somos el equipo de Maris AI y queríamos saber cómo te está yendo con "${appTitle}". Nos importa que tu experiencia sea la mejor posible y que tu app quede exactamente como la necesitas.

Si tienes cualquier duda, algo no funciona como esperabas, o simplemente quieres mejorar alguna parte de tu app, estamos aquí para ayudarte:

🎫 Soporte por ticket — Escríbenos directamente respondiendo a este correo y te atendemos en menos de 2 horas.

💬 Soporte por WhatsApp — También puedes contactarnos por WhatsApp al +34 611 935 616. Te respondemos en español, sin bots, directamente con nuestro equipo.

Todo nuestro soporte es en español 🇪🇸 y completamente personalizado — no recibirás respuestas automáticas, sino atención real de personas que conocen la plataforma a fondo.

Gracias por confiar en Maris AI. Estamos aquí para lo que necesites.

Un saludo,
El equipo de Maris AI`,
    defaultCredits: 0,
  },
  {
    id: "project_abandoned",
    label: "Proyecto a medias — vuelve a terminarlo",
    icon: "🚀",
    subject: ({ appTitle }) => `🚀 "${appTitle}" te está esperando para finalizarse`,
    body: ({ appTitle, userName }) => `Hola${userName ? ` ${userName}` : ""},

Hemos notado que tu proyecto "${appTitle}" lleva un tiempo parado y nos da pena que se quede a medias… ¡estabas tan cerca!

Tu app ya tiene la base construida, solo necesita ese empujón final para quedar perfecta. Muchas de las mejores apps que han pasado por Maris AI empezaron exactamente igual — un momento de pausa — y luego se convirtieron en algo increíble.

¿Qué tal si le dedicas 5 minutos hoy? Entra en tu panel, retoma el proyecto y dinos qué quieres mejorar. Estamos aquí para ayudarte a cruzar la línea de meta.

👉 Accede ahora: https://www.marisai.es/dashboard

Si tienes alguna duda o algo no te funcionó como esperabas, responde a este correo o escríbenos por WhatsApp al +34 611 935 616. Te atendemos en español en menos de 2 horas.

¡Ánimo, el resultado final va a merecer la pena!

Un saludo,
El equipo de Maris AI`,
    defaultCredits: 0,
  },
  {
    id: "reactivation_urgency",
    label: "Reactivación — tus créditos te esperan",
    icon: "⏰",
    subject: ({ appTitle }) => `⏰ "${appTitle}" sigue ahí esperándote`,
    body: ({ appTitle, userName }) => `Hola${userName ? ` ${userName}` : ""},

Llevamos un tiempo sin verte por aquí y queríamos asegurarnos de que todo va bien. Tu proyecto "${appTitle}" sigue guardado y listo para cuando quieras retomarlo — no hemos tocado nada.

Tu proyecto sigue aquí, pero los créditos de recarga duran 30 días desde la compra — si ya ha pasado ese tiempo, puede que hayan caducado. Entra y comprueba tu saldo para no perder lo que te queda.

Si en algún momento el proyecto se complicó más de lo esperado, no te preocupes — es normal. Cuéntanos qué necesitas y lo resolvemos juntos. Tenemos soporte en español 🇪🇸 y respondemos en menos de 2 horas por correo o WhatsApp (+34 611 935 616).

👉 Retoma tu proyecto: https://www.marisai.es/dashboard

¡Te esperamos!

El equipo de Maris AI`,
    defaultCredits: 0,
  },
  {
    id: "nudge_soft",
    label: "Empujón suave — ¿necesitas ayuda?",
    icon: "💡",
    subject: ({ appTitle }) => `💡 ¿Necesitas ayuda con "${appTitle}"?`,
    body: ({ appTitle, userName }) => `Hola${userName ? ` ${userName}` : ""},

Hemos visto que "${appTitle}" lleva un rato parado y nos preguntamos si hay algo en lo que podamos echarte una mano.

A veces el proyecto se complica, no sabes cómo pedir exactamente lo que quieres, o simplemente el día a día no deja tiempo. Lo entendemos perfectamente.

Lo que sí sabemos es que tienes una idea que vale la pena construir — si no, no habrías llegado hasta aquí. ¿Qué te está frenando? Cuéntanoslo y lo resolvemos:

📩 Responde este correo con lo que necesitas
💬 WhatsApp: +34 611 935 616
🌐 https://www.marisai.es/dashboard

Estamos en español 🇪🇸, somos personas reales y nos encanta ayudar. Sin bots, sin respuestas automáticas.

Un saludo,
El equipo de Maris AI`,
    defaultCredits: 0,
  },
  {
    id: "win_back",
    label: "Recuperar cliente — oferta especial",
    icon: "🎯",
    subject: ({ userName }) => `🎯 ${userName ? userName + ", t" : "T"}enemos algo para ti en Maris AI`,
    body: ({ appTitle, userName }) => `Hola${userName ? ` ${userName}` : ""},

Hace un tiempo empezaste a crear "${appTitle}" con Maris AI y nos encantaría que terminases lo que empezaste.

Para que no haya ninguna excusa, hemos añadido créditos extra a tu cuenta. Úsalos para retomar el proyecto, añadir nuevas funciones o incluso crear una app nueva desde cero.

👉 Entra ahora y úsalos: https://www.marisai.es/dashboard

Si en algún momento necesitas orientación, escríbenos. Respondemos en español en menos de 2 horas, por correo o por WhatsApp al +34 611 935 616.

¡Nos vemos dentro!

El equipo de Maris AI`,
    defaultCredits: 15,
  },
  {
    id: "technical_clarification_reminder",
    label: "Recordatorio — confirmación técnica pendiente",
    icon: "🔔",
    subject: ({ appTitle }) => `🔔 Tu app "${appTitle}" está esperando tu confirmación`,
    body: ({ appTitle, userName }) => `Hola${userName ? ` ${userName}` : ""},

Tu proyecto "${appTitle}" está listo para arrancar, pero necesita que confirmes unos detalles técnicos antes de que podamos generarlo correctamente.

Solo son un par de preguntas rápidas para asegurarnos de que el resultado final sea exactamente lo que necesitas — no queremos asumir nada y que luego no quede como imaginabas.

👉 Entra en tu panel y confirma los detalles: https://www.marisai.es/dashboard

Si tienes alguna duda sobre lo que te preguntamos, responde este correo o escríbenos por WhatsApp al +34 611 935 616 y te explicamos en 2 minutos.

¡Ya casi está!

El equipo de Maris AI`,
    defaultCredits: 0,
  },
  // ── CAMPAÑA MASIVA ──────────────────────────────────────────────────────
  {
    id: "comeback_campaign",
    label: "📢 CAMPAÑA MASIVA — Volver a Maris AI",
    icon: "📢",
    subject: () => "🚀 Maris AI ha mejorado mucho — te esperamos de vuelta",
    body: ({ userName }) => `Hola${userName ? ` ${userName}` : ""},\n\nHace un tiempo creaste tu primera app con Maris AI y queremos contarte que la plataforma ha cambiado muchísimo desde entonces.\n\n🏗️ Nuevo orquestador por hitos — tus apps ahora se construyen módulo a módulo, sin pantallas en blanco ni errores a mitad. Proyectos complejos como portales, CRMs y plataformas multi-usuario ahora salen perfectos desde el primer intento.\n\n⚡ Generación hasta 3x más rápida — reducimos los tiempos de espera a la mitad y los resultados son más completos y funcionales.\n\n🔗 Tu dominio personalizado — ahora puedes conectar tu propio dominio a cualquier app que generes. Tu marca, tu URL.\n\n💜 Soporte mejorado — respondemos en menos de 2 horas por WhatsApp y email, en español, sin bots. Somos personas reales que conocen la plataforma a fondo.\n\n🎁 Programa de referidos — comparte tu link personal y gana el 30% de cada compra que haga quien refieras. Sin límite, sin caducidad. Más info en: https://www.marisai.es/afiliados\n\n👉 Vuelve y compruébalo tú mismo: https://www.marisai.es/dashboard\n\nTus créditos siguen ahí esperándote — pero recuerda que los de recarga duran 30 días desde la compra, así que entra y comprueba tu saldo antes de que caduquen.\n\nSi tienes alguna duda o quieres que te ayudemos a retomar tu proyecto, responde a este correo o escríbenos por WhatsApp al +34 611 935 616.\n\n¡Hasta pronto!\n\nEl equipo de Maris AI\nsoporte@marisai.es`,
    defaultCredits: 0,
  },
];

/**
 * BrokenBundlesPanel — ENCONTRADO A PETICIÓN DEL USUARIO (caso real: app
 * con título "Here are your Instructions", contenido inválido guardado
 * como si fuera una generación exitosa). Botón real, sin necesitar la
 * consola del navegador ni pegar URLs a mano: llama a
 * GET /admin/apps/broken-bundles (con la autenticación real del panel,
 * vía apiFetch) y muestra la lista de apps afectadas, si las hay.
 */
function BrokenBundlesPanel() {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{
    totalChecked: number;
    totalBroken: number;
    apps: Array<{ id: string; userEmail: string | null; title: string; status: string; frontendCodeLength: number; createdAt: string }>;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const runScan = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiFetch<typeof result>("/api/admin/apps/broken-bundles");
      setResult(data);
    } catch (e: any) {
      setError(e?.message || "No se pudo completar la búsqueda.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card className="bg-card/40 border-white/5">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-red-400" />
          Apps ya existentes con contenido inválido
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-white/60">
          Revisa todas las apps ya generadas y encuentra cuáles tienen el mismo problema real que se corrigió para las generaciones nuevas (contenido guardado sin ser código válido).
        </p>
        <Button size="sm" onClick={runScan} disabled={loading} className="bg-red-600/80 hover:bg-red-600 text-white">
          {loading ? "Buscando…" : "Buscar apps rotas"}
        </Button>
        {error && <p className="text-xs text-red-400">{error}</p>}
        {result && (
          <div className="space-y-2">
            <p className="text-xs text-white/70">
              Revisadas: <strong>{result.totalChecked}</strong> · Rotas encontradas:{" "}
              <strong className={result.totalBroken > 0 ? "text-red-400" : "text-emerald-400"}>{result.totalBroken}</strong>
            </p>
            {result.apps.length > 0 && (
              <div className="max-h-64 overflow-auto space-y-1.5 pr-1">
                {result.apps.map((a) => (
                  <div key={a.id} className="text-xs bg-white/5 rounded p-2 flex flex-col gap-0.5">
                    <span className="font-semibold text-white/90">{a.title || "(sin título)"}</span>
                    <span className="text-white/50">{a.userEmail || "(sin email)"} · {a.frontendCodeLength} caracteres · {new Date(a.createdAt).toLocaleString("es-ES")}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * BroadcastButton — botón de campaña masiva a todos los clientes.
 * Abre un dialog con la plantilla "Volver a Maris AI" editable
 * y envía el email a todos los usuarios con al menos 1 job generado.
 */
function BroadcastButton() {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const CAMPAIGN = EMAIL_TEMPLATES.find(t => t.id === "comeback_campaign")!;
  const [subject, setSubject] = useState(CAMPAIGN.subject({ appTitle: "", userName: "" }));
  const [body, setBody] = useState(CAMPAIGN.body({ appTitle: "", userName: "" }));
  const [credits, setCredits] = useState(0);
  const [sending, setSending] = useState(false);
  const [confirmed, setConfirmed] = useState(false);

  const handleSend = async () => {
    if (!confirmed) return;
    setSending(true);
    try {
      const d = await apiFetch<any>("/api/admin/broadcast", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subject, body, creditsCompensation: credits }),
      });
      toast({
        title: "📢 Campaña lanzada",
        description: d.message,
      });
      setOpen(false);
      setConfirmed(false);
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    } finally {
      setSending(false);
    }
  };

  return (
    <>
      <Button
        size="sm"
        className="h-7 text-xs bg-gradient-to-r from-violet-600 to-purple-600 hover:from-violet-700 hover:to-purple-700 text-white font-bold gap-1.5 shadow-lg shadow-violet-500/20"
        onClick={() => setOpen(true)}
      >
        📢 Campaña masiva
      </Button>

      <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) setConfirmed(false); }}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-lg">
              📢 Campaña masiva — Volver a Maris AI
            </DialogTitle>
          </DialogHeader>

          <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-400 mb-2">
            ⚠️ Este email se enviará a <strong>TODOS los clientes</strong> que hayan generado al menos 1 app.
            El mensaje puede personalizarse antes de enviar. Los envíos se hacen en background con un retraso de 600ms entre cada uno.
          </div>

          <div className="space-y-3">
            <div>
              <label className="text-xs text-white/50 block mb-1">Asunto</label>
              <Input value={subject} onChange={(e) => setSubject(e.target.value)} className="text-sm" />
            </div>
            <div>
              <label className="text-xs text-white/50 block mb-1">Mensaje — edítalo si quieres personalizar algo</label>
              <Textarea
                rows={14}
                value={body}
                onChange={(e) => setBody(e.target.value)}
                className="text-sm font-mono resize-y"
              />
            </div>
            <div className="flex items-center gap-4">
              <div className="flex-1">
                <label className="text-xs text-white/50 block mb-1">Créditos de regalo (0 = sin créditos)</label>
                <Input
                  type="number"
                  min={0}
                  value={credits}
                  onChange={(e) => setCredits(Number(e.target.value) || 0)}
                  className="text-sm w-32"
                />
              </div>
              <div className="text-xs text-white/40 text-right">
                {credits > 0 && <p className="text-yellow-400">⚡ Se añadirán {credits} créditos a cada destinatario</p>}
              </div>
            </div>

            {/* Confirmación obligatoria */}
            <div
              className={`flex items-center gap-3 rounded-lg border p-3 cursor-pointer transition ${confirmed ? "border-violet-500/40 bg-violet-500/10" : "border-white/10 bg-white/[0.02]"}`}
              onClick={() => setConfirmed(c => !c)}
            >
              <div className={`w-5 h-5 rounded border-2 flex items-center justify-center shrink-0 transition ${confirmed ? "border-violet-500 bg-violet-500" : "border-white/30"}`}>
                {confirmed && <span className="text-white text-xs font-bold">✓</span>}
              </div>
              <p className="text-xs text-white/70">
                Confirmo que quiero enviar este email a <strong className="text-white">todos los clientes de Maris AI</strong>. He revisado el mensaje y estoy seguro.
              </p>
            </div>
          </div>

          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => { setOpen(false); setConfirmed(false); }}>Cancelar</Button>
            <Button
              onClick={handleSend}
              disabled={sending || !confirmed || !subject.trim() || !body.trim()}
              className="bg-gradient-to-r from-violet-600 to-purple-600 hover:from-violet-700 hover:to-purple-700 text-white font-bold gap-2"
            >
              {sending
                ? <><Loader2 className="h-4 w-4 animate-spin" /> Enviando campaña…</>
                : <>📢 Lanzar campaña</>
              }
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function EmailTemplateMenu({
  recipientEmail,
  userName,
  appTitle,
  userId,
}: {
  recipientEmail: string;
  userName?: string;
  appTitle?: string;
  userId: string;
}) {
  const { toast } = useToast();
  const [openTemplate, setOpenTemplate] = useState<EmailTemplateDef | null>(null);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [credits, setCredits] = useState(0);
  const [recipient, setRecipient] = useState(recipientEmail);
  const [sending, setSending] = useState(false);

  const handlePickTemplate = (tpl: EmailTemplateDef) => {
    const ctx = { appTitle: appTitle || "tu app", userName: userName || "" };
    setOpenTemplate(tpl);
    setSubject(tpl.subject(ctx));
    setBody(tpl.body(ctx));
    setCredits(tpl.defaultCredits || 0);
    setRecipient(recipientEmail);
  };

  const handleSend = async () => {
    if (!recipient || !subject.trim() || !body.trim()) return;
    setSending(true);
    try {
      await apiFetch<any>(`/api/admin/users/${userId}/send-email`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subject, body, creditsCompensation: credits || 0, recipientEmail: recipient }),
      });
      toast({ title: "✅ Correo enviado", description: `Enviado a ${recipient}` });
      setOpenTemplate(null);
    } catch (e: any) {
      toast({ title: "Error al enviar", description: e.message, variant: "destructive" });
    } finally {
      setSending(false);
    }
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="sm" variant="outline" className="h-7 text-[10px] border-violet-500/30 text-violet-400 hover:bg-violet-500/10">
            💌 Enviar correo
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuLabel>Plantillas de correo</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {EMAIL_TEMPLATES.map((tpl) => (
            <DropdownMenuItem key={tpl.id} onClick={() => handlePickTemplate(tpl)}>
              {tpl.icon} {tpl.label}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={!!openTemplate} onOpenChange={(o) => !o && setOpenTemplate(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{openTemplate?.icon} {openTemplate?.label}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-xs text-white/50">Destinatario</label>
              <Input value={recipient} onChange={(e) => setRecipient(e.target.value)} />
            </div>
            <div>
              <label className="text-xs text-white/50">Asunto</label>
              <Input value={subject} onChange={(e) => setSubject(e.target.value)} />
            </div>
            <div>
              <label className="text-xs text-white/50">Mensaje (puedes editarlo antes de enviar)</label>
              <Textarea rows={8} value={body} onChange={(e) => setBody(e.target.value)} />
            </div>
            <div>
              <label className="text-xs text-white/50">Créditos de compensación (0 = sin créditos)</label>
              <Input type="number" min={0} value={credits} onChange={(e) => setCredits(Number(e.target.value) || 0)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpenTemplate(null)}>Cancelar</Button>
            <Button onClick={handleSend} disabled={sending || !recipient || !subject.trim() || !body.trim()} className="bg-violet-600 hover:bg-violet-700">
              {sending ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : null}
              Enviar correo
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export default function AdminDashboardPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [, setLocation] = useLocation();
  const [smokeResult, setSmokeResult] = useState<E2BSmokeResponse | null>(null);
  const [smokeRunning, setSmokeRunning] = useState(false);
  const [templateBuildResult, setTemplateBuildResult] = useState<E2BTemplateBuildResponse | null>(null);
  const [templateBuilding, setTemplateBuilding] = useState(false);
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
    mutation: {
      onSuccess: () => {
        toast({ title: "Job reintentado", description: "El job ha sido re-encolado correctamente." });
        queryClient.invalidateQueries({ queryKey: ["admin", "jobs"] });
      },
      onError: (err: any) => {
        toast({ title: "Error al reintentar", description: err?.message ?? "Error desconocido", variant: "destructive" });
      },
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

  const backfillTopUpExpiryMutation = useMutation({
    mutationFn: backfillTopUpExpiry,
    onSuccess: (res) => {
      toast({
        title: "Migración aplicada",
        description: `Se actualizaron ${res.usersUpdated} clientes. Su saldo de recarga caduca el ${new Date(res.expiresAt).toLocaleDateString("es-ES")}. Puedes pulsar el botón otra vez sin problema — solo afecta a quien todavía no tuviera fecha.`,
      });
    },
    onError: (err) => {
      toast({ title: "Error al aplicar la migración", description: err instanceof Error ? err.message : String(err), variant: "destructive" });
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

            {/* KPI Row 3 — Overview & Revenue */}
            {data.overview && (
              <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <MetricCard
                  icon={<Users className="h-4 w-4 text-cyan-400" />}
                  title="Usuarios totales"
                  value={(data.overview.totalUsers ?? 0).toLocaleString("es-ES")}
                  hint={`+${data.overview.newUsers7d ?? 0} nuevos esta semana`}
                  trend={(data.overview.newUsers7d ?? 0) > 0 ? "up" : "neutral"}
                  color="cyan"
                />
                <MetricCard
                  icon={<Code2 className="h-4 w-4 text-indigo-400" />}
                  title="Apps generadas (total)"
                  value={(data.overview.totalApps ?? 0).toLocaleString("es-ES")}
                  hint="Desde el inicio de Maris AI"
                  trend="up"
                  color="indigo"
                />
                <MetricCard
                  icon={<TrendingUp className="h-4 w-4 text-emerald-400" />}
                  title="Nuevos usuarios (7d)"
                  value={(data.overview.newUsers7d ?? 0).toLocaleString("es-ES")}
                  hint="Registros en los últimos 7 días"
                  trend={(data.overview.newUsers7d ?? 0) > 0 ? "up" : "neutral"}
                  color="emerald"
                />
                <MetricCard
                  icon={<DollarSign className="h-4 w-4 text-yellow-400" />}
                  title="Ingresos totales"
                  value={`${(((data as any).revenueCentsTotal ?? 0) / 100).toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`}
                  hint="Acumulado desde Viva.com"
                  trend={((data as any).revenueCentsTotal ?? 0) > 0 ? "up" : "neutral"}
                  color="yellow"
                />
              </section>
            )}

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
                <TabsTrigger value="apps" className="gap-2">
                  <Eye className="h-3.5 w-3.5" />
                  Apps clientes
                </TabsTrigger>
                <TabsTrigger value="remote" className="gap-2">
                  <Monitor className="h-3.5 w-3.5 text-violet-400" />
                  Dashboards remotos
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
                        { label: "Base de datos", value: data.server ? "Operativa" : "Sin datos", ok: !!data.server, bar: 100 },
                        { label: "Redis", value: data.redis?.connected ? `${data.redis.latencyMs}ms` : "Desconectado", ok: data.redis?.connected ?? false, bar: data.redis?.connected ? 100 : 0 },
                        { label: "Redis/Cola", value: data.redis?.connected ? `${data.redis.latencyMs ?? 0}ms` : "Sin conexión", ok: data.redis?.connected ?? false, bar: data.redis?.connected ? 100 : 0 },
          { label: "E2B Sandbox", value: data.e2b?.effective ? "Activo" : "Inactivo", ok: data.e2b?.effective ?? false, bar: data.e2b?.effective ? 100 : 0 },
                      ].map((item, i) => (
                        <div key={i} className="flex items-center justify-between text-xs">
                          <span className="text-white/60">{item.label}</span>
                          <span className={`font-bold ${item.ok ? "text-emerald-400" : "text-red-400"}`}>{item.value}</span>
                        </div>
                      ))}
                    </CardContent>
                  </Card>

                  {/* ENCONTRADO A PETICIÓN DEL USUARIO: panel real para
                      encontrar, sin tener que usar la consola del
                      navegador, las apps ya existentes afectadas por el
                      mismo problema del caso "Here are your Instructions"
                      -- llama a GET /admin/apps/broken-bundles (ya con la
                      autenticación real del panel, vía apiFetch). */}
                  <BrokenBundlesPanel />
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
                                      <div className="flex items-center gap-3 px-4 py-2 text-xs text-muted-foreground border-b border-white/5 flex-wrap">
                                        <Terminal className="h-3 w-3 shrink-0" />
                                        <span
                                          className="font-mono text-white/40 hover:text-white/70 cursor-pointer"
                                          title="Click para copiar Job ID"
                                          onClick={e => { e.stopPropagation(); navigator.clipboard?.writeText(String(job.id)); toast({ title: "Job ID copiado" }); }}
                                        >
                                          🔧 Job: {job.id}
                                        </span>
                                        <span
                                          className="font-mono text-white/30 hover:text-white/60 cursor-pointer"
                                          title="Click para copiar User ID"
                                          onClick={e => { e.stopPropagation(); navigator.clipboard?.writeText(String(job.userId)); toast({ title: "User ID copiado" }); }}
                                        >
                                          👤 User: {job.userId}
                                        </span>
                                        {job.appId && (
                                          <span
                                            className="font-mono text-white/30 hover:text-white/60 cursor-pointer"
                                            title="Click para copiar App ID"
                                            onClick={e => { e.stopPropagation(); navigator.clipboard?.writeText(String(job.appId)); toast({ title: "App ID copiado" }); }}
                                          >
                                            📦 App: {job.appId}
                                          </span>
                                        )}
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
                                          <span className="font-semibold">Error (mensaje al cliente):</span> {job.errorMessage}
                                          {job.internalErrorMessage && (
                                            <div className="mt-1.5 pt-1.5 border-t border-red-500/20 text-red-300/70">
                                              <span className="font-semibold">Error técnico real (solo admin):</span> {job.internalErrorMessage}
                                            </div>
                                          )}
                                        </div>
                                      )}
                                      <JobDiagnosisPanel jobId={String(job.id)} />
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
                    <CardTitle className="text-base flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <Users className="h-4 w-4 text-muted-foreground" />
                        Todos los clientes — de más a menos gastado
                      </div>
                      <div className="flex items-center gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          className="text-xs h-7 px-2"
                          onClick={() => {
                            const emails = data.topUsers.map((u) => u.email).filter((e) => e && e !== "(usuario eliminado)").join(", ");
                            navigator.clipboard.writeText(emails);
                            toast({ title: "✅ Copiado", description: `${data.topUsers.length} emails copiados al portapapeles` });
                          }}
                        >
                          Copiar todos los emails
                        </Button>
                        <BroadcastButton />
                      </div>
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    {data.topUsers.length === 0 ? (
                      <p className="text-sm text-muted-foreground">Sin clientes todavía.</p>
                    ) : (
                      <div className="space-y-3 max-h-[70vh] overflow-y-auto">
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
                                <p className="text-lg font-bold text-primary">
                                  {(u.totalSpentCents / 100).toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €
                                </p>
                                <p className="text-xs text-muted-foreground">gastado</p>
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

              {/* APPS CLIENTES TAB */}
              <TabsContent value="apps" className="space-y-4">
                <AppsClientesPanel apiBase={getApiBaseUrl()} />
              </TabsContent>

              {/* DASHBOARDS REMOTOS TAB */}
              <TabsContent value="remote" className="space-y-4">
                <RemoteDashboardPanel apiBase={getApiBaseUrl()} />
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
                            toast({ title: "📧 Email de soporte enviado", description: d.message });
                          } catch (e: any) {
                            toast({ title: "Error", description: e.message + " — ¿RESEND_API_KEY configurada en Coolify?", variant: "destructive" });
                          }
                        }}
                      >
                        📧 Enviar email de soporte
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 text-xs border-blue-500/30 text-blue-400 hover:bg-blue-500/10"
                        onClick={async () => {
                          const email = prompt("¿A qué email enviar la prueba?", "rrhh.milchollos@gmail.com");
                          if (!email) return;
                          try {
                            const d = await apiFetch<any>("/api/admin/test-customer-email", {
                              method: "POST",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({ email }),
                            });
                            toast({ title: "✅ Email de cliente enviado", description: d.message });
                          } catch (e: any) {
                            toast({ title: "❌ Fallo al enviar", description: e.message, variant: "destructive" });
                          }
                        }}
                      >
                        💌 Test email a cliente
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

                    <div className="border-t border-white/5 pt-3 space-y-2">
                      <p className="text-xs text-muted-foreground">
                        Plantilla con más memoria (4GB en vez de los 512MB por defecto) para importar proyectos grandes
                        (ej. exports de Wix) sin que la instalación de dependencias se quede sin memoria. Solo hace falta
                        pulsar esto <strong>una vez</strong> — se reutiliza en todas las importaciones futuras.
                      </p>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={templateBuilding}
                        onClick={async () => {
                          setTemplateBuilding(true);
                          setTemplateBuildResult(null);
                          try {
                            const res = await buildE2BImportTemplate();
                            setTemplateBuildResult(res);
                            toast({
                              title: res.ok ? "✅ Plantilla construida" : "❌ Fallo al construir",
                              description: res.ok ? `Lista: ${res.alias}` : res.reason,
                              variant: res.ok ? "default" : "destructive",
                            });
                          } catch (err) {
                            const reason = err instanceof Error ? err.message : String(err);
                            setTemplateBuildResult({ ok: false, reason });
                            toast({ title: "❌ Fallo al construir", description: reason, variant: "destructive" });
                          } finally {
                            setTemplateBuilding(false);
                          }
                        }}
                        className="gap-2"
                      >
                        {templateBuilding ? <><Loader2 className="h-3 w-3 animate-spin" />Construyendo (puede tardar varios minutos)…</> : <><Server className="h-3 w-3" />Construir plantilla de 4GB para importaciones grandes</>}
                      </Button>
                      {templateBuildResult && (
                        <div className={`text-xs rounded-lg border px-3 py-2 ${templateBuildResult.ok ? "border-emerald-500/40 bg-emerald-500/10" : "border-red-500/40 bg-red-500/10"}`}>
                          {templateBuildResult.ok ? `✓ Plantilla "${templateBuildResult.alias}" lista para usarse` : `✗ Falló: ${templateBuildResult.reason}`}
                        </div>
                      )}
                    </div>

                    <div className="border-t border-white/5 pt-3 space-y-2">
                      <p className="text-xs text-muted-foreground">
                        Arranca la caducidad de 30 días (créditos de recarga) para los clientes que ya tenían saldo
                        <strong> antes</strong> de este cambio de política. Solo hace falta pulsar esto <strong>una vez</strong>,
                        al desplegar — es seguro pulsarlo más de una vez por error, solo afecta a quien todavía no
                        tuviera fecha de caducidad asignada.
                      </p>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={backfillTopUpExpiryMutation.isPending}
                        onClick={() => backfillTopUpExpiryMutation.mutate()}
                        className="gap-2"
                      >
                        {backfillTopUpExpiryMutation.isPending
                          ? <><Loader2 className="h-3 w-3 animate-spin" />Aplicando…</>
                          : <><Clock className="h-3 w-3" />Activar caducidad de 30 días para saldo existente</>}
                      </Button>
                    </div>
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
  value: React.ReactNode;
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
