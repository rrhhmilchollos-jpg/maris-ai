import { useState, useEffect, useRef, useMemo } from "react";
import { useLocation } from "wouter";
import { useClerk, useUser } from "@clerk/react";
import {
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
} from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { AgentLogStream } from "@/components/agent-log-stream";

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
  // ✅ Persistir activeJobId en localStorage para sobrevivir recargas de página
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
  const [isPublishingGoogle, setIsPublishingGoogle] = useState(false);
  const [showDeployModal, setShowDeployModal] = useState(false);
  const [showAccountSettings, setShowAccountSettings] = useState(false);
  const [accountSettingsTab, setAccountSettingsTab] = useState<"personal" | "apikey" | "agents" | "preferences" | "billing" | "usage">("personal");
  const [rightPanelTab, setRightPanelTab] = useState<"preview" | "code">("preview");
  const [previewSize, setPreviewSize] = useState<"desktop" | "tablet" | "mobile">("desktop");
  const [darkModeEnabled, setDarkModeEnabled] = useState(true);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  const { data: app, isLoading } = useGetApp(id, {
    query: {
      enabled: !!id,
      queryKey: getGetAppQueryKey(id),
      // Refrescar la app periódicamente mientras hay un job activo para que
      // el frontendCode se actualice en cuanto el job termine (succeeded).
      // Una vez que hay código renderizable, reducimos a 10s para no saturar.
      refetchInterval: (data: any) => {
        if (!data) return 3000;
        const code = String(data?.frontendCode ?? "").trim();
        const hasCode = code.length >= 20 && !code.includes("El código ha sido consolidado en disco por hitos");
        return hasCode ? 10000 : 3000;
      },
    },
  });
    const { data: me } = useGetMe();
  const isAdmin = !!me?.isAdmin;
  const { data: stats } = useGetMyStats();
  const credits = stats?.credits ?? 0;
  const outOfCredits = credits <= 0 && !isAdmin;

  // ✅ Seguimiento 2 y 3: Notificaciones y gráfico de créditos
  const { data: notificationsData } = useGetNotifications();
  const unreadCount: number = notificationsData?.unreadCount ?? 0;
  const { data: creditsHistory } = useGetCreditsHistory();

  const { data: messages } = useListAppMessages(id, {
    query: { enabled: !!id, queryKey: getListAppMessagesQueryKey(id), refetchInterval: 3000 },
  });

  // ✅ activeAppJob siempre habilitado — necesario para detectar jobs en awaiting_approval
  // aunque el localStorage tenga un jobId anterior (que puede haber terminado ya)
  const { data: activeAppJob } = useGetActiveAppJob(id, {
    query: {
      enabled: !!id,
      queryKey: getGetActiveAppJobQueryKey(id),
      refetchInterval: (data: any) => {
        const status = data?.status;
        return status && status !== "succeeded" && status !== "failed" ? 2000 : 5000;
      },
    },
  });

  // Si activeAppJob devuelve un job activo diferente al del localStorage, sincronizar
  useEffect(() => {
    if (activeAppJob?.id && String(activeAppJob.id) !== activeJobId) {
      // El servidor tiene un job activo que no conocemos localmente → actualizar
      setActiveJobId(String(activeAppJob.id));
    }
    if (!activeAppJob && activeJobId) {
      // El servidor no tiene ningún job activo → limpiar el localStorage
      // Solo limpiar si el job local ya terminó (succeeded/failed)
      // Esto se maneja en el useEffect de job.status
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeAppJob?.id]);

  // effectiveJobId: prioridad → activeAppJob del servidor (siempre fresco) > localStorage
  // NUNCA del objeto app, cuyo _id es el ID de la app (causaba 404 en /api/jobs/:appId)
  const effectiveJobId: string | null =
    (activeAppJob?.id ? String(activeAppJob.id) : null) ?? activeJobId;

  // Job logs para los bloques inline de agentes (Emergent.sh style)
  const { data: jobLogsData } = useQuery({
    queryKey: [...getGetGenerationJobLogsQueryKey(effectiveJobId ?? ""), "inline"],
    queryFn: () => getGenerationJobLogs(effectiveJobId!, { }),
    enabled: !!effectiveJobId && isWorking,
    refetchInterval: isWorking ? 2000 : false,
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
      setActiveJobId(null);
      toast({ title: "¡Cambios aplicados!", description: "La previsualización se ha actualizado." });
    } else if (job?.status === "failed") {
      queryClient.invalidateQueries({ queryKey: getGetActiveAppJobQueryKey(id) });
      setActiveJobId(null);
      toast({ title: "Error en la generación", description: job.error || "Algo salió mal", variant: "destructive" });
    }
  }, [job?.status, id, queryClient, job?.error, toast]);

  const sendMutation = useSendAppMessage({
    mutation: {
      onSuccess: (nextJob: any) => {
        setDraft("");
        setChatAttachments([]);
        queryClient.invalidateQueries({ queryKey: getListAppMessagesQueryKey(id) });
        queryClient.invalidateQueries({ queryKey: getGetMyStatsQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetMeQueryKey() });
        if (nextJob?.conversationOnly) {
          setActiveJobId(null);
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
  // isWorking = hay un job activo procesando (no en awaiting_approval, que es cuando el usuario puede enviar mensajes)
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
  const deployedUrl = app?.vercelDeployUrl || app?.deploymentUrl || (app?.marisaiSubdomain ? `https://${app.marisaiSubdomain}.marisai.es` : "");
  const showStaticBuildState = !hasRenderableCode;
  const renderedFileCount = hasRenderableCode ? parseBundle(frontendCode) ? Object.keys(parseBundle(frontendCode)).length : 0 : 0;
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
    toast({ title: "Preview cerrada", description: "La vista en vivo se ha retirado completamente y el chat ocupa el área de trabajo." });
  };

  const handleOpenPreview = () => {
    setIsPreviewClosed(false);
    setIsPreviewMaximized(false);
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

    // Si ya tenemos una ventana pre-abierta (desde el click directo), redirigirla
    if (preOpenedWindow && !preOpenedWindow.closed) {
      preOpenedWindow.location.href = searchConsoleUrl;
    } else {
      // Intento directo como fallback
      const opened = window.open(searchConsoleUrl, "_blank", "noopener,noreferrer");
      if (!opened) {
        toast({ title: "Ventana bloqueada", description: "Permite ventanas emergentes para Maris AI y vuelve a pulsar Publicar en Google.", variant: "destructive" });
        return false;
      }
    }

    toast({
      title: "Google Search Console abierto",
      description: "Revisa la propiedad y pulsa Solicitar indexación en Google. Si la propiedad no existe, Google te pedirá verificarla.",
    });

    window.setTimeout(() => {
      window.open(googleSearchUrl, "_blank", "noopener,noreferrer");
    }, 250);

    return true;
  };

  const handlePublishGoogle = async () => {
    if (!hasRenderableCode) {
      toast({ title: "App no disponible", description: "Genera la app primero antes de publicarla en Google.", variant: "destructive" });
      return;
    }
    if (isPublishingGoogle) return;
    setIsPublishingGoogle(true);

    // Pre-abrimos la ventana AQUÍ, en el contexto directo del click del usuario,
    // antes de cualquier llamada async. Así el navegador no la bloquea.
    const preOpenedWindow = !deployedUrl ? window.open("about:blank", "_blank", "noopener,noreferrer") : null;

    try {
      if (deployedUrl) {
        openGoogleIndexing(deployedUrl);
      } else {
        toast({
          title: "Desplegando antes de publicar…",
          description: "Tu app necesita estar desplegada para aparecer en Google. Iniciando deploy automático.",
        });
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
      <div className="px-6 pt-6">
        <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[#a78bfa]">{panelTitle}</p>
        <h2 className="mt-2 text-2xl font-extrabold text-white">{title}</h2>
        <p className="mt-2 text-sm leading-relaxed text-white/55">{description}</p>
      </div>
    );

    if (activeSidebar === "plan") {
      return (
        <>
          <PanelHeader title="Plan de construcción" description="Revisa la estructura que debe seguir Maris AI antes de continuar con la generación o los cambios." />
          <div className="flex-1 overflow-y-auto px-6 py-6 custom-scrollbar">
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
          <div className="px-6 pb-6">
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
          <div className="flex-1 overflow-y-auto px-6 py-6 custom-scrollbar">
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
          <PanelHeader title="Integraciones" description="Gestiona la URL pública, compartir y despliegue conectado de la aplicación." />
          <div className="flex-1 overflow-y-auto px-6 py-6 custom-scrollbar">
            <div className="rounded-2xl border border-white/8 bg-white/[0.035] p-5">
              <p className="text-xs uppercase tracking-[0.18em] text-white/35">URL pública</p>
              <p className="mt-3 break-all text-sm text-white/75">{deployedUrl || "Aún no hay URL pública. Pulsa Deploy cuando la preview esté lista."}</p>
            </div>
            <div className="mt-5 grid gap-3">
              <Button onClick={handleShare} variant="outline" className="border-white/10 bg-white/[0.04] text-white hover:bg-white/[0.08]"><Share2 className="mr-2 h-4 w-4" /> Compartir enlace</Button>
              <Button onClick={handleDeploy} disabled={deployMutation.isPending || !hasRenderableCode} className="bg-gradient-to-r from-[#7c3aed] to-[#9333ea] font-bold text-white hover:from-[#8b5cf6] hover:to-[#a855f7]">
                {deployMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Rocket className="mr-2 h-4 w-4" />}
                {deployMutation.isPending ? "Desplegando" : "Deploy app"}
              </Button>
            </div>
          </div>
        </>
      );
    }

    if (activeSidebar === "ui-builder") {
      return (
        <>
          <PanelHeader title="UI Builder" description="Controla la preview en vivo de la interfaz generada y abre la vista de trabajo ampliada." />
          <div className="flex-1 overflow-y-auto px-6 py-6 custom-scrollbar">
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
          <div className="flex-1 overflow-y-auto px-6 py-6 custom-scrollbar">
            <div className="rounded-2xl border border-white/8 bg-white/[0.035] p-5">
              <div className="flex items-center gap-3 text-white/80">
                <PhaseIcon className={`h-5 w-5 text-[#a78bfa] ${isWorking ? "animate-pulse" : ""}`} />
                <span className="font-semibold">{isWorking ? phaseInfo.label : "Sin trabajos activos"}</span>
              </div>
              {job?.error && <p className="mt-3 text-sm text-red-300">{job.error}</p>}
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
          <div className="flex-1 overflow-y-auto px-6 py-6 custom-scrollbar">
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

    return (
      <>
        <div className="px-6 pt-6">
          <div className="rounded-lg border border-[#1d4ed8]/35 bg-[#0f2244]/70 px-6 py-3.5 text-center text-[15px] font-semibold text-[#60a5fa] shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]">
            <div className="flex items-center justify-center gap-3">
              <Info className="h-5 w-5" />
              <span>Maris AI seguirá trabajando después de tu respuesta</span>
            </div>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto px-8 py-10 custom-scrollbar">
          {visibleMessages.length === 0 ? (
            <div className="flex items-start gap-5">
              <div className="relative mt-1 shrink-0">
                <div className="absolute inset-0 rounded-full bg-[#7c3aed]/40 blur-xl" />
                <div className="relative grid h-[74px] w-[74px] place-items-center rounded-full border border-[#8b5cf6]/30 bg-[#111827] shadow-[0_0_30px_rgba(124,58,237,0.55)]">
                  <Bot className="h-10 w-10 text-white robot-vibrate" />
                </div>
              </div>
              <div className="space-y-2">
                <div className="rounded-lg border border-white/[0.07] bg-[#1b2230] px-5 py-4 text-[18px] leading-relaxed text-white/90 shadow-[0_12px_30px_rgba(0,0,0,0.2)]">
                  <p>He terminado la estructura.</p>
                  <p className="mt-3">Revisa el plan y dame el visto bueno para continuar.</p>
                </div>
                <div className="pl-1">
                  <p className="text-[17px] font-bold text-[#a78bfa]">Maris AI</p>
                  <p className="mt-1 text-[14px] text-white/45">Ahora</p>
                </div>
              </div>
            </div>
          ) : (
            <div className="space-y-7">
              {visibleMessages.map((message, index) => {
                const isUserMessage = message.role === "user";
                const key = message.id ?? `${message.role}-${index}`;
                return (
                  <div key={key} className={`flex items-start gap-4 ${isUserMessage ? "justify-end" : "justify-start"}`}>
                    {!isUserMessage && (
                      <div className="relative mt-1 shrink-0">
                        <div className="absolute inset-0 rounded-full bg-[#7c3aed]/35 blur-lg" />
                        <div className="relative grid h-12 w-12 place-items-center rounded-full border border-[#8b5cf6]/25 bg-[#111827]">
                          <Bot className="h-6 w-6 text-white" />
                        </div>
                      </div>
                    )}
                    <div className={`max-w-[78%] space-y-2 ${isUserMessage ? "items-end text-right" : "items-start"}`}>
                      <div className={`whitespace-pre-wrap rounded-2xl px-5 py-4 text-[15px] leading-relaxed shadow-[0_12px_30px_rgba(0,0,0,0.18)] ${isUserMessage ? "bg-gradient-to-r from-[#7c3aed] to-[#9333ea] text-white" : "border border-white/[0.07] bg-[#1b2230] text-white/90"}`}>
                        {message.content}
                      </div>
                      <div className={`px-1 ${isUserMessage ? "text-right" : "text-left"}`}>
                        <p className={`text-[13px] font-bold ${isUserMessage ? "text-white/65" : "text-[#a78bfa]"}`}>{isUserMessage ? firstName : "Maris AI"}</p>
                        <p className="mt-0.5 text-[12px] text-white/35">{formatMessageTime(message.createdAt)}</p>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          {/* ─── Agent logs inline (Emergent.sh style) ─── */}
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
                  system:       { label: "SYSTEM",       color: "text-red-400",     bg: "bg-red-500/10",      border: "border-red-500/25",     Icon: AlertCircle },
                };
                const cfg = agentCfg[agentKey] || agentCfg.system;
                const isActive = idx === jobLogs.slice(-8).length - 1 && isWorking;
                const isError = log.level === "error" || agentKey === "system";
                return (
                  <div key={log.id || idx} className={`flex items-center gap-3 rounded-xl border px-3.5 py-2.5 ${
                    isError ? "border-red-500/30 bg-red-500/8" :
                    isActive ? "border-[#7c3aed]/40 bg-[#7c3aed]/8" :
                    `${cfg.border} ${cfg.bg}`
                  }`}>
                    <div className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg border ${
                      isError ? "border-red-500/30 bg-red-500/15" :
                      `${cfg.border} ${cfg.bg}`
                    }`}>
                      <cfg.Icon className={`h-4 w-4 ${isError ? "text-red-400" : cfg.color}`} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className={`text-[11px] font-black tracking-widest ${isError ? "text-red-400" : cfg.color}`}>{cfg.label}</span>
                        {log.file && <span className="text-[11px] text-white/35 font-mono truncate">{log.file}</span>}
                      </div>
                      {log.message && <p className={`text-[12px] leading-snug truncate ${
                        isError ? "text-red-300" : "text-white/60"
                      }`}>{log.message}</p>}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-[11px] text-white/25 font-mono">{formatMessageTime(log.createdAt)}</span>
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
        </div>
        <div className="space-y-3 px-6 pb-6">
          {/* Botón Aprobar y continuar: SOLO visible cuando el job está en awaiting_approval */}
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
          {/* Input de mensajes: SOLO visible cuando NO está en awaiting_approval */}
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
                placeholder="Escribe un mensaje al agente..."
                className="min-h-[72px] resize-none border-0 bg-transparent text-[14px] text-white placeholder:text-white/30 focus-visible:ring-0 px-4 pt-3 pb-2"
              />
              <div className="flex items-center justify-between px-3 pb-3">
                <div className="flex items-center gap-1">
                  <AttachmentPicker attachments={chatAttachments} onChange={setChatAttachments} disabled={sendMutation.isPending || isActivelyProcessing} />
                  <button type="button" title="Marcar" className="grid h-8 w-8 place-items-center rounded-lg text-white/30 hover:bg-white/[0.05] hover:text-white/60 transition">
                    <Star className="h-4 w-4" />
                  </button>
                  <button type="button" title="Fork" className="grid h-8 w-8 place-items-center rounded-lg text-white/30 hover:bg-white/[0.05] hover:text-white/60 transition">
                    <GitBranch className="h-4 w-4" />
                  </button>
                  <button type="button" title="Compartir" className="grid h-8 w-8 place-items-center rounded-lg text-white/30 hover:bg-white/[0.05] hover:text-white/60 transition">
                    <Share2 className="h-4 w-4" />
                  </button>
                </div>
                <button
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
      <header className="h-[61px] shrink-0 border-b border-white/[0.075] bg-[#070910]/95 backdrop-blur-xl">
        <div className="flex h-full items-center justify-between px-5">
          {/* LEFT: Logo + project tab */}
          <div className="flex items-center gap-4">
            <button onClick={() => setLocation("/dashboard")} className="flex items-center gap-2.5 hover:opacity-80 transition">
              <MarisLogo />
            </button>
            <div className="flex items-center gap-1.5">
              <div className="flex items-center gap-1.5 rounded-lg border border-white/[0.065] bg-white/[0.04] px-3 py-1.5 text-[13.5px] font-semibold text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]">
                <span className="h-2 w-2 rounded-full bg-[#7c3aed]" />
                <span className="max-w-[180px] truncate">{app?.title || "Sin título"}</span>
                <X className="ml-1 h-3.5 w-3.5 text-white/35 hover:text-white/70 cursor-pointer" onClick={(e) => { e.stopPropagation(); setLocation("/dashboard"); }} />
              </div>
              <button onClick={() => setLocation("/dashboard")} className="grid h-8 w-8 place-items-center rounded-lg border border-white/[0.065] bg-white/[0.04] text-white/60 hover:bg-white/[0.07] hover:text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] transition">
                <span className="text-lg leading-none font-bold">+</span>
              </button>
            </div>
          </div>

          {/* RIGHT: streak + credits + notifications + profile */}
          <div className="flex items-center gap-3 text-white/70">
            {/* Streak */}
            <button onClick={() => setLocation("/billing")} className="flex items-center gap-1.5 rounded-full border border-orange-500/20 bg-orange-500/8 px-3 py-1.5 text-[13px] font-bold text-orange-400 hover:bg-orange-500/15 transition">
              <Flame className="h-4 w-4" />
              <span>{(stats as any)?.streak ?? 1}</span>
            </button>

            {/* Credits */}
            <button onClick={() => setLocation("/billing")} className="flex items-center gap-1.5 rounded-full border border-yellow-500/20 bg-yellow-500/8 px-3 py-1.5 text-[13px] font-bold text-yellow-400 hover:bg-yellow-500/15 transition">
              <Cpu className="h-4 w-4" />
              <span>{isAdmin ? "∞" : credits}</span>
            </button>

            {/* ✅ Seguimiento 3: Notificaciones con badge de contador real */}
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
              <DropdownMenuContent align="end" forceMount className="z-[220] w-80 border-white/10 bg-[#0f1320] text-white">
                <DropdownMenuLabel className="flex items-center justify-between">
                  <span>Notificaciones</span>
                  {unreadCount > 0 && <span className="rounded-full bg-[#7c3aed]/20 px-2 py-0.5 text-[10px] font-bold text-[#a78bfa]">{unreadCount} nuevas</span>}
                </DropdownMenuLabel>
                <DropdownMenuSeparator className="bg-white/10" />
                {/* Notificaciones del backend */}
                {notificationsData?.notifications?.map((n: any) => (
                  <DropdownMenuItem key={n.id} onSelect={(e) => e.preventDefault()} className="flex cursor-default flex-col items-start gap-1 whitespace-normal focus:bg-white/5 focus:text-white">
                    <span className={`text-sm font-semibold ${n.type === 'error' ? 'text-red-400' : n.type === 'warning' ? 'text-yellow-400' : 'text-white'}`}>{n.title}</span>
                    <span className="text-xs leading-relaxed text-white/55">{n.body}</span>
                  </DropdownMenuItem>
                ))}
                {/* Notificaciones del estado del job activo */}
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

            {/* Profile dropdown */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button type="button" aria-label="Perfil" className="flex items-center gap-2 rounded-full pl-1 pr-1.5 hover:bg-white/5 transition">
                  <Avatar className="h-8 w-8 border border-white/10">
                    <AvatarImage src={user?.imageUrl} alt={user?.fullName || firstName} />
                    <AvatarFallback className="bg-gradient-to-br from-[#7c3aed] to-[#5b21b6] text-xs font-bold text-white">{user?.firstName?.charAt(0) || firstName.charAt(0) || "M"}</AvatarFallback>
                  </Avatar>
                  <ChevronDown className="h-3.5 w-3.5 text-white/45" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" forceMount className="z-[220] w-72 border-white/10 bg-[#0f1320] text-white p-0 overflow-hidden">
                {/* User info header */}
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
                {/* Buy credits CTA */}
                <div className="px-3 py-2 border-b border-white/[0.07]">
                  <button onClick={() => setLocation("/billing")} className="w-full flex items-center justify-between rounded-lg bg-gradient-to-r from-yellow-500/15 to-orange-500/15 border border-yellow-500/20 px-3 py-2 text-sm font-semibold text-yellow-300 hover:from-yellow-500/25 hover:to-orange-500/25 transition">
                    <div className="flex items-center gap-2">
                      <Cpu className="h-4 w-4" />
                      Comprar créditos
                    </div>
                    <ChevronRight className="h-4 w-4" />
                  </button>
                </div>
                {/* Menu items */}
                <div className="py-1">
                  <DropdownMenuItem onClick={() => setLocation("/dashboard")} className="cursor-pointer focus:bg-white/8 focus:text-white mx-1 rounded-md">
                    <LayoutDashboard className="mr-2 h-4 w-4 text-white/45" />
                    Panel de proyectos
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => { setShowAccountSettings(true); setAccountSettingsTab("personal"); }} className="cursor-pointer focus:bg-white/8 focus:text-white mx-1 rounded-md">
                    <Settings className="mr-2 h-4 w-4 text-white/45" />
                    Configuración de cuenta
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => { setShowAccountSettings(true); setAccountSettingsTab("agents"); }} className="cursor-pointer focus:bg-white/8 focus:text-white mx-1 rounded-md">
                    <Users className="mr-2 h-4 w-4 text-white/45" />
                    Gestionar agentes
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={(e) => e.preventDefault()} className="cursor-default focus:bg-white/5 mx-1 rounded-md">
                    <div className="flex items-center justify-between w-full">
                      <div className="flex items-center gap-2">
                        <Moon className="h-4 w-4 text-white/45" />
                        <span>Modo oscuro</span>
                      </div>
                      <Switch checked={darkModeEnabled} onCheckedChange={setDarkModeEnabled} className="scale-75" />
                    </div>
                  </DropdownMenuItem>
                </div>
                <DropdownMenuSeparator className="bg-white/[0.07]" />
                <div className="py-1">
                  {isAdmin && (
                    <DropdownMenuItem onClick={() => setLocation("/admin")} className="cursor-pointer focus:bg-white/8 focus:text-white mx-1 rounded-md">
                      <Shield className="mr-2 h-4 w-4 text-[#a78bfa]" />
                      Panel admin
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuItem onClick={handleOpenDocs} className="cursor-pointer focus:bg-white/8 focus:text-white mx-1 rounded-md">
                    <ExternalLink className="mr-2 h-4 w-4 text-white/45" />
                    Documentación
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => signOut(() => setLocation("/"))} className="cursor-pointer focus:bg-red-500/10 focus:text-red-300 mx-1 rounded-md text-white/70">
                    <LogOut className="mr-2 h-4 w-4" />
                    Cerrar sesión
                  </DropdownMenuItem>
                </div>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <aside className="flex w-[72px] shrink-0 flex-col border-r border-white/[0.07] bg-[#070910]">
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
                    active
                      ? "bg-[#7c3aed]/12 text-[#c084fc]"
                      : "text-white/40 hover:bg-white/[0.04] hover:text-white/75"
                  }`}
                >
                  {active && (
                    <span className="absolute left-0 top-1/2 -translate-y-1/2 h-8 w-0.5 rounded-r-full bg-[#7c3aed] shadow-[0_0_12px_rgba(124,58,237,0.9)]" />
                  )}
                  <Icon className={`h-5 w-5 transition ${
                    active ? "text-[#c084fc] drop-shadow-[0_0_8px_rgba(192,132,252,0.8)]" : ""
                  }`} />
                  <span className="leading-none">{item.label}</span>
                </button>
              );
            })}
          </nav>
          {/* Avatar at bottom */}
          <div className="flex justify-center pb-4">
            <Avatar className="h-9 w-9 border border-white/10 cursor-pointer hover:ring-2 hover:ring-[#7c3aed]/50 transition" onClick={() => setShowAccountSettings(true)}>
              <AvatarImage src={user?.imageUrl} />
              <AvatarFallback className="bg-gradient-to-br from-[#7c3aed] to-[#5b21b6] text-xs font-bold text-white">{user?.firstName?.charAt(0) || firstName.charAt(0) || "M"}</AvatarFallback>
            </Avatar>
          </div>
        </aside>

        <section className={`flex min-w-[430px] flex-col border-r border-white/[0.08] bg-[#080a12] ${isPreviewClosed ? "flex-1" : "w-[590px] shrink-0"}`}>
          {renderSidebarPanel()}
          {isPreviewClosed && (
            <div className="px-6 pb-6">
              <Button onClick={handleOpenPreview} variant="outline" className="h-11 w-full border-[#8b5cf6]/50 bg-[#7c3aed]/10 font-bold text-[#c4b5fd] hover:bg-[#7c3aed]/20 hover:text-white">
                Abrir App Preview
              </Button>
            </div>
          )}
        </section>

        {!isPreviewClosed && (
        <main className={`${isPreviewMaximized ? "fixed inset-0 z-[130]" : "flex min-w-0 flex-1"} flex-col bg-[#0a0d15]`}>
          {/* ─── Right panel toolbar ─── */}
          <div className="flex h-[61px] shrink-0 items-center border-b border-white/[0.07] bg-[#0a0d15] px-4 gap-3">
            {/* Preview / Code tabs */}
            <div className="flex items-center rounded-lg border border-white/[0.07] bg-white/[0.03] p-0.5">
              <button onClick={() => setRightPanelTab("preview")} className={`px-3 py-1.5 rounded-md text-[13px] font-semibold transition ${rightPanelTab === "preview" ? "bg-white/[0.08] text-white" : "text-white/45 hover:text-white/70"}`}>Preview</button>
              <button onClick={() => setRightPanelTab("code")} className={`px-3 py-1.5 rounded-md text-[13px] font-semibold transition ${rightPanelTab === "code" ? "bg-white/[0.08] text-white" : "text-white/45 hover:text-white/70"}`}>
                <Code className="inline h-3.5 w-3.5 mr-1" />Código
              </button>
            </div>

            {/* URL bar */}
            <div className="flex flex-1 items-center gap-2 rounded-lg border border-white/[0.07] bg-white/[0.025] px-3 py-1.5 min-w-0">
              <Globe className="h-3.5 w-3.5 text-white/30 shrink-0" />
              <span className="flex-1 truncate text-[12.5px] text-white/50 font-mono">{deployedUrl || `https://${(app?.title || "mi-app").toLowerCase().replace(/\s+/g, "-")}.marisai.es`}</span>
              <button onClick={() => { if (deployedUrl) { navigator.clipboard.writeText(deployedUrl); toast({ title: "URL copiada" }); } }} className="shrink-0 text-white/30 hover:text-white/70 transition">
                <Copy className="h-3.5 w-3.5" />
              </button>
              <button onClick={handleRefreshPreview} className="shrink-0 text-white/30 hover:text-white/70 transition">
                <RefreshCcw className="h-3.5 w-3.5" />
              </button>
            </div>

            {/* Size controls */}
            <div className="flex items-center rounded-lg border border-white/[0.07] bg-white/[0.03] p-0.5 gap-0.5">
              <button onClick={() => setPreviewSize("desktop")} title="Escritorio" className={`grid h-7 w-7 place-items-center rounded-md transition ${previewSize === "desktop" ? "bg-white/[0.1] text-white" : "text-white/35 hover:text-white/65"}`}><Monitor className="h-4 w-4" /></button>
              <button onClick={() => setPreviewSize("tablet")} title="Tablet" className={`grid h-7 w-7 place-items-center rounded-md transition ${previewSize === "tablet" ? "bg-white/[0.1] text-white" : "text-white/35 hover:text-white/65"}`}><Tablet className="h-4 w-4" /></button>
              <button onClick={() => setPreviewSize("mobile")} title="Móvil" className={`grid h-7 w-7 place-items-center rounded-md transition ${previewSize === "mobile" ? "bg-white/[0.1] text-white" : "text-white/35 hover:text-white/65"}`}><Smartphone className="h-4 w-4" /></button>
            </div>

            {/* GitHub button */}
            <GitHubButton
              appId={id}
              appTitle={app?.title ?? "app"}
              appDescription={app?.description ?? ""}
              githubRepoUrl={(app as any)?.githubRepoUrl}
              onSuccess={() => queryClient.invalidateQueries({ queryKey: getGetAppQueryKey(id) })}
            />

            {/* Share */}
            <button onClick={handleShare} className="inline-flex h-8 items-center gap-1.5 rounded-md border border-white/[0.07] bg-white/[0.04] px-3 text-[13px] font-semibold text-white/70 hover:bg-white/[0.07] hover:text-white transition">
              <Share2 className="h-3.5 w-3.5" />Share
            </button>

            {/* Deploy split button */}
            <div className="flex items-center">
              <button
                onClick={handleDeploy}
                disabled={deployMutation.isPending || !hasRenderableCode}
                className="inline-flex h-8 items-center gap-1.5 rounded-l-md bg-gradient-to-r from-[#7c3aed] to-[#9333ea] px-4 text-[13px] font-bold text-white hover:from-[#8b5cf6] hover:to-[#a855f7] disabled:opacity-50 transition"
              >
                {deployMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Rocket className="h-3.5 w-3.5" />}
                {deployMutation.isPending ? "Desplegando" : "Deploy"}
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

            {/* Maximize */}
            <button onClick={handleMaximizePreview} title={isPreviewMaximized ? "Restaurar" : "Maximizar"} className={`grid h-8 w-8 place-items-center rounded-md border border-white/[0.07] bg-white/[0.04] text-white/55 hover:bg-white/[0.08] hover:text-white transition ${isPreviewMaximized ? "border-[#7c3aed]/40 text-[#a78bfa]" : ""}`}>
              {isPreviewMaximized ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
            </button>
          </div>



          <div className="relative min-h-0 flex-1 overflow-hidden">
            {rightPanelTab === "code" ? (
              /* ─── Code view ─── */
              <div className="h-full overflow-auto bg-[#060810] p-6">
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
              /* ─── Preview view ─── */
              <>
                <button
                  type="button"
                  onClick={handleClosePreview}
                  aria-label="Cerrar vista previa"
                  title="Cerrar vista previa"
                  className="absolute right-4 top-4 z-20 grid h-9 w-9 place-items-center rounded-full border border-white/15 bg-[#070910]/85 text-white shadow-[0_8px_25px_rgba(0,0,0,0.45)] backdrop-blur transition hover:border-red-400/50 hover:bg-red-500/20"
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
                    />
                  )}
                </div>
                <div className="pointer-events-none absolute bottom-6 left-1/2 w-[620px] max-w-[calc(100%-4rem)] -translate-x-1/2">
                  <div className="pointer-events-auto flex h-[56px] items-center justify-between rounded-lg border border-white/[0.09] bg-[#0b0f18]/95 px-5 shadow-[0_12px_40px_rgba(0,0,0,0.45)] backdrop-blur-xl">
                    <div className="flex items-center gap-3 text-[13px] text-white/55">
                      <span className={`h-2 w-2 rounded-full ${hasRenderableCode ? "bg-emerald-400" : "bg-white/20"}`} />
                      <span>{showStaticBuildState ? "Esperando código renderizable…" : "Vista en vivo activa"}</span>
                    </div>
                    <button onClick={handleResumePreview} className="rounded-md border border-[#8b5cf6]/60 px-4 py-1.5 text-[13px] font-bold text-[#a78bfa] transition hover:bg-[#7c3aed]/10 hover:text-white">
                      {hasRenderableCode ? "Resume Preview" : "Cerrar preview"}
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        </main>
        )}
      </div>
    </div>

    {/* Account Settings Modal */}
    {showAccountSettings && (
      <div className="fixed inset-0 z-[300] flex items-center justify-center bg-black/70 backdrop-blur-sm" onClick={() => setShowAccountSettings(false)}>
        <div className="relative w-full max-w-3xl mx-4 rounded-2xl border border-white/[0.09] bg-[#0d0f1a] shadow-[0_32px_80px_rgba(0,0,0,0.7)] overflow-hidden" onClick={(e) => e.stopPropagation()} style={{ maxHeight: "85vh" }}>
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-white/[0.07]">
            <div>
              <h2 className="text-lg font-bold text-white">Configuración de cuenta</h2>
              <p className="text-xs text-white/40 mt-0.5">{user?.primaryEmailAddress?.emailAddress || me?.email}</p>
            </div>
            <button onClick={() => setShowAccountSettings(false)} className="grid h-8 w-8 place-items-center rounded-lg text-white/40 hover:bg-white/5 hover:text-white transition">
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="flex" style={{ height: "calc(85vh - 73px)" }}>
            {/* Sidebar tabs */}
            <div className="w-52 shrink-0 border-r border-white/[0.07] p-3 space-y-0.5 overflow-y-auto">
              {([
                { id: "personal", label: "Configuración personal", icon: Settings },
                { id: "apikey", label: "Clave universal", icon: Key },
                { id: "agents", label: "Gestionar agentes", icon: Users },
                { id: "preferences", label: "Preferencias", icon: Moon },
                { id: "billing", label: "Facturas y planes", icon: CreditCard },
                { id: "usage", label: "Uso de créditos", icon: Cpu },
              ] as const).map(({ id: tabId, label, icon: Icon }) => (
                <button
                  key={tabId}
                  onClick={() => setAccountSettingsTab(tabId)}
                  className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-[13px] font-medium transition text-left ${
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
            {/* Tab content */}
            <div className="flex-1 overflow-y-auto p-6">
              {accountSettingsTab === "personal" && (
                <div className="space-y-5">
                  <h3 className="text-base font-bold text-white">Información personal</h3>
                  <div className="flex items-center gap-4">
                    <Avatar className="h-16 w-16 border-2 border-white/10">
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
                      <p className="text-xs text-white/35 uppercase tracking-widest">Racha actual</p>
                      <p className="mt-2 text-2xl font-bold text-orange-400 flex items-center gap-2"><Flame className="h-5 w-5" />{(stats as any)?.streak ?? 1} días</p>
                    </div>
                    <div className="rounded-xl border border-white/[0.07] bg-white/[0.03] p-4">
                      <p className="text-xs text-white/35 uppercase tracking-widest">Créditos</p>
                      <p className="mt-2 text-2xl font-bold text-yellow-400 flex items-center gap-2"><Cpu className="h-5 w-5" />{isAdmin ? "∞" : credits}</p>
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
                      <div>
                        <p className="text-sm font-semibold text-white">Modo oscuro</p>
                        <p className="text-xs text-white/40">Interfaz oscura siempre activa</p>
                      </div>
                      <Switch checked={darkModeEnabled} onCheckedChange={setDarkModeEnabled} />
                    </div>
                    <div className="flex items-center justify-between rounded-xl border border-white/[0.07] bg-white/[0.03] px-4 py-3">
                      <div>
                        <p className="text-sm font-semibold text-white">Idioma</p>
                        <p className="text-xs text-white/40">Español (ES)</p>
                      </div>
                      <span className="text-sm font-bold text-white/60">ES</span>
                    </div>
                    <div className="flex items-center justify-between rounded-xl border border-white/[0.07] bg-white/[0.03] px-4 py-3">
                      <div>
                        <p className="text-sm font-semibold text-white">Notificaciones de agentes</p>
                        <p className="text-xs text-white/40">Avisar cuando un agente termina</p>
                      </div>
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
        isPremium={!!(me as any)?.isPremium}
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
