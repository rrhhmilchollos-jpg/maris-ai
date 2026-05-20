import { useState } from "react";
import { Bot, Code2, Eye, EyeOff, Loader2, CheckCircle2, XCircle, Zap, Share2, Rocket, RefreshCcw, Maximize2 } from "lucide-react";
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

function PreviewPane({ code, isActive }: { code: string | null | undefined; isActive: boolean }) {
  const html = bundleToPreviewHtml(code);
  const [showPreview, setShowPreview] = useState(true);

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex items-center justify-between px-4 py-2 border-b border-white/10 bg-[#0d0d12] shrink-0">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <div className="h-2 w-2 rounded-full bg-white/20" />
            <span className="text-[11px] font-bold uppercase tracking-widest text-white/50">App Preview</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button className="p-1.5 hover:bg-white/5 rounded-md text-white/40 hover:text-white transition-colors"><Share2 className="h-3.5 w-3.5" /></button>
          <button className="p-1.5 hover:bg-white/5 rounded-md text-white/40 hover:text-white transition-colors"><Rocket className="h-3.5 w-3.5" /></button>
          <button className="p-1.5 hover:bg-white/5 rounded-md text-white/40 hover:text-white transition-colors"><RefreshCcw className="h-3.5 w-3.5" /></button>
          <button className="p-1.5 hover:bg-white/5 rounded-md text-white/40 hover:text-white transition-colors"><Maximize2 className="h-3.5 w-3.5" /></button>
        </div>
      </div>

      <div className="flex-1 min-h-0 relative bg-black">
        {!html ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-4">
             <div className="relative">
                <div className="h-24 w-24 rounded-full border-2 border-primary/20 border-t-primary animate-spin" />
                <div className="absolute inset-0 flex items-center justify-center">
                   <div className="h-12 w-12 rounded-lg bg-gradient-to-br from-primary to-accent animate-pulse" />
                </div>
             </div>
             <p className="text-sm font-medium text-white/40 animate-pulse">Building something incredible ~!</p>
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
  const queryClient = useQueryClient();
  const approveMutation = useApproveFacet({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetGenerationJobQueryKey(jobId ?? "") });
      }
    }
  });

  // Defensive check: if jobId is missing, don't render anything to avoid network cancellations
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
      <div className="flex items-center justify-between px-6 py-3 border-b border-white/5 bg-[#0d0d12]">
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
        <div className="flex items-center gap-4">
           <span className="text-sm font-mono font-bold text-white/40">{progressValue}%</span>
           <div className="w-32 h-1.5 bg-white/5 rounded-full overflow-hidden">
              <div className="h-full bg-primary transition-all duration-500" style={{ width: `${progressValue}%` }} />
           </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex flex-col lg:flex-row min-h-0 divide-y lg:divide-y-0 lg:divide-x divide-white/10">
        {/* Left Panel: Chat/Logs */}
        <div className="w-full lg:w-[480px] flex flex-col min-h-0 bg-[#0d0d12]">
          <div className="flex-1 overflow-y-auto p-6 space-y-6 custom-scrollbar">
            {/* Blue Notice Banner */}
            <div className="p-3 rounded-lg bg-blue-500/10 border border-blue-500/20 flex items-center gap-3">
               <div className="h-5 w-5 rounded-full bg-blue-500 flex items-center justify-center text-[10px] font-bold">i</div>
               <p className="text-xs text-blue-400 font-medium">Agent will continue working after your reply</p>
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
          </div>
        </div>

        {/* Right Panel: Preview */}
        <div className="flex-1 flex flex-col min-h-0 bg-black relative">
          <PreviewPane code={partialCode} isActive={isActive} />
          
          {/* Emergent-style Bottom Floating Bar */}
          <div className="absolute bottom-8 left-1/2 -translate-x-1/2 w-full max-w-xl px-4">
            <div className="flex items-center justify-between px-6 py-4 bg-black/80 backdrop-blur-2xl border border-white/10 rounded-full shadow-[0_0_50px_rgba(0,0,0,0.5)]">
              <div className="flex items-center gap-4">
                <div className="h-2.5 w-2.5 rounded-full bg-cyan-400 animate-pulse shadow-[0_0_10px_rgba(34,211,238,0.5)]" />
                <p className="text-xs text-white/80 font-semibold tracking-tight">
                  You're viewing a static preview. Resume to interact.
                </p>
              </div>
              <button className="px-5 py-2 bg-white text-black text-xs font-bold rounded-full hover:bg-white/90 transition-all active:scale-95 shadow-lg">
                Resume Preview
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
