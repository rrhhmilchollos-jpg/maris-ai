import { useState, useRef, useEffect } from "react";
import { Bot, Code2, Eye, EyeOff, Loader2, CheckCircle2, XCircle, Zap, Share2, Rocket, RefreshCcw, Maximize2, X, Layout as LayoutIcon, Paperclip, Send, Mic, Sparkles, Plus, ShoppingBag, ArrowRight, Star, Github, Globe, Search, Database, Server, MessageSquare, Terminal } from "lucide-react";
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
  if (!code || code.length < 100) return null;

  // Si el bundle parece completo (tiene index.html), lo servimos tal cual.
  const htmlMatch = code.match(/\/\/ === FILE: index\.html ===([\s\S]*?)(?:\/\/ === FILE:|$)/);
  if (htmlMatch && (htmlMatch[1].includes("<html") || htmlMatch[1].includes("<body"))) {
    return htmlMatch[1].trim();
  }

  // Si es código parcial (streaming), mostramos una pantalla de carga técnica.
  const cssMatch = code.match(/\/\/ === FILE: src\/index\.css ===([\s\S]*?)(?:\/\/ === FILE:|$)/);
  const css = cssMatch ? `<style>${cssMatch[1]}</style>` : "";
  
  const files = Array.from(code.matchAll(/\/\/ === FILE: (.*?) ===/g)).map(m => m[1]);
  const lastFile = files[files.length - 1] || "Iniciando...";

  // Intentamos extraer el contenido de App.tsx para mostrar algo si es posible
  const appMatch = code.match(/\/\/ === FILE: src\/App\.(?:tsx|jsx) ===([\s\S]*?)(?:\/\/ === FILE:|$)/);
  const appCode = appMatch ? appMatch[1].trim() : "";

  return `
    <!DOCTYPE html>
    <html lang="es">
    <head>
      <meta charset="UTF-8" />
      <script src="https://cdn.tailwindcss.com"></script>
      <style>
        @keyframes shimmer { 0% { transform: translateX(-100%); } 100% { transform: translateX(100%); } }
        @keyframes pulse-slow { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }
        :root { --primary-rgb: 124, 58, 237; }
        body { background: #0a0a0f; color: white; margin: 0; font-family: system-ui, -apple-system, sans-serif; }
      </style>
      ${css}
    </head>
    <body class="flex flex-col items-center justify-center min-h-screen p-8 overflow-hidden">
      <div class="max-w-md w-full space-y-8 text-center">
        <div class="relative inline-block">
          <div class="h-24 w-24 rounded-3xl bg-gradient-to-br from-primary to-accent animate-pulse shadow-[0_0_40px_rgba(124,58,237,0.3)]"></div>
          <div class="absolute -top-2 -right-2 h-6 w-6 bg-emerald-500 rounded-full border-4 border-[#0a0a0f] animate-bounce"></div>
        </div>
        <div class="space-y-2">
          <h2 class="text-2xl font-black tracking-tighter uppercase italic">Construyendo Interfaz</h2>
          <p class="text-white/40 text-sm font-medium">El equipo de agentes está redactando tu aplicación.</p>
        </div>
        <div class="bg-white/5 border border-white/10 rounded-2xl p-4 text-left backdrop-blur-sm">
          <div class="flex items-center gap-2 mb-3">
            <div class="h-1.5 w-1.5 rounded-full bg-primary animate-ping"></div>
            <span class="text-[10px] font-bold text-primary uppercase tracking-widest">Streaming File</span>
          </div>
          <code class="text-xs text-emerald-400 font-mono break-all block mb-2">${lastFile}</code>
          <div class="h-1 w-full bg-white/5 rounded-full overflow-hidden">
            <div class="h-full bg-primary animate-[shimmer_2s_infinite] w-full" style="background: linear-gradient(90deg, transparent, rgba(255,255,255,0.2), transparent)"></div>
          </div>
        </div>
        ${appCode ? `<div class="text-[9px] text-white/10 font-mono text-left max-h-32 overflow-hidden opacity-50">
          <p class="mb-1 uppercase tracking-widest border-b border-white/5 pb-1">Snippet src/App.tsx:</p>
          <pre>${appCode.slice(0, 300)}...</pre>
        </div>` : ""}
        <p class="text-[10px] text-white/20 font-bold uppercase tracking-[0.2em] animate-pulse-slow">Maris AI Engine v2.6 • Frontier Models Active</p>
      </div>
    </body>
    </html>
  `;
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function PreviewPane({ code, isActive, onDeploy, isDeploying, viewMode, setViewMode }: { code: string | null | undefined; isActive: boolean; onDeploy?: () => void; isDeploying?: boolean; viewMode: "preview" | "code"; setViewMode: (m: "preview" | "code") => void }) {
  const html = bundleToPreviewHtml(code);

  return (
    <div className="flex flex-col h-full min-h-0 bg-[#0d0d12]">
      <div className="flex items-center justify-between px-4 py-2 border-b border-white/10 bg-[#0d0d12] shrink-0">
        <div className="flex items-center gap-3">
          <div className="flex bg-white/5 p-1 rounded-lg border border-white/10">
            <button 
              onClick={() => setViewMode("preview")}
              className={`px-3 py-1 rounded-md text-[10px] font-bold uppercase tracking-tight transition-all ${viewMode === "preview" ? "bg-primary text-white shadow-lg" : "text-white/40 hover:text-white"}`}
            >
              Preview
            </button>
            <button 
              onClick={() => setViewMode("code")}
              className={`px-3 py-1 rounded-md text-[10px] font-bold uppercase tracking-tight transition-all ${viewMode === "code" ? "bg-primary text-white shadow-lg" : "text-white/40 hover:text-white"}`}
            >
              Código
            </button>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={onDeploy}
            disabled={!onDeploy || isDeploying}
            className="flex items-center gap-2 px-3 py-1.5 bg-primary/10 hover:bg-primary/20 text-primary border border-primary/20 rounded-lg transition-all disabled:opacity-40"
          >
            {isDeploying ? <Loader2 className="h-3 w-3 animate-spin" /> : <Rocket className="h-3 w-3" />}
            <span className="text-[10px] font-bold uppercase tracking-tight">Deploy</span>
          </button>
          <button className="p-1.5 hover:bg-white/5 rounded-md text-white/40 hover:text-white transition-colors"><RefreshCcw className="h-3.5 w-3.5" /></button>
        </div>
      </div>

      <div className="flex-1 min-h-0 relative bg-[#0a0a0f]">
        {viewMode === "code" ? (
          <div className="w-full h-full overflow-auto p-6 font-mono text-xs text-emerald-400/80 bg-[#0a0a0f] custom-scrollbar">
            <pre className="whitespace-pre-wrap leading-relaxed">
              {code || "// Esperando código..."}
            </pre>
          </div>
        ) : !html ? (
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
          <iframe srcDoc={html!} title="Preview" sandbox="allow-scripts allow-same-origin" className="w-full h-full border-0" />
        )}
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function GenerationStudio({ jobId, job, phaseLabel, PhaseIcon, appId }: GenerationStudioProps) {
  const [viewMode, setViewMode] = useState<"preview" | "code">("preview");
  const [message, setMessage] = useState("");
  const [isMaxx, setIsMaxx] = useState(false);
  const [selectedModel, setSelectedModel] = useState(() => localStorage.getItem("maris_ai_selected_model") || "auto");
  const { data: models } = useListModels();
  const { data: me } = useGetMe();
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);

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
    },
  });

  const deployAppMutation = useDeployApp({
    mutation: {
      onSuccess: (data: any) => {
        toast({ title: "Deploy completado", description: data?.deploymentUrl ?? "El proyecto se ha compilado correctamente." });
        if (data?.deploymentUrl) window.open(data.deploymentUrl, "_blank", "noopener,noreferrer");
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
    generateAppMutation.mutate({
      data: {
        prompt: message,
        coderModel: selectedModel,
        language: "typescript",
        attachments: [],
        kind: "fullstack"
      }
    });
    setMessage("");
  };

  if (!jobId) return null;

  const isActive = job?.status !== "succeeded" && job?.status !== "failed" && job?.status !== "awaiting_approval";
  const isAwaitingApproval = job?.status === "awaiting_approval";
  const partialCode = job?.partialFrontendCode;

  const AGENTS = [
    { id: 'researcher', name: 'Researcher', icon: Search, color: 'text-blue-400', phase: 'researching' },
    { id: 'architect', name: 'Architect', icon: LayoutIcon, color: 'text-purple-400', phase: 'architecting' },
    { id: 'integrator', name: 'Integrator', icon: Zap, color: 'text-yellow-400', phase: 'integrating' },
    { id: 'designer', name: 'Designer', icon: Sparkles, color: 'text-pink-400', phase: 'designing' },
    { id: 'frontend', name: 'Frontend', icon: Code2, color: 'text-emerald-400', phase: 'generating' },
    { id: 'backend', name: 'Backend', icon: Server, color: 'text-indigo-400', phase: 'backend' },
    { id: 'database', name: 'Database', icon: Database, color: 'text-amber-400', phase: 'schema' },
    { id: 'qa', name: 'QA Auditor', icon: CheckCircle2, color: 'text-cyan-400', phase: 'reviewing' },
    { id: 'devops', name: 'DevOps', icon: Rocket, color: 'text-rose-400', phase: 'testing' },
  ];

  return (
    <div className="flex flex-col h-screen bg-[#0d0d12] overflow-hidden">
      {/* ─── Header ─── */}
      <div className="flex items-center justify-between px-6 py-3 border-b border-white/5 bg-[#0d0d12]/80 backdrop-blur-xl z-50">
        <div className="flex items-center gap-4">
          <div className="h-8 w-8 rounded-xl bg-gradient-to-br from-primary to-accent flex items-center justify-center shadow-lg shadow-primary/20">
            <Sparkles className="h-4 w-4 text-white" />
          </div>
          <div>
            <h1 className="text-sm font-black tracking-tighter uppercase italic">Maris AI Studio</h1>
            <div className="flex items-center gap-2">
              <div className={`h-1.5 w-1.5 rounded-full ${isActive ? 'bg-emerald-500 animate-pulse' : 'bg-white/20'}`} />
              <span className="text-[10px] font-bold text-white/40 uppercase tracking-widest">{phaseLabel}</span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3">
           <Select value={selectedModel} onValueChange={(val) => { setSelectedModel(val); localStorage.setItem("maris_ai_selected_model", val); }}>
              <SelectTrigger className="w-[180px] h-8 bg-white/5 border-white/10 text-[11px] font-bold uppercase tracking-tight">
                <SelectValue placeholder="Modelo" />
              </SelectTrigger>
              <SelectContent className="bg-[#16161e] border-white/10">
                {models?.map((m: any) => (
                  <SelectItem key={m.id} value={m.id} className="text-[11px] font-bold uppercase tracking-tight hover:bg-primary/20">
                    {m.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button onClick={() => setLocation("/dashboard")} variant="ghost" className="h-8 text-[11px] font-bold uppercase tracking-tight text-white/40 hover:text-white">Salir</Button>
        </div>
      </div>

      {/* ─── Main Split Layout ─── */}
      <div className="flex-1 flex min-h-0">
        {/* Left Pane: Chat & Agents (40%) */}
        <div className="w-[400px] border-r border-white/5 flex flex-col bg-[#0d0d12] relative z-40 shadow-2xl">
          {/* Agents Status Bar */}
          <div className="px-4 py-4 border-b border-white/5 bg-white/[0.02]">
            <div className="grid grid-cols-3 gap-2">
              {AGENTS.map((agent) => {
                const isCurrent = job?.phase === agent.phase;
                const isPast = job?.progress && job.progress > (AGENTS.findIndex(a => a.id === agent.id) + 1) * 10;
                const Icon = agent.icon;
                return (
                  <div key={agent.id} className={`flex flex-col items-center p-2 rounded-xl border transition-all duration-300 ${isCurrent ? 'bg-primary/10 border-primary/30 shadow-lg' : isPast ? 'bg-emerald-500/5 border-emerald-500/20' : 'bg-white/[0.02] border-white/5 opacity-40'}`}>
                    <Icon className={`h-3.5 w-3.5 mb-1 ${isCurrent ? agent.color : isPast ? 'text-emerald-400' : 'text-white/20'}`} />
                    <span className="text-[8px] font-black uppercase tracking-tighter text-center leading-none">{agent.name}</span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Chat/Log Stream */}
          <div className="flex-1 overflow-hidden flex flex-col">
            <div className="flex items-center gap-2 px-4 py-3 border-b border-white/5 bg-white/[0.01]">
              <Terminal className="h-3 w-3 text-primary" />
              <span className="text-[10px] font-bold uppercase tracking-widest text-white/40">Engine Output</span>
            </div>
            <div className="flex-1 overflow-auto custom-scrollbar">
              <AgentLogStream jobId={jobId} isActive={isActive || isAwaitingApproval} />
            </div>
          </div>

          {/* Chat Input */}
          <div className="p-4 bg-[#0d0d12] border-t border-white/5">
             <div className="relative flex flex-col bg-[#16161e] border border-white/10 rounded-xl focus-within:border-primary/40 transition-all">
                <textarea 
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  placeholder="Message Agents..."
                  className="w-full bg-transparent p-3 text-xs text-white placeholder:text-white/20 outline-none resize-none h-20 custom-scrollbar"
                />
                <div className="flex items-center justify-between px-3 py-2 border-t border-white/5 bg-white/[0.02]">
                  <div className="flex items-center gap-1">
                    <button onClick={() => fileInputRef.current?.click()} className="p-1.5 text-white/40 hover:text-white hover:bg-white/5 rounded-lg transition-all"><Paperclip className="h-3.5 w-3.5" /></button>
                    <button onClick={handlePushToGitHub} className="p-1.5 text-white/40 hover:text-white hover:bg-white/5 rounded-lg transition-all"><Github className="h-3.5 w-3.5" /></button>
                  </div>
                  <button 
                    onClick={handleGenerate}
                    disabled={!message.trim()}
                    className={`p-1.5 rounded-lg transition-all ${message.trim() ? 'bg-primary text-white' : 'bg-white/5 text-white/20'}`}
                  >
                    <ArrowRight className="h-3.5 w-3.5" />
                  </button>
                </div>
             </div>
          </div>
        </div>

        {/* Right Pane: Preview (60%) */}
        <div className="flex-1 flex flex-col min-w-0 bg-black">
          <PreviewPane 
            code={partialCode} 
            isActive={isActive} 
            onDeploy={appId ? handleDeploy : undefined} 
            isDeploying={deployAppMutation.isPending}
            viewMode={viewMode}
            setViewMode={setViewMode}
          />
        </div>
      </div>

      {/* ─── Approval Footer ─── */}
      {isAwaitingApproval && (
        <div className="fixed bottom-0 left-0 right-0 p-6 bg-gradient-to-t from-black to-transparent z-[100] animate-in slide-in-from-bottom-10">
          <div className="max-w-2xl mx-auto bg-[#16161e] border border-primary/40 rounded-2xl p-6 shadow-[0_0_50px_rgba(var(--primary-rgb),0.2)]">
            <div className="flex items-center gap-4 mb-4">
              <div className="h-12 w-12 rounded-2xl bg-primary/20 flex items-center justify-center">
                <MessageSquare className="h-6 w-6 text-primary" />
              </div>
              <div>
                <h3 className="text-lg font-black tracking-tighter uppercase italic">Aprobación Requerida</h3>
                <p className="text-sm text-white/40">El Arquitecto ha terminado los planos. ¿Procedemos a la construcción?</p>
              </div>
            </div>
            <div className="flex gap-3">
              <Button 
                onClick={() => approveMutation.mutate({ id: jobId! })} 
                disabled={approveMutation.isPending}
                className="flex-1 bg-primary hover:bg-primary/90 text-white font-bold uppercase italic tracking-tighter"
              >
                {approveMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Zap className="h-4 w-4 mr-2" />}
                Confirmar y Construir
              </Button>
              <Button variant="outline" className="flex-1 border-white/10 hover:bg-white/5 text-white/60 font-bold uppercase italic tracking-tighter">Cancelar</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
