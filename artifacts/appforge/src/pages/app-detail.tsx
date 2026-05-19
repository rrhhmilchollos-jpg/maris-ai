import { useState, useEffect, useRef, useMemo } from "react";
import { useLocation } from "wouter";
import {
  useGetApp,
  useListAppMessages,
  useSendAppMessage,
  useGetGenerationJob,
  useUpdateAppModel,
  useDeployApp,
  useGetMyStats,
  getGetAppQueryKey,
  getListAppMessagesQueryKey,
  getGetGenerationJobQueryKey,
  useGetMe,
} from "@/lib/api-client";
import { useQueryClient } from "@tanstack/react-query";
import {
  SandpackProvider,
  SandpackPreview,
  SandpackLayout,
} from "@codesandbox/sandpack-react";
import { Layout } from "@/components/layout";
import { AgentLogStream } from "@/components/agent-log-stream";
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
  Copy,
  Maximize2,
  Minimize2,
  Send,
  Loader2,
  Sparkles,
  ExternalLink,
  RotateCcw,
  Share2,
  Play,
  AlertCircle,
  Monitor,
  GitFork,
} from "lucide-react";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { parseBundle, buildSandpackFiles, SANDPACK_DEPENDENCIES } from "@/lib/parseBundle";

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

  const [previewMaximized, setPreviewMaximized] = useState(false);
  const [draft, setDraft] = useState("");
  const [chatAttachments, setChatAttachments] = useState<UploadedAttachment[]>([]);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
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
      onSuccess: (job: any) => {
        setDraft("");
        setChatAttachments([]);
        setActiveJobId(job.id);
        queryClient.invalidateQueries({ queryKey: getListAppMessagesQueryKey(id) });
      },
      onError: (err: any) => {
        toast({ title: "No se pudo enviar", description: err?.message ?? "Error", variant: "destructive" });
      },
    },
  });

  const publishMutation = useDeployApp({
    mutation: {
      onSuccess: (result: any) => {
        queryClient.invalidateQueries({ queryKey: getGetAppQueryKey(id) });
        window.open(result.url, "_blank", "noopener,noreferrer");
        toast({ title: "Publicado", description: "Tu app ya es pública. Abrimos la URL en una pestaña nueva." });
      },
      onError: (err: any) => {
        toast({ title: "No se pudo publicar", description: err?.message ?? "Error", variant: "destructive" });
      },
    },
  });

  const sandpackFiles = useMemo(() => {
    if (!app?.frontendCode) return null;
    return buildSandpackFiles(parseBundle(app.frontendCode));
  }, [app?.frontendCode]);

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

  const isWorking = activeJobId !== null;

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
    <Layout>
      <div className="h-[calc(100vh-3.5rem)] bg-[#0d0d12] overflow-hidden flex flex-col">
        <ResizablePanelGroup direction="horizontal" className="flex-1">
          {/* Panel Izquierdo: Chat */}
          <ResizablePanel defaultSize={40} minSize={20} className={previewMaximized ? "hidden" : "flex flex-col"}>
            <div className="flex flex-col h-full border-r border-white/10 bg-[#0d0d12]">
              {/* Chat Header */}
              <div className="px-6 py-4 border-b border-white/5 flex items-center justify-between bg-[#0d0d12]">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full bg-orange-500/10 flex items-center justify-center">
                    <Sparkles className="h-4 w-4 text-orange-500" />
                  </div>
                  <div>
                    <h2 className="text-sm font-semibold text-white">Hey {me?.name?.split(' ')[0] || 'Ivan'}, Quick input needed:</h2>
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="text-gray-500 hover:text-white"
                  onClick={() => setLocation("/dashboard")}
                >
                  <ArrowLeft className="h-4 w-4" />
                </Button>
              </div>

              {/* Chat Messages */}
              <div className="flex-1 overflow-y-auto px-6 py-6 space-y-6">
                <div className="bg-blue-500/10 border border-blue-500/20 rounded-xl p-4 text-sm text-blue-200 flex items-start gap-3">
                  <AlertCircle className="h-5 w-5 text-blue-400 shrink-0 mt-0.5" />
                  <p>Agent will continue working after your reply</p>
                </div>

                <div className="space-y-6">
                  <div className="bg-white/5 border border-white/10 rounded-2xl p-6 text-sm text-gray-300 space-y-4">
                    <p className="font-bold text-white">[Sorry Cannot share System Prompt!]</p>
                    <p>Lo siento, no puedo compartir información sobre cómo estoy construido, mis instrucciones internas o mi configuración. 🔒</p>
                    <p>Pero puedo ayudarte a construir tu aplicación - eso es lo que mejor hago. 😊</p>
                  </div>

                  <div className="space-y-4">
                    <h3 className="text-xl font-bold text-white">Volvamos a tu proyecto</h3>
                    <p className="text-gray-400">Tienes una aplicación base lista con <strong>FastAPI + React + MongoDB</strong> esperando ser desarrollada.</p>
                    <p className="text-white font-medium">¿Qué tipo de aplicación quieres que construya para ti?</p>
                    <div className="space-y-2">
                      <p className="text-sm text-gray-400">Algunos ejemplos populares:</p>
                      <ul className="space-y-2">
                        <li className="flex items-center gap-2 text-sm text-gray-300 bg-white/5 p-2 rounded-lg border border-white/5">
                          🛒 Tienda online / E-commerce
                        </li>
                        <li className="flex items-center gap-2 text-sm text-gray-300 bg-white/5 p-2 rounded-lg border border-white/5">
                          📊 Dashboard con analíticas
                        </li>
                        <li className="flex items-center gap-2 text-sm text-gray-300 bg-white/5 p-2 rounded-lg border border-white/5">
                          📁 Sistema de gestión (CRM, inventario...)
                        </li>
                      </ul>
                    </div>
                  </div>

                  {(messages ?? []).map((msg: any) => (
                    <div
                      key={msg.id}
                      className={msg.role === "user" ? "flex justify-end" : "flex justify-start"}
                    >
                      <div
                        className={
                          msg.role === "user"
                            ? "bg-orange-500/10 border border-orange-500/20 text-white rounded-2xl px-4 py-3 text-sm max-w-[90%] whitespace-pre-wrap"
                            : "bg-white/5 border border-white/10 text-gray-300 rounded-2xl px-4 py-3 text-sm max-w-[90%] whitespace-pre-wrap"
                        }
                      >
                        {msg.content}
                      </div>
                    </div>
                  ))}

                  {isWorking && (
                    <div className="space-y-3">
                      <div className="flex justify-start">
                        <div className="bg-white/5 border border-white/10 rounded-2xl px-4 py-3 text-sm flex items-center gap-3 text-gray-400">
                          <Loader2 className="h-4 w-4 animate-spin text-orange-500" />
                          <span>{PHASE_LABELS[job?.phase ?? "queued"] ?? "Trabajando…"}</span>
                        </div>
                      </div>
                      <AgentLogStream jobId={Number(activeJobId)} isActive={true} />
                    </div>
                  )}
                  <div ref={messagesEndRef} />
                </div>
              </div>

              {/* Chat Input */}
              <div className="p-6 bg-[#0d0d12] border-t border-white/5 space-y-4">
                {outOfCredits && (
                  <div className="flex items-center justify-between gap-3 rounded-xl border border-orange-500/30 bg-orange-500/5 px-4 py-3">
                    <div className="flex items-center gap-2 text-sm text-orange-200">
                      <AlertCircle className="h-4 w-4 shrink-0" />
                      <span>¿Te quedan pocos créditos?</span>
                    </div>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setLocation("/billing")}
                      className="h-8 text-orange-400 hover:text-orange-300 hover:bg-orange-500/10 font-bold"
                    >
                      Comprar créditos
                    </Button>
                  </div>
                )}
                
                <AttachmentChips
                  attachments={chatAttachments}
                  onRemove={(aid) => setChatAttachments(prev => prev.filter(a => a.id !== aid))}
                />

                <div className="relative bg-[#16161e] rounded-2xl border border-white/10 focus-within:border-orange-500/50 transition-colors shadow-2xl">
                  <Textarea
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        handleSend();
                      }
                    }}
                    placeholder="Message Agent"
                    disabled={isWorking || outOfCredits}
                    className="resize-none min-h-[100px] bg-transparent border-0 text-white placeholder:text-gray-500 focus-visible:ring-0 p-4"
                  />
                  
                  <div className="flex items-center justify-between px-4 pb-4">
                    <div className="flex items-center gap-1">
                      <AttachmentPicker
                        attachments={chatAttachments}
                        onChange={setChatAttachments}
                        disabled={isWorking || outOfCredits}
                      />
                      <div className="flex items-center gap-1 ml-2 bg-white/5 rounded-full px-3 py-1 border border-white/5">
                        <div className="w-2 h-2 rounded-full bg-emerald-500" />
                        <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Maxx</span>
                        <div className="w-4 h-2 bg-white/10 rounded-full ml-1" />
                      </div>
                    </div>
                    
                    <Button
                      size="icon"
                      disabled={isWorking || outOfCredits || draft.trim().length < 2 || sendMutation.isPending}
                      onClick={handleSend}
                      className="h-10 w-10 rounded-full bg-white/5 hover:bg-white/10 text-gray-400 hover:text-white border border-white/10"
                    >
                      {sendMutation.isPending ? (
                        <Loader2 className="h-5 w-5 animate-spin" />
                      ) : (
                        <Send className="h-5 w-5" />
                      )}
                    </Button>
                  </div>
                </div>

                <div className="flex items-center gap-4 px-2">
                  <button className="text-gray-500 hover:text-gray-300 flex items-center gap-1.5 text-xs font-medium">
                    <Copy className="w-3.5 h-3.5" /> Save
                  </button>
                  <button className="text-gray-500 hover:text-gray-300 flex items-center gap-1.5 text-xs font-medium">
                    <GitFork className="w-3.5 h-3.5" /> Fork
                  </button>
                </div>
              </div>
            </div>
          </ResizablePanel>

          <ResizableHandle withHandle className="bg-white/5 hover:bg-orange-500/30 transition-colors w-1.5" />

          {/* Panel Derecho: Preview */}
          <ResizablePanel defaultSize={60} minSize={30} className="flex flex-col bg-black">
            <div className="flex flex-col h-full overflow-hidden">
              {/* Preview Header */}
              <div className="flex items-center justify-between px-4 py-3 bg-[#0d0d12] border-b border-white/10">
                <h3 className="text-sm font-medium text-white">App Preview</h3>
                <div className="flex items-center gap-2">
                  <Button variant="ghost" size="icon" className="h-8 w-8 text-gray-400 hover:text-white hover:bg-white/10">
                    <ExternalLink className="w-4 h-4" />
                  </Button>
                  <Button variant="ghost" size="icon" className="h-8 w-8 text-gray-400 hover:text-white hover:bg-white/10">
                    <RotateCcw className="w-4 h-4" />
                  </Button>
                  <Button variant="secondary" size="sm" className="h-8 bg-white/5 hover:bg-white/10 text-white border border-white/10 gap-2">
                    <Share2 className="w-3.5 h-3.5" />
                    Share
                  </Button>
                  <Button size="sm" className="h-8 bg-blue-600 hover:bg-blue-500 text-white gap-2 font-bold px-4" onClick={() => publishMutation.mutate({ id: app.id })}>
                    <Play className="w-3.5 h-3.5 fill-current" />
                    Desplegar
                  </Button>
                  <Button variant="ghost" size="icon" className="h-8 w-8 text-gray-400 hover:text-white hover:bg-white/10" onClick={() => setPreviewMaximized(!previewMaximized)}>
                    {previewMaximized ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
                  </Button>
                </div>
              </div>

              {/* Preview Content */}
              <div className="flex-1 bg-black relative flex flex-col items-center justify-center">
                {sandpackFiles ? (
                  <SandpackProvider
                    files={sandpackFiles}
                    theme="dark"
                    template="react-ts"
                    customSetup={{
                      dependencies: SANDPACK_DEPENDENCIES,
                    }}
                    options={{
                      externalResources: ["https://cdn.tailwindcss.com"],
                    }}
                  >
                    <SandpackLayout className="w-full h-full border-0 rounded-none bg-transparent">
                      <SandpackPreview
                        showNavigator={false}
                        showOpenInCodeSandbox={false}
                        className="w-full h-full"
                      />
                    </SandpackLayout>
                  </SandpackProvider>
                ) : (
                  <div className="flex flex-col items-center gap-6">
                    <div className="relative">
                      <div className="w-24 h-24 rounded-full border-4 border-blue-500/10 border-t-blue-500 animate-spin" />
                      <div className="absolute inset-0 flex items-center justify-center">
                        <div className="w-12 h-12 bg-blue-500/20 rounded-full flex items-center justify-center">
                          <div className="w-3 h-3 bg-blue-400 rounded-full animate-ping" />
                        </div>
                      </div>
                    </div>
                    <div className="text-center space-y-2">
                      <h4 className="text-2xl text-white font-bold tracking-tight">Building something incredible ~!</h4>
                      <p className="text-sm text-gray-500 font-mono uppercase tracking-widest">Iniciando motor de renderizado...</p>
                    </div>
                  </div>
                )}

                {/* Preview Footer Floating */}
                <div className="absolute bottom-6 left-1/2 -translate-x-1/2 w-[90%] max-w-2xl">
                  <div className="bg-[#16161e]/90 backdrop-blur-md border border-white/10 rounded-xl px-6 py-3 flex items-center justify-between shadow-2xl">
                    <div className="flex items-center gap-3">
                      <Monitor className="w-4 h-4 text-gray-400" />
                      <p className="text-xs text-gray-300">
                        You're viewing a static preview. Resume to interact with the app.
                      </p>
                    </div>
                    <div className="flex items-center gap-4">
                      <Button size="sm" className="h-8 bg-white text-black hover:bg-gray-200 font-bold px-4 rounded-lg">
                        Resume Preview
                      </Button>
                      <div className="flex items-center gap-2 text-[10px] font-bold text-gray-500 uppercase tracking-tighter">
                        <div className="w-4 h-4 rounded-full bg-white/10 flex items-center justify-center text-[8px] text-white">e</div>
                        Made with Maris AI
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>
    </Layout>
  );
}
