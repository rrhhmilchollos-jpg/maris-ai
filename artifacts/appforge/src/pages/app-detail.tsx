import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "wouter";
import {
  useGetApp,
  useDeleteApp,
  useListAppMessages,
  useSendAppMessage,
  useGetGenerationJob,
  getGetAppQueryKey,
  getListAppsQueryKey,
  getGetMyStatsQueryKey,
  getListAppMessagesQueryKey,
  getGetGenerationJobQueryKey,
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
} from "lucide-react";
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
import { parseBundle, buildSandpackFiles } from "@/lib/parseBundle";

type TabKey = "preview" | "frontend" | "backend";

const PHASE_LABELS: Record<string, string> = {
  queued: "En cola…",
  starting: "Inicializando…",
  researching: "Investigando referencias…",
  generating: "Aplicando cambios…",
  parsing: "Procesando archivos…",
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
  const [draft, setDraft] = useState("");
  const [activeJobId, setActiveJobId] = useState<number | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  const { data: app, isLoading } = useGetApp(id, {
    query: { enabled: !!id, queryKey: getGetAppQueryKey(id) },
  });

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
            {app.techStack?.slice(0, 4).map((tech) => (
              <Badge key={tech} variant="secondary" className="font-mono text-xs bg-secondary/50">
                {tech}
              </Badge>
            ))}
            <span className="text-xs text-muted-foreground hidden md:inline">
              {format(new Date(app.createdAt), "d MMM yyyy", { locale: es })}
            </span>
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

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 h-[calc(100vh-160px)] min-h-[600px]">
          {/* Chat panel */}
          <div className="lg:col-span-4 flex flex-col bg-[#0d0d12] rounded-xl border border-white/10 overflow-hidden">
            <div className="px-4 py-3 border-b border-white/5 bg-[#111118] flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-primary" />
              <span className="text-sm font-medium text-white">Chat con el agente</span>
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
          <div className="lg:col-span-8 flex flex-col bg-[#0d0d12] rounded-xl border border-white/10 overflow-hidden">
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
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setActiveTab("backend")}
                  className={`h-8 rounded-md ${activeTab === "backend" ? "bg-white/10 text-white" : "text-muted-foreground hover:text-white hover:bg-white/5"}`}
                >
                  <Server className="h-4 w-4 mr-2" /> Backend
                </Button>
              </div>
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
            </div>

            <div className="flex-1 overflow-hidden bg-white">
              {activeTab === "preview" ? (
                sandpackFiles ? (
                  <SandpackProvider
                    template="react-ts"
                    files={sandpackFiles}
                    customSetup={{
                      entry: "/index.tsx",
                    }}
                    options={{
                      recompileMode: "delayed",
                      recompileDelay: 500,
                    }}
                    theme="light"
                  >
                    <SandpackLayout style={{ height: "100%", border: "none", borderRadius: 0 }}>
                      <SandpackPreview
                        showOpenInCodeSandbox={false}
                        showRefreshButton
                        style={{ height: "100%", flex: 1 }}
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
    </Layout>
  );
}
