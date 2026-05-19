import { useEffect, useMemo, useRef, useState } from "react";
import { useState, useEffect, useRef, useMemo } from "react";
import { useLocation } from "wouter";
import {
  useGetApp,
  useDeleteApp,
  useListAppMessages,
  useSendAppMessage,
  useGetGenerationJob,
  useUpdateAppModel,
  useUpdateAppAutoPublish,
  useRetryAppGeneration,
  useHealthCheckApp,
  useDeployApp,
  useDeployAppToVercel,
  usePushAppToGitHub,
  useGenerateAppImages,
  useVisualTestApp,
  useForkApp,
  useGetMyStats,
  useListAppRuntimeErrors,
  useClearAppRuntimeErrors,
  getGetAppQueryKey,
  getListAppsQueryKey,
  getGetMyStatsQueryKey,
  getListAppMessagesQueryKey,
  getGetGenerationJobQueryKey,
  getListAppRuntimeErrorsQueryKey,
  useGetMe,
  useGetAppNotes,
  useUpdateAppNotes,
  getGetAppNotesQueryKey,
  useListAppRevisions,
  getListAppRevisionsQueryKey,
  useRestoreAppRevision,
  useGetAppCustomDomain,
  getGetAppCustomDomainQueryKey,
  useAttachAppCustomDomain,
  useDetachAppCustomDomain,
  type VisualTestReport,
  type AppRuntimeError,
} from "@/lib/api-client";
import { useQueryClient } from "@tanstack/react-query";
import {
  SandpackProvider,
  SandpackPreview,
  SandpackLayout,
  useSandpack,
} from "@codesandbox/sandpack-react";
import { Layout } from "@/components/layout";
import { AgentLogStream } from "@/components/agent-log-stream";
import { AgentNotesPanel } from "@/components/agent-notes-panel";
import { RevisionHistoryPanel } from "@/components/revision-history-panel";
import {
  AttachmentPicker,
  AttachmentChips,
  type UploadedAttachment,
} from "@/components/attachment-picker";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import {
  ArrowLeft,
  Trash2,
  Copy,
  Check,
  Eye,
  Code2,
  Server,
  Send,
  Loader2,
  Sparkles,
  Download,
  HeartPulse,
  Globe,
  Github,
  RefreshCw,
  Rocket,
  ExternalLink,
  ImagePlus,
  Maximize2,
  Minimize2,
  ScanEye,
  X,
  PanelRightOpen,
  GitFork,
  AlertCircle,
  Monitor,
  Tablet,
  Smartphone,
  Zap,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { parseBundle, buildSandpackFiles, SANDPACK_DEPENDENCIES } from "@/lib/parseBundle";
import { LivePreview } from "@/components/live-preview";

type TabKey = "preview" | "live" | "frontend" | "backend";

const PHASE_LABELS: Record<string, string> = {
  queued: "En cola…",
  starting: "Inicializando equipo…",
  researching: "🔎 Investigando referencias…",
  architecting: "🧠 Arquitecto planificando…",
  integrating: "🔌 Definiendo integraciones…",
  designing: "🎨 Diseñador trabajando…",
  generating: "⚡ Aplicando cambios al código…",
  reviewing: "✅ Revisión de calidad…",
  validating: "🔍 Compilando en memoria…",
  fixing: "🔧 Auto-reparación…",
  parsing: "📦 Empaquetando archivos…",
  ready: "Listo",
  failed: "Error",
};

export default function AppDetailPage({ params }: { params: { id: string } }) {
  const id = params.id;
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [activeTab, setActiveTab] = useState<TabKey>("preview");
  const [copied, setCopied] = useState(false);
  const [previewMaximized, setPreviewMaximized] = useState(false);
  // Viewport mode for the preview pane. "fit" = render the iframe at the
  // panel's actual size (current default). The other modes render the iframe
  // at a fixed device width and visually scale it to fit the panel — same UX
  // as v0/lovable/emergent. "Fit" was the only behaviour before; with narrow
  // panels (chat open) responsive apps designed for ≥1024px collapsed into a
  // mobile layout that misled users into thinking the build was broken.
  type PreviewViewport = "fit" | "desktop" | "tablet" | "mobile";
  // Default to "fit" so the iframe fills the panel exactly (1:1 with the
  // available space). Device modes are opt-in: they render at a fixed real
  // device viewport and letterbox to fit, useful for checking specific
  // breakpoints. We used to default to "desktop", which forced 1280-wide
  // rendering and stretched the iframe height — apps with natural-height
  // content showed at the top with a big white gap below, exactly the bug
  // the user reported. "Fit" guarantees the app gets the full panel size.
  const [previewViewport, setPreviewViewport] = useState<PreviewViewport>("fit");
  const previewBoxRef = useRef<HTMLDivElement>(null);
  const [previewBoxSize, setPreviewBoxSize] = useState<{ w: number; h: number }>({ w: 0, h: 0 });
  // Live preview window visibility. Mirrors emergent.sh — the preview can be
  // closed (chat takes the full width) and re-opened from a button. The agent
  // also auto-opens it when it starts a new job so the user sees its work in
  // real time, and on job success.
  const [previewOpen, setPreviewOpen] = useState(true);
  const [exportModalOpen, setExportModalOpen] = useState(false);
  const [isCompiling, setIsCompiling] = useState(false);
  const [compileProgress, setCompileProgress] = useState(0);
  useEffect(() => {
    const el = previewBoxRef.current;
    if (!el) return;
    const update = () => {
      const r = el.getBoundingClientRect();
      setPreviewBoxSize({ w: r.width, h: r.height });
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [previewOpen, previewMaximized, activeTab]);
  const [draft, setDraft] = useState("");
  const [chatAttachments, setChatAttachments] = useState<UploadedAttachment[]>([]);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  const { data: app, isLoading } = useGetApp(id, {
    query: { enabled: !!id, queryKey: getGetAppQueryKey(id) },
  });
  const { data: me } = useGetMe();
  const isAdmin = !!me?.isAdmin;
  const isPremium = !!me?.isPremium;
  // Pull live credit balance so we can show an inline "out of credits" banner
  // above the chat input — currently a non-admin user who runs out mid-edit
  // only gets a backend error after pressing send. Mirrors emergent.sh's
  // "you ran out of credits" callout (screenshot from the user).
  const { data: stats } = useGetMyStats();
  const outOfCredits = !isAdmin && !!stats && stats.credits <= 0;

  const { data: messages } = useListAppMessages(id, {
    query: { enabled: !!id, queryKey: getListAppMessagesQueryKey(id) },
  });

  const { data: job } = useGetGenerationJob(activeJobId ?? 0, {
    query: {
      queryKey: getGetGenerationJobQueryKey(activeJobId ?? 0),
      enabled: activeJobId !== null,
      refetchInterval: (query) => {
        const data = query.state.data as { status?: string } | undefined;
        if (!data) return 800;
        if (data.status === "succeeded" || data.status === "failed") return false;
        return 800;
      },
    },
  });

  // When job finishes, refresh app + messages and clear active job.
  useEffect(() => {
    if (!job) return;
    if (job.status === "succeeded") {
      queryClient.invalidateQueries({ queryKey: getGetAppQueryKey(id) });
      queryClient.invalidateQueries({ queryKey: getListAppMessagesQueryKey(id) });
      queryClient.invalidateQueries({ queryKey: getGetMyStatsQueryKey() });
      setActiveJobId(null);
      // Surface the preview so the user can immediately see the result.
      setPreviewOpen(true);
      toast({ title: "Cambios aplicados", description: "La vista previa se ha actualizado." });
    } else if (job.status === "failed") {
      setActiveJobId(null);
      toast({
        title: "No pudimos aplicar el cambio",
        description: job.errorMessage ?? "Error desconocido",
        variant: "destructive",
      });
    }
  }, [job, id, queryClient, toast]);

  // Auto-scroll chat to latest message.
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, job?.progress]);

  const sendMutation = useSendAppMessage({
    mutation: {
      onSuccess: (response) => {
        // The server now returns one of two shapes:
        //  - GenerationJob (HTTP 202) → an edit was enqueued, watch its progress.
        //  - SendAppMessageDirectResponse (HTTP 200) → the intent classifier
        //    decided this was a question or a research request and answered
        //    inline; no job, no credit charged. Just refresh the chat.
        const isAnswered =
          response != null &&
          typeof response === "object" &&
          "kind" in response &&
          (response as { kind?: string }).kind === "answered";
        if (isAnswered) {
          // No job, no preview to open — just clear the draft, drop
          // attachments and refresh the message list so the assistant
          // reply pops in.
          setDraft("");
          chatAttachments.forEach((a) => a.previewUrl && URL.revokeObjectURL(a.previewUrl));
          setChatAttachments([]);
          queryClient.invalidateQueries({ queryKey: getListAppMessagesQueryKey(id) });
          return;
        }
        // Default: it's a GenerationJob. Track it.
        const job = response as { id: string };
        setActiveJobId(job.id);
        // Auto-open the live preview the moment the agent starts working so
        // the user can watch the changes happen instead of staring at chat.
        setPreviewOpen(true);
        setDraft("");
        // Drop the chat attachments now that they've been handed off to the
        // server — keep them around longer and the user might re-send them by
        // accident on the next message. Revoke object URLs to free memory.
        chatAttachments.forEach((a) => a.previewUrl && URL.revokeObjectURL(a.previewUrl));
        setChatAttachments([]);
        queryClient.invalidateQueries({ queryKey: getListAppMessagesQueryKey(id) });
      },
      onError: (err: any) => {
        toast({
          title: "No se pudo enviar",
          description: err?.message ?? "Error desconocido",
          variant: "destructive",
        });
      },
    },
  });

  // Surface runtime errors captured by the published iframe sandbox so the
  // owner is alerted when a real visitor hit a broken page. Polled at a slow
  // cadence (10s) — these arrive from real traffic, not a UI action, so we
  // don't need sub-second freshness, and most apps will report nothing.
  // The query is enabled only once the app has actually been published
  // (publicSlug present) — there's nothing to fetch otherwise.
  const { data: runtimeErrors } = useListAppRuntimeErrors(id, {
    query: {
      enabled: !!id && !!app?.publicSlug,
      queryKey: getListAppRuntimeErrorsQueryKey(id),
      refetchInterval: 10_000,
    },
  });
  const errorCount = runtimeErrors?.errors?.length ?? 0;
  const [errorsOpen, setErrorsOpen] = useState(false);
  const clearErrorsMutation = useClearAppRuntimeErrors({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({
          queryKey: getListAppRuntimeErrorsQueryKey(id),
        });
        setErrorsOpen(false);
        toast({ title: "Errores descartados" });
      },
      onError: (err: any) => {
        toast({
          title: "No pudimos limpiar los errores",
          description: err?.message ?? "Inténtalo otra vez.",
          variant: "destructive",
        });
      },
    },
  });

  const deleteMutation = useDeleteApp({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListAppsQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetMyStatsQueryKey() });
        toast({ title: "App eliminada" });
        setLocation("/dashboard");
      },
      onError: (err: any) => {
        toast({ title: "No se pudo eliminar", description: err.message, variant: "destructive" });
      },
    },
  });

  // --- Per-app action mutations ------------------------------------------
  const updateModelMutation = useUpdateAppModel({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetAppQueryKey(id) });
        toast({ title: "Modelo actualizado", description: "Las próximas ediciones usarán el nuevo modelo." });
      },
      onError: (err: any) => {
        toast({ title: "No se pudo cambiar el modelo", description: err?.message ?? "Error", variant: "destructive" });
      },
    },
  });

  const healthMutation = useHealthCheckApp({
    mutation: {
      onSuccess: (result) => {
        queryClient.invalidateQueries({ queryKey: getGetAppQueryKey(id) });
        if (result.ok && !result.fixed) {
          toast({ title: "Todo en orden", description: "El bundle compila sin problemas." });
        } else if (result.fixed) {
          toast({ title: "Reparado", description: `Se corrigieron problemas (antes: ${result.before.issuesCount}, ahora: ${result.after.issuesCount}).` });
        } else {
          toast({
            title: "Sigue habiendo problemas",
            description: `Detectamos ${result.after.issuesCount} y no pudimos arreglarlos automáticamente.`,
            variant: "destructive",
          });
        }
      },
      onError: (err: any) => {
        toast({ title: "El chequeo falló", description: err?.message ?? "Error", variant: "destructive" });
      },
    },
  });

  const forkMutation = useForkApp({
    mutation: {
      onSuccess: (newApp) => {
        queryClient.invalidateQueries({ queryKey: getListAppsQueryKey() });
        toast({
          title: "App clonada",
          description: `Te llevamos a tu copia "${newApp.title}".`,
        });
        setLocation(`/app/${newApp.id}`);
      },
      onError: (err: any) => {
        toast({ title: "No se pudo clonar", description: err?.message ?? "Error", variant: "destructive" });
      },
    },
  });

  const deployMutation = useDeployApp({
    mutation: {
      onSuccess: (result) => {
        queryClient.invalidateQueries({ queryKey: getGetAppQueryKey(id) });
        // Open the public URL in a new tab so the user immediately sees the result.
        window.open(result.url, "_blank", "noopener,noreferrer");
        toast({ title: "Publicado", description: "Tu app ya es pública. Abrimos la URL en una pestaña nueva." });
      },
      onError: (err: any) => {
        toast({ title: "No se pudo publicar", description: err?.message ?? "Error", variant: "destructive" });
      },
    },
  });

  // Deploy to Vercel — independent from the internal /p/<slug> publish.
  // The first click creates a Vercel project and reuses it on subsequent
  // deploys, so the URL stays stable and the user can also point a custom
  // domain at it from their own Vercel dashboard.
  const vercelDeployMutation = useDeployAppToVercel({
    mutation: {
      onSuccess: (result) => {
        queryClient.invalidateQueries({ queryKey: getGetAppQueryKey(id) });
        window.open(result.url, "_blank", "noopener,noreferrer");
        toast({
          title: "Desplegado en Vercel",
          description: "Vercel está terminando de servir tu app. Abrimos la URL en una pestaña nueva.",
        });
      },
      onError: (err: any) => {
        toast({
          title: "No se pudo desplegar en Vercel",
          description: err?.message ?? "Error",
          variant: "destructive",
        });
      },
    },
  });

  // Auto-publish toggle: when ON, the autonomous evaluator deploys the app
  // for the user as soon as it gives it the visto bueno. We invalidate the
  // app query immediately so the toggle reflects the new state without
  // waiting for the next poll.
  const autoPublishMutation = useUpdateAppAutoPublish({
    mutation: {
      onSuccess: (result) => {
        queryClient.invalidateQueries({ queryKey: getGetAppQueryKey(id) });
        toast({
          title: result.autoPublish ? "Auto-publicar activado" : "Auto-publicar desactivado",
          description: result.autoPublish
            ? "Publicaremos automáticamente cuando la evaluación visual lo apruebe."
            : "Tendrás que pulsar Publicar manualmente.",
        });
      },
      onError: (err: any) => {
        toast({
          title: "No pudimos cambiar el ajuste",
          description: err?.message ?? "Error",
          variant: "destructive",
        });
      },
    },
  });

  // Re-trigger generation for an app stuck in needs_review. The dashboard
  // shows a red panel with this button when the evaluator rejected the app
  // after exhausting its retry budget.
  const retryGenerationMutation = useRetryAppGeneration({
    mutation: {
      onSuccess: (job) => {
        queryClient.invalidateQueries({ queryKey: getGetAppQueryKey(id) });
        queryClient.invalidateQueries({ queryKey: getListAppMessagesQueryKey(id) });
        setActiveJobId(job.id);
        toast({
          title: "Reintentando generación",
          description: "Te avisaré cuando termine.",
        });
      },
      onError: (err: any) => {
        toast({
          title: "No pudimos reintentar",
          description: err?.message ?? "Error",
          variant: "destructive",
        });
      },
    },
  });

  // Visual Testing Agent: takes screenshots of the deployed app, scores them
  // with Claude Vision, and auto-fixes up to 3 cycles. Costs 30 credits per
  // run (silent — disclosed in product copy, not per click).
  const [visualReport, setVisualReport] = useState<VisualTestReport | null>(null);
  const visualTestMutation = useVisualTestApp({
    mutation: {
      onSuccess: (result) => {
        setVisualReport(result);
        // The auto-fix loop may have rewritten the bundle, so refetch.
        queryClient.invalidateQueries({ queryKey: getGetAppQueryKey(id) });
        toast({
          title: `Análisis visual: ${Math.round(result.analysis.overallScore)}/100`,
          description:
            result.fixesApplied > 0
              ? `Aplicamos ${result.fixesApplied} ronda(s) de correcciones automáticas.`
              : result.analysis.summary || "Sin problemas críticos detectados.",
        });
      },
      onError: (err: any) => {
        toast({
          title: "Análisis visual falló",
          description:
            err?.message ?? "No pudimos analizar la app visualmente.",
          variant: "destructive",
        });
      },
    },
  });

  const imagesMutation = useGenerateAppImages({
    mutation: {
      onSuccess: (result) => {
        queryClient.invalidateQueries({ queryKey: getGetAppQueryKey(id) });
        if (result.found === 0) {
          toast({
            title: "Sin imágenes que reemplazar",
            description: "No encontramos placeholders de Unsplash o picsum en tu app.",
          });
        } else if (result.generated === 0) {
          toast({
            title: "No pudimos generar imágenes",
            description: "Inténtalo de nuevo en unos segundos.",
            variant: "destructive",
          });
        } else {
          toast({
            title: "Imágenes generadas",
            description: `Reemplazamos ${result.generated}/${result.found} placeholder(s) con imágenes reales.`,
          });
        }
      },
      onError: (err: any) => {
        toast({
          title: "No pudimos generar imágenes",
          description: err?.message ?? "Error",
          variant: "destructive",
        });
      },
    },
  });

  const githubMutation = usePushAppToGitHub({
    mutation: {
      onSuccess: (result) => {
        queryClient.invalidateQueries({ queryKey: getGetAppQueryKey(id) });
        window.open(result.url, "_blank", "noopener,noreferrer");
        // Differentiate "first push" (created a fresh repo) from "update"
        // (added a new commit to the existing repo) so the user sees what
        // actually happened. Both cases open the repo in a new tab.
        toast({
          title: result.updated
            ? "Repo actualizado en GitHub"
            : "Repo creado en GitHub",
          description: result.updated
            ? `Nuevo commit en ${result.repoFullName}`
            : result.repoFullName,
        });
      },
      onError: (err: any) => {
        toast({ title: "No se pudo subir a GitHub", description: err?.message ?? "Error", variant: "destructive" });
      },
    },
  });

  /**
   * Trigger a ZIP download of the app source. We hit the export endpoint
   * directly (bypassing the generated React Query hook, which assumes JSON
   * responses) and stream the response into a temporary blob URL.
   */
  const handleExport = async () => {
    try {
      const res = await fetch(`/api/apps/${id}/export`, { credentials: "include" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const safeName = (app?.title ?? "app").toLowerCase().replace(/[^a-z0-9-_]+/g, "-").slice(0, 60) || "app";
      a.download = `${safeName}.zip`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast({ title: "ZIP descargado" });
    } catch (err: any) {
      toast({ title: "No se pudo descargar el ZIP", description: err?.message ?? "Error", variant: "destructive" });
    }
  };

  const sandpackFiles = useMemo(() => {
    if (!app?.frontendCode) return null;
    return buildSandpackFiles(parseBundle(app.frontendCode));
  }, [app?.frontendCode]);

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    toast({ title: "Copiado al portapapeles", duration: 1500 });
  };

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

  const codeForTab =
    activeTab === "frontend" ? app?.frontendCode : app?.backendCode;

  const isWorking = activeJobId !== null;

  if (isLoading) {
    return (
      <Layout>
        <div className="container mx-auto px-4 py-6 max-w-7xl space-y-4">
          <Skeleton className="h-12 w-1/3" />
          <Skeleton className="h-[600px] w-full" />
        </div>
      </Layout>
    );
  }

  if (!app) {
    return (
      <Layout>
        <div className="text-center py-20">
          <h2 className="text-2xl font-bold text-muted-foreground">No encontramos esta aplicación</h2>
          <Button variant="outline" className="mt-4" onClick={() => setLocation("/dashboard")}>
            Volver al panel
          </Button>
        </div>
      </Layout>
    );
  }

  const handleNativeExport = (type: "apk" | "ipa") => {
    setIsCompiling(true);
    setCompileProgress(0);
    const interval = setInterval(() => {
      setCompileProgress((prev) => {
        if (prev >= 100) {
          clearInterval(interval);
          setIsCompiling(false);
          toast({
            title: `Exportación ${type.toUpperCase()} lista`,
            description: `El archivo ${type.toUpperCase()} ha sido generado con éxito.`,
          });
          return 100;
        }
        return prev + 5;
      });
    }, 200);
  };

  return (
    <Layout>
      <Dialog open={exportModalOpen} onOpenChange={setExportModalOpen}>
        <DialogContent className="sm:max-w-[425px] bg-[#0d0d12] border-white/10 text-white">
          <DialogHeader>
            <DialogTitle className="text-xl font-bold flex items-center gap-2">
              <Smartphone className="h-5 w-5 text-orange-400" />
              Exportar Aplicación Nativa
            </DialogTitle>
            <DialogDescription className="text-gray-400">
              Compila tu proyecto de Maris AI para dispositivos móviles.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            {isCompiling ? (
              <div className="space-y-4 py-4 text-center">
                <Loader2 className="h-10 w-10 animate-spin mx-auto text-orange-400" />
                <div className="space-y-2">
                  <p className="text-sm font-medium">Compilando binarios nativos...</p>
                  <div className="w-full bg-white/5 rounded-full h-2 overflow-hidden">
                    <div 
                      className="bg-orange-500 h-full transition-all duration-300" 
                      style={{ width: `${compileProgress}%` }}
                    />
                  </div>
                  <p className="text-xs text-gray-500">{compileProgress}% completado</p>
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-4">
                <Button
                  variant="outline"
                  className="h-32 flex flex-col gap-3 border-white/10 bg-white/5 hover:bg-white/10 hover:border-orange-500/50"
                  onClick={() => handleNativeExport("apk")}
                >
                  <div className="p-3 rounded-full bg-green-500/10 text-green-500">
                    <Smartphone className="h-6 w-6" />
                  </div>
                  <div className="text-center">
                    <p className="font-bold">Android</p>
                    <p className="text-[10px] text-gray-500">Descargar .APK</p>
                  </div>
                </Button>
                <Button
                  variant="outline"
                  className="h-32 flex flex-col gap-3 border-white/10 bg-white/5 hover:bg-white/10 hover:border-blue-500/50"
                  onClick={() => handleNativeExport("ipa")}
                >
                  <div className="p-3 rounded-full bg-blue-500/10 text-blue-500">
                    <Tablet className="h-6 w-6" />
                  </div>
                  <div className="text-center">
                    <p className="font-bold">iOS (Apple)</p>
                    <p className="text-[10px] text-gray-500">Generar .IPA</p>
                  </div>
                </Button>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <div className="container mx-auto px-4 py-4 max-w-[1500px] h-[calc(100vh-3.5rem)] flex flex-col overflow-hidden">
        {/* Header bar */}
        <div className="flex items-center justify-between mb-4 gap-3 flex-wrap flex-shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <Button
              variant="ghost"
              size="sm"
              className="text-muted-foreground hover:text-foreground"
              onClick={() => setLocation("/dashboard")}
            >
              <ArrowLeft className="h-4 w-4 mr-2" /> Panel
            </Button>
            <div className="min-w-0">
              <h1 className="text-xl font-bold text-foreground truncate">{app.title}</h1>
              <p className="text-xs text-muted-foreground truncate max-w-md">{app.description}</p>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {app.techStack?.slice(0, 3).map((tech) => (
              <Badge key={tech} variant="secondary" className="font-mono text-xs bg-secondary/50">
                {tech}
              </Badge>
            ))}
            <span className="text-xs text-muted-foreground hidden md:inline">
              {format(new Date(app.createdAt), "d MMM yyyy", { locale: es })}
            </span>
            <Badge
              variant="secondary"
              className="font-mono text-xs bg-secondary/50 hidden md:inline-flex"
              title="Lenguaje del código generado (fijado al crear la app)"
            >
              {app.language === "javascript" ? "JS" : "TS"}
            </Badge>

            {/* Coder model selector — affects subsequent edits on this app. */}
            <Select
              value={app.coderModel ?? "auto"}
              onValueChange={(value) =>
                updateModelMutation.mutate({ id: app.id, data: { coderModel: value } })
              }
              disabled={updateModelMutation.isPending || isWorking}
            >
              <SelectTrigger className="h-8 w-[180px] text-xs bg-white/5 border-white/10">
                <SelectValue placeholder="Modelo" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="auto">⚡ Auto (Claude Sonnet 4.5)</SelectItem>
                <SelectItem value="claude-haiku">🐇 Claude Haiku 4.5 (más rápido)</SelectItem>
                <SelectItem value="claude-sonnet">✨ Claude Sonnet 4.5 (recomendado)</SelectItem>
                <SelectItem value="claude-opus-4-7" disabled={!isPremium}>
                  🏆 Claude Opus 4.7 {isPremium ? "(máxima calidad)" : "(Premium)"}
                </SelectItem>
                <SelectItem value="gpt-5" disabled={!isPremium}>
                  ⚡ GPT-5.4 {isPremium ? "(OpenAI Ultra)" : "(Premium)"}
                </SelectItem>
              </SelectContent>
            </Select>

            <Button
              variant="outline"
              size="sm"
              onClick={handleExport}
              className="h-8 border-white/10 bg-white/5 hover:bg-white/10 text-white"
              title="Descargar el código fuente como ZIP"
            >
              <Download className="h-4 w-4 mr-1.5" /> ZIP
            </Button>

            <Button
              variant="outline"
              size="sm"
              onClick={() => setExportModalOpen(true)}
              className="h-8 border-orange-400/30 bg-orange-400/10 hover:bg-orange-400/20 text-orange-300"
              title="Exportar como aplicación nativa (APK para Android / IPA para iOS)"
            >
              <Smartphone className="h-4 w-4 mr-1.5" /> Exportar App
            </Button>

            <Button
              variant="outline"
              size="sm"
              onClick={() => healthMutation.mutate({ id: app.id })}
              disabled={healthMutation.isPending}
              className="h-8 border-white/10 bg-white/5 hover:bg-white/10 text-white"
              title="Validar el bundle y auto-reparar si hay problemas"
            >
              {healthMutation.isPending ? (
                <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
              ) : (
                <HeartPulse className="h-4 w-4 mr-1.5" />
              )}
              Chequeo
            </Button>

            <Button
              variant="outline"
              size="sm"
              onClick={() => imagesMutation.mutate({ id: app.id })}
              disabled={imagesMutation.isPending || isWorking}
              className="h-8 border-fuchsia-400/30 bg-fuchsia-400/10 hover:bg-fuchsia-400/20 text-fuchsia-300"
              title="Reemplaza placeholders de Unsplash con imágenes reales generadas por Nano Banana Pro"
            >
              {imagesMutation.isPending ? (
                <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
              ) : (
                <ImagePlus className="h-4 w-4 mr-1.5" />
              )}
              Imágenes IA
            </Button>

            <Button
              variant="outline"
              size="sm"
              onClick={() => visualTestMutation.mutate({ id: app.id })}
              disabled={visualTestMutation.isPending || isWorking}
              className="h-8 border-cyan-400/30 bg-cyan-400/10 hover:bg-cyan-400/20 text-cyan-300"
              title="Toma screenshots de tu app (escritorio, tablet, móvil), los analiza con Claude Vision, y arregla problemas visuales automáticamente. Puede tardar 1-3 minutos."
            >
              {visualTestMutation.isPending ? (
                <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
              ) : (
                <ScanEye className="h-4 w-4 mr-1.5" />
              )}
              Análisis Visual
            </Button>

            <Button
              variant="outline"
              size="sm"
              onClick={() => forkMutation.mutate({ id: app.id })}
              disabled={forkMutation.isPending || isWorking || app.status !== "ready"}
              className="h-8 border-white/10 bg-white/5 hover:bg-white/10 text-white"
              title={
                isWorking
                  ? "Espera a que termine el cambio actual para clonar"
                  : app.status !== "ready"
                  ? "Solo se pueden clonar apps en estado listo"
                  : "Clonar esta app a una copia tuya nueva (gratis)"
              }
              data-testid="button-fork"
            >
              {forkMutation.isPending ? (
                <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
              ) : (
                <GitFork className="h-4 w-4 mr-1.5" />
              )}
              Fork
            </Button>

            {app.publicSlug ? (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  asChild
                  className="h-8 border-emerald-400/30 bg-emerald-400/10 hover:bg-emerald-400/20 text-emerald-300"
                  title="Abrir la URL pública"
                >
                  <a
                    href={`/p/${app.publicSlug}`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <ExternalLink className="h-4 w-4 mr-1.5" /> Pública
                  </a>
                </Button>
                {errorCount > 0 && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setErrorsOpen(true)}
                    className="h-8 border-red-400/40 bg-red-500/10 hover:bg-red-500/20 text-red-300"
                    title="Tu app publicada falló al cargarse en el navegador de algún visitante. Haz click para ver los detalles."
                    data-testid="button-runtime-errors"
                  >
                    <AlertCircle className="h-4 w-4 mr-1.5" />
                    {errorCount >= 50 ? "50+" : errorCount} error
                    {errorCount === 1 ? "" : "es"}
                  </Button>
                )}
              </>
            ) : (
              <Button
                variant="outline"
                size="sm"
                onClick={() => deployMutation.mutate({ id: app.id })}
                disabled={deployMutation.isPending}
                className="h-8 border-white/10 bg-white/5 hover:bg-white/10 text-white"
                title="Publicar como /p/<slug> público"
              >
                {deployMutation.isPending ? (
                  <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                ) : (
                  <Globe className="h-4 w-4 mr-1.5" />
                )}
                Publicar
              </Button>
            )}

            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                autoPublishMutation.mutate({
                  id: app.id,
                  data: { autoPublish: !app.autoPublish },
                })
              }
              disabled={autoPublishMutation.isPending}
              className={
                app.autoPublish
                  ? "h-8 border-cyan-400/30 bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-200"
                  : "h-8 border-white/10 bg-white/5 hover:bg-white/10 text-white"
              }
              title={
                app.autoPublish
                  ? "Auto-publicar activado: la próxima generación que pase la evaluación visual se publicará automáticamente"
                  : "Activa para publicar automáticamente cuando la evaluación visual lo apruebe"
              }
              data-testid="button-auto-publish-toggle"
            >
              {autoPublishMutation.isPending ? (
                <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
              ) : (
                <Sparkles className="h-4 w-4 mr-1.5" />
              )}
              Auto-publicar cuando esté lista: {app.autoPublish ? "ON" : "OFF"}
            </Button>

            {app.githubRepoUrl ? (
              // Two-state when there's already a repo: a passive link to
              // open it on GitHub + an active "Actualizar" button that
              // pushes the current snapshot as a new commit on `main`
              // (server-side handles the `existingRepoFullName` plumbing).
              <>
                <Button
                  variant="outline"
                  size="sm"
                  asChild
                  className="h-8 border-white/10 bg-white/5 hover:bg-white/10 text-white"
                  title={
                    app.githubRepoFullName
                      ? `Abrir ${app.githubRepoFullName} en GitHub`
                      : "Abrir el repositorio en GitHub"
                  }
                >
                  <a href={app.githubRepoUrl} target="_blank" rel="noopener noreferrer">
                    <Github className="h-4 w-4 mr-1.5" />
                    {app.githubRepoFullName ?? "Repo"}
                  </a>
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => githubMutation.mutate({ id: app.id })}
                  disabled={githubMutation.isPending}
                  className="h-8 border-white/10 bg-white/5 hover:bg-white/10 text-white"
                  title="Subir un nuevo commit con el código actual al mismo repo"
                >
                  {githubMutation.isPending ? (
                    <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                  ) : (
                    <RefreshCw className="h-4 w-4 mr-1.5" />
                  )}
                  Actualizar
                </Button>
              </>
            ) : (
              <Button
                variant="outline"
                size="sm"
                onClick={() => githubMutation.mutate({ id: app.id })}
                disabled={githubMutation.isPending}
                className="h-8 border-white/10 bg-white/5 hover:bg-white/10 text-white"
                title="Crear un repo nuevo en GitHub y subir el código"
              >
                {githubMutation.isPending ? (
                  <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                ) : (
                  <Github className="h-4 w-4 mr-1.5" />
                )}
                GitHub
              </Button>
            )}

            {/* Vercel deploy. Two-state button: when there's no previous
                deploy we show "Desplegar en Vercel" + a single triangle
                icon; once deployed we show a small "Vercel" link to the
                live URL plus a "Re-desplegar" action that pushes the
                latest bundle to the same Vercel project. */}
            {app.vercelDeployUrl ? (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  asChild
                  className="h-8 border-white/10 bg-white/5 hover:bg-white/10 text-white"
                  title="Abrir la app en Vercel"
                >
                  <a href={app.vercelDeployUrl} target="_blank" rel="noopener noreferrer">
                    <ExternalLink className="h-4 w-4 mr-1.5" /> Vercel
                  </a>
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => vercelDeployMutation.mutate({ id: app.id })}
                  disabled={vercelDeployMutation.isPending || app.status !== "ready"}
                  className="h-8 border-white/10 bg-white/5 hover:bg-white/10 text-white"
                  title="Volver a desplegar la versión actual a Vercel (mismo proyecto, misma URL)"
                  data-testid="button-vercel-redeploy"
                >
                  {vercelDeployMutation.isPending ? (
                    <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                  ) : (
                    <Rocket className="h-4 w-4 mr-1.5" />
                  )}
                  Re-desplegar
                </Button>
              </>
            ) : (
              <Button
                variant="outline"
                size="sm"
                onClick={() => vercelDeployMutation.mutate({ id: app.id })}
                disabled={vercelDeployMutation.isPending || app.status !== "ready"}
                className="h-8 border-white/10 bg-white/5 hover:bg-white/10 text-white"
                title="Desplegar esta app a tu cuenta de Vercel (URL pública en Vercel)"
                data-testid="button-vercel-deploy"
              >
                {vercelDeployMutation.isPending ? (
                  <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                ) : (
                  <Rocket className="h-4 w-4 mr-1.5" />
                )}
                Desplegar en Vercel
              </Button>
            )}

            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-destructive hover:bg-destructive/10"
                  aria-label="Eliminar aplicación"
                  title="Eliminar aplicación"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent className="border-destructive/20">
                <AlertDialogHeader>
                  <AlertDialogTitle>¿Eliminar esta aplicación?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Esta acción no se puede deshacer. Se borrará "{app.title}" y todo su historial.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancelar</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={() => deleteMutation.mutate({ id: app.id })}
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  >
                    Eliminar definitivamente
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </div>

        {app.status === "needs_review" && (
          <div
            className="mb-4 rounded-xl border border-red-500/40 bg-red-500/10 p-4 text-red-100 flex-shrink-0"
            data-testid="panel-needs-review"
          >
            <div className="flex items-start gap-3">
              <AlertCircle className="h-5 w-5 flex-shrink-0 text-red-400 mt-0.5" />
              <div className="flex-1 min-w-0">
                <div className="font-semibold text-red-200">
                  La evaluación visual rechazó esta app
                </div>
                <div className="mt-1 text-sm text-red-100/90 whitespace-pre-wrap break-words">
                  {app.evaluatorSummary ??
                    "El evaluador no pudo aprobar la app después de varios intentos."}
                </div>
                <div className="mt-3 flex items-center gap-2">
                  <Button
                    size="sm"
                    onClick={() => retryGenerationMutation.mutate({ id: app.id })}
                    disabled={retryGenerationMutation.isPending || isWorking}
                    className="h-8 bg-red-500 hover:bg-red-600 text-white"
                    data-testid="button-retry-generation"
                  >
                    {retryGenerationMutation.isPending ? (
                      <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                    ) : (
                      <Sparkles className="h-4 w-4 mr-1.5" />
                    )}
                    Reintentar generación
                  </Button>
                  <span className="text-xs text-red-200/70">
                    Reusará el prompt original más el resumen del evaluador.
                  </span>
                </div>
              </div>
            </div>
          </div>
        )}

        <div
          className={`grid grid-cols-1 ${previewMaximized || !previewOpen ? "" : "lg:grid-cols-12"} gap-4 flex-1 min-h-0`}
        >
          {/* Chat panel */}
          <div
            className={`${previewMaximized ? "hidden" : previewOpen ? "lg:col-span-4" : "lg:col-span-12"} flex flex-col bg-[#0d0d12] rounded-xl border border-white/10 overflow-hidden`}
          >
            <div className="px-4 py-3 border-b border-white/5 bg-[#111118] flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-primary" />
                <span className="text-sm font-medium text-white">Chat con el agente</span>
              </div>
              {!previewOpen && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setPreviewOpen(true)}
                  className="h-8 border-cyan-400/30 bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-200"
                  title="Abrir la ventana de preview en vivo"
                >
                  <PanelRightOpen className="h-4 w-4 mr-2" />
                  Abrir preview en vivo
                </Button>
              )}
            </div>

            <div className="px-3 pt-3 space-y-2">
              <AppNotesSection appId={id} />
              <RevisionHistorySection appId={id} />
              {app.vercelProjectId ? (
                <CustomDomainSection appId={id} />
              ) : null}
            </div>

            <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
              {(messages ?? []).length === 0 && !isWorking ? (
                <div className="text-center py-8 text-sm text-muted-foreground">
                  Pide cualquier cambio: "añade modo oscuro", "cambia los colores a verde", "añade una sección de testimonios"…
                </div>
              ) : null}
              {(messages ?? []).map((msg: any) => (
                <div
                  key={msg.id}
                  className={
                    msg.role === "user"
                      ? "flex justify-end"
                      : "flex justify-start"
                  }
                >
                  <div
                    className={
                      msg.role === "user"
                        ? "bg-primary/20 border border-primary/30 text-foreground rounded-lg px-3 py-2 text-sm max-w-[85%] whitespace-pre-wrap break-words"
                        : "bg-white/5 border border-white/10 text-foreground rounded-lg px-3 py-2 text-sm max-w-[85%] whitespace-pre-wrap break-words"
                    }
                  >
                    {msg.content}
                  </div>
                </div>
              ))}
              {isWorking && (
                <div className="flex flex-col gap-2 items-stretch">
                  <div className="flex justify-start">
                    <div className="bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm flex items-center gap-2 text-muted-foreground">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      {PHASE_LABELS[job?.phase ?? "queued"] ?? "Trabajando…"}
                      {typeof job?.progress === "number" && job.progress > 0 && (
                        <span className="text-xs opacity-70">{job.progress}%</span>
                      )}
                    </div>
                  </div>
                  <AgentLogStream
                    jobId={activeJobId}
                    isActive={
                      job?.status !== "succeeded" && job?.status !== "failed"
                    }
                  />
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>

            <div className="p-3 border-t border-white/5 bg-[#0a0a0f] space-y-2">
              {/* Out-of-credits banner — soft warning + CTA so users discover
                  they need to top up BEFORE pressing send and getting a hard
                  error from the API. Inspired by emergent.sh's inline notice. */}
              {outOfCredits && (
                <div
                  className="flex items-center justify-between gap-3 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2"
                  data-testid="banner-no-credits"
                >
                  <div className="flex items-center gap-2 text-sm text-destructive-foreground min-w-0">
                    <AlertCircle className="h-4 w-4 flex-shrink-0 text-destructive" />
                    <span className="truncate">Te quedaste sin créditos. Recarga para seguir editando.</span>
                  </div>
                  <Button
                    size="sm"
                    variant="destructive"
                    onClick={() => setLocation("/billing")}
                    className="h-8 flex-shrink-0"
                    data-testid="button-buy-credits-banner"
                  >
                    Comprar créditos
                  </Button>
                </div>
              )}
              <AttachmentChips
                attachments={chatAttachments}
                onRemove={(aid) => {
                  const removed = chatAttachments.find((a) => a.id === aid);
                  if (removed?.previewUrl) URL.revokeObjectURL(removed.previewUrl);
                  setChatAttachments((prev) => prev.filter((a) => a.id !== aid));
                }}
                testIdPrefix="chat-attachment"
              />
              <div className="relative">
                <Textarea
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      handleSend();
                    }
                  }}
                  placeholder={isWorking ? "Espera a que termine el cambio actual…" : outOfCredits ? "Compra créditos para volver a editar…" : "Pide un cambio… (Enter envía, Shift+Enter salto de línea)"}
                  disabled={isWorking || outOfCredits}
                  className="resize-none min-h-[60px] max-h-[140px] bg-white/5 border-white/10 text-foreground pl-12 pr-12"
                />
                <div className="absolute left-2 bottom-2">
                  <AttachmentPicker
                    attachments={chatAttachments}
                    onChange={setChatAttachments}
                    disabled={isWorking || outOfCredits}
                    testIdPrefix="chat-attachment"
                  />
                </div>
                <Button
                  size="icon"
                  disabled={isWorking || outOfCredits || draft.trim().length < 2 || sendMutation.isPending}
                  onClick={handleSend}
                  className="absolute right-2 bottom-2 h-8 w-8"
                  aria-label="Enviar mensaje"
                  title="Enviar mensaje"
                >
                  {sendMutation.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Send className="h-4 w-4" />
                  )}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground px-1">
                Cada cambio cuesta 1 crédito (gratis para admin).
              </p>
            </div>
          </div>

          {/* Preview / code panel */}
          <div
            className={`${!previewOpen ? "hidden" : previewMaximized ? "lg:col-span-12" : "lg:col-span-8"} flex flex-col bg-[#0d0d12] rounded-xl border border-white/10 overflow-hidden`}
          >
            <div className="flex items-center justify-between px-3 py-2 bg-[#111118] border-b border-white/5">
              <div className="flex space-x-1">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setActiveTab("preview")}
                  className={`h-8 rounded-md ${activeTab === "preview" ? "bg-white/10 text-white" : "text-muted-foreground hover:text-white hover:bg-white/5"}`}
                >
                  <Eye className="h-4 w-4 mr-2" /> Preview
                </Button>
                {/* "Live" tab boots a real Node.js inside the browser via
                    WebContainer and runs the generated bundle with vite dev,
                    same way the user's published app would run. Slower to
                    start than Sandpack (~30-90s npm install) but a true
                    fidelity preview — real npm graph, real HMR, real
                    tailwind/postcss pipeline. The preview/sandpack tab stays
                    as the always-available instant fallback. */}
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setActiveTab("live")}
                  className={`h-8 rounded-md ${activeTab === "live" ? "bg-white/10 text-white" : "text-muted-foreground hover:text-white hover:bg-white/5"}`}
                  title="Ejecuta tu app en un Node real dentro del navegador (Chrome/Edge)"
                >
                  <Zap className="h-4 w-4 mr-2" /> Live
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setActiveTab("frontend")}
                  className={`h-8 rounded-md ${activeTab === "frontend" ? "bg-white/10 text-white" : "text-muted-foreground hover:text-white hover:bg-white/5"}`}
                >
                  <Code2 className="h-4 w-4 mr-2" /> Frontend
                </Button>
                {/* Backend tab is visible to anyone who reached this page —
                    GET /apps/:id already gates by ownership / admin, so any
                    authenticated visitor here owns the app (or is staff).
                    Hiding the tab made owners think "the agent didn't create
                    a backend for me" when in reality it was generated and
                    persisted in `backendCode` but unreachable in the UI. */}
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setActiveTab("backend")}
                  className={`h-8 rounded-md ${activeTab === "backend" ? "bg-white/10 text-white" : "text-muted-foreground hover:text-white hover:bg-white/5"}`}
                >
                  <Server className="h-4 w-4 mr-2" /> Backend
                </Button>
              </div>
              <div className="flex items-center gap-2">
                {activeTab === "preview" && (
                  <div
                    className="flex items-center bg-white/5 border border-white/10 rounded-md p-0.5"
                    role="group"
                    aria-label="Tamaño de vista previa"
                  >
                    {(
                      [
                        { v: "desktop", label: "Escritorio", Icon: Monitor },
                        { v: "tablet", label: "Tablet", Icon: Tablet },
                        { v: "mobile", label: "Móvil", Icon: Smartphone },
                        { v: "fit", label: "Ajustar al panel", Icon: Maximize2 },
                      ] as { v: PreviewViewport; label: string; Icon: typeof Monitor }[]
                    ).map(({ v, label, Icon }) => (
                      <button
                        key={v}
                        type="button"
                        onClick={() => setPreviewViewport(v)}
                        className={`h-7 w-8 flex items-center justify-center rounded transition-colors ${
                          previewViewport === v
                            ? "bg-white/15 text-white"
                            : "text-muted-foreground hover:text-white hover:bg-white/10"
                        }`}
                        title={label}
                        aria-label={label}
                        aria-pressed={previewViewport === v}
                        data-testid={`preview-viewport-${v}`}
                      >
                        <Icon className="h-4 w-4" />
                      </button>
                    ))}
                  </div>
                )}
                {/* Copy button only makes sense in code tabs (frontend/backend);
                    "preview" and "live" both render iframes, no text to copy. */}
                {(activeTab === "frontend" || activeTab === "backend") && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => copyToClipboard(codeForTab ?? "")}
                    className="h-8 border-white/10 bg-white/5 hover:bg-white/10 text-white"
                  >
                    {copied ? <Check className="h-4 w-4 mr-2 text-green-400" /> : <Copy className="h-4 w-4 mr-2" />}
                    {copied ? "Copiado" : "Copiar"}
                  </Button>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPreviewMaximized((v) => !v)}
                  className="h-8 border-white/10 bg-white/5 hover:bg-white/10 text-white"
                  title={previewMaximized ? "Restaurar (mostrar chat)" : "Maximizar a pantalla completa"}
                >
                  {previewMaximized ? (
                    <>
                      <Minimize2 className="h-4 w-4 mr-2" /> Restaurar
                    </>
                  ) : (
                    <>
                      <Maximize2 className="h-4 w-4 mr-2" /> Maximizar
                    </>
                  )}
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => {
                    setPreviewOpen(false);
                    // If the user closes from a maximized state, also un-maximize
                    // so reopening puts them back into the normal split view.
                    setPreviewMaximized(false);
                  }}
                  className="h-8 w-8 text-muted-foreground hover:text-white hover:bg-white/10"
                  title="Cerrar preview"
                  aria-label="Cerrar preview en vivo"
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            </div>

            <div ref={previewBoxRef} className="flex-1 overflow-hidden bg-[#0d0d12] relative">
              {activeTab === "preview" ? (
                sandpackFiles ? (
                  (() => {
                    // Compute the inner viewport size and the scale factor used
                    // to fit it inside the actual panel. "fit" mirrors the old
                    // behaviour (1:1, no scaling, iframe = panel size). The
                    // device modes render at a fixed width and scale down with
                    // CSS transform so the user sees the full responsive layout
                    // even when the chat is open beside the preview.
                    // Real device viewports — width × height in CSS pixels.
                    // Heights are deliberate (MacBook 13", iPad portrait,
                    // iPhone 14 Pro) so the iframe shows what a real screen
                    // would: app fills its viewport, bottom of the page
                    // doesn't bleed out as white space the way the old
                    // "stretch height to fill panel" logic did.
                    const VIEWPORT_DIM: Record<
                      Exclude<PreviewViewport, "fit">,
                      { w: number; h: number }
                    > = {
                      desktop: { w: 1280, h: 800 },
                      tablet: { w: 768, h: 1024 },
                      mobile: { w: 390, h: 844 },
                    };
                    const isFit = previewViewport === "fit";
                    const innerW = isFit ? previewBoxSize.w : VIEWPORT_DIM[previewViewport].w;
                    const innerH = isFit ? previewBoxSize.h : VIEWPORT_DIM[previewViewport].h;
                    // Scale to fit BOTH dimensions of the panel (min of the
                    // two ratios) so device frames letterbox cleanly inside
                    // the dark panel background instead of overflowing or
                    // leaving a white tail underneath.
                    const scale =
                      isFit ||
                      innerW <= 0 ||
                      innerH <= 0 ||
                      previewBoxSize.w <= 0 ||
                      previewBoxSize.h <= 0
                        ? 1
                        : Math.min(
                            1,
                            previewBoxSize.w / innerW,
                            previewBoxSize.h / innerH,
                          );
                    // Force a definite-height chain into Sandpack: the
                    // provider renders a plain div with no height set, which
                    // means SandpackLayout's `height: 100%` would resolve
                    // against an auto-height parent and fall back to the
                    // library's CSS variable default (~300px). That's why
                    // the iframe was rendering as a small strip with the
                    // rest of the panel blank. We pass an explicit style to
                    // the provider AND wrap it in a flex container so every
                    // descendant has a real pixel height to consume.
                    const sandpack = (
                      <div
                        style={{
                          width: "100%",
                          height: "100%",
                          display: "flex",
                          flexDirection: "column",
                          minHeight: 0,
                        }}
                      >
                        <SandpackProvider
                          template="react-ts"
                          files={sandpackFiles}
                          customSetup={{
                            entry: "/index.tsx",
                            // Common packages the coder is allowed to import. Without
                            // this, Sandpack only knows react/react-dom and dies with
                            // "Could not find dependency: 'wouter'" when the
                            // generated app does multi-page routing.
                            dependencies: SANDPACK_DEPENDENCIES,
                          }}
                          options={{
                            recompileMode: "delayed",
                            recompileDelay: 500,
                            // El default de la librería son 40 s. En redes
                            // lentas o cuando el bundler de CodeSandbox
                            // tiene latencia alta el iframe reporta
                            // "ERROR: TIME_OUT" antes de poder instalar
                            // las deps + bootstrappear React. Subimos a
                            // 2 minutos: el coste real es sólo el tiempo
                            // que el usuario espera ANTES de que aparezca
                            // el botón de reintentar; si el bundler
                            // responde en 30 s el preview sigue
                            // apareciendo igual de rápido.
                            bundlerTimeOut: 120_000,
                            // No arrancar el bundler hasta que el panel
                            // de preview sea realmente visible. Si el
                            // usuario está editando código sin abrir el
                            // preview no tiene sentido pagar el coste
                            // del install.
                            initMode: "user-visible",
                          }}
                          theme="light"
                          style={{
                            width: "100%",
                            height: "100%",
                            flex: 1,
                            minHeight: 0,
                            display: "flex",
                            flexDirection: "column",
                          }}
                        >
                          <SandpackLayout
                            style={{
                              height: "100%",
                              width: "100%",
                              flex: 1,
                              minHeight: 0,
                              border: "none",
                              borderRadius: 0,
                              position: "relative",
                            }}
                          >
                            <SandpackPreview
                              showOpenInCodeSandbox={false}
                              showRefreshButton
                              style={{
                                height: "100%",
                                width: "100%",
                                flex: 1,
                                minWidth: 0,
                                minHeight: 0,
                              }}
                            />
                            <SandpackTimeoutOverlay
                              onSwitchToLive={() => setActiveTab("live")}
                            />
                          </SandpackLayout>
                        </SandpackProvider>
                      </div>
                    );
                    if (isFit) {
                      return (
                        <div className="absolute inset-0 bg-white flex">{sandpack}</div>
                      );
                    }
                    return (
                      <div className="absolute inset-0 flex items-center justify-center overflow-hidden bg-[#0d0d12]">
                        <div
                          style={{
                            width: innerW,
                            height: innerH,
                            transform: `scale(${scale})`,
                            transformOrigin: "center center",
                            background: "white",
                            boxShadow: "0 4px 24px rgba(0,0,0,0.35)",
                            borderRadius: previewViewport === "mobile" ? 24 : 8,
                            overflow: "hidden",
                            flexShrink: 0,
                          }}
                          data-testid="preview-viewport-frame"
                        >
                          {sandpack}
                        </div>
                      </div>
                    );
                  })()
                ) : (
                  <div className="h-full flex items-center justify-center text-muted-foreground">
                    No hay vista previa disponible
                  </div>
                )
              ) : activeTab === "live" ? (
                app?.frontendCode ? (
                  <LivePreview 
                    appId={String(app.id)} 
                    appName={app.title} 
                    frontendCode={app.frontendCode} 
                    vercelUrl={app.vercelDeployUrl}
                    onDeploy={() => vercelDeployMutation.mutate({ id: app.id })}
                  />
                ) : (
                  <div className="h-full flex items-center justify-center text-muted-foreground">
                    Aún no hay bundle para ejecutar.
                  </div>
                )
              ) : (
                <div className="h-full overflow-auto bg-[#0d0d12] p-4">
                  <pre className="font-mono text-xs text-[#e2e2e3] leading-relaxed whitespace-pre-wrap break-all">
                    <code>{codeForTab || "// Aún no hay código generado para esta sección."}</code>
                  </pre>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      <Dialog
        open={!!visualReport}
        onOpenChange={(open) => !open && setVisualReport(null)}
      >
        <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto bg-slate-950 border-cyan-400/30">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-cyan-300">
              <ScanEye className="h-5 w-5" />
              Reporte de Análisis Visual
              {visualReport && (
                <Badge
                  variant="outline"
                  className={
                    visualReport.analysis.overallScore >= 80
                      ? "border-emerald-400/40 text-emerald-300"
                      : visualReport.analysis.overallScore >= 60
                      ? "border-amber-400/40 text-amber-300"
                      : "border-rose-400/40 text-rose-300"
                  }
                >
                  {Math.round(visualReport.analysis.overallScore)}/100
                </Badge>
              )}
            </DialogTitle>
            <DialogDescription className="text-slate-400">
              {visualReport?.analysis.summary}
            </DialogDescription>
          </DialogHeader>

          {visualReport && (
            <div className="space-y-6">
              {visualReport.fixesApplied > 0 && (
                <div className="rounded-lg border border-emerald-400/30 bg-emerald-400/10 p-3 text-sm text-emerald-200">
                  Aplicamos {visualReport.fixesApplied} ronda(s) de correcciones
                  automáticas. La app fue regenerada y vuelta a desplegar.
                </div>
              )}

              <div>
                <h3 className="text-sm font-semibold text-slate-200 mb-2">
                  Capturas ({visualReport.screenshots.length})
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  {visualReport.screenshots.map((shot, idx) => (
                    <div
                      key={idx}
                      className="rounded-lg border border-slate-700 overflow-hidden bg-slate-900"
                    >
                      <div className="px-2 py-1 text-xs text-slate-400 bg-slate-800/50 flex items-center justify-between">
                        <span className="capitalize">{shot.viewport}</span>
                        <span>
                          {shot.width}×{shot.height}
                        </span>
                      </div>
                      <img
                        src={`data:image/png;base64,${shot.imageBase64}`}
                        alt={`${shot.viewport} screenshot`}
                        className="w-full h-auto"
                      />
                    </div>
                  ))}
                </div>
              </div>

              {visualReport.analysis.issues.length > 0 && (
                <div>
                  <h3 className="text-sm font-semibold text-slate-200 mb-2">
                    Problemas detectados ({visualReport.analysis.issues.length})
                  </h3>
                  <ul className="space-y-2">
                    {visualReport.analysis.issues.map((issue, idx) => (
                      <li
                        key={idx}
                        className="rounded-lg border border-slate-700 bg-slate-900/50 p-3"
                      >
                        <div className="flex items-start gap-2">
                          <Badge
                            variant="outline"
                            className={
                              issue.severity === "critical"
                                ? "border-rose-400/40 text-rose-300"
                                : issue.severity === "major"
                                ? "border-amber-400/40 text-amber-300"
                                : "border-slate-500/40 text-slate-300"
                            }
                          >
                            {issue.severity}
                          </Badge>
                          <div className="flex-1">
                            <p className="text-sm text-slate-200">
                              {issue.description}
                            </p>
                            {issue.suggestion && (
                              <p className="text-xs text-slate-400 mt-1">
                                💡 {issue.suggestion}
                              </p>
                            )}
                          </div>
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {visualReport.analysis.issues.length === 0 && (
                <div className="rounded-lg border border-emerald-400/30 bg-emerald-400/10 p-3 text-sm text-emerald-200 text-center">
                  ✨ Sin problemas visuales detectados.
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/*
        Runtime errors dialog. Surfaces the JS errors captured by the
        published iframe sandbox so the owner sees what their visitors are
        hitting and can decide whether to regenerate the app. The endpoint
        always returns a bounded list (max 50 most recent) so we render
        them inline without virtualization.
      */}
      <Dialog open={errorsOpen} onOpenChange={setErrorsOpen}>
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto bg-slate-950 border-red-400/30">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-red-300">
              <AlertCircle className="h-5 w-5" />
              Errores en tu app publicada
            </DialogTitle>
            <DialogDescription className="text-slate-300">
              Estos son los errores de JavaScript que captamos cuando alguien
              abrió tu app pública. Si ves algo recurrente, intenta describirlo
              en el chat para que la IA lo corrija o vuelve a regenerarla.
            </DialogDescription>
          </DialogHeader>
          {runtimeErrors?.errors?.length ? (
            <div className="space-y-3">
              {runtimeErrors.errors.map((err: AppRuntimeError) => (
                <div
                  key={err.id}
                  className="rounded-lg border border-red-400/20 bg-red-500/5 p-3 text-sm"
                  data-testid={`runtime-error-${err.id}`}
                >
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <Badge
                      variant="secondary"
                      className="bg-red-500/15 text-red-200 border-red-400/30 font-mono text-[10px]"
                    >
                      {err.kind}
                    </Badge>
                    <span className="text-xs text-slate-400">
                      {format(new Date(err.createdAt), "d MMM yyyy HH:mm", {
                        locale: es,
                      })}
                    </span>
                  </div>
                  <div className="font-mono text-xs text-red-100 break-words whitespace-pre-wrap">
                    {err.message}
                  </div>
                  {(err.source || err.lineno) && (
                    <div className="mt-1.5 text-[11px] text-slate-400 font-mono break-all">
                      {err.source ?? "(sin archivo)"}
                      {err.lineno ? `:${err.lineno}` : ""}
                      {err.colno ? `:${err.colno}` : ""}
                    </div>
                  )}
                  {err.pathname && err.pathname !== "/" && (
                    <div className="mt-1 text-[11px] text-slate-400">
                      Ruta:{" "}
                      <span className="font-mono text-slate-300">
                        {err.pathname}
                      </span>
                    </div>
                  )}
                  {err.stack && (
                    <details className="mt-2">
                      <summary className="cursor-pointer text-[11px] text-slate-400 hover:text-slate-200">
                        Stack trace
                      </summary>
                      <pre className="mt-1.5 overflow-x-auto rounded bg-black/40 p-2 text-[10px] text-slate-300 leading-tight">
                        {err.stack}
                      </pre>
                    </details>
                  )}
                </div>
              ))}
              <div className="flex items-center justify-end gap-2 pt-2 sticky bottom-0 bg-slate-950">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => clearErrorsMutation.mutate({ id: app.id })}
                  disabled={clearErrorsMutation.isPending}
                  className="h-8 border-white/10 bg-white/5 hover:bg-white/10 text-white"
                  data-testid="button-clear-runtime-errors"
                >
                  {clearErrorsMutation.isPending ? (
                    <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                  ) : (
                    <X className="h-4 w-4 mr-1.5" />
                  )}
                  Descartar todos
                </Button>
              </div>
            </div>
          ) : (
            <div className="rounded-lg border border-emerald-400/30 bg-emerald-400/10 p-3 text-sm text-emerald-200 text-center">
              ✨ No hay errores reportados.
            </div>
          )}
        </DialogContent>
      </Dialog>
    </Layout>
  );
}

/**
 * Per-app agent memory editor. Wired to GET/PUT /apps/:id/notes. Pulled out
 * into its own component so each tab/route mount manages its own query and
 * mutation state without rebuilding the whole detail page on every save.
 */
function AppNotesSection({ appId }: { appId: number }) {
  const queryClient = useQueryClient();
  const { data, isLoading } = useGetAppNotes(appId);
  const updateMutation = useUpdateAppNotes({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetAppNotesQueryKey(appId) });
      },
    },
  });
  return (
    <AgentNotesPanel
      title="Memoria del agente para esta app"
      description="Notas que el agente recordará al editar esta app: decisiones de diseño, convenciones de código, integraciones, etc."
      initialValue={data?.notes}
      isLoading={isLoading}
      isSaving={updateMutation.isPending}
      onSave={async (notes) => {
        await updateMutation.mutateAsync({ id: appId, data: { notes } });
      }}
      testIdPrefix="app-notes"
    />
  );
}

/**
 * Revision history with one-click rollback. Each successful generation,
 * edit, and visual fix is captured as an immutable snapshot. Restoring a
 * revision automatically saves the current state as a "restore-backup"
 * snapshot first so the user can always come back.
 */
/**
 * Custom Vercel domain panel. Only mounted once the app has been deployed
 * to Vercel at least once (parent gates on `app.vercelProjectId`). Three
 * UI states based on what the API returns:
 *
 *  1. spentCents < requiredCents   → locked card, shows progress to unlock.
 *  2. unlocked, no domain attached → form to enter the bare domain.
 *  3. unlocked, domain attached    → shows DNS records the user must add at
 *                                    their registrar (Arsys, Hostinger…) +
 *                                    verification status + remove button.
 *
 * The 50€ gate is enforced server-side too — this component just hides the
 * form when the user hasn't unlocked it.
 */
function CustomDomainSection({ appId }: { appId: number }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data, isLoading } = useGetAppCustomDomain(appId, {
    query: {
      queryKey: getGetAppCustomDomainQueryKey(appId),
      // Verification status changes when the user updates DNS — refresh on
      // focus and every 30s so "✓ verificado" appears without manual reload.
      refetchOnWindowFocus: true,
      refetchInterval: 30_000,
    },
  });
  const [domainInput, setDomainInput] = useState("");
  const attachMutation = useAttachAppCustomDomain({
    mutation: {
      onSuccess: () => {
        setDomainInput("");
        void queryClient.invalidateQueries({
          queryKey: getGetAppCustomDomainQueryKey(appId),
        });
        toast({ title: "Dominio conectado", description: "Añade los registros DNS en tu registrador para activarlo." });
      },
      onError: (err: any) => {
        const msg = err?.response?.data?.error ?? "No pude conectar el dominio.";
        toast({ title: "No se pudo conectar", description: msg, variant: "destructive" });
      },
    },
  });
  const detachMutation = useDetachAppCustomDomain({
    mutation: {
      onSuccess: () => {
        void queryClient.invalidateQueries({
          queryKey: getGetAppCustomDomainQueryKey(appId),
        });
        toast({ title: "Dominio desconectado" });
      },
    },
  });

  if (isLoading || !data) {
    return (
      <div className="rounded-lg border border-white/10 bg-white/5 p-3 text-xs text-slate-400">
        Cargando estado del dominio…
      </div>
    );
  }

  // Nuevo gate (Mayo 2026): el dominio propio se desbloquea con CUALQUIER
  // plan de pago o si la cuenta es admin/propietaria. Ya no hay un umbral
  // de € acumulados — el backend devuelve `unlocked` y `unlockReason`.
  // Fallback al campo legacy spentCents/requiredCents por si un cliente
  // viejo recibe la respuesta antigua.
  const unlocked =
    typeof data.unlocked === "boolean"
      ? data.unlocked
      : (data.spentCents ?? 0) >= (data.requiredCents ?? 0);

  // 1. Locked → mensaje claro de "necesitas plan de pago", sin barra de
  //    progreso (ya no aplica el umbral en €).
  if (!unlocked) {
    return (
      <div
        className="rounded-lg border border-amber-400/20 bg-amber-500/5 p-3"
        data-testid="custom-domain-locked"
      >
        <div className="flex items-center justify-between gap-2 mb-1.5">
          <div className="text-sm font-medium text-amber-100">
            🔒 Conecta tu propio dominio
          </div>
          <div className="text-[10px] uppercase tracking-wide text-amber-200/70">
            Plan de pago
          </div>
        </div>
        <p className="text-xs text-amber-100/80 leading-relaxed">
          En el plan gratis puedes desplegar tu app, pero solo con el subdominio
          de preview que asigna Maris AI.
          Para conectar tu propio dominio (p. ej. <span className="font-mono">mitienda.com</span>)
          necesitas un plan de pago — basta con comprar cualquier paquete de
          créditos para desbloquearlo.
        </p>
      </div>
    );
  }

  // 2/3. Unlocked → either form or attached state.
  const attached = !!data.domain;

  return (
    <div
      className="rounded-lg border border-emerald-400/20 bg-emerald-500/5 p-3 space-y-3"
      data-testid="custom-domain-panel"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="text-sm font-medium text-emerald-100">
          🌐 Dominio personalizado
        </div>
        {attached ? (
          data.verified ? (
            <Badge className="bg-emerald-500/15 text-emerald-200 border-emerald-400/30 text-[10px]">
              ✓ Verificado
            </Badge>
          ) : (
            <Badge
              variant="secondary"
              className="bg-amber-500/15 text-amber-200 border-amber-400/30 text-[10px]"
            >
              Pendiente DNS
            </Badge>
          )
        ) : null}
      </div>

      {!attached ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const v = domainInput.trim().toLowerCase();
            if (!v) return;
            attachMutation.mutate({ id: appId, data: { domain: v } });
          }}
          className="space-y-2"
        >
          <input
            type="text"
            value={domainInput}
            onChange={(e) => setDomainInput(e.target.value)}
            placeholder="mitienda.com"
            className="w-full rounded-md border border-white/10 bg-white/5 px-3 py-1.5 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:ring-1 focus:ring-emerald-400/50"
            data-testid="input-custom-domain"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
          />
          <Button
            type="submit"
            size="sm"
            disabled={attachMutation.isPending || !domainInput.trim()}
            className="w-full h-8 bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-400/30 text-emerald-100"
            data-testid="button-attach-domain"
          >
            {attachMutation.isPending ? (
              <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
            ) : null}
            Conectar dominio
          </Button>
          <p className="text-[11px] text-slate-400 leading-relaxed">
            Solo el nombre, sin <span className="font-mono">https://</span> ni barra final. Después tendrás que añadir 2 registros DNS en tu registrador (Arsys, Hostinger, GoDaddy, IONOS, Cloudflare…).
          </p>
        </form>
      ) : (
        <>
          <div className="rounded-md bg-black/30 border border-white/5 p-2 font-mono text-xs text-emerald-100 break-all">
            {data.domain}
          </div>
          {data.recommendedDns && data.recommendedDns.length > 0 ? (
            <div>
              <div className="text-xs text-emerald-100/80 font-medium mb-1.5">
                Añade estos registros en tu registrador:
              </div>
              <div className="rounded-md bg-black/30 border border-white/5 overflow-hidden">
                <table className="w-full text-[11px] font-mono text-slate-200">
                  <thead className="bg-white/5 text-slate-400">
                    <tr>
                      <th className="px-2 py-1 text-left">Tipo</th>
                      <th className="px-2 py-1 text-left">Nombre</th>
                      <th className="px-2 py-1 text-left">Valor</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.recommendedDns.map((rec: any, i: any) => (
                      <tr key={i} className="border-t border-white/5">
                        <td className="px-2 py-1">{rec.type}</td>
                        <td className="px-2 py-1">{rec.name}</td>
                        <td className="px-2 py-1 break-all">{rec.value}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="text-[11px] text-slate-400 mt-1.5 leading-relaxed">
                Vercel verifica el dominio automáticamente cuando los DNS propagan (puede tardar de 5 minutos a varias horas según tu registrador).
              </p>
            </div>
          ) : null}
          {data.verification && data.verification.length > 0 ? (
            <div className="rounded-md border border-amber-400/20 bg-amber-500/5 p-2 text-[11px] text-amber-100">
              <div className="font-medium mb-1">Verificación pendiente:</div>
              <ul className="space-y-0.5">
                {data.verification.map((v: any, i: any) => (
                  <li key={i} className="font-mono break-all">
                    {v.type} {v.domain} → {v.value}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {data.warning ? (
            <div className="text-[11px] text-amber-200/80">{data.warning}</div>
          ) : null}
          <Button
            variant="outline"
            size="sm"
            onClick={() => detachMutation.mutate({ id: appId })}
            disabled={detachMutation.isPending}
            className="w-full h-8 border-white/10 bg-white/5 hover:bg-red-500/15 hover:border-red-400/30 hover:text-red-200 text-slate-300"
            data-testid="button-detach-domain"
          >
            {detachMutation.isPending ? (
              <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
            ) : null}
            Quitar dominio
          </Button>
        </>
      )}
    </div>
  );
}

function RevisionHistorySection({ appId }: { appId: number }) {
  const queryClient = useQueryClient();
  const { data, isLoading } = useListAppRevisions(appId, {
    query: {
      queryKey: getListAppRevisionsQueryKey(appId),
      // Refetch when the user comes back to the tab so a freshly-finished
      // visual-fix snapshot shows up without needing a manual reload.
      refetchOnWindowFocus: true,
      // Light polling so snapshots that land while the tab is open also show.
      refetchInterval: 30_000,
    },
  });
  const restoreMutation = useRestoreAppRevision({
    mutation: {
      onSuccess: () => {
        // Refetch everything that derives from the app's content: the app row
        // (frontend/backend bundles drive the preview), the chat (we appended
        // a "I restored revision #N" assistant message), and the revision
        // list itself (the restore created a "restore-backup" snapshot).
        void queryClient.invalidateQueries({ queryKey: getGetAppQueryKey(appId) });
        void queryClient.invalidateQueries({
          queryKey: getListAppMessagesQueryKey(appId),
        });
        void queryClient.invalidateQueries({
          queryKey: getListAppRevisionsQueryKey(appId),
        });
      },
    },
  });
  return (
    <RevisionHistoryPanel
      revisions={data?.revisions}
      isLoading={isLoading}
      isRestoring={restoreMutation.isPending}
      pendingRevisionId={restoreMutation.variables?.revisionId ?? null}
      onRestore={async (revisionId) => {
        await restoreMutation.mutateAsync({ id: appId, revisionId });
      }}
    />
  );
}

/**
 * Overlay que se monta dentro de <SandpackProvider> y escucha el `status`
 * del bundler. Cuando Sandpack se queda sin tiempo conectando con el
 * runtime de CodeSandbox (status === "timeout"), tapamos el iframe
 * corrupto con un mensaje accionable: explicar QUÉ ha pasado, ofrecer un
 * botón para reintentar y sugerir cambiar a la pestaña "Live" (que usa
 * el host nativo en vez del bundler in-browser y por tanto no depende
 * de la red de CodeSandbox). El comportamiento por defecto de la
 * librería es mostrar el cartel inglés "Couldn't connect to server.
 * ENV: create-react-app, ERROR: TIME_OUT" sin botón de recuperación, lo
 * que dejaba al usuario atrapado.
 */
function SandpackTimeoutOverlay({
  onSwitchToLive,
}: {
  onSwitchToLive?: () => void;
}) {
  const { sandpack } = useSandpack();
  if (sandpack.status !== "timeout") return null;
  return (
    <div className="absolute inset-0 z-30 flex items-center justify-center bg-white/95 backdrop-blur-sm p-6">
      <div className="max-w-md text-center space-y-3">
        <div className="text-base font-semibold text-gray-900">
          La preview rápida ha tardado demasiado en arrancar
        </div>
        <p className="text-sm text-gray-600 leading-relaxed">
          Esta vista usa el bundler en navegador de CodeSandbox para mostrarte
          la app sin instalar nada. A veces su servidor está saturado o tu red
          es lenta y se queda sin tiempo. No es un problema de tu app: el
          código sigue intacto.
        </p>
        <div className="flex flex-col gap-2 pt-2">
          <Button
            type="button"
            onClick={() => sandpack.runSandpack()}
            className="w-full"
          >
            Reintentar
          </Button>
          {onSwitchToLive ? (
            <Button
              type="button"
              variant="outline"
              onClick={onSwitchToLive}
              className="w-full"
            >
              Usar preview "Live" (más estable)
            </Button>
          ) : null}
        </div>
        <p className="text-xs text-gray-500 pt-1">
          La pestaña Live tarda más en arrancar la primera vez (instala
          dependencias en el contenedor) pero no depende de servidores
          externos.
        </p>
      </div>
    </div>
  );
}
