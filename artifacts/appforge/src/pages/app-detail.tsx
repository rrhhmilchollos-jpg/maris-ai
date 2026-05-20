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
} from "@/lib/api-client";
import { useQueryClient } from "@tanstack/react-query";
import { Layout } from "@/components/layout";
import { GenerationStudio } from "@/components/generation-studio";
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
} from "lucide-react";

const PHASE_LABELS: Record<string, { label: string; icon: any }> = {
  queued: { label: "En cola…", icon: Loader2 },
  starting: { label: "Inicializando equipo…", icon: Loader2 },
  researching: { label: "🔎 Investigando referencias…", icon: Sparkles },
  architecting: { label: "🧠 Arquitecto planificando…", icon: Sparkles },
  integrating: { label: "🔌 Definiendo integraciones…", icon: Sparkles },
  designing: { label: "🎨 Diseñador trabajando…", icon: Sparkles },
  generating: { label: "⚡ Aplicando cambios al código…", icon: Zap },
  reviewing: { label: "✅ Revisión de calidad…", icon: Sparkles },
  validating: { label: "🔍 Compilando en memoria…", icon: Sparkles },
  fixing: { label: "🔧 Auto-reparación…", icon: Sparkles },
  parsing: { label: "📦 Empaquetando archivos…", icon: Sparkles },
  ready: { label: "Listo", icon: Sparkles },
  failed: { label: "Error", icon: Sparkles },
};

export default function AppDetailPage({ params }: { params: { id: string } }) {
  const id = params.id;
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();

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

  const isWorking = activeJobId !== null || job?.status === "awaiting_approval";

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

  // SI ESTÁ TRABAJANDO O EN PAUSA DE APROBACIÓN -> MOSTRAR SPLIT SCREEN COMPLETO (CLON EMERGENT)
  if (isWorking && job) {
    const phaseInfo = PHASE_LABELS[job.phase ?? "queued"] ?? PHASE_LABELS.queued;
    return (
      <div className="h-screen w-screen bg-[#0a0a0f] fixed inset-0 z-[100]">
        <GenerationStudio
          jobId={activeJobId}
          job={job}
          phaseLabel={phaseInfo.label}
          PhaseIcon={phaseInfo.icon}
          appId={id}
        />
      </div>
    );
  }

  return (
    <Layout>
      <div className="h-[calc(100vh-3.5rem)] bg-[#0d0d12] overflow-hidden flex flex-col">
        <div className="flex-1 flex overflow-hidden">
          {/* Panel Izquierdo: Chat */}
          <div className="w-full lg:w-[450px] flex flex-col border-r border-white/10 bg-[#0d0d12]">
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
            <div className="flex-1 overflow-y-auto px-6 py-6 space-y-6 custom-scrollbar">
              <div className="bg-blue-500/10 border border-blue-500/20 rounded-xl p-4 text-sm text-blue-200 flex items-start gap-3">
                <AlertCircle className="h-5 w-5 text-blue-400 shrink-0 mt-0.5" />
                <p>Agent will continue working after your reply</p>
              </div>

              <div className="space-y-6">
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
            </div>
          </div>

          {/* Panel Derecho: Preview Estático (cuando no está trabajando) */}
          <div className="flex-1 bg-black relative">
             {app.frontendCode ? (
                <iframe 
                  srcDoc={app.frontendCode.includes('<!DOCTYPE html>') ? app.frontendCode : `<!DOCTYPE html><html><body>${app.frontendCode}</body></html>`} 
                  title="App Preview" 
                  className="w-full h-full border-0" 
                />
             ) : (
                <div className="flex items-center justify-center h-full text-white/20">
                   <p>Esperando código del frontend...</p>
                </div>
             )}
          </div>
        </div>
      </div>
    </Layout>
  );
}
