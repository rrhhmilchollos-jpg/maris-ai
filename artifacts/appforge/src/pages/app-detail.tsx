import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "wouter";
import {
  useGetApp,
  useDeleteApp,
  useListAppMessages,
  useSendAppMessage,
  useGetGenerationJob,
  useUpdateAppModel,
  useHealthCheckApp,
  useDeployApp,
  usePushAppToGitHub,
  useGenerateAppImages,
  useVisualTestApp,
  getGetAppQueryKey,
  getListAppsQueryKey,
  getGetMyStatsQueryKey,
  getListAppMessagesQueryKey,
  getGetGenerationJobQueryKey,
  useGetMe,
  type VisualTestReport,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  SandpackProvider,
  SandpackPreview,
  SandpackLayout,
} from "@codesandbox/sandpack-react";
import { Layout } from "@/components/layout";
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
  ExternalLink,
  ImagePlus,
  Maximize2,
  Minimize2,
  ScanEye,
  X,
  PanelRightOpen,
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

type TabKey = "preview" | "frontend" | "backend";

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
  const id = Number(params.id);
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [activeTab, setActiveTab] = useState<TabKey>("preview");
  const [copied, setCopied] = useState(false);
  const [previewMaximized, setPreviewMaximized] = useState(false);
  // Live preview window visibility. Mirrors emergent.sh — the preview can be
  // closed (chat takes the full width) and re-opened from a button. The agent
  // also auto-opens it when it starts a new job so the user sees its work in
  // real time, and on job success.
  const [previewOpen, setPreviewOpen] = useState(true);
  const [draft, setDraft] = useState("");
  const [activeJobId, setActiveJobId] = useState<number | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  const { data: app, isLoading } = useGetApp(id, {
    query: { enabled: !!id, queryKey: getGetAppQueryKey(id) },
  });
  const { data: me } = useGetMe();
  const isAdmin = !!me?.isAdmin;
  const isPremium = !!me?.isPremium;

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
      onSuccess: (newJob) => {
        setActiveJobId(newJob.id);
        // Auto-open the live preview the moment the agent starts working so
        // the user can watch the changes happen instead of staring at chat.
        setPreviewOpen(true);
        setDraft("");
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
        toast({ title: "Subido a GitHub", description: result.repoFullName });
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
    sendMutation.mutate({ id, data: { message: trimmed } });
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

  return (
    <Layout>
      <div className="container mx-auto px-4 py-4 max-w-[1500px]">
        {/* Header bar */}
        <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
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
                <SelectItem value="auto">Auto (Gemini Flash)</SelectItem>
                <SelectItem value="gemini-2.5-flash">Gemini 2.5 Flash (rápido)</SelectItem>
                <SelectItem value="gpt-5" disabled={!isPremium}>
                  ⚡ GPT-5 Codex {isPremium ? "(Ultra Rápido)" : "(Premium)"}
                </SelectItem>
                <SelectItem value="claude-sonnet-4-6" disabled={!isPremium}>
                  Claude Sonnet 4.6 {isPremium ? "(calidad)" : "(Premium)"}
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

            {app.publicSlug ? (
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

            {app.githubRepoUrl ? (
              <Button
                variant="outline"
                size="sm"
                asChild
                className="h-8 border-white/10 bg-white/5 hover:bg-white/10 text-white"
                title="Abrir el repositorio en GitHub"
              >
                <a href={app.githubRepoUrl} target="_blank" rel="noopener noreferrer">
                  <Github className="h-4 w-4 mr-1.5" /> Repo
                </a>
              </Button>
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

            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:bg-destructive/10">
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

        <div
          className={`grid grid-cols-1 ${previewMaximized || !previewOpen ? "" : "lg:grid-cols-12"} gap-4 h-[calc(100vh-160px)] min-h-[600px]`}
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

            <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
              {(messages ?? []).length === 0 && !isWorking ? (
                <div className="text-center py-8 text-sm text-muted-foreground">
                  Pide cualquier cambio: "añade modo oscuro", "cambia los colores a verde", "añade una sección de testimonios"…
                </div>
              ) : null}
              {(messages ?? []).map((msg) => (
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
                <div className="flex justify-start">
                  <div className="bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm flex items-center gap-2 text-muted-foreground">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    {PHASE_LABELS[job?.phase ?? "queued"] ?? "Trabajando…"}
                    {typeof job?.progress === "number" && job.progress > 0 && (
                      <span className="text-xs opacity-70">{job.progress}%</span>
                    )}
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>

            <div className="p-3 border-t border-white/5 bg-[#0a0a0f]">
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
                  placeholder={isWorking ? "Espera a que termine el cambio actual…" : "Pide un cambio… (Enter envía, Shift+Enter salto de línea)"}
                  disabled={isWorking}
                  className="resize-none min-h-[60px] max-h-[140px] bg-white/5 border-white/10 text-foreground pr-12"
                />
                <Button
                  size="icon"
                  disabled={isWorking || draft.trim().length < 2 || sendMutation.isPending}
                  onClick={handleSend}
                  className="absolute right-2 bottom-2 h-8 w-8"
                >
                  {sendMutation.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Send className="h-4 w-4" />
                  )}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground mt-1.5 px-1">
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
                  <Eye className="h-4 w-4 mr-2" /> Preview en vivo
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setActiveTab("frontend")}
                  className={`h-8 rounded-md ${activeTab === "frontend" ? "bg-white/10 text-white" : "text-muted-foreground hover:text-white hover:bg-white/5"}`}
                >
                  <Code2 className="h-4 w-4 mr-2" /> Frontend
                </Button>
                {/* Backend tab is owner/admin-only — clients shouldn't see
                    server code in apps published to them. */}
                {isAdmin && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setActiveTab("backend")}
                    className={`h-8 rounded-md ${activeTab === "backend" ? "bg-white/10 text-white" : "text-muted-foreground hover:text-white hover:bg-white/5"}`}
                  >
                    <Server className="h-4 w-4 mr-2" /> Backend
                  </Button>
                )}
              </div>
              <div className="flex items-center gap-2">
                {activeTab !== "preview" && (
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

            <div className="flex-1 overflow-hidden bg-white">
              {activeTab === "preview" ? (
                sandpackFiles ? (
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
                    }}
                    theme="light"
                  >
                    <SandpackLayout style={{ height: "100%", width: "100%", border: "none", borderRadius: 0 }}>
                      <SandpackPreview
                        showOpenInCodeSandbox={false}
                        showRefreshButton
                        style={{ height: "100%", width: "100%", flex: 1, minWidth: 0 }}
                      />
                    </SandpackLayout>
                  </SandpackProvider>
                ) : (
                  <div className="h-full flex items-center justify-center text-muted-foreground">
                    No hay vista previa disponible
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
    </Layout>
  );
}
