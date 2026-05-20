import { useState, useRef, useEffect } from "react";
import { Bot, Code2, Eye, EyeOff, Loader2, CheckCircle2, XCircle, Zap, Share2, Rocket, RefreshCcw, Maximize2, X, Layout as LayoutIcon, Paperclip, Send, Mic, Sparkles, Plus, GitFork, ShoppingBag, ArrowRight } from "lucide-react";
import { AgentLogStream } from "@/components/agent-log-stream";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { useApproveFacet } from "@/lib/api-client";
import { useQueryClient } from "@tanstack/react-query";
import { getGetGenerationJobQueryKey } from "@/lib/api-client";

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
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function bundleToPreviewHtml(code: string | null | undefined): string | null {
  if (!code || code.length < 200) return null;
  const htmlMatch = code.match(/\/\/ === FILE: index\.html ===([\s\S]*?)(?:\/\/ === FILE:|$)/);
  if (htmlMatch) return htmlMatch[1].trim();
  return `<!DOCTYPE html><html><body style="background:#0a0a0f;color:white;display:flex;align-items:center;justify-content:center;height:100vh;font-family:sans-serif"><div>Escribiendo código...</div></body></html>`;
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function PreviewPane({ code, isActive, onClose }: { code: string | null | undefined; isActive: boolean; onClose: () => void }) {
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
          <button className="p-1.5 hover:bg-white/5 rounded-md text-white/40 hover:text-white transition-colors" title="Desplegar"><Rocket className="h-3.5 w-3.5" /></button>
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

export function GenerationStudio({ jobId, job, phaseLabel, PhaseIcon }: GenerationStudioProps) {
  const [showPreview, setShowPreview] = useState(true);
  const [message, setMessage] = useState("");
  const [isMaxx, setIsMaxx] = useState(false);
  const [showCreditsWarning, setShowCreditsWarning] = useState(true);
  const queryClient = useQueryClient();
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const approveMutation = useApproveFacet({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetGenerationJobQueryKey(jobId ?? "") });
      }
    }
  });

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
      <div className="h-full w-full flex flex-col items-center justify-center bg-[#0a0a0f] text-white">
        <div className="relative">
          <div className="h-24 w-24 rounded-full border-2 border-primary/20 border-t-primary animate-spin" />
          <div className="absolute inset-0 flex items-center justify-center">
            <Bot className="h-10 w-10 text-primary animate-pulse" />
          </div>
        </div>
        <p className="mt-6 text-sm font-medium text-white/40 animate-pulse">Conectando con los agentes...</p>
      </div>
    );
  }

  return (
    <div className="h-full w-full flex flex-col bg-[#0a0a0f] text-white overflow-hidden" data-testid="generation-studio">
      {/* Top Bar */}
      <div className="flex items-center justify-between px-6 py-3 border-b border-white/5 bg-[#0d0d12] z-10">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
             <div className={`h-2 w-2 rounded-full ${isFailed ? 'bg-red-500' : isDone ? 'bg-emerald-500' : 'bg-primary animate-pulse'}`} />
             <span className="text-sm font-bold tracking-tight">{phaseLabel}</span>
          </div>
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

      {/* Main Content */}
      <div className="flex-1 flex flex-col lg:flex-row min-h-0 divide-y lg:divide-y-0 lg:divide-x divide-white/10">
        {/* Left Panel: Chat/Logs */}
        <div className={`flex flex-col min-h-0 bg-[#0d0d12] transition-all duration-500 ease-in-out relative ${showPreview ? 'w-full lg:w-[480px]' : 'flex-1'}`}>
          <div ref={scrollRef} className={`flex-1 overflow-y-auto p-6 space-y-6 custom-scrollbar ${!showPreview ? 'max-w-3xl mx-auto w-full' : ''}`}>
            
            {/* Blue Notice Banner */}
            <div className="p-3 rounded-xl bg-primary/5 border border-primary/20 flex items-center justify-between gap-3 animate-in fade-in slide-in-from-top-4">
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

            {/* Awaiting Approval Card */}
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
            
            {/* Spacer for bottom bar */}
            {!showPreview && <div className="h-32" />}
          </div>

          {/* Bottom Chat Bar (Only in Chat-Only mode) */}
          {!showPreview && (
            <div className="absolute bottom-0 left-0 right-0 p-6 bg-gradient-to-t from-[#0d0d12] via-[#0d0d12] to-transparent">
              <div className="max-w-3xl mx-auto space-y-4">
                {/* Credits Warning */}
                {showCreditsWarning && (
                  <div className="flex items-center justify-between px-4 py-2 rounded-xl bg-white/5 border border-white/10 animate-in fade-in slide-in-from-bottom-2">
                    <div className="flex items-center gap-2">
                      <div className="h-4 w-4 rounded-full bg-primary/20 flex items-center justify-center">
                        <Plus className="h-2.5 w-2.5 text-primary" />
                      </div>
                      <span className="text-[11px] font-medium text-white/60">¿Te quedan pocos créditos?</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <button 
                        onClick={() => {
                          if (typeof window !== 'undefined') {
                            window.location.href = "/billing";
                          }
                        }}
                        className="text-[11px] font-bold text-white hover:text-primary transition-colors flex items-center gap-1.5 bg-white/5 px-3 py-1 rounded-lg border border-white/10"
                      >
                        <ShoppingBag className="h-3 w-3" /> Comprar créditos
                      </button>
                      <button onClick={() => setShowCreditsWarning(false)} className="text-white/40 hover:text-white"><X className="h-3 w-3" /></button>
                    </div>
                  </div>
                )}

                {/* Input Area */}
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
                        <button 
                          onClick={() => fileInputRef.current?.click()}
                          className="p-2 text-white/40 hover:text-white hover:bg-white/5 rounded-lg transition-all"
                        >
                          <Paperclip className="h-4 w-4" />
                        </button>
                        <button 
                          onClick={() => alert("Proyecto guardado en tu biblioteca.")}
                          className="p-2 text-white/40 hover:text-white hover:bg-white/5 rounded-lg transition-all flex items-center gap-1.5 text-xs font-bold"
                        >
                          <RefreshCcw className="h-3.5 w-3.5" /> Save
                        </button>
                        <button 
                          onClick={() => alert("Clonando proyecto para una nueva versión...")}
                          className="p-2 text-white/40 hover:text-white hover:bg-white/5 rounded-lg transition-all flex items-center gap-1.5 text-xs font-bold"
                        >
                          <GitFork className="h-3.5 w-3.5" /> Fork
                        </button>
                        <div 
                          onClick={() => setIsMaxx(!isMaxx)}
                          className={`flex items-center gap-2 ml-2 px-2 py-1 rounded-lg border cursor-pointer transition-all ${isMaxx ? 'bg-primary/20 border-primary/40' : 'bg-white/5 border-white/10'}`}
                        >
                          <Sparkles className={`h-3 w-3 ${isMaxx ? 'text-primary animate-pulse' : 'text-white/40'}`} />
                          <span className={`text-[10px] font-bold uppercase tracking-tighter ${isMaxx ? 'text-primary' : 'text-white/60'}`}>Maxx</span>
                          <div className={`w-6 h-3 rounded-full relative transition-colors ${isMaxx ? 'bg-primary/40' : 'bg-white/10'}`}>
                            <div className={`absolute top-0.5 w-2 h-2 rounded-full transition-all ${isMaxx ? 'right-0.5 bg-primary' : 'left-0.5 bg-white/40'}`} />
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <button 
                          onClick={() => alert("Escuchando... (Función de voz próximamente)")}
                          className="p-2 text-white/40 hover:text-white hover:bg-white/5 rounded-lg transition-all"
                        >
                          <Mic className="h-4 w-4" />
                        </button>
                        <button 
                          onClick={() => {
                            if (message.trim()) {
                              alert("Mensaje enviado a los agentes: " + message);
                              setMessage("");
                            }
                          }}
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

        {/* Right Panel: Preview */}
        {showPreview && (
          <div className="flex-1 flex flex-col min-h-0 bg-black relative animate-in slide-in-from-right duration-500">
            <PreviewPane code={partialCode} isActive={isActive} onClose={() => setShowPreview(false)} />
            
            {/* Emergent-style Bottom Floating Bar */}
            <div className="absolute bottom-8 left-1/2 -translate-x-1/2 w-full max-w-xl px-4 pointer-events-none">
              <div className="flex items-center justify-between px-6 py-4 bg-black/80 backdrop-blur-2xl border border-white/10 rounded-full shadow-[0_0_50px_rgba(0,0,0,0.5)] pointer-events-auto">
                <div className="flex items-center gap-4">
                  <div className="h-2.5 w-2.5 rounded-full bg-cyan-400 animate-pulse shadow-[0_0_10px_rgba(34,211,238,0.5)]" />
                  <p className="text-xs text-white/80 font-semibold tracking-tight">
                    Vista previa en tiempo real.
                  </p>
                </div>
                <button className="px-5 py-2 bg-white text-black text-xs font-bold rounded-full hover:bg-white/90 transition-all active:scale-95 shadow-lg">
                  Ver Código
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
