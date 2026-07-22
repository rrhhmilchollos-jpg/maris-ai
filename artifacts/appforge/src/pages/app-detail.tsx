import { useState, useEffect, useRef, useMemo } from "react";
import { useLocation } from "wouter";
import { useClerk, useUser } from "@clerk/react";
import {
  apiFetch,
  useGetApp,
  useListAppMessages,
  useSendAppMessage,
  useGetGenerationJob,
  useGetActiveAppJob,
  getGetActiveAppJobQueryKey,
  useGetMyStats,
  getGetMyStatsQueryKey,
  getGetMeQueryKey,
  getGetAppQueryKey,
  getListAppMessagesQueryKey,
  getGetGenerationJobQueryKey,
  useGetMe,
  useApproveFacet,
  useDeployApp,
  useDeepTestApp,
  useGetAppDomain,
  useConnectAppDomain,
  useDisconnectAppDomain,
  getGenerationJobLogs,
  getGetGenerationJobLogsQueryKey,
  useGetNotifications,
  useGetCreditsHistory,
  useSSRPreviewHeartbeat,
  useRestartSSRPreview,
} from "@/lib/api-client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { DeployModal } from "@/components/deploy-modal";
import { ReviewInviteModal } from "@/components/review-invite-modal";
import { WorkflowListPanel } from "@/components/workflow-list-panel";
import { StressTestModal } from "@/components/stress-test-modal";
import { AgentStatusPipeline } from "@/components/agent-status-pipeline";
import { LoopProtectionModal } from "@/components/loop-protection-modal";
import { GitHubButton } from "@/components/github-button";
import { RailwayDeployButton } from "@/components/railway-deploy-button";
import { AdminCodeEditor } from "@/components/admin-code-editor";
import { LivePreview } from "@/components/live-preview";
import { parseBundle } from "@/lib/parseBundle";
import { Layout } from "@/components/layout";
import {
  AttachmentPicker,
  AttachmentChips,
  type UploadedAttachment,
} from "@/components/attachment-picker";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useToast } from "@/hooks/use-toast";
import {
  ArrowLeft,
  Send,
  Loader2,
  Sparkles,
  CheckCircle2,
  Circle,
  AlertCircle,
  Zap,
  Share2,
  Workflow as WorkflowIcon,
  Activity,
  Rocket,
  RefreshCcw,
  Maximize2,
  Bot,
  Info,
  HelpCircle,
  Bell,
  ChevronDown,
  CreditCard,
  LayoutDashboard,
  LogOut,
  Shield,
  ExternalLink,
  Globe,
  RefreshCw,
  Flame,
  Settings,
  Gift,
  Crown,
  Moon,
  X,
  Code,
  Monitor,
  Tablet,
  Smartphone,
  Copy,
  ChevronRight,
  Terminal,
  Cpu,
  GitBranch,
  Minimize2,
  Link,
  Users,
  Key,
  Star,
  Eye,
  Mic,
  MicOff,
  AlertTriangle,
  ShoppingCart,
  ShieldCheck,
  Calendar,
  Fingerprint,
} from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { AgentLogStream } from "@/components/agent-log-stream";
import { VisualTestPanel } from "@/components/visual-test-panel";

// Coste fijo de la "Revisión profunda de errores" (Testing Agent bajo
// demanda) — debe coincidir con DEEP_TEST_COST en apps.ts.
const DEEP_TEST_COST = 30;
// Coste fijo del deploy y duración de la ventana de gracia de re-deploy
// gratuito — deben coincidir con DEPLOY_COST / DEPLOY_GRACE_WINDOW_MS en apps.ts.
// Coste escalonado del deploy: 5 créditos el primer deploy de cada app, 50
// a partir del segundo. Deben coincidir con DEPLOY_COST_FIRST /
// DEPLOY_COST_SUBSEQUENT / DEPLOY_GRACE_WINDOW_MS en apps.ts.
const DEPLOY_COST_FIRST = 5;
const DEPLOY_COST_SUBSEQUENT = 50;
const DEPLOY_GRACE_WINDOW_MS = 5 * 60 * 1000;

const PHASE_LABELS: Record<string, { label: string; icon: any }> = {
  queued:       { label: "En cola…",                                          icon: Loader2 },
  starting:     { label: "Iniciando equipo de 11 agentes…",                    icon: Loader2 },
  researching:  { label: "🔎 Researcher investigando referencias…",            icon: Sparkles },
  architecting: { label: "🧠 Architect planificando la arquitectura…",          icon: Sparkles },
  designing:    { label: "🎨 Designer definiendo el sistema visual…",          icon: Sparkles },
  schema:       { label: "🗄️ Database diseñando los modelos de datos…",        icon: Sparkles },
  frontend:     { label: "⚡ Frontend Engineer aplicando cambios…",            icon: Zap },
  backend:      { label: "🖥️ Backend Engineer actualizando la API…",          icon: Sparkles },
  integrations: { label: "🔌 API Integrator conectando servicios…",            icon: Sparkles },
  testing:      { label: "🧪 testing-agent analizando el bundle…",                 icon: Sparkles },
  patching:     { label: "🔧 testing-agent reparando errores…",                  icon: Sparkles },
  validating:   { label: "🔍 testing-agent validando el código…",                  icon: Sparkles },
  fixing:       { label: "🛠️ testing-agent aplicando correcciones…",               icon: Sparkles },
  parsing:      { label: "📦 Empaquetando archivos del proyecto…",             icon: Sparkles },
  ready:        { label: "Cambios aplicados con éxito",                        icon: Sparkles },
  failed:       { label: "Error en la generación",                            icon: Sparkles },
};

type SidebarTab = "chat" | "plan" | "data" | "integrations" | "ui-builder" | "workflows" | "settings";

type ChatMessage = {
  id?: string;
  role?: string;
  content?: string;
  createdAt?: string;
};

const TECHNICAL_ASSISTANT_PREFIXES = /^(leer|buscar|revisar|aplicar|ejecutar|comprobar|abrir|expandir|desplazarse|extraer|registrar|actualizar|comparar|descargar|esperar|localizar|listar|usar búsqueda|corregir en backend)\b/i;
const TECHNICAL_ASSISTANT_MARKERS = ["/home/ubuntu", "app-detail.tsx", "api-server", "grep", "shell", "file action", "browser_", "tool", "chunk", "diff --", "pnpm build"];

function isTechnicalAssistantMessage(message: ChatMessage) {
  const role = String(message.role ?? "");
  const content = String(message.content ?? "").trim();
  if (!content) return true;
  if (role === "user") return false;
  const lower = content.toLowerCase();
  return TECHNICAL_ASSISTANT_PREFIXES.test(content) || TECHNICAL_ASSISTANT_MARKERS.some((marker) => lower.includes(marker.toLowerCase()));
}

function formatMessageTime(value?: string) {
  if (!value) return "Ahora";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Ahora";
  return date.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });
}

const NAV_ITEMS: Array<{ id: SidebarTab; label: string; icon: React.ComponentType<{ className?: string }> }> = [
  { id: "chat", label: "Chat", icon: Bot },
  { id: "plan", label: "Plan", icon: Sparkles },
  { id: "data", label: "Data", icon: GitBranch },
  { id: "integrations", label: "Integrations", icon: Link },
  { id: "ui-builder", label: "UI Builder", icon: Monitor },
  { id: "workflows", label: "Workflows", icon: Zap },
  { id: "settings", label: "Settings", icon: Settings },
];

function MarisLogo({ compact = false }: { compact?: boolean }) {
  return (
    <div className="flex items-center gap-3">
      <div className="relative h-8 w-9">
        <div className="absolute left-0 top-2 h-5 w-3 rotate-[28deg] rounded-full bg-gradient-to-b from-[#8b5cf6] to-[#7c3aed] shadow-[0_0_18px_rgba(124,58,237,0.65)]" />
        <div className="absolute left-3 top-1 h-6 w-3 -rotate-[26deg] rounded-full bg-gradient-to-b from-[#a855f7] to-[#ec4899] shadow-[0_0_16px_rgba(168,85,247,0.5)]" />
        <div className="absolute left-[22px] top-1 h-6 w-3 rotate-[18deg] rounded-full bg-gradient-to-b from-[#22d3ee] to-[#3b82f6] shadow-[0_0_18px_rgba(34,211,238,0.6)]" />
      </div>
      {!compact && <span className="text-[22px] font-extrabold tracking-tight text-white">Maris AI</span>}
    </div>
  );
}

function TopActionButton({ icon: Icon, label, onClick, disabled = false, active = false }: { icon: any; label: string; onClick?: () => void; disabled?: boolean; active?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex h-10 items-center gap-2 rounded-md border px-5 text-[14px] font-semibold shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] transition ${active ? "border-[#8b5cf6]/70 bg-[#7c3aed]/20 text-white" : "border-white/8 bg-white/[0.055] text-white/75 hover:bg-white/[0.085] hover:text-white"} disabled:cursor-not-allowed disabled:opacity-45`}
    >
      <Icon className={`h-4 w-4 ${disabled ? "animate-pulse" : ""}`} />
      {label}
    </button>
  );
}

function AppPreviewWaitingState() {
  return (
    <div className="relative flex h-full w-full flex-col items-center justify-center overflow-hidden bg-[#0b0e17]">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_48%,rgba(124,58,237,0.21),transparent_24%),radial-gradient(circle_at_62%_50%,rgba(34,211,238,0.17),transparent_22%),linear-gradient(180deg,#0b0e17_0%,#090b12_100%)]" />
      <div className="absolute inset-0 opacity-[0.22] [background-image:linear-gradient(rgba(255,255,255,0.025)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.025)_1px,transparent_1px)] [background-size:46px_46px]" />
      <div className="relative z-10 flex flex-col items-center gap-9">
        <div className="relative h-[190px] w-[190px]">
          <div className="absolute inset-0 rounded-full border border-white/5" />
          <div className="absolute inset-[18px] rounded-full border border-white/5" />
          <div className="absolute inset-[6px] rounded-full border-4 border-transparent border-t-[#a78bfa] border-r-[#22d3ee] opacity-90 animate-spin" />
          <div className="absolute inset-[31px] rounded-full border-[3px] border-transparent border-b-[#93c5fd] border-l-[#c084fc] opacity-80 animate-[spin_4s_linear_infinite_reverse]" />
          <span className="absolute left-[37px] top-[26px] h-2 w-2 rounded-full bg-[#a78bfa] shadow-[0_0_16px_rgba(167,139,250,0.9)]" />
          <span className="absolute right-[32px] top-[58px] h-2 w-2 rounded-full bg-[#60a5fa] shadow-[0_0_16px_rgba(96,165,250,0.9)]" />
          <span className="absolute bottom-[43px] left-[42px] h-2 w-2 rounded-full bg-[#c084fc] shadow-[0_0_16px_rgba(192,132,252,0.9)]" />
          <div className="absolute inset-0 flex items-center justify-center">
            <MarisLogo compact />
          </div>
        </div>
        <h4 className="text-[22px] font-extrabold tracking-tight text-white drop-shadow-[0_0_22px_rgba(255,255,255,0.16)]">
          Building something <span className="bg-gradient-to-r from-[#a78bfa] via-[#c084fc] to-[#22d3ee] bg-clip-text text-transparent">incredible</span> ~!
        </h4>
      </div>
    </div>
  );
}

interface GatingQuestion {
  id: string;
  topic: "database" | "auth_roles" | "integrations";
  question: string;
  options: string[];
}

// ENCONTRADO a petición explícita del usuario, conectando el Gating
// Question Block (estilo Emergent.sh) ya implementado en el backend de hoy
// mismo: el botón genérico "Aprobar y continuar" ya existente (usado para
// OTRA faceta distinta, "structure") llamaba a approveMutation con un solo
// clic sin recoger ninguna respuesta real — si se dejaba así, las 3
// preguntas críticas de clarificación técnica (base de datos, roles/auth,
// integraciones de pago) se "aprobarían" sin que el cliente las viera ni
// respondiera, rompiendo por completo el propósito del bloqueo. Este
// formulario sustituye a ese botón SOLO cuando job.phase es
// "awaiting_technical_clarification" — el resto de pausas (ej. "structure")
// siguen usando el botón genérico exactamente como antes.
function GatingQuestionsForm({
  questions,
  isPending,
  onSubmit,
}: {
  questions: GatingQuestion[];
  isPending: boolean;
  onSubmit: (answers: Record<string, string>, extraNotes?: string) => void;
}) {
  const [selected, setSelected] = useState<Record<string, string>>({});
  const [extraNotes, setExtraNotes] = useState("");
  const allAnswered = questions.every((q) => !!selected[q.id]);

  return (
    <div className="space-y-4 px-2 md:px-4">
      <div className="rounded-lg border border-[#1d4ed8]/35 bg-[#0f2244]/70 px-4 py-3 text-center text-[14px] font-semibold text-[#60a5fa]">
        <div className="flex items-center justify-center gap-3">
          <Info className="h-5 w-5 shrink-0" />
          <span>Antes de empezar, confirma estos detalles para que Maris AI no asuma nada que no pediste</span>
        </div>
      </div>
      {questions.map((q) => (
        <div key={q.id} className="rounded-2xl border border-white/[0.09] bg-[#0d0f1a] p-4 space-y-2.5">
          <p className="text-[15px] font-semibold text-white/90">{q.question}</p>
          <div className="space-y-1.5">
            {q.options.map((opt) => (
              <button
                key={opt}
                type="button"
                onClick={() => setSelected((prev) => ({ ...prev, [q.id]: opt }))}
                className={`w-full text-left rounded-lg border px-3.5 py-2.5 text-[14px] transition ${
                  selected[q.id] === opt
                    ? "border-[#7c3aed] bg-[#7c3aed]/15 text-white"
                    : "border-white/[0.08] bg-white/[0.02] text-white/70 hover:bg-white/[0.05]"
                }`}
              >
                {opt}
              </button>
            ))}
          </div>
        </div>
      ))}

      {/* Campo de especificaciones adicionales libres */}
      <div className="rounded-2xl border border-white/[0.09] bg-[#0d0f1a] p-4 space-y-2">
        <p className="text-[14px] font-semibold text-white/80 flex items-center gap-2">
          <span>💬</span>
          <span>¿Algo más que quieras añadir? <span className="text-white/40 font-normal">(opcional)</span></span>
        </p>
        <p className="text-[12px] text-white/40">Funciones extra, diseño específico, integraciones, restricciones… cuéntanoslo aquí antes de que empecemos.</p>
        <textarea
          value={extraNotes}
          onChange={(e) => setExtraNotes(e.target.value)}
          placeholder="Ej: Quiero que el diseño sea oscuro, con colores morados. También necesito que soporte múltiples idiomas y que tenga notificaciones por email cuando alguien se registra..."
          className="w-full min-h-[90px] resize-none rounded-lg border border-white/[0.08] bg-white/[0.02] px-3.5 py-2.5 text-[13px] text-white/80 placeholder:text-white/25 focus:outline-none focus:border-[#7c3aed]/50 transition"
        />
      </div>

      <Button
        size="lg"
        onClick={() => onSubmit(selected, extraNotes.trim() || undefined)}
        disabled={!allAnswered || isPending}
        className="h-12 w-full bg-gradient-to-r from-[#7c3aed] to-[#9333ea] font-bold text-white shadow-[0_0_22px_rgba(124,58,237,0.4)] hover:from-[#8b5cf6] hover:to-[#a855f7] disabled:opacity-50"
      >
        {isPending ? <Loader2 className="mr-2 h-5 w-5 animate-spin" /> : <Zap className="mr-2 h-5 w-5 fill-current" />}
        Confirmar y empezar a construir
      </Button>
    </div>
  );
}




// ── RuntimeErrorsPanel ───────────────────────────────────────────────────────
// Muestra los últimos errores JavaScript capturados en la app en producción.
// Los errores llegan desde el error reporter inyectado en el bundle (deployBundle.ts).
function RuntimeErrorsPanel({ appId }: { appId: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ["runtime-errors", appId],
    queryFn: () => apiFetch<any>(`/api/apps/${appId}/runtime-errors`),
    refetchInterval: 30_000,
    staleTime: 20_000,
  });

  const errors = data?.errors ?? [];
  if (isLoading) return null;
  if (errors.length === 0) return (
    <div className="mt-4 rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-3">
      <p className="text-xs text-emerald-400 font-medium flex items-center gap-2">
        <CheckCircle2 className="h-3.5 w-3.5" /> Sin errores en producción
      </p>
    </div>
  );

  return (
    <div className="mt-4 space-y-2">
      <p className="text-xs uppercase tracking-[0.18em] text-white/35 flex items-center gap-2">
        <Terminal className="h-3.5 w-3.5 text-red-400" />
        Errores en producción ({errors.length})
      </p>
      <div className="space-y-2 max-h-48 overflow-y-auto">
        {errors.slice(0, 5).map((e: any, i: number) => (
          <div key={i} className="rounded-lg border border-red-500/20 bg-red-500/5 p-3">
            <p className="text-xs font-mono text-red-300 break-words">{e.message}</p>
            {e.pathname && <p className="text-[10px] text-white/30 mt-1">{e.pathname}</p>}
            <p className="text-[10px] text-white/25 mt-1">{new Date(e.createdAt).toLocaleString("es-ES")}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
export default function AppDetailPage({ params }: { params: { id: string } }) {
  const id = params.id;
  const [, setLocation] = useLocation();
  const { signOut } = useClerk();
  const { user } = useUser();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [draft, setDraft] = useState("");
  const [chatAttachments, setChatAttachments] = useState<UploadedAttachment[]>([]);
  const localStorageKey = `maris_active_job_${id}`;
  const [activeJobId, setActiveJobIdRaw] = useState<string | null>(() => {
    try { return localStorage.getItem(localStorageKey) || null; } catch { return null; }
  });
  const setActiveJobId = (jobId: string | null) => {
    setActiveJobIdRaw(jobId);
    try {
      if (jobId) { localStorage.setItem(localStorageKey, jobId); }
      else { localStorage.removeItem(localStorageKey); }
    } catch {}
  };
  const [previewKey, setPreviewKey] = useState(0);
  const [isPreviewMaximized, setIsPreviewMaximized] = useState(false);
  const [isPreviewClosed, setIsPreviewClosed] = useState(false);
  // Barra "Vista en vivo activa" — solo debe aparecer cuando el preview
  // de verdad se pausó (pestaña en segundo plano), no siempre. Se basa en
  // visibilitychange real del navegador, no en un temporizador falso.
  const [isPreviewPaused, setIsPreviewPaused] = useState(false);
  const [activeSidebar, setActiveSidebar] = useState<SidebarTab>("chat");
  const [isPublishingGoogle, setIsPublishingGoogle] = useState(false);
  const [showDeployModal, setShowDeployModal] = useState(false);
  const [showReviewInvite, setShowReviewInvite] = useState(false);
  const [showWorkflows, setShowWorkflows] = useState(false);
  const [showStressTest, setShowStressTest] = useState(false);
  const [dismissedProtectionForJobId, setDismissedProtectionForJobId] = useState<string | null>(null);
  const [showAccountSettings, setShowAccountSettings] = useState(false);
  const [accountSettingsTab, setAccountSettingsTab] = useState<"personal" | "apikey" | "agents" | "preferences" | "billing" | "usage">("personal");
  const [rightPanelTab, setRightPanelTab] = useState<"preview" | "code" | "visual-test">("preview");
  const [copyAttempts, setCopyAttempts] = useState(0);
  const [isRecording, setIsRecording] = useState(false);
  const recognitionRef = useRef<any>(null);
  const [copyBlocked, setCopyBlocked] = useState(false);
  const [showVisualTestInline, setShowVisualTestInline] = useState(false);
  // Tarjeta de éxito que sustituye al panel inline cuando la verificación
  // automática (autoRunOnMount) confirma que la app quedó funcional —
  // mensaje claro + oferta de seguir editando, en vez de simplemente
  // desaparecer en silencio.
  const [showVisualSuccessCard, setShowVisualSuccessCard] = useState(false);
  // ✅ RESPONSIVE MÓVIL: tab activa en móvil (chat o preview)
  const [mobileTab, setMobileTab] = useState<"chat" | "preview">("chat");
  const [previewSize, setPreviewSize] = useState<"desktop" | "tablet" | "mobile">("desktop");
  const [darkModeEnabled, setDarkModeEnabled] = useState(true);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const lastPreviewRefreshSignatureRef = useRef<string>("");

  const { data: app, isLoading } = useGetApp(id, {
    query: {
      enabled: !!id,
      queryKey: getGetAppQueryKey(id),
      refetchInterval: (data: any) => {
        if (!activeJobId) return false;
        if (!data) return 3000;
        const code = String(data?.frontendCode ?? "").trim();
        const hasCode = code.length >= 20 && !code.includes("El código ha sido consolidado en disco por hitos");
        return hasCode ? 5000 : 2000;
      },
    },
  });
  const { data: me } = useGetMe();
  const isAdmin = !!me?.isAdmin;
  const { data: stats } = useGetMyStats({ query: { refetchInterval: 5000 } });
  const credits = stats?.credits ?? 0;
  const outOfCredits = credits <= 0 && !isAdmin;
  // Ventana de gracia de re-deploy gratuito — solo informativo en el texto
  // del botón; la fuente de verdad real es siempre el backend.
  const isFreeRedeployNow = !!(app as any)?.lastPaidDeployAt
    && (Date.now() - new Date((app as any).lastPaidDeployAt).getTime()) < DEPLOY_GRACE_WINDOW_MS;
  // Coste escalonado — informativo, el backend decide el cobro real.
  const effectiveDeployCost = (app as any)?.lastPaidDeployAt ? DEPLOY_COST_SUBSEQUENT : DEPLOY_COST_FIRST;

  // Polling: detectar recarga de créditos cuando el usuario está bloqueado
  useEffect(() => {
    if (!outOfCredits) return;
    const interval = setInterval(async () => {
      try {
        const fresh = await apiFetch<any>("/api/me/stats");
        if (fresh?.credits > 0) {
          queryClient.invalidateQueries({ queryKey: getGetMyStatsQueryKey() });
          queryClient.invalidateQueries({ queryKey: getGetMeQueryKey() });
          toast({ title: "\u2705 \u00a1Cr\u00e9ditos recargados!", description: `Tienes ${fresh.credits} cr\u00e9ditos. \u00a1Ya puedes seguir editando tu app!` });
        }
      } catch { /* silencioso */ }
    }, 6000);
    return () => clearInterval(interval);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [outOfCredits]);

  const { data: notificationsData } = useGetNotifications();
  const unreadCount: number = notificationsData?.unreadCount ?? 0;
  const { data: creditsHistory } = useGetCreditsHistory();

  const { data: messages } = useListAppMessages(id, {
    query: { enabled: !!id, queryKey: getListAppMessagesQueryKey(id), refetchInterval: activeJobId ? 3000 : false },
  });

  const { data: activeAppJob } = useGetActiveAppJob(id, {
    query: {
      enabled: !!id,
      queryKey: getGetActiveAppJobQueryKey(id),
      refetchInterval: (data: any) => {
        const status = data?.status;
        if (status && status !== "succeeded" && status !== "failed") return 2000;
        return activeJobId ? 3000 : 15000;
      },
    },
  });

  useEffect(() => {
    if (activeAppJob?.id && String(activeAppJob.id) !== activeJobId) {
      setActiveJobId(String(activeAppJob.id));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeAppJob?.id]);

  const effectiveJobId: string | null =
    (activeAppJob?.id ? String(activeAppJob.id) : null) ?? activeJobId;

  const { data: jobLogsData } = useQuery({
    queryKey: [...getGetGenerationJobLogsQueryKey(effectiveJobId ?? ""), "inline"],
    queryFn: () => getGenerationJobLogs(effectiveJobId!, { }),
    enabled: !!effectiveJobId,
    refetchInterval: effectiveJobId ? 2000 : false,
    select: (d) => d.logs ?? [],
  });
  const jobLogs = jobLogsData ?? [];

  const { data: job } = useGetGenerationJob(effectiveJobId ?? "", {
    query: {
      enabled: !!effectiveJobId,
      queryKey: getGetGenerationJobQueryKey(effectiveJobId ?? ""),
      refetchInterval: (data: any) =>
        data?.status === "succeeded" || data?.status === "failed" ? false : 1000,
    },
  });

  const approveMutation = useApproveFacet({
    mutation: {
      onSuccess: () => {
        if (effectiveJobId) queryClient.invalidateQueries({ queryKey: getGetGenerationJobQueryKey(effectiveJobId) });
        queryClient.invalidateQueries({ queryKey: getGetActiveAppJobQueryKey(id) });
        toast({ title: "Aprobado", description: "Maris AI continúa construyendo la aplicación." });
      },
      onError: (err: any) => {
        toast({ title: "No se pudo aprobar", description: err?.message ?? "Error", variant: "destructive" });
      },
    },
  });

  // Usado por handlePublishGoogle (dispara el deploy y hace su propio
  // polling de deploy-status). El botón "Deploy app" normal usa
  // handleDeploy -> setShowDeployModal(true), que abre DeployModal — el
  // componente que ya tiene el stepper de 6 fases real conectado.
  const deployMutation = useDeployApp({
    mutation: {
      onError: (err: any) => {
        const isPaymentRequired = err?.error === "Créditos insuficientes";
        toast({
          title: isPaymentRequired ? "Créditos insuficientes" : "No se pudo desplegar",
          description: isPaymentRequired ? err?.hint : (err?.message ?? err?.error ?? "Error"),
          variant: "destructive",
        });
      },
    },
  });

  // A petición explícita del usuario: el Testing Agent SIEMPRE corre gratis
  // durante la generación/edición normal — este botón dispara una "Revisión
  // profunda de errores" ADICIONAL bajo demanda, con coste explícito de 30
  // créditos, que el cliente decide voluntariamente pedir sobre su app YA
  // generada.
  const deepTestMutation = useDeepTestApp({
    mutation: {
      onSuccess: (result: any) => {
        queryClient.invalidateQueries({ queryKey: getGetMyStatsQueryKey() });
        if (result?.id) {
          setActiveJobId(String(result.id));
        }
        toast({
          title: "Revisión profunda iniciada",
          description: `Se han descontado ${result?.creditsCost ?? 30} créditos. El Testing Agent está analizando tu app a fondo…`,
        });
      },
      onError: (err: any) => {
        const required = err?.required;
        toast({
          title: err?.error === "Créditos insuficientes" ? "Créditos insuficientes" : "No se pudo iniciar la revisión",
          description: required ? `Necesitas ${required} créditos para esta revisión.` : (err?.message ?? "Error"),
          variant: "destructive",
        });
      },
    },
  });
  const handleDeepTest = () => {
    if (!hasRenderableCode) {
      toast({ title: "Sin código generado", description: "Genera la app primero antes de pedir una revisión profunda.", variant: "destructive" });
      return;
    }
    deepTestMutation.mutate({ id });
  };

  // A petición explícita del usuario: dominios personalizados, solo para
  // usuarios que han pagado al menos una vez (hasEverPaid). La
  // infraestructura real (Vercel) ya existía en vercelDeploy.ts, ahora
  // conectada a estos endpoints. El control de pago vive en el BACKEND
  // (única fuente de verdad: devuelve 402 si no ha pagado) — el frontend
  // no duplica esa lógica, solo muestra el mensaje de upsell que el
  // servidor ya construye cuando llega ese error.
  const [domainInput, setDomainInput] = useState("");
  const { data: domainStatus, refetch: refetchDomain } = useGetAppDomain(id, {
    query: { refetchInterval: (q: any) => (q?.state?.data?.domain && !q.state.data.verified ? 8000 : false) },
  });
  const connectDomainMutation = useConnectAppDomain({
    mutation: {
      onSuccess: () => {
        refetchDomain();
        toast({ title: "Dominio añadido", description: "Configura los registros DNS que aparecen abajo en tu proveedor de dominios para activarlo." });
      },
      onError: (err: any) => {
        const isPaymentRequired = err?.error === "Los dominios personalizados son una función de pago";
        toast({
          title: isPaymentRequired ? "Función de pago" : "No se pudo conectar el dominio",
          description: err?.hint ?? err?.error ?? err?.message ?? "Error",
          variant: "destructive",
        });
      },
    },
  });
  const disconnectDomainMutation = useDisconnectAppDomain({
    mutation: {
      onSuccess: () => {
        refetchDomain();
        setDomainInput("");
        toast({ title: "Dominio desconectado" });
      },
      onError: (err: any) => {
        toast({ title: "No se pudo desconectar el dominio", description: err?.error ?? err?.message ?? "Error", variant: "destructive" });
      },
    },
  });
  const handleConnectDomain = () => {
    const trimmed = domainInput.trim().toLowerCase();
    if (!trimmed || !trimmed.includes(".")) {
      toast({ title: "Dominio inválido", description: "Escribe un dominio completo, por ejemplo midominio.com", variant: "destructive" });
      return;
    }
    connectDomainMutation.mutate({ id, domain: trimmed });
  };

  useEffect(() => {
    if (job?.status === "succeeded") {
      queryClient.invalidateQueries({ queryKey: getGetAppQueryKey(id) });
      queryClient.invalidateQueries({ queryKey: getListAppMessagesQueryKey(id) });
      queryClient.invalidateQueries({ queryKey: getGetActiveAppJobQueryKey(id) });
      queryClient.refetchQueries({ queryKey: getGetAppQueryKey(id) }).finally(() => {
        setPreviewKey((value) => value + 1);
      });
      setActiveJobId(null);
      // Auto-show visual test panel in chat after generation completes
      setShowVisualTestInline(true);
      toast({ title: "¡Cambios aplicados!", description: "La previsualización se ha recargado automáticamente con la actualización." });
    } else if (job?.status === "failed") {
      queryClient.invalidateQueries({ queryKey: getGetActiveAppJobQueryKey(id) });
      setActiveJobId(null);
      // internalErrorMessage solo viene relleno para la cuenta admin (ver
      // jobs.ts) -- para clientes normales sigue siendo undefined y el
      // toast se comporta exactamente igual que antes.
      const internalMsg = (job as any).internalErrorMessage;
      toast({
        title: "Error en la generación",
        description: internalMsg
          ? `${job.errorMessage || "Algo salió mal"}\n\n🔧 Error técnico real: ${internalMsg}`
          : job.errorMessage || "Algo salió mal",
        variant: "destructive",
      });
    }
  }, [job?.status, id, queryClient, job?.errorMessage, toast]);

  const sendMutation = useSendAppMessage({
    mutation: {
      onSuccess: (nextJob: any) => {
        setDraft("");
        setChatAttachments([]);
        queryClient.invalidateQueries({ queryKey: getListAppMessagesQueryKey(id) });
        queryClient.invalidateQueries({ queryKey: getGetMyStatsQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetMeQueryKey() });
        if (nextJob?.conversationOnly || nextJob?.operationOnly) {
          setActiveJobId(null);
          const engine = String(nextJob?.engine || "");
          if (engine === "ENGINE_EXEC") {
            toast({ title: "ENGINE_EXEC activado", description: "Operación de datos enroutada sin recompilar ni consumir créditos." });
          } else if (engine === "ENGINE_RESEARCH") {
            toast({ title: "Investigación completada", description: "Respuesta generada sin modificar código ni lanzar build." });
          }
          return;
        }
        if (nextJob?.id) {
          setActiveJobId(nextJob.id);
          return;
        }
        toast({ title: "Respuesta inesperada", description: "No se ha iniciado ningún trabajo de modificación.", variant: "destructive" });
      },
      onError: (err: any) => {
        const msg = err?.message || "";
        if (msg.includes("402") || msg.toLowerCase().includes("cr\u00e9ditos insuficientes")) {
          // Forzar refresco de stats para activar el overlay de sin cr\u00e9ditos
          queryClient.invalidateQueries({ queryKey: getGetMyStatsQueryKey() });
          queryClient.invalidateQueries({ queryKey: getGetMeQueryKey() });
          toast({ title: "Sin cr\u00e9ditos", description: "Compra m\u00e1s cr\u00e9ditos para seguir editando tu app.", variant: "destructive" });
        } else {
          toast({ title: "No se pudo enviar", description: msg || "Error", variant: "destructive" });
        }
      },
    },
  });

  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, activeJobId]);

  const handleSend = () => {
    if (outOfCredits) return; // Bloqueado — sin créditos
    const trimmed = draft.trim();
    if (trimmed.length < 2 || sendMutation.isPending || isActivelyProcessing) return;
    sendMutation.mutate({
      id,
      data: {
        content: trimmed,
        attachmentIds: chatAttachments.map((a: any) => a.id),
      },
    });
  };

  const handleApprove = () => {
    const approvalJobId = effectiveJobId;
    if (approvalJobId) {
      approveMutation.mutate({ id: String(approvalJobId), data: { facet: "structure" } });
      return;
    }
    toast({
      title: "Sin trabajo de generación activo",
      description: "No encuentro el identificador del trabajo que debe aprobarse. Envía un mensaje a Maris AI para reactivar la generación o recarga la pantalla.",
      variant: "destructive",
    });
  };

  const handleSubmitGatingAnswers = (selected: Record<string, string>, extraNotes?: string) => {
    const approvalJobId = effectiveJobId;
    if (!approvalJobId) {
      toast({
        title: "Sin trabajo de generación activo",
        description: "No encuentro el identificador del trabajo que debe aprobarse. Recarga la pantalla.",
        variant: "destructive",
      });
      return;
    }
    approveMutation.mutate({
      id: String(approvalJobId),
      data: {
        facet: "technical_architecture",
        answers: selected,
        // Especificaciones adicionales libres que el cliente puede escribir
        // junto a las respuestas del formulario de clarificación técnica.
        // Se inyectan en el prompt final antes de la generación.
        ...(extraNotes ? { extraNotes } : {}),
      },
    });
  };

  const phaseInfo = PHASE_LABELS[job?.phase ?? "queued"] ?? PHASE_LABELS.queued;
  const PhaseIcon = phaseInfo.icon;
  const jobStatus = job?.status ?? activeAppJob?.status;
  const isAwaitingApproval = jobStatus === "awaiting_approval";
  // Distingue la pausa REAL del Gating Question Block (con preguntas
  // estructuradas que el cliente debe responder) de cualquier otra pausa
  // genérica preexistente (ej. facet "structure") — solo la primera
  // sustituye el botón "Aprobar y continuar" por el formulario de preguntas.
  const isAwaitingTechnicalClarification = isAwaitingApproval && job?.phase === "awaiting_technical_clarification";
  const gatingQuestions: GatingQuestion[] = isAwaitingTechnicalClarification
    ? (job?.checkpointData?.questions ?? [])
    : [];
  const isActivelyProcessing = effectiveJobId !== null && !isAwaitingApproval;
  const isWorking = isActivelyProcessing || isAwaitingApproval;
  const firstName = me?.name?.split(" ")?.[0] || me?.firstName || user?.firstName || "Ivan";
  const visibleMessages = ((messages ?? []) as ChatMessage[]).filter((msg) => !isTechnicalAssistantMessage(msg));
  const assistantMessages = visibleMessages.filter((msg) => msg.role !== "user");
  const latestAssistantMessage = assistantMessages[assistantMessages.length - 1]?.content;
  const frontendCode = String(app?.frontendCode ?? "").trim();
  const hasMilestonePlaceholder = frontendCode.includes("El código ha sido consolidado en disco por hitos");
  const hasRenderableCode = frontendCode.length >= 20 && !hasMilestonePlaceholder;
  const API_BASE = import.meta.env.VITE_API_URL ?? "";
  const previewEndpointUrl = app?._id ? `${API_BASE}/api/apps/${app._id}/preview` : "";
  // Prioridad máxima: proyectos importados con servidor SSR en vivo (Next.js
  // vía ssrImportBuilder.ts) — su "preview" es literalmente el servidor
  // corriendo en el sandbox, no un bundle servido por Maris AI.
  const deployedUrl = (app?.renderMode === "ssr-live" && app?.livePreviewUrl)
    ? app.livePreviewUrl
    : app?.vercelUrl || app?.vercelDeployUrl || app?.deploymentUrl || (app?.marisaiSubdomain ? `https://${app.marisaiSubdomain}.marisai.es` : "") || previewEndpointUrl;

  const isDeployedForShowcase = !!(app?.vercelUrl || app?.vercelDeployUrl || app?.deploymentUrl || app?.marisaiSubdomain);

  // ── SSR en vivo: heartbeat mientras se mira el preview + detección de
  // expiración + reinicio manual. Ver lib/ssrImportBuilder.ts (backend).
  const isSSRLive = app?.renderMode === "ssr-live";
  const ssrExpiresAt = app?.livePreviewExpiresAt ? new Date(app.livePreviewExpiresAt) : null;
  const [ssrExpired, setSsrExpired] = useState(false);
  const [ssrRestarting, setSsrRestarting] = useState(false);
  const ssrHeartbeat = useSSRPreviewHeartbeat();
  const ssrRestart = useRestartSSRPreview();

  useEffect(() => {
    if (!isSSRLive || !app?._id) return;
    // Comprobación inmediata: si ya venía expirado de antes (el cliente
    // cerró la pestaña y volvió pasados los 30 min), no intentar cargar
    // el iframe con una URL muerta -- mostrar directamente el aviso.
    if (ssrExpiresAt && ssrExpiresAt.getTime() < Date.now()) {
      setSsrExpired(true);
      return;
    }
    // Heartbeat cada 5 minutos mientras la pestaña sigue abierta con el
    // preview visible -- extiende el sandbox otros 30 min cada vez, así
    // que un cliente mirando el preview sin cortes nunca lo ve caducar.
    const interval = setInterval(async () => {
      try {
        const res = await ssrHeartbeat.mutateAsync({ appId: String(app._id) });
        if (!res.ok) {
          setSsrExpired(true);
          clearInterval(interval);
        }
      } catch {
        // Un fallo de red puntual en el heartbeat no debe marcar el
        // preview como expirado -- solo lo hacemos si el backend confirma
        // explícitamente que el sandbox murió (res.ok === false arriba).
      }
    }, 5 * 60_000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSSRLive, app?._id]);

  const handleRestartSSRPreview = async () => {
    if (!app?._id) return;
    setSsrRestarting(true);
    try {
      await ssrRestart.mutateAsync({ appId: String(app._id) });
      setSsrExpired(false);
      queryClient.invalidateQueries({ queryKey: getGetAppQueryKey(String(app._id)) });
      toast({ title: "✅ Preview reiniciado", description: "El servidor en vivo ha vuelto a arrancar." });
    } catch (err: any) {
      toast({ title: "No se pudo reiniciar", description: err?.message || "Error desconocido", variant: "destructive" });
    } finally {
      setSsrRestarting(false);
    }
  };
  const [showcasePending, setShowcasePending] = useState(false);
  const handleToggleShowcase = async (checked: boolean) => {
    if (!app?._id) return;
    setShowcasePending(true);
    try {
      const result = await apiFetch<{ ok: boolean; isPublic: boolean; publicSlug?: string }>(`/api/apps/${app._id}/showcase`, {
        method: "PATCH",
        body: JSON.stringify({ isPublic: checked }),
      });
      queryClient.invalidateQueries({ queryKey: getGetAppQueryKey(id) });
      toast({
        title: result.isPublic ? "Publicado en la galería" : "Retirado de la galería",
        description: result.isPublic
          ? `Tu proyecto ya es visible en marisai.es/showcase/${result.publicSlug}`
          : "Tu proyecto ya no aparece en la galería pública.",
      });
    } catch (error: any) {
      toast({ title: "Error", description: error?.message || "No se pudo actualizar la galería.", variant: "destructive" });
    } finally {
      setShowcasePending(false);
    }
  };

  const showStaticBuildState = !hasRenderableCode;
  const renderedFileCount = hasRenderableCode ? parseBundle(frontendCode) ? Object.keys(parseBundle(frontendCode)).length : 0 : 0;
  useEffect(() => {
    if (!hasRenderableCode || isWorking) return;
    const codeHash = frontendCode.slice(0, 200) + frontendCode.slice(-200) + frontendCode.length;
    const signature = `${app?._id || id}:${codeHash}`;
    if (!signature || signature === lastPreviewRefreshSignatureRef.current) return;
    lastPreviewRefreshSignatureRef.current = signature;
    setPreviewKey((value) => value + 1);
  }, [app?._id, app?.updatedAt, frontendCode.length, hasRenderableCode, isWorking, id]);

  const createdAtLabel = app?.createdAt ? new Date(app.createdAt).toLocaleString("es-ES") : "Sin fecha";
  const updatedAtLabel = app?.updatedAt ? new Date(app.updatedAt).toLocaleString("es-ES") : "Sin fecha";
  const appStatusLabel = deployedUrl ? "Desplegada" : hasRenderableCode ? "Preview lista" : isWorking ? "Construyendo" : "Pendiente";
  const workflowSteps = [
    { label: "Plan", done: !!app?.plan || !!frontendCode || !!latestAssistantMessage },
    { label: "Generación", done: hasRenderableCode },
    { label: "Preview", done: hasRenderableCode && !showStaticBuildState },
    { label: "Deploy", done: !!deployedUrl },
  ];

  const handleShare = async () => {
    const shareUrl = deployedUrl || (typeof window !== "undefined" ? window.location.href : "");
    if (!shareUrl) {
      toast({ title: "Sin enlace disponible", description: "Todavía no hay una URL para compartir.", variant: "destructive" });
      return;
    }
    try {
      if (typeof navigator !== "undefined" && navigator.share && deployedUrl) {
        await navigator.share({ title: app?.title || "Maris AI App", text: app?.description || "App generada con Maris AI", url: shareUrl });
        toast({ title: "Compartido", description: "Se abrió el panel nativo para compartir la app." });
        return;
      }
      if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(shareUrl);
        toast({ title: "Enlace copiado", description: deployedUrl ? "Se copió la URL pública de la app." : "Se copió el enlace de esta pantalla de trabajo." });
        return;
      }
      if (typeof window !== "undefined") {
        window.prompt("Copia este enlace", shareUrl);
        toast({ title: "Enlace preparado", description: "Copia el enlace mostrado para compartirlo." });
      }
    } catch (err: any) {
      if (err?.name !== "AbortError") toast({ title: "No se pudo compartir", description: err?.message ?? "Error", variant: "destructive" });
    }
  };

  const handleDeploy = () => {
    if (!hasRenderableCode) {
      setIsPreviewMaximized(false);
      setIsPreviewClosed(true);
      setActiveSidebar("chat");
      toast({ title: "Generación pendiente", description: "Aún no hay código frontend desplegable. Aprueba el plan o envía un mensaje para que Maris AI genere la app.", variant: "destructive" });
      return;
    }
    setShowDeployModal(true);
  };

  const handleRefreshPreview = () => {
    queryClient.invalidateQueries({ queryKey: getGetAppQueryKey(id) });
    queryClient.invalidateQueries({ queryKey: getGetActiveAppJobQueryKey(id) });
    if (effectiveJobId) queryClient.invalidateQueries({ queryKey: getGetGenerationJobQueryKey(effectiveJobId) });
    queryClient.invalidateQueries({ queryKey: getListAppMessagesQueryKey(id) });
    setPreviewKey((value) => value + 1);
    toast({ title: "Preview recargada", description: hasRenderableCode ? "La vista previa se ha recompilado con el último código guardado." : "Se actualizó el estado del trabajo. Si la generación terminó, la preview aparecerá automáticamente." });
  };

  const handleMaximizePreview = () => {
    if (isPreviewClosed) setIsPreviewClosed(false);
    setIsPreviewMaximized((value) => !value);
    toast({ title: isPreviewMaximized ? "Preview restaurada" : "Preview maximizada", description: isPreviewMaximized ? "Vuelves a ver el chat y los paneles junto a la app." : "La app ocupa toda la pantalla. Usa Restore o × para volver." });
  };

  // Pausa REAL del preview: cuando la pestaña pasa a segundo plano
  // mientras hay una vista en vivo renderizable, el iframe deja de
  // recibir foco/recursos del navegador y el contenido puede quedar
  // desactualizado. Al volver, mostramos la barra para que el usuario
  // decida si refrescar (Resume) — antes esta barra aparecía siempre,
  // sin relación real con si algo estaba pausado o no.
  useEffect(() => {
    if (!hasRenderableCode || isPreviewClosed) return;
    const onVisibilityChange = () => {
      if (document.hidden) {
        setIsPreviewPaused(true);
      }
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => document.removeEventListener("visibilitychange", onVisibilityChange);
  }, [hasRenderableCode, isPreviewClosed]);

  const handleClosePreview = () => {
    setIsPreviewMaximized(false);
    setIsPreviewClosed(true);
    setActiveSidebar("chat");
    setMobileTab("chat");
    toast({ title: "Preview cerrada", description: "La vista en vivo se ha retirado completamente y el chat ocupa el área de trabajo." });
  };

  const autoRepairTriedForCodeRef = useRef<string | null>(null);
  const autoRepairAttemptsRef = useRef(0);
  const MAX_AUTO_REPAIR_ATTEMPTS = 2;
  const handlePreviewFatalError = (detail: string) => {
    if (!hasRenderableCode || isWorking) return;
    const codeSignature = `${frontendCode.length}`;
    if (autoRepairTriedForCodeRef.current === codeSignature) return;
    if (autoRepairAttemptsRef.current >= MAX_AUTO_REPAIR_ATTEMPTS) return;
    autoRepairTriedForCodeRef.current = codeSignature;
    autoRepairAttemptsRef.current += 1;
    sendMutation.mutate({
      id,
      data: {
        content: `La vista previa no muestra nada (pantalla en blanco). Detalle técnico capturado en el navegador: ${detail || "el contenedor #root nunca recibió contenido tras cargar"}. Revisa el bundle generado y corrígelo para que la app renderice correctamente.`,
        attachmentIds: [],
        isAutoRepair: true,
      },
    });
  };

  const handleOpenPreview = () => {
    setIsPreviewClosed(false);
    setIsPreviewMaximized(false);
    setMobileTab("preview");
    toast({ title: "Preview abierta", description: hasRenderableCode ? "La vista en vivo se ha restaurado." : "Todavía no hay frontend renderizable; verás el estado de construcción." });
  };

  const normalizePublicUrl = (rawUrl?: string | null): URL | null => {
    const value = rawUrl?.trim();
    if (!value) return null;
    try {
      return new URL(value.startsWith("http://") || value.startsWith("https://") ? value : `https://${value}`);
    } catch {
      return null;
    }
  };

  const openGoogleIndexing = (rawUrl?: string | null, preOpenedWindow?: Window | null) => {
    const target = normalizePublicUrl(rawUrl);
    if (!target) {
      preOpenedWindow?.close();
      toast({ title: "URL no válida", description: "No se encontró una URL pública válida para enviar a Google.", variant: "destructive" });
      return false;
    }
    const propertyUrl = `${target.origin}/`;
    const searchConsoleUrl = `https://search.google.com/search-console/index/inspection?resource_id=${encodeURIComponent(propertyUrl)}&url=${encodeURIComponent(target.href)}`;
    const googleSearchUrl = `https://www.google.com/search?q=${encodeURIComponent(`${app?.title || "Maris AI App"} site:${target.hostname}`)}`;
    if (preOpenedWindow && !preOpenedWindow.closed) {
      preOpenedWindow.location.href = searchConsoleUrl;
    } else {
      const opened = window.open(searchConsoleUrl, "_blank", "noopener,noreferrer");
      if (!opened) {
        toast({ title: "Ventana bloqueada", description: "Permite ventanas emergentes para Maris AI y vuelve a pulsar Publicar en Google.", variant: "destructive" });
        return false;
      }
    }
    toast({ title: "Google Search Console abierto", description: "Revisa la propiedad y pulsa Solicitar indexación en Google." });
    window.setTimeout(() => { window.open(googleSearchUrl, "_blank", "noopener,noreferrer"); }, 250);
    return true;
  };

  const handlePublishGoogle = async () => {
    if (!hasRenderableCode) {
      toast({ title: "App no disponible", description: "Genera la app primero antes de publicarla en Google.", variant: "destructive" });
      return;
    }
    if (isPublishingGoogle) return;
    setIsPublishingGoogle(true);
    const preOpenedWindow = !deployedUrl ? window.open("about:blank", "_blank", "noopener,noreferrer") : null;
    try {
      if (deployedUrl) {
        openGoogleIndexing(deployedUrl);
      } else {
        toast({ title: "Desplegando antes de publicar…", description: "Tu app necesita estar desplegada para aparecer en Google. Iniciando deploy automático." });
        // El endpoint de deploy ahora es asíncrono (202 "started" — ver
        // POST /apps/:id/deploy). Se hace polling real de deploy-status
        // hasta que la fase llegue a "done", igual que el stepper de
        // DeployModal, en vez de esperar la URL en la respuesta directa.
        deployMutation.mutate({ id }, {
          onSuccess: () => {
            const pollUntilDone = async () => {
              for (let attempt = 0; attempt < 60; attempt++) {
                await new Promise((r) => setTimeout(r, 2500));
                try {
                  const status = await apiFetch<any>(`/api/apps/${id}/deploy-status`);
                  if (status.phase === "done" && status.deploymentUrl) {
                    queryClient.invalidateQueries({ queryKey: getGetAppQueryKey(id) });
                    if (openGoogleIndexing(status.deploymentUrl, preOpenedWindow)) {
                      toast({ title: "App desplegada", description: `Tu app está en ${status.deploymentUrl}. Search Console se ha abierto para solicitar la indexación.` });
                    }
                    return;
                  }
                  if (status.phase === "error") {
                    preOpenedWindow?.close();
                    toast({ title: "No se pudo desplegar", description: status.error || "Intenta publicar de nuevo en unos minutos.", variant: "destructive" });
                    return;
                  }
                } catch { /* sigue intentando */ }
              }
              preOpenedWindow?.close();
              toast({ title: "El despliegue está tardando más de lo normal", description: "Revisa el estado del deploy en el panel e inténtalo de nuevo.", variant: "destructive" });
            };
            pollUntilDone();
          },
          onError: (err: any) => {
            preOpenedWindow?.close();
            const isPaymentRequired = err?.error === "Créditos insuficientes";
            toast({ title: isPaymentRequired ? "Créditos insuficientes" : "No se pudo desplegar", description: isPaymentRequired ? err?.hint : (err?.message || "Intenta publicar de nuevo en unos minutos."), variant: "destructive" });
          },
        });
      }
    } catch (err: any) {
      preOpenedWindow?.close();
      toast({ title: "Error al publicar en Google", description: err?.message ?? "Inténtalo de nuevo.", variant: "destructive" });
    } finally {
      setTimeout(() => setIsPublishingGoogle(false), 2000);
    }
  };

  const handleResumePreview = () => {
    setIsPreviewPaused(false);
    if (hasRenderableCode) {
      handleRefreshPreview();
      return;
    }
    setIsPreviewMaximized(false);
    setIsPreviewClosed(true);
    setActiveSidebar("chat");
    setMobileTab("chat");
    toast({ title: "Preview cerrada", description: "La app aún no tiene frontend renderizable. Revisa el plan o pide cambios en el chat." });
  };

  // Cierra SOLO la barra de aviso "Vista en vivo activa" — no toca la
  // preview ni el chat. Antes su botón × llamaba a handleClosePreview,
  // que cerraba toda la vista previa; era el mismo aspecto pero un efecto
  // mucho más grande de lo que parecía.
  const handleDismissPausedBar = () => {
    setIsPreviewPaused(false);
  };

  const handleSidebarClick = (tab: SidebarTab) => {
    setActiveSidebar(tab);
    if (tab === "ui-builder") {
      setIsPreviewClosed(false);
      toast({ title: "UI Builder activo", description: "Usa los controles del panel para refrescar, maximizar o desplegar la preview." });
    }
  };

  const handleOpenHelp = () => {
    if (typeof window !== "undefined") {
      window.open("mailto:soporte@marisai.es?subject=Ayuda%20Maris%20AI", "_blank", "noopener,noreferrer");
    }
    toast({ title: "Ayuda abierta", description: "Se ha abierto un mensaje para contactar con soporte de Maris AI." });
  };

  const handleOpenDocs = () => {
    if (typeof window !== "undefined") {
      window.open("https://docs.marisai.es", "_blank", "noopener,noreferrer");
    }
  };

  const notificationItems = [
    { title: appStatusLabel, description: hasRenderableCode ? "La preview tiene código renderizable." : "Maris AI sigue esperando código renderizable." },
    { title: isWorking ? "Trabajo activo" : "Sin trabajo activo", description: isWorking ? phaseInfo.label : "No hay generación en curso ahora mismo." },
    { title: deployedUrl ? "Deploy disponible" : "Deploy pendiente", description: deployedUrl || "Despliega cuando la preview esté lista." },
  ];

  const renderSidebarPanel = () => {
    const panelTitle = NAV_ITEMS.find((item) => item.id === activeSidebar)?.label ?? "Chat";
    const PanelHeader = ({ title, description }: { title: string; description: string }) => (
      <div className="px-4 md:px-6 pt-4 md:pt-6">
        <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[#a78bfa]">{panelTitle}</p>
        <h2 className="mt-2 text-xl md:text-2xl font-extrabold text-white">{title}</h2>
        <p className="mt-2 text-sm leading-relaxed text-white/55">{description}</p>
      </div>
    );

    if (activeSidebar === "plan") {
      return (
        <>
          <PanelHeader title="Plan de construcción" description="Revisa la estructura que debe seguir Maris AI antes de continuar con la generación o los cambios." />
          <div className="flex-1 overflow-y-auto px-4 md:px-6 py-4 md:py-6 custom-scrollbar pb-20 md:pb-6">
            <div className="rounded-2xl border border-white/8 bg-white/[0.035] p-5 text-sm leading-relaxed text-white/75">
              {app?.plan || latestAssistantMessage || "Todavía no hay un plan detallado guardado. Cuando Maris AI termine la estructura, aparecerá aquí para revisión."}
            </div>
            <div className="mt-5 grid gap-3">
              {workflowSteps.map((step, index) => (
                <div key={step.label} className="flex items-center justify-between rounded-xl border border-white/8 bg-[#111827]/70 px-4 py-3">
                  <span className="text-sm text-white/70">{index + 1}. {step.label}</span>
                  <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${step.done ? "bg-emerald-500/15 text-emerald-300" : "bg-white/8 text-white/45"}`}>{step.done ? "Listo" : "Pendiente"}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="px-4 md:px-6 pb-20 md:pb-6">
            <Button size="lg" onClick={handleApprove} disabled={approveMutation.isPending} className="h-12 w-full bg-gradient-to-r from-[#7c3aed] to-[#9333ea] font-bold text-white hover:from-[#8b5cf6] hover:to-[#a855f7]">
              {approveMutation.isPending ? <Loader2 className="mr-2 h-5 w-5 animate-spin" /> : <Zap className="mr-2 h-5 w-5" />}
              Aprobar plan
            </Button>
          </div>
        </>
      );
    }

    if (activeSidebar === "data") {
      return (
        <>
          <PanelHeader title="Datos de la app" description="Consulta el estado técnico y los datos disponibles para la vista previa y el despliegue." />
          <div className="flex-1 overflow-y-auto px-4 md:px-6 py-4 md:py-6 custom-scrollbar pb-20 md:pb-6">
            <div className="grid gap-3">
              {[
                ["Estado", appStatusLabel],
                ["Archivos preview", String(renderedFileCount)],
                ["Código frontend", `${frontendCode.length.toLocaleString("es-ES")} caracteres`],
                ["Creada", createdAtLabel],
                ["Actualizada", updatedAtLabel],
              ].map(([label, value]) => (
                <div key={label} className="rounded-xl border border-white/8 bg-white/[0.035] p-4">
                  <p className="text-xs uppercase tracking-[0.18em] text-white/35">{label}</p>
                  <p className="mt-2 break-words text-sm font-semibold text-white/80">{value}</p>
                </div>
              ))}
            </div>
            <Button onClick={handleRefreshPreview} disabled={!hasRenderableCode} variant="outline" className="mt-5 w-full border-white/10 bg-white/[0.04] text-white hover:bg-white/[0.08]">
              <RefreshCcw className="mr-2 h-4 w-4" /> Recargar datos y preview
            </Button>
        {/* Runtime errors capturados en producción */}
        <RuntimeErrorsPanel appId={id} />
          </div>
        </>
      );
    }

    if (activeSidebar === "integrations") {
      return (
        <>
          <PanelHeader title="Integraciones" description="Gestiona la URL pública, compartir y despliegue conectado de la aplicación." />
          <div className="flex-1 overflow-y-auto px-4 md:px-6 py-4 md:py-6 custom-scrollbar pb-20 md:pb-6">
            <div className="rounded-2xl border border-white/8 bg-white/[0.035] p-5">
              <p className="text-xs uppercase tracking-[0.18em] text-white/35">URL pública</p>
              <p className="mt-3 break-all text-sm text-white/75">{deployedUrl || "Aún no hay URL pública. Pulsa Deploy cuando la preview esté lista."}</p>
            </div>
            <div className="mt-5 grid gap-3">
              <Button onClick={handleShare} variant="outline" className="border-white/10 bg-white/[0.04] text-white hover:bg-white/[0.08]"><Share2 className="mr-2 h-4 w-4" /> Compartir enlace</Button>
              <Button onClick={handleDeploy} disabled={deployMutation.isPending || !hasRenderableCode} className="bg-gradient-to-r from-[#7c3aed] to-[#9333ea] font-bold text-white hover:from-[#8b5cf6] hover:to-[#a855f7]">
                {deployMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Rocket className="mr-2 h-4 w-4" />}
                {deployMutation.isPending ? "Desplegando" : isFreeRedeployNow ? "Deploy app (gratis)" : `Deploy app (${effectiveDeployCost} créditos)`}
              </Button>
            </div>
            <div className="mt-5 rounded-2xl border border-white/8 bg-white/[0.035] p-5">
              <div className="flex items-start gap-3">
                <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-emerald-400" />
                <div className="flex-1">
                  <p className="text-sm font-medium text-white">Revisión profunda de errores</p>
                  <p className="mt-1 text-xs text-white/50">
                    El Testing Agent vuelve a analizar todo el código de tu app en busca de errores de navegación, rutas rotas o problemas de compilación, y los repara automáticamente.
                  </p>
                </div>
              </div>
              <Button
                onClick={handleDeepTest}
                disabled={deepTestMutation.isPending || !hasRenderableCode || credits < DEEP_TEST_COST}
                variant="outline"
                className="mt-4 w-full border-emerald-500/30 bg-emerald-500/[0.06] text-emerald-300 hover:bg-emerald-500/[0.12] disabled:opacity-40"
              >
                {deepTestMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ShieldCheck className="mr-2 h-4 w-4" />}
                {deepTestMutation.isPending ? "Revisando…" : `Revisar errores (${DEEP_TEST_COST} créditos)`}
              </Button>
              {!deepTestMutation.isPending && credits < DEEP_TEST_COST && (
                <p className="mt-2 text-xs text-amber-400/90">
                  Te faltan {DEEP_TEST_COST - credits} créditos para esta revisión.{" "}
                  <button type="button" onClick={() => setLocation("/billing")} className="underline hover:text-amber-300">
                    Comprar créditos
                  </button>
                </p>
              )}
            </div>
            <div className="mt-5 rounded-2xl border border-white/8 bg-white/[0.035] p-5">
              <div className="flex items-start gap-3">
                <Globe className="mt-0.5 h-5 w-5 shrink-0 text-sky-400" />
                <div className="flex-1">
                  <p className="text-sm font-medium text-white">Dominio personalizado</p>
                  <p className="mt-1 text-xs text-white/50">
                    Conecta tu propio dominio (ej. midominio.com) apuntando sus DNS a Maris AI. Disponible para clientes que han activado un plan de pago alguna vez — el acceso se mantiene aunque canceles la suscripción más adelante.
                  </p>
                </div>
              </div>
              {!domainStatus?.domain ? (
                <div className="mt-4 flex gap-2">
                  <Input
                    value={domainInput}
                    onChange={(e) => setDomainInput(e.target.value)}
                    placeholder="midominio.com"
                    disabled={connectDomainMutation.isPending}
                    className="border-white/10 bg-white/[0.04] text-white placeholder:text-white/30"
                  />
                  <Button
                    onClick={handleConnectDomain}
                    disabled={connectDomainMutation.isPending || !domainInput.trim()}
                    variant="outline"
                    className="shrink-0 border-sky-500/30 bg-sky-500/[0.06] text-sky-300 hover:bg-sky-500/[0.12] disabled:opacity-40"
                  >
                    {connectDomainMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Conectar"}
                  </Button>
                </div>
              ) : (
                <div className="mt-4 space-y-3">
                  <div className="flex items-center justify-between rounded-lg border border-white/10 bg-white/[0.02] px-3.5 py-2.5">
                    <div className="flex items-center gap-2">
                      <span className={`h-2 w-2 rounded-full ${domainStatus.verified ? "bg-emerald-400" : "bg-amber-400 animate-pulse"}`} />
                      <span className="text-sm font-medium text-white">{domainStatus.domain}</span>
                      <span className={`text-xs ${domainStatus.verified ? "text-emerald-400" : "text-amber-400"}`}>
                        {domainStatus.verified ? "Verificado" : "Esperando DNS…"}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      {!domainStatus.verified && (
                        <Button
                          onClick={() => refetchDomain()}
                          variant="ghost"
                          size="sm"
                          className="h-7 text-xs text-sky-400/80 hover:text-sky-300 hover:bg-sky-500/10"
                        >
                          <RefreshCw className="mr-1 h-3 w-3" /> Verificar conexión
                        </Button>
                      )}
                      <Button
                        onClick={() => disconnectDomainMutation.mutate({ id })}
                        disabled={disconnectDomainMutation.isPending}
                        variant="ghost"
                        size="sm"
                        className="h-7 text-xs text-white/40 hover:text-red-400 hover:bg-red-500/10"
                      >
                        {disconnectDomainMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Desconectar"}
                      </Button>
                    </div>
                  </div>
                  {!domainStatus.verified && Array.isArray(domainStatus.recommendedDns) && domainStatus.recommendedDns.length > 0 && (
                    <div className="rounded-lg border border-amber-500/20 bg-amber-500/[0.04] p-3.5">
                      <p className="text-xs font-medium text-amber-300/90 mb-2">Añade estos registros DNS en tu proveedor de dominios:</p>
                      <div className="space-y-1.5">
                        {domainStatus.recommendedDns.map((rec: any, i: number) => (
                          <div key={i} className="grid grid-cols-[50px_1fr_1fr] gap-2 text-xs font-mono">
                            <span className="text-white/40">{rec.type}</span>
                            <span className="text-white/70">{rec.name}</span>
                            <span className="text-white/70 truncate">{rec.value}</span>
                          </div>
                        ))}
                      </div>
                      <p className="mt-2 text-[11px] text-white/40">La propagación DNS puede tardar hasta 24 horas. Esta página se actualiza sola.</p>
                    </div>
                  )}
                </div>
              )}
            </div>
            <div className="mt-5 rounded-2xl border border-white/8 bg-white/[0.035] p-5">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-sm font-medium text-white">Galería pública de Maris AI</p>
                  <p className="mt-1 text-xs text-white/50">
                    Muestra este proyecto en{" "}
                    <a href="https://www.marisai.es/showcase" target="_blank" rel="noreferrer" className="text-primary underline underline-offset-2">marisai.es/showcase</a>
                    {" "}con su enlace de demo en vivo.
                  </p>
                  {app?.isPublic && app?.publicSlug && (
                    <a href={`https://www.marisai.es/showcase/${app.publicSlug}`} target="_blank" rel="noreferrer" className="mt-2 inline-block text-xs text-primary underline underline-offset-2 break-all">
                      Ver tu ficha pública →
                    </a>
                  )}
                </div>
                <Switch checked={!!app?.isPublic} onCheckedChange={handleToggleShowcase} disabled={showcasePending || (!isDeployedForShowcase && !app?.isPublic)} />
              </div>
              {!isDeployedForShowcase && !app?.isPublic && (
                <p className="mt-2 text-xs text-amber-400/80">Despliega la app primero para poder publicarla en la galería.</p>
              )}
            </div>
            <div className="mt-5 rounded-2xl border border-white/8 bg-white/[0.035] p-5">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-sm font-medium text-white">Automatización</p>
                  <p className="mt-1 text-xs text-white/50">Conecta eventos de esta app con n8n, Zapier, Make o tu propio endpoint, con flujos visuales propios.</p>
                </div>
                <Button onClick={() => setShowWorkflows(true)} variant="outline" className="shrink-0 border-white/10 bg-white/[0.04] text-white hover:bg-white/[0.08]">
                  <WorkflowIcon className="mr-2 h-4 w-4" /> Abrir flujos
                </Button>
              </div>
            </div>
            <div className="mt-5 rounded-2xl border border-white/8 bg-white/[0.035] p-5">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-sm font-medium text-white">Prueba de estrés</p>
                  <p className="mt-1 text-xs text-white/50">Lanza tráfico real contra tu app desplegada y mide cómo responde bajo carga.</p>
                </div>
                <Button onClick={() => setShowStressTest(true)} variant="outline" className="shrink-0 border-white/10 bg-white/[0.04] text-white hover:bg-white/[0.08]">
                  <Activity className="mr-2 h-4 w-4" /> Probar carga
                </Button>
              </div>
            </div>
          </div>
        </>
      );
    }

    if (activeSidebar === "ui-builder") {
      return (
        <>
          <PanelHeader title="UI Builder" description="Controla la preview en vivo de la interfaz generada y abre la vista de trabajo ampliada." />
          <div className="flex-1 overflow-y-auto px-4 md:px-6 py-4 md:py-6 custom-scrollbar pb-20 md:pb-6">
            <div className="rounded-2xl border border-[#7c3aed]/25 bg-[#7c3aed]/10 p-5 text-sm text-white/75">
              {showStaticBuildState ? "La preview aún espera código renderizable." : "La preview en vivo está disponible y conectada al último bundle guardado."}
            </div>
            <div className="mt-5 grid gap-3">
              <Button onClick={handleRefreshPreview} disabled={!hasRenderableCode} variant="outline" className="border-white/10 bg-white/[0.04] text-white hover:bg-white/[0.08]"><RefreshCcw className="mr-2 h-4 w-4" /> Refrescar preview</Button>
              <Button onClick={handleMaximizePreview} variant="outline" className="border-white/10 bg-white/[0.04] text-white hover:bg-white/[0.08]"><Maximize2 className="mr-2 h-4 w-4" /> {isPreviewMaximized ? "Restaurar preview" : "Maximizar preview"}</Button>
              <Button onClick={handleDeploy} disabled={deployMutation.isPending || !hasRenderableCode} className="bg-gradient-to-r from-[#7c3aed] to-[#9333ea] font-bold text-white"><Rocket className="mr-2 h-4 w-4" /> Deploy desde UI Builder</Button>
            </div>
          </div>
        </>
      );
    }

    if (activeSidebar === "workflows") {
      return (
        <>
          <PanelHeader title="Workflows" description="Sigue el flujo de trabajo del agente y las fases activas de generación." />
          <div className="flex-1 overflow-y-auto px-4 md:px-6 py-4 md:py-6 custom-scrollbar pb-20 md:pb-6">
            <div className="rounded-2xl border border-white/8 bg-white/[0.035] p-5">
              <div className="flex items-center gap-3 text-white/80">
                <PhaseIcon className={`h-5 w-5 text-[#a78bfa] ${isWorking ? "animate-pulse" : ""}`} />
                <span className="font-semibold">{isWorking ? phaseInfo.label : "Sin trabajos activos"}</span>
              </div>
              {job?.status === "queued" && job?.queuePosition != null && (
                <div className="mt-3 rounded-xl border border-[#7c3aed]/20 bg-[#7c3aed]/[0.06] px-4 py-3">
                  <p className="text-sm text-white/85">
                    {job.queuePosition === 0
                      ? "Eres el siguiente — empezará en cuanto se libere un agente."
                      : `Hay ${job.queuePosition} generación${job.queuePosition === 1 ? "" : "es"} delante de la tuya.`}
                  </p>
                  {job.estimatedWaitSeconds != null && job.estimatedWaitSeconds > 0 && (
                    <p className="mt-1 text-xs text-white/45">
                      Tiempo estimado de espera: {job.estimatedWaitSeconds < 60 ? `${job.estimatedWaitSeconds}s` : `${Math.round(job.estimatedWaitSeconds / 60)} min`}
                    </p>
                  )}
                </div>
              )}
              {job?.errorMessage && <p className="mt-3 text-sm text-red-300">{job.errorMessage}</p>}
            </div>
            <div className="mt-5 grid gap-3">
              {workflowSteps.map((step) => (
                <div key={step.label} className="flex items-center justify-between rounded-xl border border-white/8 bg-[#111827]/70 px-4 py-3">
                  <span className="text-sm text-white/70">{step.label}</span>
                  <span className={`h-2.5 w-2.5 rounded-full ${step.done ? "bg-emerald-400" : "bg-white/20"}`} />
                </div>
              ))}
            </div>
          </div>
        </>
      );
    }

    if (activeSidebar === "settings") {
      return (
        <>
          <PanelHeader title="Settings" description="Accesos y acciones de configuración de esta app y de tu cuenta." />
          <div className="flex-1 overflow-y-auto px-4 md:px-6 py-4 md:py-6 custom-scrollbar pb-20 md:pb-6">
            <div className="rounded-2xl border border-white/8 bg-white/[0.035] p-5">
              <p className="text-sm font-semibold text-white">{app?.title || "App sin título"}</p>
              <p className="mt-2 text-sm text-white/55">{app?.description || "Sin descripción guardada."}</p>
              <p className="mt-4 text-xs text-white/35">ID: {id}</p>
            </div>
            <div className="mt-5 grid gap-3">
              <Button onClick={() => setLocation("/dashboard")} variant="outline" className="border-white/10 bg-white/[0.04] text-white hover:bg-white/[0.08]"><ArrowLeft className="mr-2 h-4 w-4" /> Volver al panel</Button>
              <Button onClick={() => setLocation("/billing")} variant="outline" className="border-white/10 bg-white/[0.04] text-white hover:bg-white/[0.08]">Créditos: {isAdmin ? "Admin" : credits}</Button>
              {isAdmin && <Button onClick={() => setLocation("/admin")} variant="outline" className="border-white/10 bg-white/[0.04] text-white hover:bg-white/[0.08]">Abrir panel admin</Button>}
            </div>
          </div>
        </>
      );
    }

    // ── CHAT (tab por defecto) ──
    return (
      <>
        {isAwaitingApproval && !isAwaitingTechnicalClarification && (
          <div className="px-4 md:px-6 pt-4 md:pt-6">
            <div className="rounded-lg border border-[#1d4ed8]/35 bg-[#0f2244]/70 px-4 md:px-6 py-3.5 text-center text-[14px] md:text-[15px] font-semibold text-[#60a5fa] shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]">
              <div className="flex items-center justify-center gap-3">
                <Info className="h-5 w-5" />
                <span>Maris AI seguirá trabajando después de tu respuesta</span>
              </div>
            </div>
          </div>
        )}
        <div className="flex-1 overflow-y-auto px-4 md:px-8 py-6 md:py-10 pb-20 md:pb-6 custom-scrollbar">
          {visibleMessages.length === 0 ? (
            <div className="flex items-start gap-4 md:gap-5">
              <div className="relative mt-1 shrink-0">
                <div className="absolute inset-0 rounded-full bg-[#7c3aed]/40 blur-xl" />
                <div className="relative grid h-14 w-14 md:h-[74px] md:w-[74px] place-items-center rounded-full border border-[#8b5cf6]/30 bg-[#111827] shadow-[0_0_30px_rgba(124,58,237,0.55)]">
                  <Bot className="h-7 w-7 md:h-10 md:w-10 text-white robot-vibrate" />
                </div>
              </div>
              <div className="space-y-2">
                <div className="rounded-lg border border-white/[0.07] bg-[#1b2230] px-4 py-3 md:px-5 md:py-4 text-[16px] md:text-[18px] leading-relaxed text-white/90 shadow-[0_12px_30px_rgba(0,0,0,0.2)]">
                  {hasRenderableCode || isWorking ? (
                    <>
                      <p>He terminado la estructura.</p>
                      <p className="mt-3">Revisa el plan y dame el visto bueno para continuar.</p>
                    </>
                  ) : (
                    <>
                      <p>No encuentro mensajes ni código generado para esta conversación.</p>
                      <p className="mt-3">Es posible que una generación anterior se interrumpiera antes de terminar. Escríbeme abajo qué quieres construir y vuelvo a empezar.</p>
                    </>
                  )}
                </div>
                <div className="pl-1">
                  <p className="text-[15px] md:text-[17px] font-bold text-[#a78bfa]">Maris AI</p>
                  <p className="mt-1 text-[12px] md:text-[14px] text-white/45">Ahora</p>
                </div>
              </div>
            </div>
          ) : (
            <div className="space-y-2 md:space-y-3">
              {visibleMessages.map((message, index) => {
                const isUserMessage = message.role === "user";
                const key = message.id ?? `${message.role}-${index}`;
                const isOld = index < visibleMessages.length - 4; // los últimos 4 se ven completos
                const rawContent = String(message.content || "").trim();
                // Truncar mensajes antiguos y prompts largos del usuario
                const MAX_CHARS = isOld ? 120 : isUserMessage ? 300 : 600;
                const truncated = rawContent.length > MAX_CHARS;
                const displayContent = truncated ? rawContent.slice(0, MAX_CHARS) + "…" : rawContent;

                if (isOld && isUserMessage) {
                  // Mensajes de usuario antiguos: línea compacta
                  return (
                    <div key={key} className="flex justify-end">
                      <div className="max-w-[75%] flex items-center gap-1.5 bg-[#7c3aed]/20 border border-[#7c3aed]/20 rounded-xl px-3 py-1.5">
                        <span className="text-[11px] text-white/40 shrink-0">{formatMessageTime(message.createdAt)}</span>
                        <span className="text-[11px] text-white/60 truncate">{rawContent.slice(0, 80)}{rawContent.length > 80 ? "…" : ""}</span>
                      </div>
                    </div>
                  );
                }

                if (isOld && !isUserMessage) {
                  // Respuestas antiguas de la IA: línea colapsada con ✓
                  return (
                    <div key={key} className="flex items-center gap-2 px-1">
                      <div className="w-4 h-4 rounded-full bg-violet-500/20 border border-violet-500/30 flex items-center justify-center shrink-0">
                        <span className="text-[8px] text-violet-400">✓</span>
                      </div>
                      <div className="flex-1 h-px bg-white/[0.04]" />
                      <span className="text-[10px] text-white/20 shrink-0">{formatMessageTime(message.createdAt)}</span>
                    </div>
                  );
                }

                return (
                  <div key={key} className={`flex items-start gap-2 md:gap-3 ${isUserMessage ? "justify-end" : "justify-start"}`}>
                    {!isUserMessage && (
                      <div className="relative mt-0.5 shrink-0">
                        <div className="absolute inset-0 rounded-full bg-[#7c3aed]/25 blur-md" />
                        <div className="relative grid h-7 w-7 md:h-8 md:w-8 place-items-center rounded-full border border-[#8b5cf6]/25 bg-[#111827]">
                          <Bot className="h-3.5 w-3.5 md:h-4 md:w-4 text-white" />
                        </div>
                      </div>
                    )}
                    <div className={`max-w-[85%] md:max-w-[78%] space-y-1 ${isUserMessage ? "items-end text-right" : "items-start"}`}>
                      <div className={`whitespace-pre-wrap rounded-xl px-3 py-2 md:px-4 md:py-2.5 text-[13px] md:text-[14px] leading-relaxed ${isUserMessage ? "bg-gradient-to-r from-[#7c3aed] to-[#9333ea] text-white shadow-[0_4px_15px_rgba(124,58,237,0.3)]" : "border border-white/[0.07] bg-[#1b2230] text-white/90"}`}>
                        {!isUserMessage && rawContent.includes("ENGINE_EXEC activado") && (
                          <div className="mb-2 inline-flex items-center gap-1.5 rounded-full border border-emerald-400/25 bg-emerald-400/10 px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-[0.15em] text-emerald-200">
                            <Shield className="h-3 w-3" /> ENGINE_EXEC
                          </div>
                        )}
                        {displayContent}
                      </div>
                      <div className={`px-1 flex items-center gap-2 ${isUserMessage ? "justify-end" : "justify-start"}`}>
                        <p className={`text-[10px] font-semibold ${isUserMessage ? "text-white/50" : "text-[#a78bfa]"}`}>{isUserMessage ? firstName : "Maris AI"}</p>
                        <p className="text-[10px] text-white/25">{formatMessageTime(message.createdAt)}</p>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          {/* Pipeline de agentes en vivo + quema de créditos (estilo Emergent.sh) */}
          {isWorking && job && <AgentStatusPipeline job={job} />}
          {/* Agent logs inline */}
          {isWorking && job && jobLogs && jobLogs.length > 0 && (
            <div className="mt-4 space-y-2">
              {jobLogs.slice(-8).map((log: any, idx: number) => {
                const agentKey = (log.agent || "system").toLowerCase();
                const agentCfg: Record<string, { label: string; color: string; bg: string; border: string; Icon: any }> = {
                  frontend:     { label: "FRONTEND",     color: "text-emerald-400", bg: "bg-emerald-500/10",  border: "border-emerald-500/25", Icon: Code },
                  backend:      { label: "BACKEND",      color: "text-orange-400",  bg: "bg-orange-500/10",   border: "border-orange-500/25",  Icon: Terminal },
                  testing:      { label: "TESTING",      color: "text-sky-400",     bg: "bg-sky-500/10",      border: "border-sky-500/25",     Icon: Terminal },
                  planner:      { label: "PLANNER",      color: "text-amber-400",   bg: "bg-amber-500/10",    border: "border-amber-500/25",   Icon: Sparkles },
                  orchestrator: { label: "ORCHESTRATOR", color: "text-violet-400",  bg: "bg-violet-500/10",   border: "border-violet-500/25",  Icon: Cpu },
                  coder:        { label: "CODER",        color: "text-violet-400",  bg: "bg-violet-500/10",   border: "border-violet-500/25",  Icon: Code },
                  architect:    { label: "ARCHITECT",    color: "text-amber-400",   bg: "bg-amber-500/10",    border: "border-amber-500/25",   Icon: Sparkles },
                  qa:           { label: "QA",           color: "text-sky-400",     bg: "bg-sky-500/10",      border: "border-sky-500/25",     Icon: Terminal },
                  patcher:      { label: "PATCHER",      color: "text-teal-400",    bg: "bg-teal-500/10",     border: "border-teal-500/25",    Icon: Code },
                  validator:    { label: "VALIDATOR",    color: "text-cyan-400",    bg: "bg-cyan-500/10",     border: "border-cyan-500/25",    Icon: Shield },
                  memory:       { label: "MEMORY",       color: "text-indigo-400",  bg: "bg-indigo-500/10",   border: "border-indigo-500/25",  Icon: Cpu },
                  system:       { label: "SYSTEM",       color: "text-red-400",     bg: "bg-red-500/10",      border: "border-red-500/25",     Icon: AlertCircle },
                };
                const cfg = agentCfg[agentKey] || agentCfg.system;
                const isActive = idx === jobLogs.slice(-8).length - 1 && isWorking;
                const isError = log.level === "error" || agentKey === "system";
                return (
                  <div key={log.id || idx} className={`flex items-center gap-3 rounded-xl border px-3 py-2 md:px-3.5 md:py-2.5 ${
                    isError ? "border-red-500/30 bg-red-500/8" :
                    isActive ? "border-[#7c3aed]/40 bg-[#7c3aed]/8" :
                    `${cfg.border} ${cfg.bg}`
                  }`}>
                    <div className={`grid h-7 w-7 md:h-8 md:w-8 shrink-0 place-items-center rounded-lg border ${isError ? "border-red-500/30 bg-red-500/15" : `${cfg.border} ${cfg.bg}`}`}>
                      <cfg.Icon className={`h-3.5 w-3.5 md:h-4 md:w-4 ${isError ? "text-red-400" : cfg.color}`} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className={`text-[10px] md:text-[11px] font-black tracking-widest ${isError ? "text-red-400" : cfg.color}`}>{cfg.label}</span>
                        {log.file && <span className="text-[10px] md:text-[11px] text-white/35 font-mono truncate">{log.file}</span>}
                      </div>
                      {log.message && <p className={`text-[11px] md:text-[12px] leading-snug truncate ${isError ? "text-red-300" : "text-white/60"}`}>{log.message}</p>}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="hidden md:inline text-[11px] text-white/25 font-mono">{formatMessageTime(log.createdAt)}</span>
                      {isActive ? (
                        <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse shadow-[0_0_6px_rgba(52,211,153,0.8)]" />
                      ) : (
                        <ChevronRight className="h-3.5 w-3.5 text-white/20" />
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          {isWorking && job && (!jobLogs || jobLogs.length === 0) && (
            <div className="mt-4 flex flex-col items-center gap-3 py-6">
              <div className="grid h-12 w-12 place-items-center rounded-2xl border border-[#7c3aed]/30 bg-[#7c3aed]/10">
                <Terminal className="h-6 w-6 text-[#a78bfa] animate-pulse" />
              </div>
              <p className="text-[12px] font-mono uppercase tracking-widest text-white/30">Conectando con los agentes…</p>
            </div>
          )}
          <div ref={messagesEndRef} />

          {/* ─── Visual Test Inline — aparece automáticamente tras generar ─── */}
          {showVisualTestInline && (
            <div className="mx-2 md:mx-6 mb-4 animate-in slide-in-from-bottom-2">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2 text-[11px] text-cyan-400 font-medium">
                  <Eye className="h-3.5 w-3.5" />
                  Testing visual automático — Zoco IA verifica tu app
                </div>
                <button onClick={() => setShowVisualTestInline(false)}
                  className="text-white/25 hover:text-white/60 transition-colors">
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
              <VisualTestPanel
                appId={app?._id || app?.id || ""}
                appSlug={app?.publicSlug || undefined}
                autoRunOnMount
                onResolved={() => {
                  setShowVisualTestInline(false);
                  setShowVisualSuccessCard(true);
                }}
              />
            </div>
          )}

          {/* ─── Tarjeta de éxito tras verificación automática resuelta ─── */}
          {showVisualSuccessCard && (
            <div className="mx-2 md:mx-6 mb-4 animate-in slide-in-from-bottom-2 rounded-xl border border-emerald-500/25 bg-emerald-500/[0.06] p-4">
              <div className="flex items-start gap-3">
                <div className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-emerald-500/15 border border-emerald-500/25">
                  <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] font-bold text-white">
                    ¡Tu {app?.platform === "mobile-native" ? "app" : "web"} está generada con éxito! 🎉
                  </p>
                  <p className="mt-0.5 text-[12px] text-white/55">
                    Verificada visualmente — ya puedes seguir editándola o hacer el deploy cuando quieras.
                  </p>
                  <button
                    onClick={() => {
                      setShowVisualSuccessCard(false);
                      setDraft("¿Qué más puedo mejorar?");
                    }}
                    className="mt-2.5 inline-flex items-center gap-1.5 rounded-md border border-[#8b5cf6]/35 bg-[#7c3aed]/10 px-3 py-1.5 text-[12px] font-semibold text-[#a78bfa] transition hover:bg-[#7c3aed]/20 hover:text-white"
                  >
                    <Sparkles className="h-3.5 w-3.5" />
                    ¿Puedo mejorar esto?
                  </button>
                </div>
                <button onClick={() => setShowVisualSuccessCard(false)}
                  className="text-white/25 hover:text-white/60 transition-colors">
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          )}
        </div>
        <div className="space-y-2 px-2 md:px-4 pb-24 md:pb-6">
          {isAwaitingTechnicalClarification && gatingQuestions.length > 0 ? (
            <GatingQuestionsForm
              questions={gatingQuestions}
              isPending={approveMutation.isPending}
              onSubmit={handleSubmitGatingAnswers}
            />
          ) : isAwaitingApproval && (
            <Button
              size="lg"
              onClick={handleApprove}
              disabled={approveMutation.isPending}
              className="h-12 w-full bg-gradient-to-r from-[#7c3aed] to-[#9333ea] font-bold text-white shadow-[0_0_22px_rgba(124,58,237,0.4)] hover:from-[#8b5cf6] hover:to-[#a855f7]"
            >
              {approveMutation.isPending ? <Loader2 className="mr-2 h-5 w-5 animate-spin" /> : <Zap className="mr-2 h-5 w-5 fill-current" />}
              Aprobar y continuar
            </Button>
          )}
          {!isAwaitingApproval && (
            <div className="relative rounded-2xl border border-white/[0.09] bg-[#0d0f1a] shadow-[0_8px_30px_rgba(0,0,0,0.3)]">
              {/* === OVERLAY: SIN CRÉDITOS === */}
              {outOfCredits && (
                <div className="absolute inset-0 z-30 flex flex-col items-center justify-center rounded-2xl bg-[#0d0f1a]/97 backdrop-blur-sm border-2 border-red-500/30">
                  <div className="text-center px-6 max-w-sm">
                    <div className="w-12 h-12 rounded-full bg-red-500/10 flex items-center justify-center mx-auto mb-3">
                      <AlertTriangle className="h-6 w-6 text-red-400" />
                    </div>
                    <h3 className="text-base font-bold text-white mb-1.5">Te has quedado sin créditos</h3>
                    <p className="text-sm text-white/50 mb-4">Compra más créditos para poder seguir trabajando con los agentes.</p>
                    <Button
                      className="w-full bg-gradient-to-r from-green-500 to-green-600 hover:from-green-600 hover:to-green-700 font-bold text-white shadow-lg shadow-green-500/20"
                      onClick={() => setLocation("/billing")}
                    >
                      <ShoppingCart className="mr-2 h-4 w-4" />
                      Comprar créditos
                    </Button>
                    <p className="text-[11px] text-white/30 mt-2 animate-pulse">Se reactivará automáticamente al recargar...</p>
                  </div>
                </div>
              )}
              <AttachmentChips attachments={chatAttachments} onRemove={(attachmentId) => setChatAttachments((items) => items.filter((item) => item.id !== attachmentId))} />
              <Textarea
                value={draft}
                onChange={(event) => { if (!outOfCredits) setDraft(event.target.value); }}
                onKeyDown={(e) => {
                  if (outOfCredits) { e.preventDefault(); return; }
                  // Enter solo = enviar | Shift+Enter = nueva línea
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    if (draft.trim().length >= 2 && !sendMutation.isPending && !isActivelyProcessing) handleSend();
                  }
                }}
                placeholder={outOfCredits ? "Sin créditos — compra más para continuar..." : "Escribe un mensaje al agente..."}
                disabled={outOfCredits}
                className={`min-h-[64px] md:min-h-[72px] resize-none border-0 bg-transparent text-[14px] text-white placeholder:text-white/30 focus-visible:ring-0 px-4 pt-3 pb-2 ${outOfCredits ? "opacity-40 cursor-not-allowed" : ""}`}
              />
              <div className="flex items-center justify-between px-3 pb-3">
                <div className="flex items-center gap-1">
                  <AttachmentPicker attachments={chatAttachments} onChange={setChatAttachments} disabled={outOfCredits || sendMutation.isPending || isActivelyProcessing} />
                  <button type="button" title="Marcar" className="grid h-8 w-8 place-items-center rounded-lg text-white/30 hover:bg-white/[0.05] hover:text-white/60 transition">
                    <Star className="h-4 w-4" />
                  </button>
                  <button type="button" title="Fork" className="hidden md:grid h-8 w-8 place-items-center rounded-lg text-white/30 hover:bg-white/[0.05] hover:text-white/60 transition">
                    <GitBranch className="h-4 w-4" />
                  </button>
                  <button type="button" title="Compartir" className="hidden md:grid h-8 w-8 place-items-center rounded-lg text-white/30 hover:bg-white/[0.05] hover:text-white/60 transition">
                    <Share2 className="h-4 w-4" />
                  </button>
                </div>
                <div className="flex items-center gap-2">
                  {/* Botón micrófono — Speech to Text */}
                  <button
                    type="button"
                    title={outOfCredits ? "Sin créditos" : isRecording ? "Detener grabación" : "Hablar con el agente"}
                    disabled={outOfCredits}
                    onClick={() => {
                      if (outOfCredits) return;
                      const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
                      if (!SpeechRecognition) {
                        toast({ title: "Navegador no compatible", description: "El reconocimiento de voz requiere Chrome o Edge. Prueba con uno de ellos.", variant: "destructive" });
                        return;
                      }
                      if (isRecording) {
                        recognitionRef.current?.stop();
                        setIsRecording(false);
                        return;
                      }
                      // Solicitar permiso explícito antes de iniciar
                      navigator.mediaDevices?.getUserMedia({ audio: true })
                        .then(() => {
                          const recognition = new SpeechRecognition();
                          recognition.lang = "es-ES";
                          recognition.continuous = false;
                          recognition.interimResults = false;
                          recognition.onstart = () => setIsRecording(true);
                          recognition.onresult = (event: any) => {
                            const transcript = event.results[0][0].transcript;
                            setDraft(prev => prev ? prev + " " + transcript : transcript);
                            setIsRecording(false);
                          };
                          recognition.onerror = (event: any) => {
                            setIsRecording(false);
                            if (event.error === 'not-allowed' || event.error === 'permission-denied') {
                              toast({ title: "Permiso denegado", description: "Haz clic en el candado 🔒 de la barra de direcciones y activa el micrófono para marisai.es.", variant: "destructive" });
                            } else if (event.error === 'audio-capture') {
                              toast({ title: "Micrófono no encontrado", description: "No se detectó ningún micrófono en tu dispositivo. Conecta uno e inténtalo de nuevo.", variant: "destructive" });
                            } else if (event.error === 'network') {
                              toast({ title: "Error de red", description: "No se pudo procesar la voz. Comprueba tu conexión a internet.", variant: "destructive" });
                            }
                            // 'no-speech' es normal — no mostrar error
                          };
                          recognition.onend = () => setIsRecording(false);
                          recognitionRef.current = recognition;
                          recognition.start();
                        })
                        .catch(() => {
                          toast({ title: "Permiso de micrófono denegado", description: "Para usar la voz, haz clic en el candado 🔒 de la barra de direcciones y activa el micrófono para marisai.es.", variant: "destructive" });
                        });
                    }}
                    className={`flex h-9 w-9 items-center justify-center rounded-xl transition ${
                      isRecording
                        ? "bg-red-500 text-white animate-pulse shadow-[0_4px_14px_rgba(239,68,68,0.5)]"
                        : "text-white/40 hover:bg-white/[0.07] hover:text-white/70"
                    }`}
                  >
                    {isRecording ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
                  </button>
                  {/* Botón enviar */}
                  <button
                    onClick={handleSend}
                    disabled={outOfCredits || draft.trim().length < 2 || sendMutation.isPending || isActivelyProcessing}
                    className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-[#7c3aed] to-[#9333ea] text-white shadow-[0_4px_14px_rgba(124,58,237,0.4)] hover:from-[#8b5cf6] hover:to-[#a855f7] disabled:opacity-40 disabled:cursor-not-allowed transition"
                  >
                    {sendMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </>
    );
  };

  if (isLoading) {
    return (
      <Layout>
        <div className="h-[calc(100vh-3.5rem)] flex items-center justify-center bg-[#0d0d12]">
          <div className="space-y-4 w-full max-w-md px-6">
            <Skeleton className="h-8 w-2/3 mx-auto bg-white/5" />
            <Skeleton className="h-[400px] w-full bg-white/5 rounded-xl" />
          </div>
        </div>
      </Layout>
    );
  }

  if (!app) {
    return (
      <Layout>
        <div className="h-[calc(100vh-3.5rem)] flex flex-col items-center justify-center bg-[#0d0d12] text-white">
          <h2 className="text-2xl font-bold text-gray-400">No encontramos esta aplicación</h2>
          <Button variant="outline" className="mt-4 border-white/10 hover:bg-white/5" onClick={() => setLocation("/dashboard")}>
            Volver al panel
          </Button>
        </div>
      </Layout>
    );
  }

  return (
    <>
    <div className="fixed inset-0 z-[100] flex flex-col overflow-hidden bg-[#070910] text-white" data-testid="maris-emergent-workspace">
      {/* ── HEADER ── */}
      <header className="h-[56px] md:h-[61px] shrink-0 border-b border-white/[0.075] bg-[#070910]/95 backdrop-blur-xl">
        <div className="flex h-full items-center justify-between px-3 md:px-5">
          {/* LEFT */}
          <div className="flex items-center gap-2 md:gap-4">
            <button onClick={() => setLocation("/dashboard")} className="flex items-center gap-2.5 hover:opacity-80 transition">
              <MarisLogo />
            </button>
            <div className="flex items-center gap-1.5">
              <div className="flex items-center gap-1.5 rounded-lg border border-white/[0.065] bg-white/[0.04] px-2 md:px-3 py-1.5 text-[12px] md:text-[13.5px] font-semibold text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]">
                <span className="h-2 w-2 rounded-full bg-[#7c3aed]" />
                <span className="max-w-[100px] md:max-w-[180px] truncate">{app?.title || "Sin título"}</span>
                <X className="ml-1 h-3.5 w-3.5 text-white/35 hover:text-white/70 cursor-pointer" onClick={(e) => { e.stopPropagation(); setLocation("/dashboard"); }} />
              </div>
              <button
                onClick={() => window.open("/dashboard", "_blank", "noopener,noreferrer")}
                className="hidden md:grid h-8 w-8 place-items-center rounded-lg border border-white/[0.065] bg-white/[0.04] text-white/60 hover:bg-white/[0.07] hover:text-white transition"
              >
                <span className="text-lg leading-none font-bold">+</span>
              </button>
            </div>
          </div>

          {/* RIGHT */}
          <div className="flex items-center gap-2 md:gap-3 text-white/70">
            <button onClick={() => setLocation("/billing")} className="flex items-center gap-1.5 rounded-full border border-orange-500/20 bg-orange-500/8 px-2 md:px-3 py-1.5 text-[12px] md:text-[13px] font-bold text-orange-400 hover:bg-orange-500/15 transition">
              <Flame className="h-4 w-4" />
              <span className="hidden md:inline">{(stats as any)?.streak ?? 1}</span>
            </button>
            <button onClick={() => setLocation("/billing")} className="flex items-center gap-1.5 rounded-full border border-yellow-500/20 bg-yellow-500/8 px-2 md:px-3 py-1.5 text-[12px] md:text-[13px] font-bold text-yellow-400 hover:bg-yellow-500/15 transition">
              <Cpu className="h-4 w-4" />
              <span>{isAdmin ? "∞" : credits}</span>
            </button>

            {/* Notificaciones */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button type="button" aria-label="Notificaciones" className="relative grid h-8 w-8 place-items-center rounded-full hover:bg-white/5 hover:text-white">
                  <Bell className="h-[18px] w-[18px]" />
                  {(unreadCount > 0 || isWorking) && (
                    <span className="absolute -right-0.5 -top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-[#7c3aed] text-[9px] font-bold text-white shadow-[0_0_8px_rgba(124,58,237,0.8)] animate-pulse">
                      {unreadCount > 0 ? Math.min(unreadCount, 9) : ""}
                    </span>
                  )}
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" forceMount className="z-[220] w-72 md:w-80 border-white/10 bg-[#0f1320] text-white">
                <DropdownMenuLabel className="flex items-center justify-between">
                  <span>Notificaciones</span>
                  {unreadCount > 0 && <span className="rounded-full bg-[#7c3aed]/20 px-2 py-0.5 text-[10px] font-bold text-[#a78bfa]">{unreadCount} nuevas</span>}
                </DropdownMenuLabel>
                <DropdownMenuSeparator className="bg-white/10" />
                {notificationsData?.notifications?.map((n: any) => (
                  <DropdownMenuItem key={n.id} onSelect={(e) => e.preventDefault()} className="flex cursor-default flex-col items-start gap-1 whitespace-normal focus:bg-white/5 focus:text-white">
                    <span className={`text-sm font-semibold ${n.type === 'error' ? 'text-red-400' : n.type === 'warning' ? 'text-yellow-400' : 'text-white'}`}>{n.title}</span>
                    <span className="text-xs leading-relaxed text-white/55">{n.body}</span>
                  </DropdownMenuItem>
                ))}
                {isWorking && (
                  <DropdownMenuItem onSelect={(e) => e.preventDefault()} className="flex cursor-default flex-col items-start gap-1 whitespace-normal focus:bg-white/5 focus:text-white">
                    <span className="flex items-center gap-1.5 text-sm font-semibold text-[#a78bfa]"><span className="h-1.5 w-1.5 rounded-full bg-[#7c3aed] animate-pulse" />Trabajo activo</span>
                    <span className="text-xs leading-relaxed text-white/55">{phaseInfo.label}</span>
                  </DropdownMenuItem>
                )}
                {!isWorking && !notificationsData?.notifications?.length && (
                  <DropdownMenuItem onSelect={(e) => e.preventDefault()} className="cursor-default text-white/40 focus:bg-white/5 focus:text-white/40">
                    Sin notificaciones nuevas
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>

            {/* Profile */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button type="button" aria-label="Perfil" className="flex items-center gap-1 md:gap-2 rounded-full pl-1 pr-1 md:pr-1.5 hover:bg-white/5 transition">
                  <Avatar className="h-7 w-7 md:h-8 md:w-8 border border-white/10">
                    <AvatarImage src={user?.imageUrl} alt={user?.fullName || firstName} />
                    <AvatarFallback className="bg-gradient-to-br from-[#7c3aed] to-[#5b21b6] text-xs font-bold text-white">{user?.firstName?.charAt(0) || firstName.charAt(0) || "M"}</AvatarFallback>
                  </Avatar>
                  <ChevronDown className="hidden md:block h-3.5 w-3.5 text-white/45" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" forceMount className="z-[220] w-72 border-white/10 bg-[#0f1320] text-white p-0 overflow-hidden">
                <div className="px-4 py-3 border-b border-white/[0.07]">
                  <div className="flex items-center gap-3">
                    <Avatar className="h-10 w-10 border border-white/10">
                      <AvatarImage src={user?.imageUrl} alt={user?.fullName || firstName} />
                      <AvatarFallback className="bg-gradient-to-br from-[#7c3aed] to-[#5b21b6] text-sm font-bold text-white">{user?.firstName?.charAt(0) || firstName.charAt(0) || "M"}</AvatarFallback>
                    </Avatar>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-white truncate">{user?.fullName || me?.fullName || firstName}</p>
                      <p className="text-xs text-white/45 truncate">{user?.primaryEmailAddress?.emailAddress || me?.email || "Cuenta Maris AI"}</p>
                    </div>
                    {isAdmin && <Crown className="h-4 w-4 text-yellow-400 shrink-0" />}
                  </div>
                  <div className="mt-2.5 flex items-center justify-between">
                    <div className="flex items-center gap-1.5 text-xs text-orange-400">
                      <Flame className="h-3.5 w-3.5" />
                      <span className="font-bold">{(stats as any)?.streak ?? 1} días de racha</span>
                    </div>
                    <div className="flex items-center gap-1.5 text-xs text-yellow-400">
                      <Cpu className="h-3.5 w-3.5" />
                      <span className="font-bold">{isAdmin ? "∞" : credits} créditos</span>
                    </div>
                  </div>
                </div>
                <div className="px-3 py-2 border-b border-white/[0.07]">
                  <button onClick={() => setLocation("/billing")} className="w-full flex items-center justify-between rounded-lg bg-gradient-to-r from-yellow-500/15 to-orange-500/15 border border-yellow-500/20 px-3 py-2 text-sm font-semibold text-yellow-300 hover:from-yellow-500/25 hover:to-orange-500/25 transition">
                    <div className="flex items-center gap-2"><Cpu className="h-4 w-4" />Comprar créditos</div>
                    <ChevronRight className="h-4 w-4" />
                  </button>
                </div>
                <div className="py-1">
                  <DropdownMenuItem onClick={() => setLocation("/dashboard")} className="cursor-pointer focus:bg-white/8 focus:text-white mx-1 rounded-md">
                    <LayoutDashboard className="mr-2 h-4 w-4 text-white/45" />Panel de proyectos
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => { setShowAccountSettings(true); setAccountSettingsTab("personal"); }} className="cursor-pointer focus:bg-white/8 focus:text-white mx-1 rounded-md">
                    <Settings className="mr-2 h-4 w-4 text-white/45" />Configuración de cuenta
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => { setShowAccountSettings(true); setAccountSettingsTab("agents"); }} className="cursor-pointer focus:bg-white/8 focus:text-white mx-1 rounded-md">
                    <Users className="mr-2 h-4 w-4 text-white/45" />Gestionar agentes
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={(e) => e.preventDefault()} className="cursor-default focus:bg-white/5 mx-1 rounded-md">
                    <div className="flex items-center justify-between w-full">
                      <div className="flex items-center gap-2"><Moon className="h-4 w-4 text-white/45" /><span>Modo oscuro</span></div>
                      <Switch checked={darkModeEnabled} onCheckedChange={setDarkModeEnabled} className="scale-75" />
                    </div>
                  </DropdownMenuItem>
                </div>
                <DropdownMenuSeparator className="bg-white/[0.07]" />
                <div className="py-1">
                  {isAdmin && (
                    <DropdownMenuItem onClick={() => setLocation("/admin")} className="cursor-pointer focus:bg-white/8 focus:text-white mx-1 rounded-md">
                      <Shield className="mr-2 h-4 w-4 text-[#a78bfa]" />Panel admin
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuItem onClick={handleOpenDocs} className="cursor-pointer focus:bg-white/8 focus:text-white mx-1 rounded-md">
                    <ExternalLink className="mr-2 h-4 w-4 text-white/45" />Documentación
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => signOut(() => setLocation("/"))} className="cursor-pointer focus:bg-red-500/10 focus:text-red-300 mx-1 rounded-md text-white/70">
                    <LogOut className="mr-2 h-4 w-4" />Cerrar sesión
                  </DropdownMenuItem>
                </div>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </header>

      {/* ── BODY ── */}
      <div className="flex min-h-0 flex-1 relative">

        {/* Sidebar iconos — oculto en móvil */}
        <aside className="hidden md:flex w-[72px] shrink-0 flex-col border-r border-white/[0.07] bg-[#070910]">
          <nav className="flex flex-1 flex-col items-center gap-1 pt-4 px-2">
            {NAV_ITEMS.map((item) => {
              const active = activeSidebar === item.id;
              const Icon = item.icon;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => handleSidebarClick(item.id)}
                  aria-pressed={active}
                  title={item.label}
                  className={`group relative flex w-full flex-col items-center gap-1.5 py-2.5 rounded-xl text-[11px] font-medium transition ${
                    active ? "bg-[#7c3aed]/12 text-[#c084fc]" : "text-white/40 hover:bg-white/[0.04] hover:text-white/75"
                  }`}
                >
                  {active && <span className="absolute left-0 top-1/2 -translate-y-1/2 h-8 w-0.5 rounded-r-full bg-[#7c3aed] shadow-[0_0_12px_rgba(124,58,237,0.9)]" />}
                  <Icon className={`h-5 w-5 transition ${active ? "text-[#c084fc] drop-shadow-[0_0_8px_rgba(192,132,252,0.8)]" : ""}`} />
                  <span className="leading-none">{item.label}</span>
                </button>
              );
            })}
          </nav>
          <div className="flex justify-center pb-4">
            <Avatar className="h-9 w-9 border border-white/10 cursor-pointer hover:ring-2 hover:ring-[#7c3aed]/50 transition" onClick={() => setShowAccountSettings(true)}>
              <AvatarImage src={user?.imageUrl} />
              <AvatarFallback className="bg-gradient-to-br from-[#7c3aed] to-[#5b21b6] text-xs font-bold text-white">{user?.firstName?.charAt(0) || firstName.charAt(0) || "M"}</AvatarFallback>
            </Avatar>
          </div>
        </aside>

        {/* Panel chat — full en móvil, fijo en desktop */}
        <section className={`flex flex-col border-r border-white/[0.08] bg-[#080a12] ${
          mobileTab === "preview" ? "hidden md:flex" : "flex"
        } ${isPreviewClosed ? "flex-1" : "w-full md:w-[590px] md:shrink-0"}`}>
          {renderSidebarPanel()}
          {isPreviewClosed && (
            <div className="px-3 md:px-6 pb-20 md:pb-6">
              <Button onClick={handleOpenPreview} variant="outline" className="h-11 w-full border-[#8b5cf6]/50 bg-[#7c3aed]/10 font-bold text-[#c4b5fd] hover:bg-[#7c3aed]/20 hover:text-white">
                Abrir App Preview
              </Button>
            </div>
          )}
        </section>

        {/* Panel preview — oculto en móvil cuando tab es chat */}
        {!isPreviewClosed && (
        <main className={`flex-col bg-[#0a0d15] ${
          isPreviewMaximized ? "fixed inset-0 z-[130] flex" : "flex min-w-0 flex-1"
        } ${mobileTab === "chat" ? "hidden md:flex" : "flex"}`}>
          {/* Toolbar preview */}
          <div className="flex h-[56px] md:h-[61px] shrink-0 items-center border-b border-white/[0.07] bg-[#0a0d15] px-2 md:px-4 gap-2 md:gap-3 overflow-x-auto">
            <div className="flex items-center rounded-lg border border-white/[0.07] bg-white/[0.03] p-0.5 shrink-0">
              <button onClick={() => setRightPanelTab("preview")} className={`px-2 md:px-3 py-1.5 rounded-md text-[12px] md:text-[13px] font-semibold transition ${rightPanelTab === "preview" ? "bg-white/[0.08] text-white" : "text-white/45 hover:text-white/70"}`}>Preview</button>
              <button onClick={() => setRightPanelTab("code")} className={`px-2 md:px-3 py-1.5 rounded-md text-[12px] md:text-[13px] font-semibold transition ${rightPanelTab === "code" ? "bg-white/[0.08] text-white" : "text-white/45 hover:text-white/70"}`}>
                <Code className="inline h-3.5 w-3.5 mr-1" />Código
              </button>
              <button onClick={() => setRightPanelTab("visual-test")} className={`px-2 md:px-3 py-1.5 rounded-md text-[12px] md:text-[13px] font-semibold transition flex items-center gap-1 ${rightPanelTab === "visual-test" ? "bg-cyan-500/20 text-cyan-400" : "text-white/45 hover:text-white/70"}`}>
                <Eye className="inline h-3.5 w-3.5 mr-0.5" />Test
              </button>
            </div>

            <div className="hidden md:flex flex-1 items-center gap-2 rounded-lg border border-white/[0.07] bg-white/[0.025] px-3 py-1.5 min-w-0">
              <Globe className="h-3.5 w-3.5 text-white/30 shrink-0" />
              <span className="flex-1 truncate text-[12.5px] text-white/50 font-mono">{deployedUrl || `https://${(app?.title || "mi-app").toLowerCase().replace(/\s+/g, "-")}.marisai.es`}</span>
              <button onClick={() => { if (deployedUrl) { navigator.clipboard.writeText(deployedUrl); toast({ title: "URL copiada" }); } }} className="shrink-0 text-white/30 hover:text-white/70 transition">
                <Copy className="h-3.5 w-3.5" />
              </button>
              <button onClick={handleRefreshPreview} className="shrink-0 text-white/30 hover:text-white/70 transition">
                <RefreshCcw className="h-3.5 w-3.5" />
              </button>
            </div>

            <div className="hidden md:flex items-center rounded-lg border border-white/[0.07] bg-white/[0.03] p-0.5 gap-0.5">
              <button onClick={() => setPreviewSize("desktop")} title="Escritorio" className={`grid h-7 w-7 place-items-center rounded-md transition ${previewSize === "desktop" ? "bg-white/[0.1] text-white" : "text-white/35 hover:text-white/65"}`}><Monitor className="h-4 w-4" /></button>
              <button onClick={() => setPreviewSize("tablet")} title="Tablet" className={`grid h-7 w-7 place-items-center rounded-md transition ${previewSize === "tablet" ? "bg-white/[0.1] text-white" : "text-white/35 hover:text-white/65"}`}><Tablet className="h-4 w-4" /></button>
              <button onClick={() => setPreviewSize("mobile")} title="Móvil" className={`grid h-7 w-7 place-items-center rounded-md transition ${previewSize === "mobile" ? "bg-white/[0.1] text-white" : "text-white/35 hover:text-white/65"}`}><Smartphone className="h-4 w-4" /></button>
            </div>

            <div className="hidden md:block">
              <GitHubButton
                appId={id}
                appTitle={app?.title ?? "app"}
                appDescription={app?.description ?? ""}
                githubRepoUrl={(app as any)?.githubRepoUrl}
                onSuccess={() => queryClient.invalidateQueries({ queryKey: getGetAppQueryKey(id) })}
              />
            </div>

            {isAdmin && (app as any)?.architecture !== "serverless" && (
              <div className="hidden md:block">
                <RailwayDeployButton
                  appId={id}
                  githubRepoFullName={(app as any)?.githubRepoFullName}
                  railwayBackendUrl={(app as any)?.railwayBackendUrl}
                  railwayDeploymentStatus={(app as any)?.railwayDeploymentStatus}
                />
              </div>
            )}

            <button onClick={handleShare} className="hidden md:inline-flex h-8 items-center gap-1.5 rounded-md border border-white/[0.07] bg-white/[0.04] px-3 text-[13px] font-semibold text-white/70 hover:bg-white/[0.07] hover:text-white transition">
              <Share2 className="h-3.5 w-3.5" />Share
            </button>

            <div className="flex items-center ml-auto shrink-0">
              <button
                onClick={handleDeploy}
                disabled={deployMutation.isPending || !hasRenderableCode}
                className="inline-flex h-8 items-center gap-1.5 rounded-l-md bg-gradient-to-r from-[#7c3aed] to-[#9333ea] px-3 md:px-4 text-[12px] md:text-[13px] font-bold text-white hover:from-[#8b5cf6] hover:to-[#a855f7] disabled:opacity-50 transition"
              >
                {deployMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Rocket className="h-3.5 w-3.5" />}
                {deployMutation.isPending ? "Deploying" : "Deploy"}
              </button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button className="inline-flex h-8 w-8 items-center justify-center rounded-r-md border-l border-[#5b21b6] bg-gradient-to-r from-[#9333ea] to-[#7c3aed] text-white hover:from-[#a855f7] hover:to-[#8b5cf6] transition">
                    <ChevronDown className="h-3.5 w-3.5" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="z-[220] w-52 border-white/10 bg-[#0f1320] text-white">
                  <DropdownMenuItem onClick={handleDeploy} disabled={deployMutation.isPending || !hasRenderableCode} className="cursor-pointer focus:bg-white/10">
                    <Rocket className="mr-2 h-4 w-4 text-[#a78bfa]" />Deploy rápido
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setShowDeployModal(true)} className="cursor-pointer focus:bg-white/10">
                    <Globe className="mr-2 h-4 w-4 text-[#a78bfa]" />Deploy con dominio
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={handlePublishGoogle} disabled={isPublishingGoogle || !hasRenderableCode} className="cursor-pointer focus:bg-white/10">
                    <Star className="mr-2 h-4 w-4 text-[#a78bfa]" />Publicar en Google
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>

            <button onClick={handleMaximizePreview} title={isPreviewMaximized ? "Restaurar" : "Maximizar"} className={`shrink-0 grid h-8 w-8 place-items-center rounded-md border border-white/[0.07] bg-white/[0.04] text-white/55 hover:bg-white/[0.08] hover:text-white transition ${isPreviewMaximized ? "border-[#7c3aed]/40 text-[#a78bfa]" : ""}`}>
              {isPreviewMaximized ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
            </button>
          </div>

          <div className="relative min-h-0 flex-1 overflow-hidden">
            {rightPanelTab === "visual-test" ? (
              <div className="h-full overflow-hidden bg-[#0a0d15] p-4">
                <VisualTestPanel
                  appId={app?._id || app?.id || ""}
                  appSlug={app?.publicSlug || undefined}
                  className="h-full"
                />
              </div>
            ) : rightPanelTab === "code" ? (
              isAdmin && hasRenderableCode ? (
                <AdminCodeEditor
                  appId={id}
                  frontendCode={frontendCode}
                  onSaved={() => queryClient.invalidateQueries({ queryKey: getGetAppQueryKey(id) })}
                />
              ) : (
              <div className="h-full overflow-auto bg-[#060810] p-4 md:p-6 relative"
                onCopy={(e) => {
                  // A petición explícita del usuario: este bloqueo de copia
                  // masiva no debe aplicar a cuentas admin/propietario —
                  // solo tiene sentido para clientes, como medida contra
                  // copiar el código sin pasar por el export oficial
                  // (GitHub/Descargar), que además marca el proyecto como
                  // exportado correctamente.
                  if (isAdmin) return;
                  const selected = window.getSelection()?.toString() || "";
                  if (selected.length > 500) {
                    // Bloquear copia masiva — registrar intento
                    e.preventDefault();
                    setCopyAttempts(prev => {
                      const next = prev + 1;
                      if (next >= 3) {
                        setCopyBlocked(true);
                        // Log al backend
                        fetch("/api/apps/security/copy-attempt", {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ appId: id, chars: selected.length, attempt: next }),
                        }).catch(() => {});
                      }
                      return next;
                    });
                    toast({
                      title: "⚠️ Copia limitada",
                      description: "Para obtener el código completo usa el botón 'GitHub' o 'Descargar'. Exportar por el procedimiento oficial garantiza que el proyecto funciona correctamente.",
                      variant: "destructive",
                    });
                    return false;
                  }
                }}
              >
                {copyBlocked && (
                  <div className="sticky top-0 z-10 mb-3 bg-red-500/20 border border-red-500/40 rounded-lg px-3 py-2 text-[11px] text-red-400 flex items-center gap-2">
                    <span>🔒</span>
                    Copia de código bloqueada. Usa <strong>GitHub</strong> o <strong>Descargar ZIP</strong> para exportar tu proyecto correctamente.
                  </div>
                )}
                {frontendCode ? (
                  <pre
                    className={`text-[12px] leading-relaxed text-emerald-300/80 font-mono whitespace-pre-wrap break-words select-${copyBlocked ? "none" : "text"}`}
                    style={copyBlocked ? { userSelect: "none", WebkitUserSelect: "none" } : {}}
                  >
                    {frontendCode.slice(0, 50000)}
                    {frontendCode.length > 50000 ? "\n\n... (truncado, descarga el proyecto para ver el código completo)" : ""}
                  </pre>
                ) : (
                  <div className="flex h-full items-center justify-center">
                    <div className="text-center">
                      <Terminal className="h-12 w-12 text-white/15 mx-auto mb-4" />
                      <p className="text-white/30 text-sm">El código aparecerá aquí cuando Maris AI termine de generarlo.</p>
                    </div>
                  </div>
                )}
              </div>
              )
            ) : (
              <>
                <button
                  type="button"
                  onClick={handleClosePreview}
                  aria-label="Cerrar vista previa"
                  className="absolute right-3 top-3 md:right-4 md:top-4 z-20 grid h-8 w-8 md:h-9 md:w-9 place-items-center rounded-full border border-white/15 bg-[#070910]/85 text-white shadow-[0_8px_25px_rgba(0,0,0,0.45)] backdrop-blur transition hover:border-red-400/50 hover:bg-red-500/20"
                >
                  <X className="h-4 w-4" />
                </button>
                <div className={`h-full flex items-center justify-center transition-all ${
                  previewSize === "mobile" ? "px-[calc(50%-190px)]" :
                  previewSize === "tablet" ? "px-[calc(50%-384px)]" : ""
                }`}>
                  {isSSRLive && (
                    <div className="absolute left-3 top-3 md:left-4 md:top-4 z-20 rounded-full border border-amber-400/30 bg-amber-500/10 px-3 py-1.5 text-xs text-amber-300 backdrop-blur">
                      ⚡ Servidor en vivo (Next.js) — preview temporal, no un bundle guardado
                    </div>
                  )}
                  {isSSRLive && ssrExpired ? (
                    <div className="flex flex-col items-center gap-4 text-center max-w-sm px-6">
                      <div className="h-12 w-12 rounded-full bg-amber-500/10 border border-amber-500/30 grid place-items-center">
                        <RefreshCw className="h-5 w-5 text-amber-400" />
                      </div>
                      <div>
                        <p className="text-sm font-semibold text-white">El preview en vivo ha caducado</p>
                        <p className="text-xs text-muted-foreground mt-1">
                          Los servidores en vivo (Next.js) se apagan automáticamente pasado un tiempo para no gastar recursos sin uso. Puedes reiniciarlo cuando quieras.
                        </p>
                      </div>
                      <Button size="sm" onClick={handleRestartSSRPreview} disabled={ssrRestarting}>
                        {ssrRestarting && <Loader2 className="h-3 w-3 mr-2 animate-spin" />}
                        Reiniciar preview
                      </Button>
                    </div>
                  ) : showStaticBuildState ? (
                    <AppPreviewWaitingState />
                  ) : deployedUrl ? (
                    <iframe
                      key={`deployed-${previewKey}`}
                      src={deployedUrl}
                      title="App Preview"
                      sandbox="allow-scripts allow-same-origin allow-forms allow-modals allow-popups allow-popups-to-escape-sandbox"
                      className={`border-0 bg-white ${
                        previewSize === "mobile" ? "w-[380px] h-[calc(100%-2rem)] rounded-2xl shadow-2xl" :
                        previewSize === "tablet" ? "w-[768px] h-[calc(100%-2rem)] rounded-xl shadow-xl" :
                        "w-full h-full"
                      }`}
                    />
                  ) : (
                    <LivePreview
                      key={`live-${previewKey}`}
                      appId={id}
                      appName={app?.title ?? "App"}
                      frontendCode={frontendCode}
                      vercelUrl={deployedUrl || undefined}
                      isBuilding={isWorking}
                      onShare={handleShare}
                      onDeploy={() => setShowDeployModal(true)}
                      onClose={handleClosePreview}
                      onFatalError={handlePreviewFatalError}
                    />
                  )}
                </div>
                {isPreviewPaused && (
                  <div className="pointer-events-none absolute bottom-6 left-1/2 w-[90%] md:w-[620px] max-w-[calc(100%-2rem)] -translate-x-1/2">
                    <div className="pointer-events-auto flex h-[52px] md:h-[56px] items-center justify-between rounded-lg border border-white/[0.09] bg-[#0b0f18]/95 px-4 md:px-5 shadow-[0_12px_40px_rgba(0,0,0,0.45)] backdrop-blur-xl">
                      <div className="flex items-center gap-3 text-[12px] md:text-[13px] text-white/55">
                        <span className="h-2 w-2 rounded-full bg-amber-400" />
                        <span>Vista en vivo pausada (pestaña en segundo plano)</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <button onClick={handleResumePreview} className="rounded-md border border-[#8b5cf6]/60 px-3 md:px-4 py-1.5 text-[12px] md:text-[13px] font-bold text-[#a78bfa] transition hover:bg-[#7c3aed]/10 hover:text-white">
                          Resume
                        </button>
                        <button
                          onClick={handleDismissPausedBar}
                          title="Cerrar aviso"
                          aria-label="Cerrar aviso"
                          className="grid h-8 w-8 shrink-0 place-items-center rounded-md text-white/40 transition hover:bg-white/[0.08] hover:text-white"
                        >
                          <X className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </main>
        )}
      </div>

      {/* ── BARRA DE NAVEGACIÓN MÓVIL ── */}
      <div className="md:hidden fixed bottom-0 left-0 right-0 z-[150] flex h-14 border-t border-white/[0.08] bg-[#070910]/95 backdrop-blur-xl pb-safe">
        <button
          onClick={() => setMobileTab("chat")}
          className={`flex flex-1 flex-col items-center justify-center gap-1 text-[11px] font-semibold transition ${
            mobileTab === "chat" ? "text-[#c084fc]" : "text-white/40"
          }`}
        >
          <Bot className="h-5 w-5" />
          Chat
        </button>
        <button
          onClick={() => { setMobileTab("preview"); setIsPreviewClosed(false); }}
          className={`flex flex-1 flex-col items-center justify-center gap-1 text-[11px] font-semibold transition relative ${
            mobileTab === "preview" ? "text-[#c084fc]" : "text-white/40"
          }`}
        >
          <Monitor className="h-5 w-5" />
          Preview
          {isWorking && (
            <span className="absolute top-2 right-[calc(50%-18px)] h-2 w-2 rounded-full bg-[#7c3aed] animate-pulse" />
          )}
        </button>
      </div>
    </div>

    {/* Account Settings Modal */}
    {showAccountSettings && (
      <div className="fixed inset-0 z-[300] flex items-center justify-center bg-black/70 backdrop-blur-sm" onClick={() => setShowAccountSettings(false)}>
        <div className="relative w-full max-w-3xl mx-3 md:mx-4 rounded-2xl border border-white/[0.09] bg-[#0d0f1a] shadow-[0_32px_80px_rgba(0,0,0,0.7)] overflow-hidden" onClick={(e) => e.stopPropagation()} style={{ maxHeight: "90vh" }}>
          <div className="flex items-center justify-between px-4 md:px-6 py-4 border-b border-white/[0.07]">
            <div>
              <h2 className="text-base md:text-lg font-bold text-white">Configuración de cuenta</h2>
              <p className="text-xs text-white/40 mt-0.5">{user?.primaryEmailAddress?.emailAddress || me?.email}</p>
            </div>
            <button onClick={() => setShowAccountSettings(false)} className="grid h-8 w-8 place-items-center rounded-lg text-white/40 hover:bg-white/5 hover:text-white transition">
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="flex flex-col md:flex-row" style={{ height: "calc(90vh - 73px)" }}>
            {/* Tabs en móvil: scroll horizontal. En desktop: sidebar vertical */}
            <div className="md:w-52 md:shrink-0 border-b md:border-b-0 md:border-r border-white/[0.07] md:p-3 overflow-x-auto md:overflow-y-auto">
              <div className="flex md:flex-col gap-1 p-3 md:p-0 min-w-max md:min-w-0">
                {([
                  { id: "personal", label: "Personal", icon: Settings },
                  { id: "apikey", label: "API Key", icon: Key },
                  { id: "agents", label: "Agentes", icon: Users },
                  { id: "preferences", label: "Preferencias", icon: Moon },
                  { id: "billing", label: "Facturación", icon: CreditCard },
                  { id: "usage", label: "Uso", icon: Cpu },
                ] as const).map(({ id: tabId, label, icon: Icon }) => (
                  <button
                    key={tabId}
                    onClick={() => setAccountSettingsTab(tabId)}
                    className={`flex items-center gap-2 px-3 py-2 rounded-lg text-[12px] md:text-[13px] font-medium transition whitespace-nowrap ${
                      accountSettingsTab === tabId
                        ? "bg-[#7c3aed]/15 text-[#c084fc] border border-[#7c3aed]/25"
                        : "text-white/50 hover:bg-white/[0.04] hover:text-white/80"
                    }`}
                  >
                    <Icon className="h-4 w-4 shrink-0" />
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-4 md:p-6">
              {accountSettingsTab === "personal" && (
                <div className="space-y-6">
                  {/* Cabecera de identidad */}
                  <div
                    className={`relative overflow-hidden rounded-2xl border p-5 md:p-6 ${
                      isAdmin
                        ? "border-yellow-500/20 bg-gradient-to-br from-[#7c3aed]/15 via-[#150f22] to-yellow-500/[0.06]"
                        : "border-white/[0.07] bg-white/[0.03]"
                    }`}
                  >
                    {isAdmin && (
                      <div className="pointer-events-none absolute -top-20 -right-16 h-52 w-52 rounded-full bg-yellow-400/10 blur-3xl" />
                    )}
                    <div className="relative flex items-start gap-4">
                      <div className={isAdmin ? "relative shrink-0 rounded-full bg-gradient-to-br from-yellow-400 via-[#c084fc] to-[#7c3aed] p-[2px]" : "relative shrink-0"}>
                        <Avatar className="h-16 w-16 md:h-[72px] md:w-[72px] border-2 border-[#0d0f1a]">
                          <AvatarImage src={user?.imageUrl} />
                          <AvatarFallback className="bg-gradient-to-br from-[#7c3aed] to-[#5b21b6] text-2xl font-bold text-white">
                            {(user?.fullName || firstName || "M").charAt(0)}
                          </AvatarFallback>
                        </Avatar>
                        {isAdmin && (
                          <div className="absolute -bottom-1 -right-1 grid h-6 w-6 place-items-center rounded-full border border-yellow-500/40 bg-[#0d0f1a]">
                            <Crown className="h-3.5 w-3.5 text-yellow-400" />
                          </div>
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-lg font-bold text-white truncate">{user?.fullName || firstName}</p>
                          {isAdmin ? (
                            <span className="inline-flex items-center gap-1 rounded-full border border-yellow-500/30 bg-yellow-500/10 px-2.5 py-0.5 text-[11px] font-bold text-yellow-400">
                              <Crown className="h-3 w-3" />Propietario
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/[0.05] px-2.5 py-0.5 text-[11px] font-semibold text-white/60">
                              {(me as any)?.planName ?? "Starter"}
                            </span>
                          )}
                        </div>
                        <p className="mt-0.5 truncate text-sm text-white/45">{user?.primaryEmailAddress?.emailAddress || me?.email}</p>
                        <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11px] text-white/35">
                          {(me as any)?.marisId && (
                            <button
                              onClick={() => {
                                navigator.clipboard.writeText((me as any).marisId);
                                toast({ title: "ID copiado" });
                              }}
                              className="inline-flex items-center gap-1.5 font-mono transition hover:text-white/65"
                              title="Copiar ID universal"
                            >
                              <Fingerprint className="h-3 w-3" />
                              {(me as any).marisId}
                              <Copy className="h-2.5 w-2.5" />
                            </button>
                          )}
                          {(me as any)?.createdAt && (
                            <span className="inline-flex items-center gap-1.5">
                              <Calendar className="h-3 w-3" />
                              Miembro desde {new Date((me as any).createdAt).toLocaleDateString("es-ES", { month: "long", year: "numeric" })}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Métricas */}
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    <div className="rounded-xl border border-white/[0.07] bg-white/[0.03] p-4">
                      <p className="text-[11px] font-semibold uppercase tracking-widest text-white/35">Racha</p>
                      <p className="mt-2 flex items-center gap-1.5 text-xl md:text-2xl font-bold text-orange-400">
                        <Flame className="h-5 w-5" />{(stats as any)?.streak ?? 1}<span className="text-xs font-medium text-white/30">días</span>
                      </p>
                    </div>
                    <div className="rounded-xl border border-white/[0.07] bg-white/[0.03] p-4">
                      <p className="text-[11px] font-semibold uppercase tracking-widest text-white/35">Créditos</p>
                      <p className="mt-2 flex items-center gap-1.5 text-xl md:text-2xl font-bold text-yellow-400">
                        <Cpu className="h-5 w-5" />{isAdmin ? "∞" : credits}
                      </p>
                    </div>
                    <div className="rounded-xl border border-white/[0.07] bg-white/[0.03] p-4">
                      <p className="text-[11px] font-semibold uppercase tracking-widest text-white/35">Apps generadas</p>
                      <p className="mt-2 flex items-center gap-1.5 text-xl md:text-2xl font-bold text-[#c084fc]">
                        <Sparkles className="h-5 w-5" />{(me as any)?.appsGenerated ?? stats?.appsGenerated ?? 0}
                      </p>
                    </div>
                    <div className="rounded-xl border border-white/[0.07] bg-white/[0.03] p-4">
                      <p className="text-[11px] font-semibold uppercase tracking-widest text-white/35">Plan</p>
                      <p className="mt-2 flex items-center gap-1.5 text-base md:text-lg font-bold text-emerald-400">
                        <ShieldCheck className="h-5 w-5" />{isAdmin ? "Propietario" : ((me as any)?.planName ?? "Starter")}
                      </p>
                    </div>
                  </div>

                  {/* Permisos de propietario — solo visible para tu cuenta admin */}
                  {isAdmin && (
                    <div className="rounded-2xl border border-white/[0.07] bg-white/[0.02] p-4 md:p-5">
                      <p className="mb-3 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-widest text-white/35">
                        <Crown className="h-3.5 w-3.5 text-yellow-400" />Permisos de propietario activos
                      </p>
                      <div className="grid gap-2.5 sm:grid-cols-2">
                        {[
                          { label: "Créditos ilimitados", icon: Cpu },
                          { label: "Editor de código completo", icon: Code },
                          { label: "Despliegue directo a Railway", icon: Rocket },
                          { label: "Panel de administración", icon: LayoutDashboard },
                        ].map((perm) => (
                          <div key={perm.label} className="flex items-center gap-2.5 rounded-lg border border-white/[0.05] bg-white/[0.02] px-3 py-2.5">
                            <perm.icon className="h-3.5 w-3.5 shrink-0 text-yellow-400/80" />
                            <span className="text-[13px] text-white/70">{perm.label}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
              {accountSettingsTab === "apikey" && (
                <div className="space-y-5">
                  <h3 className="text-base font-bold text-white">Clave universal de API</h3>
                  <p className="text-sm text-white/50">Usa esta clave para integrar Maris AI en tus propios proyectos o automatizaciones.</p>
                  <div className="flex items-center gap-2 rounded-xl border border-white/[0.07] bg-[#060810] px-4 py-3">
                    <Key className="h-4 w-4 text-white/30 shrink-0" />
                    <span className="flex-1 font-mono text-sm text-white/50">maris_sk_••••••••••••••••••••••••••••••••</span>
                    <button onClick={() => toast({ title: "Clave copiada" })} className="text-white/30 hover:text-white/70 transition"><Copy className="h-4 w-4" /></button>
                  </div>
                  <button onClick={() => toast({ title: "Nueva clave generada", description: "La clave anterior ha sido revocada." })} className="rounded-lg border border-white/[0.07] bg-white/[0.04] px-4 py-2 text-sm font-semibold text-white/70 hover:bg-white/[0.08] hover:text-white transition">
                    Regenerar clave
                  </button>
                </div>
              )}
              {accountSettingsTab === "agents" && (
                <div className="space-y-5">
                  <h3 className="text-base font-bold text-white">Gestionar agentes</h3>
                  <p className="text-sm text-white/50">Activa o desactiva las integraciones que usan tus agentes de Maris AI.</p>
                  <div className="space-y-3">
                    {[
                      { name: "GitHub", desc: "Subir proyectos a repositorios", icon: GitBranch, enabled: true },
                      { name: "Memoria", desc: "Recordar contexto entre sesiones", icon: Cpu, enabled: true },
                      { name: "Supabase", desc: "Base de datos para tus apps", icon: Terminal, enabled: false },
                      { name: "Notion", desc: "Exportar planes a Notion", icon: ExternalLink, enabled: false },
                    ].map((integration) => (
                      <div key={integration.name} className="flex items-center justify-between rounded-xl border border-white/[0.07] bg-white/[0.03] px-4 py-3">
                        <div className="flex items-center gap-3">
                          <div className="grid h-9 w-9 place-items-center rounded-lg bg-white/[0.05]">
                            <integration.icon className="h-4 w-4 text-white/60" />
                          </div>
                          <div>
                            <p className="text-sm font-semibold text-white">{integration.name}</p>
                            <p className="text-xs text-white/40">{integration.desc}</p>
                          </div>
                        </div>
                        <Switch defaultChecked={integration.enabled} />
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {accountSettingsTab === "preferences" && (
                <div className="space-y-5">
                  <h3 className="text-base font-bold text-white">Preferencias</h3>
                  <div className="space-y-3">
                    <div className="flex items-center justify-between rounded-xl border border-white/[0.07] bg-white/[0.03] px-4 py-3">
                      <div><p className="text-sm font-semibold text-white">Modo oscuro</p><p className="text-xs text-white/40">Interfaz oscura siempre activa</p></div>
                      <Switch checked={darkModeEnabled} onCheckedChange={setDarkModeEnabled} />
                    </div>
                    <div className="flex items-center justify-between rounded-xl border border-white/[0.07] bg-white/[0.03] px-4 py-3">
                      <div><p className="text-sm font-semibold text-white">Idioma</p><p className="text-xs text-white/40">Español (ES)</p></div>
                      <span className="text-sm font-bold text-white/60">ES</span>
                    </div>
                    <div className="flex items-center justify-between rounded-xl border border-white/[0.07] bg-white/[0.03] px-4 py-3">
                      <div><p className="text-sm font-semibold text-white">Notificaciones de agentes</p><p className="text-xs text-white/40">Avisar cuando un agente termina</p></div>
                      <Switch defaultChecked={true} />
                    </div>
                  </div>
                </div>
              )}
              {accountSettingsTab === "billing" && (
                <div className="space-y-5">
                  <h3 className="text-base font-bold text-white">Facturas y planes</h3>
                  <div className="rounded-xl border border-[#7c3aed]/30 bg-[#7c3aed]/10 p-4">
                    <p className="text-sm font-bold text-[#c084fc]">Plan actual: {isAdmin ? "Propietario" : "Starter"}</p>
                    <p className="text-xs text-white/45 mt-1">{isAdmin ? "Acceso ilimitado" : `${credits} créditos disponibles`}</p>
                  </div>
                  <button onClick={() => { setShowAccountSettings(false); setLocation("/billing"); }} className="w-full rounded-xl bg-gradient-to-r from-[#7c3aed] to-[#9333ea] px-4 py-3 text-sm font-bold text-white hover:from-[#8b5cf6] hover:to-[#a855f7] transition">
                    Ver planes y comprar créditos
                  </button>
                </div>
              )}
              {accountSettingsTab === "usage" && (
                <div className="space-y-5">
                  <h3 className="text-base font-bold text-white">Uso de créditos</h3>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="rounded-xl border border-white/[0.07] bg-white/[0.03] p-4">
                      <p className="text-xs text-white/35 uppercase tracking-widest">Disponibles</p>
                      <p className="mt-2 text-2xl font-bold text-yellow-400">{isAdmin ? "∞" : credits}</p>
                    </div>
                    <div className="rounded-xl border border-white/[0.07] bg-white/[0.03] p-4">
                      <p className="text-xs text-white/35 uppercase tracking-widest">Apps generadas</p>
                      <p className="mt-2 text-2xl font-bold text-white">{stats?.appsGenerated ?? 0}</p>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    )}

    {/* Deploy Modal */}
    {showDeployModal && (
      <DeployModal
        appId={id}
        appTitle={app?.title || "App"}
        isPremium={!!(me as any)?.isPremium || !!(me as any)?.isAdmin}
        currentDeployUrl={deployedUrl}
        currentCustomDomain={(app as any)?.customDomain}
        customDomainVerified={(app as any)?.customDomainVerified}
        onClose={() => setShowDeployModal(false)}
        onDeploySuccess={(url) => {
          queryClient.invalidateQueries({ queryKey: getGetAppQueryKey(id) });
          setShowDeployModal(false);
          toast({ title: "🚀 App desplegada", description: `Tu app está en ${url}` });

          // Invitación a reseña tras un despliegue con éxito — solo una vez
          // por usuario (no queremos ser pesados en cada deploy).
          const reviewInviteShown = localStorage.getItem("maris_review_invite_shown");
          if (!reviewInviteShown) {
            localStorage.setItem("maris_review_invite_shown", "1");
            setTimeout(() => setShowReviewInvite(true), 1500);
          }
        }}
      />
    )}

    {/* Invitación a dejar reseña, tras primer despliegue exitoso */}
    {showReviewInvite && (
      <ReviewInviteModal
        open={showReviewInvite}
        onClose={() => setShowReviewInvite(false)}
        relatedAppId={id}
        source="post_generation"
      />
    )}

    {/* Automatización (flujos visuales tipo n8n, privados de esta app) */}
    {showWorkflows && (
      <WorkflowListPanel appId={id} onClose={() => setShowWorkflows(false)} />
    )}

    {/* Alerta de protección de bucles / presupuesto (rescate guiado) */}
    {job && (job.stuckLoopDetected || job.budgetExceeded) && dismissedProtectionForJobId !== String(job.id) && (
      <LoopProtectionModal
        appId={id}
        job={job}
        onClose={() => setDismissedProtectionForJobId(String(job.id))}
        onForceRetry={() => {
          sendMutation.mutate({ id, data: { content: "Por favor, intenta una vez más resolver el problema anterior.", attachmentIds: [] } });
          setDismissedProtectionForJobId(String(job.id));
        }}
      />
    )}

    {/* Prueba de estrés (tráfico real contra el deploy en producción) */}
    {showStressTest && (
      <StressTestModal
        appId={id}
        isDeployed={!!(app?.marisaiSubdomain || ((app as any)?.customDomain && (app as any)?.customDomainVerified))}
        onClose={() => setShowStressTest(false)}
      />
    )}
    </>
  );
}
