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
} from "@/lib/api-client";
import { useQueryClient } from "@tanstack/react-query";
import { DeployModal } from "@/components/deploy-modal";
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
} from "lucide-react";

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
  testing:      { label: "🧪 QA Specialist verificando errores…",              icon: Sparkles },
  patching:     { label: "🔧 DevOps Patcher auto-reparando errores…",           icon: Sparkles },
  validating:   { label: "🔍 Compilando el código en memoria…",                icon: Sparkles },
  fixing:       { label: "🔧 Auto-reparando errores detectados…",              icon: Sparkles },
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

const NAV_ITEMS: Array<{ id: SidebarTab; label: string; glyph: string }> = [
  { id: "chat", label: "Chat", glyph: "◌" },
  { id: "plan", label: "Plan", glyph: "□" },
  { id: "data", label: "Data", glyph: "▣" },
  { id: "integrations", label: "Integrations", glyph: "✦" },
  { id: "ui-builder", label: "UI Builder", glyph: "◇" },
  { id: "workflows", label: "Workflows", glyph: "⌘" },
  { id: "settings", label: "Settings", glyph: "⚙" },
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
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  const { data: app, isLoading } = useGetApp(id, {
    query: { enabled: !!id, queryKey: getGetAppQueryKey(id) },
  });
  const { data: me } = useGetMe();
  const isAdmin = !!me?.isAdmin;

  const { data: stats } = useGetMyStats();
  const credits = stats?.credits ?? 0;
  const outOfCredits = credits <= 0 && !isAdmin;

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
          {isWorking && job && (
            <div className="mt-8 rounded-2xl border border-[#7c3aed]/25 bg-[#7c3aed]/8 p-4 text-sm text-white/80">
              <div className="flex items-center gap-3">
                <PhaseIcon className="h-4 w-4 animate-pulse text-[#a78bfa]" />
                <span className="font-semibold">{phaseInfo.label}</span>
              </div>
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
            <>
              <Textarea value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="Pide cambios a Maris AI..." className="min-h-[92px] resize-none border-white/10 bg-white/[0.04] text-white placeholder:text-white/35" />
              <AttachmentChips attachments={chatAttachments} onRemove={(attachmentId) => setChatAttachments((items) => items.filter((item) => item.id !== attachmentId))} />
              <div className="flex items-center gap-3">
                <AttachmentPicker attachments={chatAttachments} onChange={setChatAttachments} disabled={sendMutation.isPending || isActivelyProcessing} />
                <Button onClick={handleSend} disabled={draft.trim().length < 2 || sendMutation.isPending || isActivelyProcessing} className="flex-1 bg-gradient-to-r from-[#7c3aed] to-[#9333ea] font-bold text-white hover:from-[#8b5cf6] hover:to-[#a855f7]">
                  {sendMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
                  Enviar
                </Button>
              </div>
            </>
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
        <div className="flex h-full items-center justify-between px-6">
          <div className="flex items-center gap-8">
            <MarisLogo />
            <button className="grid h-9 w-9 place-items-center rounded-lg border border-white/[0.065] bg-white/[0.04] text-white/60 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]">
              <span className="text-lg leading-none">⌘</span>
            </button>
          </div>
          <div className="flex items-center gap-5 text-white/70">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button type="button" aria-label="Abrir ayuda" className="grid h-8 w-8 place-items-center rounded-full hover:bg-white/5 hover:text-white">
                  <HelpCircle className="h-[19px] w-[19px]" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" forceMount className="z-[220] w-64 border-white/10 bg-[#0f1320] text-white">
                <DropdownMenuLabel>Ayuda de Maris AI</DropdownMenuLabel>
                <DropdownMenuSeparator className="bg-white/10" />
                <DropdownMenuItem onClick={handleOpenDocs} className="cursor-pointer focus:bg-white/10 focus:text-white">
                  <ExternalLink className="mr-2 h-4 w-4 text-white/55" />
                  Abrir documentación
                </DropdownMenuItem>
                <DropdownMenuItem onClick={handleOpenHelp} className="cursor-pointer focus:bg-white/10 focus:text-white">
                  <HelpCircle className="mr-2 h-4 w-4 text-white/55" />
                  Contactar soporte
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button type="button" aria-label="Abrir notificaciones" className="relative grid h-8 w-8 place-items-center rounded-full hover:bg-white/5 hover:text-white">
                  <Bell className="h-[19px] w-[19px]" />
                  <span className="absolute right-1 top-0 h-2 w-2 rounded-full bg-[#7c3aed]" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" forceMount className="z-[220] w-80 border-white/10 bg-[#0f1320] text-white">
                <DropdownMenuLabel>Notificaciones</DropdownMenuLabel>
                <DropdownMenuSeparator className="bg-white/10" />
                {notificationItems.map((item) => (
                  <DropdownMenuItem key={item.title} onSelect={(event) => event.preventDefault()} className="flex cursor-default flex-col items-start gap-1 whitespace-normal focus:bg-white/5 focus:text-white">
                    <span className="text-sm font-semibold text-white">{item.title}</span>
                    <span className="text-xs leading-relaxed text-white/55">{item.description}</span>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button type="button" aria-label="Abrir menú de perfil" className="flex items-center gap-2 rounded-full pl-1 pr-1.5 hover:bg-white/5">
                  <Avatar className="h-9 w-9 border border-white/10">
                    <AvatarImage src={user?.imageUrl} alt={user?.fullName || firstName} />
                    <AvatarFallback className="bg-gradient-to-br from-[#7c3aed] to-[#5b21b6] text-sm font-bold text-white">{user?.firstName?.charAt(0) || firstName.charAt(0) || "M"}</AvatarFallback>
                  </Avatar>
                  <ChevronDown className="h-4 w-4 text-white/45" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" forceMount className="z-[220] w-60 border-white/10 bg-[#0f1320] text-white">
                <DropdownMenuLabel className="font-normal">
                  <div className="flex flex-col space-y-1">
                    <p className="text-sm font-medium leading-none">{user?.fullName || me?.name || firstName}</p>
                    <p className="text-xs leading-none text-white/45">{user?.primaryEmailAddress?.emailAddress || me?.email || "Cuenta Maris AI"}</p>
                  </div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator className="bg-white/10" />
                <DropdownMenuItem onClick={() => setLocation("/dashboard")} className="cursor-pointer focus:bg-white/10 focus:text-white">
                  <LayoutDashboard className="mr-2 h-4 w-4 text-white/55" />
                  Panel
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setLocation("/billing")} className="cursor-pointer focus:bg-white/10 focus:text-white">
                  <CreditCard className="mr-2 h-4 w-4 text-white/55" />
                  Facturación
                </DropdownMenuItem>
                {isAdmin && (
                  <DropdownMenuItem onClick={() => setLocation("/admin")} className="cursor-pointer focus:bg-white/10 focus:text-white">
                    <Shield className="mr-2 h-4 w-4 text-[#a78bfa]" />
                    Panel admin
                  </DropdownMenuItem>
                )}
                <DropdownMenuSeparator className="bg-white/10" />
                <DropdownMenuItem onClick={() => signOut(() => setLocation("/"))} className="cursor-pointer focus:bg-white/10 focus:text-white">
                  <LogOut className="mr-2 h-4 w-4 text-white/55" />
                  Cerrar sesión
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <aside className="flex w-[102px] shrink-0 flex-col border-r border-white/[0.07] bg-[#070910]">
          <nav className="flex flex-1 flex-col items-center gap-7 pt-9">
            {NAV_ITEMS.map((item) => {
              const active = activeSidebar === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => handleSidebarClick(item.id)}
                  aria-pressed={active}
                  title={item.label}
                  className={`group relative flex w-full flex-col items-center gap-2 text-[13px] font-medium transition ${active ? "text-[#c084fc]" : "text-white/55 hover:text-white/80"}`}
                >
                  {active && <span className="absolute left-0 top-[-8px] h-[62px] w-1 rounded-r-full bg-[#7c3aed] shadow-[0_0_18px_rgba(124,58,237,0.8)]" />}
                  <span className={`grid h-8 w-8 place-items-center rounded-xl text-[22px] ${active ? "bg-[#7c3aed]/10 text-[#c084fc] shadow-[0_0_22px_rgba(124,58,237,0.7)]" : "text-white/50"}`}>{item.glyph}</span>
                  <span>{item.label}</span>
                </button>
              );
            })}
          </nav>
          <button className="m-4 mb-5 rounded-md bg-[#4f46e5] p-3 text-base font-bold text-white shadow-[0_0_22px_rgba(79,70,229,0.35)]">P</button>
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
          <div className="flex h-[69px] shrink-0 items-center justify-between border-b border-white/[0.07] bg-[#0a0d15] px-8">
            <div className="flex items-center gap-4 text-white/90">
              <div className="grid h-7 w-7 place-items-center text-white/65">
                <span className="text-3xl leading-none">▱</span>
              </div>
              <h1 className="text-[20px] font-bold tracking-tight">App Preview</h1>
            </div>
            <div className="flex items-center gap-3">
              <TopActionButton icon={Share2} label="Share" onClick={handleShare} />
              <TopActionButton icon={Rocket} label={deployMutation.isPending ? "Deploying" : "Deploy"} onClick={handleDeploy} disabled={deployMutation.isPending} />
              <TopActionButton icon={RefreshCcw} label="Refresh" onClick={handleRefreshPreview} />
              <button
                type="button"
                onClick={handlePublishGoogle}
                disabled={isPublishingGoogle || !hasRenderableCode}
                title="Publicar en Google — Indexa tu app en Google Search Console"
                className="inline-flex h-10 items-center gap-2 rounded-md border border-white/8 bg-white/[0.055] px-4 text-[13.5px] font-semibold text-white/75 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] transition hover:bg-white/[0.085] hover:text-white disabled:cursor-not-allowed disabled:opacity-45"
              >
                {isPublishingGoogle ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0" aria-hidden="true">
                    <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
                    <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
                    <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05" />
                    <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
                  </svg>
                )}
                Publicar en Google
              </button>
              <TopActionButton icon={Maximize2} label={isPreviewMaximized ? "Restore" : "Maximize"} onClick={handleMaximizePreview} active={isPreviewMaximized} />
            </div>
          </div>

          <div className="relative min-h-0 flex-1 overflow-hidden">
            <button
              type="button"
              onClick={handleClosePreview}
              aria-label="Cerrar vista previa en vivo"
              title="Cerrar vista previa en vivo"
              className="absolute right-5 top-5 z-20 grid h-11 w-11 place-items-center rounded-full border border-white/15 bg-[#070910]/85 text-2xl font-bold leading-none text-white shadow-[0_12px_35px_rgba(0,0,0,0.45)] backdrop-blur transition hover:border-red-400/50 hover:bg-red-500/20"
            >
              ×
            </button>
            {showStaticBuildState ? (
              <AppPreviewWaitingState />
            ) : deployedUrl ? (
              <iframe
                key={`deployed-${previewKey}`}
                src={deployedUrl}
                title="App Preview"
                sandbox="allow-scripts allow-same-origin allow-forms allow-modals allow-popups allow-popups-to-escape-sandbox"
                className="h-full w-full border-0 bg-white"
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

            <div className="pointer-events-none absolute bottom-9 left-1/2 w-[720px] max-w-[calc(100%-6rem)] -translate-x-1/2">
              <div className="pointer-events-auto flex h-[69px] items-center justify-between rounded-lg border border-white/[0.09] bg-[#0b0f18]/95 px-6 shadow-[0_18px_55px_rgba(0,0,0,0.45)] backdrop-blur-xl">
                <div className="flex items-center gap-4 text-[15px] text-white/65">
                  <Info className="h-5 w-5 text-white/60" />
                  <span>{showStaticBuildState ? "La app todavía no tiene código frontend renderizable." : "Vista en vivo activa. Usa Refrescar para recargar el último build."}</span>
                </div>
                <button onClick={handleResumePreview} className="rounded-md border border-[#8b5cf6]/70 px-5 py-2.5 text-[15px] font-bold text-[#a78bfa] transition hover:bg-[#7c3aed]/10 hover:text-white">
                  {hasRenderableCode ? "Resume Preview" : "Cerrar preview"}
                </button>
              </div>
            </div>
          </div>
        </main>
        )}
      </div>
    </div>

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
