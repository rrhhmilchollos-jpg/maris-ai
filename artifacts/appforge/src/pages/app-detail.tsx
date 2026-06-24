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
  getGenerationJobLogs,
  getGetGenerationJobLogsQueryKey,
  useGetNotifications,
  useGetCreditsHistory,
} from "@/lib/api-client";
import { useQuery } from "@tanstack/react-query";
import { useQueryClient } from "@tanstack/react-query";
import { DeployModal } from "@/components/deploy-modal";
import { GitHubButton } from "@/components/github-button";
import { LivePreview } from "@/components/live-preview";
import { parseBundle } from "@/lib/parseBundle";
import { Layout } from "@/components/layout";
import {
  AttachmentPicker,
  AttachmentChips,
  type UploadedAttachment,
} from "@/components/attachment-picker";
import { Button } from "@/components/ui/button";
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
  AlertCircle,
  Zap,
  Share2,
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
  Square,
} from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { AgentLogStream } from "@/components/agent-log-stream";
import { VisualTestPanel } from "@/components/visual-test-panel";
import { MCPIntegrationsPanel } from "@/components/mcp-integrations-panel";

const PHASE_LABELS: Record<string, { label: string; icon: any }> = {
  queued:       { label: "En cola…",                                          icon: Loader2 },
  starting:     { label: "Iniciando equipo de 9 agentes…",                    icon: Loader2 },
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
  const [activeSidebar, setActiveSidebar] = useState<SidebarTab>("chat");

  // ── Voz (Web Speech API) ─────────────────────────────────────────────────
  const [isListening, setIsListening] = useState(false);
  const [isSpeechSupported, setIsSpeechSupported] = useState(false);
  const draftRef = useRef<string>("");
  const manualStopRef = useRef(false);
  const hasSentRef = useRef(false);

  // Detectar soporte DESPUÉS del mount (no en SSR)
  useEffect(() => {
    const supported = !!(
      (window as any).SpeechRecognition ||
      (window as any).webkitSpeechRecognition
    );
    setIsSpeechSupported(supported);
  }, []);

  // Sincronizar draftRef con draft
  useEffect(() => { draftRef.current = draft; }, [draft]);

  const toggleMic = () => {
    if (isListening) {
      // Parar manualmente
      manualStopRef.current = true;
      setIsListening(false);
      return;
    }

    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) return;

    const rec = new SR();
    rec.lang = "es-ES";
    rec.interimResults = true;  // mostrar texto mientras habla
    rec.maxAlternatives = 1;
    rec.continuous = false;

    rec.onresult = (e: any) => {
      let transcript = "";
      for (let i = 0; i < e.results.length; i++) {
        if (e.results[i].isFinal) {
          transcript += e.results[i][0].transcript;
        }
      }
      // Si hay resultado final, actualizar el draft
      if (transcript.trim()) {
        setDraft(transcript.trim());
        draftRef.current = transcript.trim();
        hasSentRef.current = false;
      } else {
        // Resultado intermedio — mostrar en el textarea mientras habla
        let interim = "";
        for (let i = 0; i < e.results.length; i++) {
          interim += e.results[i][0].transcript;
        }
        setDraft(interim.trim());
        draftRef.current = interim.trim();
      }
    };

    rec.onerror = (e: any) => {
      if (e.error === "not-allowed") {
        alert("Maris AI necesita permiso para usar el micrófono. Haz clic en el icono 🔒 de la barra de direcciones y permite el micrófono.");
      }
      setIsListening(false);
    };

    rec.onend = () => {
      setIsListening(false);
      if (!manualStopRef.current && !hasSentRef.current && draftRef.current.trim().length >= 2) {
        hasSentRef.current = true;
        setTimeout(() => {
          const btn = document.getElementById("maris-send-btn");
          if (btn && !(btn as HTMLButtonElement).disabled) {
            (btn as HTMLButtonElement).click();
          }
        }, 200);
      }
      manualStopRef.current = false;
      hasSentRef.current = false;
    };

    manualStopRef.current = false;
    hasSentRef.current = false;
    setIsListening(true);

    try {
      rec.start();
    } catch (err) {
      console.error("Speech recognition start error:", err);
      setIsListening(false);
    }
  };
  const [mcpConnectors, setMcpConnectors] = useState<Record<string, { connected: boolean; values: Record<string, string> }>>({});
  const [isPublishingGoogle, setIsPublishingGoogle] = useState(false);
  const [showDeployModal, setShowDeployModal] = useState(false);
  const [showAccountSettings, setShowAccountSettings] = useState(false);
  const [accountSettingsTab, setAccountSettingsTab] = useState<"personal" | "apikey" | "agents" | "preferences" | "billing" | "usage">("personal");
  const [rightPanelTab, setRightPanelTab] = useState<"preview" | "code" | "visual-test">("preview");
  const [showVisualTestInline, setShowVisualTestInline] = useState(false);
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
  const { data: stats } = useGetMyStats();
  const credits = stats?.credits ?? 0;
  const outOfCredits = credits <= 0 && !isAdmin;

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

  const deployMutation = useDeployApp({
    mutation: {
      onSuccess: (result: any) => {
        queryClient.invalidateQueries({ queryKey: getGetAppQueryKey(id) });
        const deploymentUrl = result?.deploymentUrl || result?.url;
        toast({
          title: "Deploy iniciado",
          description: deploymentUrl ? `La app está disponible en ${deploymentUrl}` : "El despliegue se ha lanzado correctamente.",
        });
        if (deploymentUrl && typeof window !== "undefined") {
          window.open(deploymentUrl, "_blank", "noopener,noreferrer");
        }
      },
      onError: (err: any) => {
        toast({ title: "No se pudo desplegar", description: err?.message ?? "Error", variant: "destructive" });
      },
    },
  });

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
      toast({ title: "Error en la generación", description: job.errorMessage || "Algo salió mal", variant: "destructive" });
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
        toast({ title: "No se pudo enviar", description: err?.message ?? "Error", variant: "destructive" });
      },
    },
  });

  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, activeJobId]);

  const handleSend = () => {
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

  const phaseInfo = PHASE_LABELS[job?.phase ?? "queued"] ?? PHASE_LABELS.queued;
  const PhaseIcon = phaseInfo.icon;
  const jobStatus = job?.status ?? activeAppJob?.status;
  const isAwaitingApproval = jobStatus === "awaiting_approval";
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
  const deployedUrl = app?.vercelUrl || app?.vercelDeployUrl || app?.deploymentUrl || (app?.marisaiSubdomain ? `https://${app.marisaiSubdomain}.marisai.es` : "") || previewEndpointUrl;

  const isDeployedForShowcase = !!(app?.vercelUrl || app?.vercelDeployUrl || app?.deploymentUrl || app?.marisaiSubdomain);
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
        deployMutation.mutate({ id }, {
          onSuccess: (result: any) => {
            const url = result?.deploymentUrl || result?.url;
            if (openGoogleIndexing(url, preOpenedWindow)) {
              toast({ title: "App desplegada", description: `Tu app está en ${url}. Search Console se ha abierto para solicitar la indexación.` });
            }
          },
          onError: (err: any) => {
            preOpenedWindow?.close();
            toast({ title: "No se pudo desplegar", description: err?.message || "Intenta publicar de nuevo en unos minutos.", variant: "destructive" });
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
          </div>
        </>
      );
    }

    if (activeSidebar === "integrations") {
      return (
        <>
          <PanelHeader title="Integraciones y Conectores" description="Conecta servicios externos que los agentes usarán al generar tu app. Gestiona también el deploy y la URL pública." />
          <div className="flex-1 overflow-y-auto px-4 md:px-6 py-4 md:py-6 custom-scrollbar pb-20 md:pb-6 space-y-5">

            {/* ── MCP Connectors ───────────────────────────────────── */}
            <MCPIntegrationsPanel
              onConnectorChange={(id, connected, values) => {
                setMcpConnectors(prev => ({
                  ...prev,
                  [id]: { connected, values }
                }));
              }}
            />

            {/* ── Deploy & URL ─────────────────────────────────────── */}
            <div className="rounded-2xl border border-white/8 bg-white/[0.035] p-5">
              <p className="text-xs uppercase tracking-[0.18em] text-white/35 mb-3">Deploy y URL pública</p>
              <p className="break-all text-sm text-white/75 mb-4">{deployedUrl || "Aún no hay URL pública. Pulsa Deploy cuando la preview esté lista."}</p>
              <div className="grid gap-3">
                <Button onClick={handleShare} variant="outline" className="border-white/10 bg-white/[0.04] text-white hover:bg-white/[0.08]"><Share2 className="mr-2 h-4 w-4" /> Compartir enlace</Button>
                <Button onClick={handleDeploy} disabled={deployMutation.isPending || !hasRenderableCode} className="bg-gradient-to-r from-[#7c3aed] to-[#9333ea] font-bold text-white hover:from-[#8b5cf6] hover:to-[#a855f7]">
                  {deployMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Rocket className="mr-2 h-4 w-4" />}
                  {deployMutation.isPending ? "Desplegando" : "Deploy app"}
                </Button>
              </div>
            </div>

            {/* ── Showcase ─────────────────────────────────────────── */}
            <div className="rounded-2xl border border-white/8 bg-white/[0.035] p-5">
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
        {isAwaitingApproval && (
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
            <div className="space-y-5 md:space-y-7">
              {visibleMessages.map((message, index) => {
                const isUserMessage = message.role === "user";
                const key = message.id ?? `${message.role}-${index}`;
                return (
                  <div key={key} className={`flex items-start gap-3 md:gap-4 ${isUserMessage ? "justify-end" : "justify-start"}`}>
                    {!isUserMessage && (
                      <div className="relative mt-1 shrink-0">
                        <div className="absolute inset-0 rounded-full bg-[#7c3aed]/35 blur-lg" />
                        <div className="relative grid h-10 w-10 md:h-12 md:w-12 place-items-center rounded-full border border-[#8b5cf6]/25 bg-[#111827]">
                          <Bot className="h-5 w-5 md:h-6 md:w-6 text-white" />
                        </div>
                      </div>
                    )}
                    <div className={`max-w-[85%] md:max-w-[78%] space-y-2 ${isUserMessage ? "items-end text-right" : "items-start"}`}>
                      <div className={`whitespace-pre-wrap rounded-2xl px-4 py-3 md:px-5 md:py-4 text-[14px] md:text-[15px] leading-relaxed shadow-[0_12px_30px_rgba(0,0,0,0.18)] ${isUserMessage ? "bg-gradient-to-r from-[#7c3aed] to-[#9333ea] text-white" : "border border-white/[0.07] bg-[#1b2230] text-white/90"}`}>
                        {!isUserMessage && String(message.content || "").includes("ENGINE_EXEC activado") && (
                          <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-emerald-400/25 bg-emerald-400/10 px-3 py-1 text-[11px] font-extrabold uppercase tracking-[0.18em] text-emerald-200">
                            <Shield className="h-3.5 w-3.5" /> ENGINE_EXEC · sin recompilar
                          </div>
                        )}
                        {message.content}
                      </div>
                      <div className={`px-1 ${isUserMessage ? "text-right" : "text-left"}`}>
                        <p className={`text-[12px] md:text-[13px] font-bold ${isUserMessage ? "text-white/65" : "text-[#a78bfa]"}`}>{isUserMessage ? firstName : "Maris AI"}</p>
                        <p className="mt-0.5 text-[10px] md:text-[12px] text-white/35">{formatMessageTime(message.createdAt)}</p>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
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
                  Testing visual automático — Claude Vision analiza tu app
                </div>
                <button onClick={() => setShowVisualTestInline(false)}
                  className="text-white/25 hover:text-white/60 transition-colors">
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
              <VisualTestPanel
                appId={app?._id || app?.id || ""}
                appSlug={app?.publicSlug || undefined}
              />
            </div>
          )}
        </div>
        <div className="space-y-3 px-2 md:px-6 pb-24 md:pb-6">
          {isAwaitingApproval && (
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
            <div className="rounded-2xl border border-white/[0.09] bg-[#0d0f1a] shadow-[0_8px_30px_rgba(0,0,0,0.3)]">
              <AttachmentChips attachments={chatAttachments} onRemove={(attachmentId) => setChatAttachments((items) => items.filter((item) => item.id !== attachmentId))} />
              <Textarea
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                    e.preventDefault();
                    if (draft.trim().length >= 2 && !sendMutation.isPending && !isActivelyProcessing) handleSend();
                  }
                }}
                placeholder={isListening ? "🎙️ Escuchando... habla ahora" : "Escribe un mensaje al agente..."}
                className="min-h-[64px] md:min-h-[72px] resize-none border-0 bg-transparent text-[14px] text-white placeholder:text-white/30 focus-visible:ring-0 px-4 pt-3 pb-2"
              />
              <div className="flex items-center justify-between px-3 pb-3">
                <div className="flex items-center gap-1">
                  <AttachmentPicker attachments={chatAttachments} onChange={setChatAttachments} disabled={sendMutation.isPending || isActivelyProcessing} />
                  <button type="button" title="Marcar" className="grid h-8 w-8 place-items-center rounded-lg text-white/30 hover:bg-white/[0.05] hover:text-white/60 transition">
                    <Star className="h-4 w-4" />
                  </button>
                  <button type="button" title="Fork" className="hidden md:grid h-8 w-8 place-items-center rounded-lg text-white/30 hover:bg-white/[0.05] hover:text-white/60 transition">
                    <GitBranch className="h-4 w-4" />
                  </button>
                  <button type="button" title="Compartir" className="hidden md:grid h-8 w-8 place-items-center rounded-lg text-white/30 hover:bg-white/[0.05] hover:text-white/60 transition">
                    <Share2 className="h-4 w-4" />
                  </button>
                  {isSpeechSupported && (
                    <button
                      type="button"
                      onClick={toggleMic}
                      disabled={sendMutation.isPending || isActivelyProcessing}
                      title={isListening ? "Detener grabación" : "Hablar por voz"}
                      className={`relative grid h-8 w-8 place-items-center rounded-lg transition disabled:opacity-40 ${
                        isListening
                          ? "text-red-400 bg-red-500/10"
                          : "text-white/30 hover:bg-white/[0.05] hover:text-violet-400"
                      }`}
                    >
                      {isListening && <span className="absolute inset-0 rounded-lg animate-ping bg-red-500/15" />}
                      {isListening
                        ? <Square className="h-4 w-4 relative z-10" />
                        : <Mic className="h-4 w-4" />}
                    </button>
                  )}
                </div>
                <button
                  id="maris-send-btn"
                  onClick={handleSend}
                  disabled={draft.trim().length < 2 || sendMutation.isPending || isActivelyProcessing}
                  className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-[#7c3aed] to-[#9333ea] text-white shadow-[0_4px_14px_rgba(124,58,237,0.4)] hover:from-[#8b5cf6] hover:to-[#a855f7] disabled:opacity-40 disabled:cursor-not-allowed transition"
                >
                  {sendMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                </button>
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
              <div className="h-full overflow-auto bg-[#0a0d15] p-4">
                <VisualTestPanel
                  appId={app?._id || app?.id || ""}
                  appSlug={app?.publicSlug || undefined}
                />
              </div>
            ) : rightPanelTab === "code" ? (
              <div className="h-full overflow-auto bg-[#060810] p-4 md:p-6">
                {frontendCode ? (
                  <pre className="text-[12px] leading-relaxed text-emerald-300/80 font-mono whitespace-pre-wrap break-words">{frontendCode.slice(0, 50000)}{frontendCode.length > 50000 ? "\n\n... (truncado, descarga el proyecto para ver el código completo)" : ""}</pre>
                ) : (
                  <div className="flex h-full items-center justify-center">
                    <div className="text-center">
                      <Terminal className="h-12 w-12 text-white/15 mx-auto mb-4" />
                      <p className="text-white/30 text-sm">El código aparecerá aquí cuando Maris AI termine de generarlo.</p>
                    </div>
                  </div>
                )}
              </div>
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
                  {showStaticBuildState ? (
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
                <div className="pointer-events-none absolute bottom-6 left-1/2 w-[90%] md:w-[620px] max-w-[calc(100%-2rem)] -translate-x-1/2">
                  <div className="pointer-events-auto flex h-[52px] md:h-[56px] items-center justify-between rounded-lg border border-white/[0.09] bg-[#0b0f18]/95 px-4 md:px-5 shadow-[0_12px_40px_rgba(0,0,0,0.45)] backdrop-blur-xl">
                    <div className="flex items-center gap-3 text-[12px] md:text-[13px] text-white/55">
                      <span className={`h-2 w-2 rounded-full ${hasRenderableCode ? "bg-emerald-400" : "bg-white/20"}`} />
                      <span>{showStaticBuildState ? "Esperando código…" : "Vista en vivo activa"}</span>
                    </div>
                    <button onClick={handleResumePreview} className="rounded-md border border-[#8b5cf6]/60 px-3 md:px-4 py-1.5 text-[12px] md:text-[13px] font-bold text-[#a78bfa] transition hover:bg-[#7c3aed]/10 hover:text-white">
                      {hasRenderableCode ? "Resume" : "Cerrar"}
                    </button>
                  </div>
                </div>
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
                <div className="space-y-5">
                  <h3 className="text-base font-bold text-white">Información personal</h3>
                  <div className="flex items-center gap-4">
                    <Avatar className="h-14 w-14 md:h-16 md:w-16 border-2 border-white/10">
                      <AvatarImage src={user?.imageUrl} />
                      <AvatarFallback className="bg-gradient-to-br from-[#7c3aed] to-[#5b21b6] text-xl font-bold text-white">{user?.firstName?.charAt(0) || "M"}</AvatarFallback>
                    </Avatar>
                    <div>
                      <p className="font-semibold text-white">{user?.fullName || firstName}</p>
                      <p className="text-sm text-white/45">{user?.primaryEmailAddress?.emailAddress || me?.email}</p>
                      {isAdmin && <span className="inline-flex items-center gap-1 mt-1 text-xs text-yellow-400"><Crown className="h-3 w-3" />Propietario</span>}
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="rounded-xl border border-white/[0.07] bg-white/[0.03] p-4">
                      <p className="text-xs text-white/35 uppercase tracking-widest">Racha</p>
                      <p className="mt-2 text-xl md:text-2xl font-bold text-orange-400 flex items-center gap-2"><Flame className="h-5 w-5" />{(stats as any)?.streak ?? 1} días</p>
                    </div>
                    <div className="rounded-xl border border-white/[0.07] bg-white/[0.03] p-4">
                      <p className="text-xs text-white/35 uppercase tracking-widest">Créditos</p>
                      <p className="mt-2 text-xl md:text-2xl font-bold text-yellow-400 flex items-center gap-2"><Cpu className="h-5 w-5" />{isAdmin ? "∞" : credits}</p>
                    </div>
                  </div>
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
        }}
      />
    )}
    </>
  );
}
