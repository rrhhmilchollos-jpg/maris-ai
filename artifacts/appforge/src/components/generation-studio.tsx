import { useState, useRef, useEffect } from "react";
import { Bot, Code2, Eye, EyeOff, Loader2, CheckCircle2, XCircle, Zap, Share2, Rocket, RefreshCcw, Maximize2, X, Layout as LayoutIcon, Paperclip, Send, Mic, Sparkles, Plus, ShoppingBag, ArrowRight, Star, Github } from "lucide-react";
import { AgentLogStream } from "@/components/agent-log-stream";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { useApproveFacet, useListModels, useGenerateApp, useGetMe, usePushAppToGitHub, useDeployApp } from "@/lib/api-client";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { getGetGenerationJobQueryKey } from "@/lib/api-client";
import { useToast } from "@/hooks/use-toast";

// ─── Types ────────────────────────────────────────────────────────────────────

interface JobState {
  status?: string;
  phase?: string;
  progress?: number;
  partialFrontendCode?: string | null;
  errorMessage?: string | null;
  awaitingApproval?: boolean;
}

interface GenerationStudioProps {
  jobId: string | null;
  job: JobState | null | undefined;
  phaseLabel: string;
  PhaseIcon: React.ComponentType<{ className?: string }>;
  appId?: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function bundleToPreviewHtml(code: string | null | undefined): string | null {
  if (!code || code.length < 200) return null;
  const htmlMatch = code.match(/\/\/ === FILE: index\.html ===([\s\S]*?)(?:\/\/ === FILE:|$)/);
  if (htmlMatch) return htmlMatch[1].trim();
  return `<!DOCTYPE html><html><body style="background:#0a0a0f;color:white;display:flex;align-items:center;justify-content:center;height:100vh;font-family:sans-serif"><div>Escribiendo código...</div></body></html>`;
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function PreviewPane({ code, isActive, onClose, onDeploy, isDeploying }: { code: string | null | undefined; isActive: boolean; onClose: () => void; onDeploy?: () => void; isDeploying?: boolean }) {
  const html = bundleToPreviewHtml(code);

  return (
    <div className="flex flex-col h-full min-h-0 bg-black">
      <div className="flex items-center justify-between px-4 py-2 border-b border-white/10 bg-[#0d0d12] shrink-0">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <div className="h-2 w-2 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]" />
            <span className="text-[11px] font-bold uppercase tracking-widest text-white/50">Live Preview</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button className="p-1.5 hover:bg-white/5 rounded-md text-white/40 hover:text-white transition-colors" title="Compartir"><Share2 className="h-3.5 w-3.5" /></button>
          <button
            onClick={onDeploy}
            disabled={!onDeploy || isDeploying}
            className="p-1.5 hover:bg-white/5 rounded-md text-white/40 hover:text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            title="Deploy · 50 créditos"
          >
            {isDeploying ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Rocket className="h-3.5 w-3.5" />}
          </button>
          <button className="p-1.5 hover:bg-white/5 rounded-md text-white/40 hover:text-white transition-colors" title="Refrescar"><RefreshCcw className="h-3.5 w-3.5" /></button>
          <div className="w-px h-4 bg-white/10 mx-1" />
          <button 
            onClick={onClose}
            className="p-1.5 bg-white/5 hover:bg-red-500/20 rounded-md text-white/60 hover:text-red-400 transition-all" 
            title="Cerrar Preview"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="flex-1 min-h-0 relative">
        {!html ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-[#0a0a0f]">
             <div className="relative">
                <div className="h-24 w-24 rounded-full border-2 border-primary/20 border-t-primary animate-spin" />
                <div className="absolute inset-0 flex items-center justify-center">
                   <div className="h-12 w-12 rounded-lg bg-gradient-to-br from-primary to-accent animate-pulse" />
                </div>
             </div>
             <p className="text-sm font-medium text-white/40 animate-pulse">Construyendo tu aplicación...</p>
          </div>
        ) : (
          <iframe srcDoc={html} title="Preview" sandbox="allow-scripts allow-same-origin" className="w-full h-full border-0" />
        )}
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function GenerationStudio({ jobId, job, phaseLabel, PhaseIcon, appId }: GenerationStudioProps) {
  const [showPreview, setShowPreview] = useState(false);
  const [message, setMessage] = useState("");
  const [isMaxx, setIsMaxx] = useState(false);
  const [showCreditsWarning, setShowCreditsWarning] = useState(false);
  const [selectedModel, setSelectedModel] = useState(() => localStorage.getItem("maris_ai_selected_model") || "claude-haiku-4-5");
  const { data: models } = useListModels();
  const { data: me } = useGetMe();
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (job?.status === "starting" || job?.status === "queued") {
      setShowPreview(false);
    }
  }, [job?.status]);

  const approveMutation = useApproveFacet({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetGenerationJobQueryKey(jobId ?? "") });
      }
    }
  });

  const generateAppMutation = useGenerateApp({
    mutation: {
      onSuccess: (data) => {
        console.log("App generated successfully:", data);
      },
      onError: (error) => {
        console.error("Error generating app:", error);
      },
    },
  });

  const pushToGitHubMutation = usePushAppToGitHub({
    mutation: {
      onSuccess: (data: any) => {
        toast({
          title: data?.updated ? "GitHub actualizado" : "Proyecto subido a GitHub",
          description: "El repositorio ya está disponible para descargar o clonar.",
        });
        if (data?.url) window.open(data.url, "_blank", "noopener,noreferrer");
      },
      onError: (error: any) => {
        toast({ title: "No se pudo subir a GitHub", description: error?.message ?? "Error", variant: "destructive" });
      },
    },
  });

  const deployAppMutation = useDeployApp({
    mutation: {
      onSuccess: (data: any) => {
        toast({ title: "Deploy completado", description: data?.deploymentUrl ?? "El proyecto se ha compilado correctamente." });
        if (data?.deploymentUrl) window.open(data.deploymentUrl, "_blank", "noopener,noreferrer");
      },
      onError: (error: any) => {
        toast({ title: "No se pudo completar el Deploy", description: error?.message ?? "Error", variant: "destructive" });
      },
    },
  });

  const handlePushToGitHub = () => {
    if (!appId || pushToGitHubMutation.isPending) return;
    pushToGitHubMutation.mutate({ id: appId });
  };

  const handleDeploy = () => {
    if (!appId || deployAppMutation.isPending) return;
    if (!me?.isAdmin && (me?.credits ?? 0) < 50) {
      toast({ title: "Créditos insuficientes", description: "El Deploy cuesta 50 créditos.", variant: "destructive" });
      setLocation("/billing");
      return;
    }
    deployAppMutation.mutate({ id: appId });
  };

  const handleGenerate = () => {
    if (!message.trim()) return;
    
    // Verificar créditos antes de generar
    if (!me?.isAdmin && (me?.credits ?? 0) <= 0) {
      setShowCreditsWarning(true);
      return;
    }

    generateAppMutation.mutate({
      data: {
        prompt: message,
        model: selectedModel,
        language: "typescript",
        attachments: [],
        kind: "fullstack"
      }
    });
    setMessage("");
  };

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [job?.progress]);

  if (!jobId) return null;

  const isActive = job?.status !== "succeeded" && job?.status !== "failed" && job?.status !== "awaiting_approval";
  const isAwaitingApproval = job?.status === "awaiting_approval";
  const isDone = job?.status === "succeeded";
  const isFailed = job?.status === "failed";
  const progressValue = job?.progress ?? 0;
  const partialCode = job?.partialFrontendCode;

  if (!job) {
    return (
      <div className="fixed inset-0 z-[100] flex flex-col items-center justify-center bg-[#0a0a0f] text-white overflow-hidden">
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[500px] bg-primary/10 rounded-full blur-[120px] animate-pulse" />
        </div>
        <div className="relative flex flex-col items-center gap-8 animate-in fade-in zoom-in-95 duration-1000">
          <div className="relative">
            <div className="h-48 w-48 rounded-full border-2 border-white/5" />
            <div className="absolute inset-0 h-48 w-48 rounded-full border-t-2 border-primary animate-spin duration-[1.5s]" />
            <div className="absolute inset-4 flex items-center justify-center">
              <div className="h-32 w-32 rounded-[40px] bg-gradient-to-br from-primary to-accent flex items-center justify-center shadow-[0_0_50px_rgba(var(--primary-rgb),0.3)] border border-white/20">
                <Bot className="h-16 w-16 text-white animate-pulse" />
              </div>
            </div>
          </div>
          <div className="text-center space-y-4 relative z-10">
            <h3 className="text-3xl font-black tracking-tighter uppercase italic">Iniciando Sistema</h3>
            <p className="text-sm font-medium text-white/40 max-w-[300px] leading-relaxed">
              Conectando con el equipo de ingenieros de Maris AI.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full w-full flex flex-col bg-[#0a0a0f] text-white overflow-hidden" data-testid="generation-studio">
      <Dialog open={showCreditsWarning} onOpenChange={setShowCreditsWarning}>
        <DialogContent className="bg-[#0d0d12] border-white/10 text-white max-w-md">
          <DialogHeader className="flex flex-col items-center text-center space-y-4">
            <div className="h-16 w-16 rounded-full bg-primary/20 flex items-center justify-center mb-2">
              <Star className="h-8 w-8 text-primary fill-primary animate-pulse" />
            </div>
            <DialogTitle className="text-2xl font-bold tracking-tight">
              ✨ Has usado todos tus créditos gratuitos
            </DialogTitle>
            <DialogDescription className="text-white/60 text-base leading-relaxed">
              Has visto lo que Maris AI puede hacer — ahora imagina todo lo que puedes construir. Compra créditos para seguir trabajando con tus agentes.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="flex flex-col sm:flex-row gap-3 mt-6">
            <Button 
              variant="outline" 
              onClick={() => setShowCreditsWarning(false)}
              className="flex-1 bg-white/5 border-white/10 hover:bg-white/10 text-white"
            >
              Cerrar
            </Button>
            <Button 
              onClick={() => setLocation("/billing")}
              className="flex-1 bg-primary hover:bg-primary/90 text-primary-foreground font-bold"
            >
              Comprar créditos
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <div className="flex items-center justify-between px-6 py-3 border-b border-white/5 bg-[#0d0d12] z-10">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
             <div className={`h-2 w-2 rounded-full ${isFailed ? 'bg-red-500' : isDone ? 'bg-emerald-500' : 'bg-primary animate-pulse'}`} />
             <span className="text-sm font-bold tracking-tight">{phaseLabel}</span>
          </div>
          <Select value={selectedModel} onValueChange={(value) => {
            setSelectedModel(value);
            localStorage.setItem("maris_ai_selected_model", value);
          }}>
            <SelectTrigger className="w-[180px] h-8 text-xs bg-white/5 border-white/10 text-white/80 hover:border-primary/40 transition-colors">
              <SelectValue placeholder="Seleccionar Modelo" />
            </SelectTrigger>
            <SelectContent className="bg-[#0d0d12] border-white/10 text-white">
              {models?.map((model: any) => (
                <SelectItem key={model.id} value={model.id}>{model.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          {isActive && (
            <div className="px-2 py-0.5 rounded bg-primary/10 border border-primary/20 flex items-center gap-1.5">
               <Zap className="h-3 w-3 text-primary" />
               <span className="text-[10px] font-bold text-primary uppercase">Multi-agente activo</span>
            </div>
          )}
        </div>
        <div className="flex items-center gap-6">
           <div className="flex items-center gap-3">
              <span className="text-xs font-mono font-bold text-white/40">{progressValue}%</span>
              <div className="w-32 h-1.5 bg-white/5 rounded-full overflow-hidden">
                 <div className="h-full bg-primary transition-all duration-500" style={{ width: `${progressValue}%` }} />
              </div>
           </div>
           <div className="flex items-center gap-2 px-3 py-1 rounded-full bg-primary/10 border border-primary/20">
              <Sparkles className="h-3 w-3 text-primary animate-pulse" />
              <span className="text-[10px] font-bold text-primary uppercase tracking-wider">Burn Rate: 1.0/hr</span>
           </div>
           {!showPreview && (
             <div className="flex items-center gap-2">
               <Button variant="ghost" size="sm" className="h-8 text-white/40 hover:text-white"><Code2 className="h-4 w-4" /> Code</Button>
               <Button 
                 variant="outline" 
                 size="sm" 
                 onClick={() => setShowPreview(true)}
                 className="h-8 gap-2 bg-primary/10 border-primary/20 hover:bg-primary/20 text-primary font-bold text-[11px]"
               >
                 <Eye className="h-3.5 w-3.5" />
                 PREVIEW
               </Button>
               <Button size="sm" className="h-8 bg-primary hover:bg-primary/90 font-bold text-[11px]"><Rocket className="h-3.5 w-3.5" /> DEPLOY</Button>
             </div>
           )}
        </div>
      </div>

      <div className="flex-1 flex flex-col lg:flex-row min-h-0 divide-y lg:divide-y-0 lg:divide-x divide-white/10">
        <div className={`flex flex-col min-h-0 bg-[#0d0d12] transition-all duration-500 ease-in-out relative ${showPreview ? 'w-full lg:w-[480px]' : 'flex-1'}`}>
          <div ref={scrollRef} className={`flex-1 overflow-y-auto p-6 space-y-6 custom-scrollbar pb-40 w-full`}>
            <div className="flex items-start gap-4 group animate-in fade-in slide-in-from-bottom-4 duration-500">
              <div className="h-8 w-8 rounded-full flex items-center justify-center border border-white/10 bg-white/5 shrink-0">
                <div className="h-4 w-4 rounded-sm bg-gradient-to-br from-white/40 to-white/10" />
              </div>
              <div className="flex-1 space-y-1">
                <div className="flex items-center gap-2">
                  <span className="text-[11px] font-bold uppercase tracking-tight text-white/40">Tú</span>
                </div>
                <details className="group/prompt">
                  <summary className="list-none cursor-pointer">
                    <div className="p-4 rounded-2xl text-sm leading-relaxed bg-white/[0.03] border border-white/5 text-white/60 shadow-sm hover:bg-white/[0.05] transition-all flex items-center justify-between">
                      <span className="truncate max-w-[80%]">
                        {localStorage.getItem("appforge_last_prompt")?.slice(0, 100) || "Crea una aplicación increíble para mí."}...
                      </span>
                      <span className="text-[10px] font-bold text-primary uppercase group-open/prompt:hidden">Ver más</span>
                      <span className="text-[10px] font-bold text-primary uppercase hidden group-open/prompt:block">Cerrar</span>
                    </div>
                  </summary>
                  <div className="mt-2 p-4 rounded-2xl text-sm leading-relaxed bg-white/[0.05] border border-primary/20 text-white/90 shadow-inner animate-in fade-in slide-in-from-top-2 duration-300">
                    {localStorage.getItem("appforge_last_prompt") || "Crea una aplicación increíble para mí."}
                  </div>
                </details>
              </div>
            </div>

            <div className="p-3 rounded-xl bg-primary/5 border border-primary/20 flex items-center justify-between gap-3 animate-in fade-in slide-in-from-top-4 relative z-10">
               <div className="flex items-center gap-3">
                 <div className="h-6 w-6 rounded-full bg-primary/20 flex items-center justify-center">
                   <Zap className="h-3 w-3 text-primary animate-pulse" />
                 </div>
                 <p className="text-xs text-white/80 font-medium">Los ingenieros están trabajando en tu aplicación en tiempo real.</p>
               </div>
               <div className="flex items-center gap-2 px-2 py-1 rounded-lg bg-white/5 border border-white/10">
                 <span className="text-[10px] font-bold text-white/40 uppercase tracking-tighter">Status:</span>
                 <span className="text-[10px] font-bold text-primary uppercase">{job?.status || 'Procesando'}</span>
               </div>
            </div>

            {isAwaitingApproval && (
              <div className="p-5 rounded-2xl border border-primary/40 bg-primary/5 shadow-2xl animate-in fade-in zoom-in-95 duration-500">
                <div className="flex items-center gap-4 mb-5">
                  <div className="h-14 w-14 rounded-2xl bg-primary/20 flex items-center justify-center border border-primary/30">
                    <Bot className="h-8 w-8 text-primary robot-vibrate" />
                  </div>
                  <div>
                    <h4 className="text-lg font-bold text-white tracking-tight">¡Arquitectura Lista!</h4>
                    <p className="text-xs text-white/50">He diseñado la base de tu app. ¿Empezamos a programar?</p>
                  </div>
                </div>
                <Button 
                  size="lg" 
                  className="w-full gap-3 text-sm font-bold bg-primary hover:bg-primary/90 shadow-xl shadow-primary/20 py-6" 
                  onClick={() => approveMutation.mutate({ id: String(jobId), data: { facet: "structure" } })}
                  disabled={approveMutation.isPending}
                >
                  {approveMutation.isPending ? <Loader2 className="h-5 w-5 animate-spin" /> : <Zap className="h-5 w-5 fill-current" />}
                  APROBAR Y CONTINUAR
                </Button>
              </div>
            )}

            <AgentLogStream jobId={jobId} isActive={isActive || isAwaitingApproval} />
          </div>

          {!showPreview && (
            <div className="sticky bottom-0 left-0 right-0 p-6 bg-[#0d0d12] z-30 border-t border-white/5">
              <div className="w-full space-y-4">
                {showCreditsWarning && (
                  <div className="flex items-center justify-between px-4 py-2 rounded-xl bg-primary/10 border border-primary/20 shadow-2xl animate-in fade-in slide-in-from-bottom-2 mb-2">
                    <div className="flex items-center gap-2">
                      <Sparkles className="h-3.5 w-3.5 text-primary animate-pulse" />
                      <span className="text-[11px] font-bold text-primary uppercase tracking-tight">Créditos bajos</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <button onClick={() => window.location.href = "/billing"} className="text-[10px] font-bold text-white bg-primary px-3 py-1 rounded-md hover:bg-primary/90 transition-all">RECARGAR</button>
                      <button onClick={() => setShowCreditsWarning(false)} className="text-white/40 hover:text-white"><X className="h-3 w-3" /></button>
                    </div>
                  </div>
                )}

                <div className="relative group">
                  <div className="absolute inset-0 bg-primary/5 rounded-2xl blur-xl group-focus-within:bg-primary/10 transition-all" />
                  <div className="relative flex flex-col bg-[#16161e] border border-white/10 rounded-2xl shadow-2xl focus-within:border-primary/40 transition-all overflow-hidden">
                    <textarea 
                      value={message}
                      onChange={(e) => setMessage(e.target.value)}
                      placeholder="Message Agent"
                      className="w-full bg-transparent p-4 text-sm text-white placeholder:text-white/20 outline-none resize-none h-24 custom-scrollbar"
                    />
                    <div className="flex items-center justify-between px-4 py-3 border-t border-white/5 bg-white/[0.02]">
                      <div className="flex items-center gap-1">
                        <input type="file" ref={fileInputRef} className="hidden" multiple />
                        <button onClick={() => fileInputRef.current?.click()} className="p-2 text-white/40 hover:text-white hover:bg-white/5 rounded-lg transition-all"><Paperclip className="h-4 w-4" /></button>
                        <button
                          onClick={handlePushToGitHub}
                          disabled={!appId || pushToGitHubMutation.isPending}
                          aria-label="Subir a GitHub"
                          title="Subir a GitHub"
                          className="p-2 text-white/40 hover:text-white hover:bg-white/5 rounded-lg transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                          {pushToGitHubMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Github className="h-4 w-4" />}
                        </button>
                        <div onClick={() => setIsMaxx(!isMaxx)} className={`flex items-center gap-2 ml-2 px-2 py-1 rounded-lg border cursor-pointer transition-all ${isMaxx ? 'bg-primary/20 border-primary/40' : 'bg-white/5 border-white/10'}`}>
                          <Sparkles className={`h-3 w-3 ${isMaxx ? 'text-primary animate-pulse' : 'text-white/40'}`} />
                          <span className={`text-[10px] font-bold uppercase tracking-tighter ${isMaxx ? 'text-primary' : 'text-white/60'}`}>Maxx</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <button onClick={() => alert("Mic")} className="p-2 text-white/40 hover:text-white hover:bg-white/5 rounded-lg transition-all"><Mic className="h-4 w-4" /></button>
                        <button 
                          onClick={handleGenerate}
                          disabled={!message.trim()}
                          className={`p-2 rounded-lg transition-all ${message.trim() ? 'bg-primary text-white shadow-lg shadow-primary/20' : 'bg-white/5 text-white/20'}`}
                        >
                          <ArrowRight className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {showPreview && (
          <div className="flex-1 flex flex-col min-h-0 bg-black relative animate-in slide-in-from-right duration-500">
            <PreviewPane code={partialCode} isActive={isActive} onClose={() => setShowPreview(false)} onDeploy={appId ? handleDeploy : undefined} isDeploying={deployAppMutation.isPending} />
            <div className="absolute bottom-8 left-1/2 -translate-x-1/2 w-full max-w-xl px-4 pointer-events-none">
              <div className="flex items-center justify-between px-6 py-4 bg-black/80 backdrop-blur-2xl border border-white/10 rounded-full shadow-[0_0_50px_rgba(0,0,0,0.5)] pointer-events-auto">
                <div className="flex items-center gap-4">
                  <div className="h-2.5 w-2.5 rounded-full bg-cyan-400 animate-pulse shadow-[0_0_10px_rgba(34,211,238,0.5)]" />
                  <p className="text-xs text-white/80 font-semibold tracking-tight">Vista previa en tiempo real.</p>
                </div>
                <button className="px-5 py-2 bg-white text-black text-xs font-bold rounded-full hover:bg-white/90 transition-all active:scale-95 shadow-lg">Ver Código</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
