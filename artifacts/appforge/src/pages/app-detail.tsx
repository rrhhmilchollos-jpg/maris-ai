import { useState, useEffect, useRef, useMemo } from "react";
import { useLocation } from "wouter";
import {
  useGetApp,
  useListAppMessages,
  useSendAppMessage,
  useGetGenerationJob,
  useGetMyStats,
  getGetAppQueryKey,
  getListAppMessagesQueryKey,
  getGetGenerationJobQueryKey,
  useGetMe,
  useApproveFacet,
  useDeployApp,
} from "@/lib/api-client";
import { useQueryClient } from "@tanstack/react-query";
import { SandpackProvider, SandpackPreview, SandpackLayout } from "@codesandbox/sandpack-react";
import { parseBundle, buildSandpackFiles, SANDPACK_DEPENDENCIES } from "@/lib/parseBundle";
import { Layout } from "@/components/layout";
import {
  AttachmentPicker,
  AttachmentChips,
  type UploadedAttachment,
} from "@/components/attachment-picker";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
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
} from "lucide-react";

const PHASE_LABELS: Record<string, { label: string; icon: any }> = {
  queued: { label: "En cola…", icon: Loader2 },
  starting: { label: "Inicializando equipo…", icon: Loader2 },
  researching: { label: "Investigando referencias…", icon: Sparkles },
  architecting: { label: "Arquitecto planificando…", icon: Sparkles },
  integrating: { label: "Definiendo integraciones…", icon: Sparkles },
  designing: { label: "Diseñador trabajando…", icon: Sparkles },
  generating: { label: "Aplicando cambios al código…", icon: Zap },
  reviewing: { label: "Revisión de calidad…", icon: Sparkles },
  validating: { label: "Compilando en memoria…", icon: Sparkles },
  fixing: { label: "Auto-reparación…", icon: Sparkles },
  parsing: { label: "Empaquetando archivos…", icon: Sparkles },
  ready: { label: "Listo", icon: Sparkles },
  failed: { label: "Error", icon: Sparkles },
};

const NAV_ITEMS = [
  { label: "Chat", active: true, glyph: "◌" },
  { label: "Plan", active: false, glyph: "□" },
  { label: "Data", active: false, glyph: "▣" },
  { label: "Integrations", active: false, glyph: "✦" },
  { label: "UI Builder", active: false, glyph: "◇" },
  { label: "Workflows", active: false, glyph: "⌘" },
  { label: "Settings", active: false, glyph: "⚙" },
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
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [draft, setDraft] = useState("");
  const [chatAttachments, setChatAttachments] = useState<UploadedAttachment[]>([]);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [previewKey, setPreviewKey] = useState(0);
  const [isPreviewMaximized, setIsPreviewMaximized] = useState(false);
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

  const { data: job } = useGetGenerationJob(activeJobId ?? "", {
    query: {
      enabled: !!activeJobId,
      queryKey: getGetGenerationJobQueryKey(activeJobId ?? ""),
      refetchInterval: (data: any) =>
        data?.status === "succeeded" || data?.status === "failed" ? false : 1000,
    },
  });

  const approveMutation = useApproveFacet({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetGenerationJobQueryKey(activeJobId ?? "") });
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
      setActiveJobId(null);
      toast({ title: "¡Cambios aplicados!", description: "La previsualización se ha actualizado." });
    } else if (job?.status === "failed") {
      setActiveJobId(null);
      toast({ title: "Error en la generación", description: job.error || "Algo salió mal", variant: "destructive" });
    }
  }, [job?.status, id, queryClient, job?.error, toast]);

  const sendMutation = useSendAppMessage({
    mutation: {
      onSuccess: (nextJob: any) => {
        setDraft("");
        setChatAttachments([]);
        setActiveJobId(nextJob.id);
        queryClient.invalidateQueries({ queryKey: getListAppMessagesQueryKey(id) });
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
    if (trimmed.length < 2 || sendMutation.isPending || activeJobId !== null) return;
    sendMutation.mutate({
      id,
      data: {
        message: trimmed,
        attachmentIds: chatAttachments.map((a: any) => a.id),
      },
    });
  };

  const handleApprove = () => {
    if (activeJobId && job?.status === "awaiting_approval") {
      approveMutation.mutate({ id: String(activeJobId), data: { facet: "structure" } });
      return;
    }
    toast({
      title: "Estructura lista",
      description: "La interfaz mantiene el estado visual de aprobación mientras Maris AI prepara la vista previa.",
    });
  };

  const phaseInfo = PHASE_LABELS[job?.phase ?? "queued"] ?? PHASE_LABELS.queued;
  const PhaseIcon = phaseInfo.icon;
  const isWorking = activeJobId !== null || job?.status === "awaiting_approval";
  const firstName = me?.name?.split(" ")?.[0] || me?.firstName || "Ivan";
  const assistantMessages = (messages ?? []).filter((msg: any) => msg.role !== "user");
  const latestAssistantMessage = assistantMessages[assistantMessages.length - 1]?.content;
  const frontendCode = String(app?.frontendCode ?? "").trim();
  const hasMilestonePlaceholder = frontendCode.includes("El código ha sido consolidado en disco por hitos");
  const hasRenderableCode = frontendCode.length >= 20 && !hasMilestonePlaceholder;
  const deployedUrl = app?.vercelDeployUrl || app?.deploymentUrl || (app?.marisaiSubdomain ? `https://${app.marisaiSubdomain}.marisai.es` : "");
  const sandpackFiles = useMemo(() => {
    if (!hasRenderableCode) return null;
    return buildSandpackFiles(parseBundle(frontendCode));
  }, [frontendCode, hasRenderableCode]);
  const showStaticBuildState = !hasRenderableCode || !sandpackFiles;

  const handleShare = async () => {
    const shareUrl = deployedUrl || (typeof window !== "undefined" ? window.location.href : "");
    try {
      if (typeof navigator !== "undefined" && navigator.share && deployedUrl) {
        await navigator.share({ title: app?.title || "Maris AI App", text: app?.description || "App generada con Maris AI", url: shareUrl });
      } else if (typeof navigator !== "undefined" && navigator.clipboard) {
        await navigator.clipboard.writeText(shareUrl);
        toast({ title: "Enlace copiado", description: deployedUrl ? "Se copió la URL pública de la app." : "Se copió el enlace de esta vista previa." });
      }
    } catch (err: any) {
      if (err?.name !== "AbortError") toast({ title: "No se pudo compartir", description: err?.message ?? "Error", variant: "destructive" });
    }
  };

  const handleDeploy = () => {
    if (!hasRenderableCode) {
      toast({ title: "Preview no lista", description: "La app todavía no tiene código frontend renderizable para desplegar.", variant: "destructive" });
      return;
    }
    deployMutation.mutate({ id });
  };

  const handleRefreshPreview = () => {
    queryClient.invalidateQueries({ queryKey: getGetAppQueryKey(id) });
    setPreviewKey((value) => value + 1);
    toast({ title: "Preview actualizado", description: "La vista previa se ha recargado con el último código guardado." });
  };

  const handleMaximizePreview = () => setIsPreviewMaximized((value) => !value);

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
            <button className="grid h-8 w-8 place-items-center rounded-full hover:bg-white/5 hover:text-white"><HelpCircle className="h-[19px] w-[19px]" /></button>
            <button className="relative grid h-8 w-8 place-items-center rounded-full hover:bg-white/5 hover:text-white">
              <Bell className="h-[19px] w-[19px]" />
              <span className="absolute right-1 top-0 h-2 w-2 rounded-full bg-[#7c3aed]" />
            </button>
            <button className="flex items-center gap-2 rounded-full pl-1 pr-1.5 hover:bg-white/5">
              <span className="grid h-9 w-9 place-items-center rounded-full bg-gradient-to-br from-[#7c3aed] to-[#5b21b6] text-sm font-bold text-white">M</span>
              <ChevronDown className="h-4 w-4 text-white/45" />
            </button>
          </div>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <aside className="flex w-[102px] shrink-0 flex-col border-r border-white/[0.07] bg-[#070910]">
          <nav className="flex flex-1 flex-col items-center gap-7 pt-9">
            {NAV_ITEMS.map((item) => (
              <button key={item.label} className={`group relative flex w-full flex-col items-center gap-2 text-[13px] font-medium transition ${item.active ? "text-[#c084fc]" : "text-white/55 hover:text-white/80"}`}>
                {item.active && <span className="absolute left-0 top-[-8px] h-[62px] w-1 rounded-r-full bg-[#7c3aed] shadow-[0_0_18px_rgba(124,58,237,0.8)]" />}
                <span className={`grid h-8 w-8 place-items-center rounded-xl text-[22px] ${item.active ? "bg-[#7c3aed]/10 text-[#c084fc] shadow-[0_0_22px_rgba(124,58,237,0.7)]" : "text-white/50"}`}>{item.glyph}</span>
                <span>{item.label}</span>
              </button>
            ))}
          </nav>
          <button className="m-4 mb-5 rounded-md bg-[#4f46e5] p-3 text-base font-bold text-white shadow-[0_0_22px_rgba(79,70,229,0.35)]">P</button>
        </aside>

        <section className="flex w-[590px] min-w-[430px] shrink-0 flex-col border-r border-white/[0.08] bg-[#080a12]">
          <div className="px-6 pt-6">
            <div className="rounded-lg border border-[#1d4ed8]/35 bg-[#0f2244]/70 px-24 py-3.5 text-center text-[15px] font-semibold text-[#60a5fa] shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]">
              <div className="flex items-center justify-center gap-3">
                <Info className="h-5 w-5" />
                <span>Agent will continue working after your reply</span>
              </div>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto px-8 py-10 custom-scrollbar">
            <div className="flex items-start gap-5">
              <div className="relative mt-1 shrink-0">
                <div className="absolute inset-0 rounded-full bg-[#7c3aed]/40 blur-xl" />
                <div className="relative grid h-[74px] w-[74px] place-items-center rounded-full border border-[#8b5cf6]/30 bg-[#111827] shadow-[0_0_30px_rgba(124,58,237,0.55)]">
                  <Bot className="h-10 w-10 text-white robot-vibrate" />
                </div>
              </div>
              <div className="space-y-2">
                <div className="rounded-lg border border-white/[0.07] bg-[#1b2230] px-5 py-4 text-[18px] leading-relaxed text-white/90 shadow-[0_12px_30px_rgba(0,0,0,0.2)]">
                  <p>He terminado la estructura!</p>
                  <p className="mt-3">Revisa el plan y dame el visto bueno</p>
                </div>
                <div className="pl-1">
                  <p className="text-[17px] font-bold text-[#a78bfa]">Maris AI</p>
                  <p className="mt-1 text-[14px] text-white/45">10:42 AM</p>
                </div>
              </div>
            </div>

            {latestAssistantMessage && (
              <div className="mt-8 rounded-2xl border border-white/8 bg-white/[0.035] p-4 text-sm leading-relaxed text-white/70">
                {latestAssistantMessage}
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

          <div className="px-6 pb-6">
            <Button
              size="lg"
              onClick={handleApprove}
              disabled={approveMutation.isPending}
              className="h-[64px] w-full rounded-lg bg-gradient-to-r from-[#7c3aed] to-[#9333ea] text-[17px] font-bold text-white shadow-[0_0_28px_rgba(124,58,237,0.55)] hover:from-[#8b5cf6] hover:to-[#a855f7]"
            >
              {approveMutation.isPending ? <Loader2 className="mr-4 h-6 w-6 animate-spin" /> : <Zap className="mr-4 h-7 w-7 fill-current" />}
              Aprobar y continuar
            </Button>
          </div>
        </section>

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
              <TopActionButton icon={Rocket} label={deployMutation.isPending ? "Deploying" : "Deploy"} onClick={handleDeploy} disabled={deployMutation.isPending || !hasRenderableCode} />
              <TopActionButton icon={RefreshCcw} label="Refresh" onClick={handleRefreshPreview} disabled={!hasRenderableCode} />
              <TopActionButton icon={Maximize2} label={isPreviewMaximized ? "Restore" : "Maximize"} onClick={handleMaximizePreview} active={isPreviewMaximized} />
            </div>
          </div>

          <div className="relative min-h-0 flex-1 overflow-hidden">
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
              <SandpackProvider
                key={`sandpack-${previewKey}`}
                template="react-ts"
                files={sandpackFiles ?? {}}
                customSetup={{ entry: "/index.tsx", dependencies: SANDPACK_DEPENDENCIES }}
                options={{ recompileMode: "delayed", recompileDelay: 400 }}
                theme="light"
              >
                <SandpackLayout style={{ height: "100%", width: "100%", border: "none", borderRadius: 0 }}>
                  <SandpackPreview
                    showNavigator={false}
                    showOpenInCodeSandbox={false}
                    showRefreshButton={false}
                    style={{ height: "100%", width: "100%", flex: 1, minWidth: 0 }}
                  />
                </SandpackLayout>
              </SandpackProvider>
            )}

            <div className="pointer-events-none absolute bottom-9 left-1/2 w-[720px] max-w-[calc(100%-6rem)] -translate-x-1/2">
              <div className="pointer-events-auto flex h-[69px] items-center justify-between rounded-lg border border-white/[0.09] bg-[#0b0f18]/95 px-6 shadow-[0_18px_55px_rgba(0,0,0,0.45)] backdrop-blur-xl">
                <div className="flex items-center gap-4 text-[15px] text-white/65">
                  <Info className="h-5 w-5 text-white/60" />
                  <span>{showStaticBuildState ? "La app todavía no tiene código frontend renderizable." : "You're viewing a live preview. Use Refresh to reload the latest build."}</span>
                </div>
                <button onClick={handleRefreshPreview} disabled={!hasRenderableCode} className="rounded-md border border-[#8b5cf6]/70 px-5 py-2.5 text-[15px] font-bold text-[#a78bfa] transition hover:bg-[#7c3aed]/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-45">
                  Resume Preview
                </button>
              </div>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
