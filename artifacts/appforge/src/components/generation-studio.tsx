import { useState, useRef, useEffect } from "react";
import {
  Code2, Eye, Loader2, CheckCircle2, Zap, Rocket, RefreshCcw,
  Paperclip, Send, Sparkles, Github, Search,
  Database, Server, MessageSquare, Terminal, Square,
  ChevronRight, FileCode2, Layout as LayoutIcon, Palette,
  Shield, Plug, Wrench, X, Maximize2, Minimize2
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useApproveFacet, useListModels, useGenerateApp, useGetMe, usePushAppToGitHub, useDeployApp } from "@/lib/api-client";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
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

// ─── Agent Config ─────────────────────────────────────────────────────────────

const AGENT_CONFIG: Record<string, { label: string; shortLabel: string; icon: React.ComponentType<{ className?: string }>; color: string; bg: string; phase: string }> = {
  researcher:  { label: "Researcher",        shortLabel: "R",  icon: Search,       color: "text-blue-400",    bg: "bg-blue-500/20",    phase: "researching" },
  architect:   { label: "Architect",         shortLabel: "A",  icon: LayoutIcon,   color: "text-purple-400",  bg: "bg-purple-500/20",  phase: "architecting" },
  designer:    { label: "Designer",          shortLabel: "D",  icon: Palette,      color: "text-pink-400",    bg: "bg-pink-500/20",    phase: "designing" },
  database:    { label: "Database",          shortLabel: "DB", icon: Database,     color: "text-amber-400",   bg: "bg-amber-500/20",   phase: "schema" },
  frontend:    { label: "Frontend Engineer", shortLabel: "FE", icon: Code2,        color: "text-emerald-400", bg: "bg-emerald-500/20", phase: "frontend" },
  backend:     { label: "Backend Engineer",  shortLabel: "BE", icon: Server,       color: "text-indigo-400",  bg: "bg-indigo-500/20",  phase: "backend" },
  integration: { label: "API Integrator",    shortLabel: "AI", icon: Plug,         color: "text-yellow-400",  bg: "bg-yellow-500/20",  phase: "integrations" },
  qa:          { label: "QA Specialist",     shortLabel: "QA", icon: Shield,       color: "text-cyan-400",    bg: "bg-cyan-500/20",    phase: "testing" },
  patcher:     { label: "DevOps Patcher",    shortLabel: "DO", icon: Wrench,       color: "text-rose-400",    bg: "bg-rose-500/20",    phase: "patching" },
  system:      { label: "Maris AI",          shortLabel: "M",  icon: Sparkles,     color: "text-white",       bg: "bg-white/10",       phase: "" },
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function bundleToPreviewHtml(code: string | null | undefined): string | null {
  if (!code || code.length < 100) return null;

  const htmlMatch = code.match(/\/\/ === FILE: index\.html ===([\s\S]*?)(?:\/\/ === FILE:|$)/);
  if (htmlMatch && (htmlMatch[1].includes("<html") || htmlMatch[1].includes("<body"))) {
    return htmlMatch[1].trim();
  }

  const cssMatch = code.match(/\/\/ === FILE: src\/index\.css ===([\s\S]*?)(?:\/\/ === FILE:|$)/);
  const css = cssMatch ? `<style>${cssMatch[1]}</style>` : "";
  const files = Array.from(code.matchAll(/\/\/ === FILE: (.*?) ===/g)).map(m => m[1]);
  const lastFile = files[files.length - 1] || "Iniciando...";

  return `<!DOCTYPE html><html><head><script src="https://cdn.tailwindcss.com"></script>${css}</head>
    <body class="bg-[#0a0a0f] text-white flex flex-col items-center justify-center min-h-screen font-sans p-8">
      <div class="max-w-sm w-full space-y-6 text-center">
        <div class="relative inline-flex items-center justify-center h-20 w-20 rounded-2xl bg-gradient-to-br from-violet-600 to-indigo-600 shadow-[0_0_40px_rgba(124,58,237,0.4)] mx-auto">
          <svg class="h-10 w-10 text-white animate-pulse" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z"/></svg>
          <div class="absolute -top-1 -right-1 h-4 w-4 bg-emerald-500 rounded-full border-2 border-[#0a0a0f] animate-bounce"></div>
        </div>
        <div>
          <h2 class="text-xl font-black tracking-tight text-white mb-1">Construyendo tu app</h2>
          <p class="text-sm text-white/40">Los agentes están trabajando...</p>
        </div>
        <div class="bg-white/5 border border-white/10 rounded-xl p-4 text-left space-y-2">
          <div class="flex items-center gap-2">
            <div class="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-ping"></div>
            <span class="text-[10px] font-bold text-emerald-400 uppercase tracking-widest">Archivo actual</span>
          </div>
          <code class="text-xs text-emerald-400/80 font-mono break-all">${lastFile}</code>
        </div>
      </div>
    </body></html>`;
}

function timeOf(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString("es-ES", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
  } catch { return ""; }
}

// ─── Chat Message Component ───────────────────────────────────────────────────

interface ChatMessage {
  id: string | number;
  agent: string;
  message: string;
  level: string;
  createdAt: string;
}

function AgentAvatar({ agent, isActive }: { agent: string; isActive?: boolean }) {
  const config = AGENT_CONFIG[agent] || AGENT_CONFIG.system;
  const Icon = config.icon;
  return (
    <div className={`relative flex-shrink-0 h-8 w-8 rounded-xl ${config.bg} flex items-center justify-center shadow-sm`}>
      <Icon className={`h-4 w-4 ${config.color}`} />
      {isActive && (
        <div className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full bg-emerald-500 border-2 border-[#0d0d12]" />
      )}
    </div>
  );
}

function FileEditCard({ filename }: { filename: string }) {
  return (
    <div className="flex items-center gap-2 bg-white/[0.04] border border-white/10 rounded-lg px-3 py-2 mt-2 group hover:border-emerald-500/30 hover:bg-emerald-500/5 transition-all cursor-default">
      <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 flex-shrink-0" />
      <FileCode2 className="h-3.5 w-3.5 text-white/40 flex-shrink-0" />
      <span className="text-xs text-emerald-400/80 font-mono truncate flex-1">{filename}</span>
      <ChevronRight className="h-3 w-3 text-white/20 group-hover:text-white/40 transition-colors flex-shrink-0" />
    </div>
  );
}

function ChatBubble({ msg, isLatest, isActive }: { msg: ChatMessage; isLatest: boolean; isActive: boolean }) {
  const config = AGENT_CONFIG[msg.agent] || AGENT_CONFIG.system;
  const isFile = msg.message.includes("FILE:") || msg.message.includes("=== FILE");
  const isError = msg.level === "error";
  const isWarn = msg.level === "warn";

  // Extract filename from FILE: messages
  const fileMatch = msg.message.match(/(?:FILE:|=== FILE: )(.*?)(?:\s*===|$)/);
  const filename = fileMatch ? fileMatch[1].trim() : null;

  if (isFile && filename) {
    return (
      <div className="flex items-start gap-3 group">
        <AgentAvatar agent={msg.agent} isActive={isLatest && isActive} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className={`text-[11px] font-bold ${config.color}`}>{config.label}</span>
            <span className="text-[10px] text-white/20">{timeOf(msg.createdAt)}</span>
          </div>
          <FileEditCard filename={filename} />
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-start gap-3 group animate-in fade-in slide-in-from-bottom-2 duration-300">
      <AgentAvatar agent={msg.agent} isActive={isLatest && isActive} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1.5">
          <span className={`text-[11px] font-bold ${config.color}`}>{config.label}</span>
          <span className="text-[10px] text-white/20">{timeOf(msg.createdAt)}</span>
          {isLatest && isActive && (
            <div className="flex items-center gap-1">
              <div className="h-1 w-1 rounded-full bg-emerald-500 animate-bounce" style={{ animationDelay: "0ms" }} />
              <div className="h-1 w-1 rounded-full bg-emerald-500 animate-bounce" style={{ animationDelay: "150ms" }} />
              <div className="h-1 w-1 rounded-full bg-emerald-500 animate-bounce" style={{ animationDelay: "300ms" }} />
            </div>
          )}
        </div>
        <div className={`rounded-2xl rounded-tl-sm px-4 py-3 text-sm leading-relaxed max-w-[calc(100%-2rem)] ${
          isError
            ? "bg-red-500/10 border border-red-500/20 text-red-300"
            : isWarn
            ? "bg-amber-500/10 border border-amber-500/20 text-amber-300"
            : "bg-white/[0.05] border border-white/[0.08] text-white/80"
        }`}>
          <p className="whitespace-pre-wrap break-words">{msg.message}</p>
        </div>
      </div>
    </div>
  );
}

// ─── Agent Log Stream (Chat Mode) ─────────────────────────────────────────────

import { useQuery } from "@tanstack/react-query";
import { getGenerationJobLogs, getGetGenerationJobLogsQueryKey } from "@/lib/api-client";

function ChatLogStream({ jobId, isActive }: { jobId: string | null; isActive: boolean }) {
  const [lines, setLines] = useState<ChatMessage[]>([]);
  const [lastId, setLastId] = useState<number | string>(0);
  const [streamPaused, setStreamPaused] = useState(false);
  const consecutiveErrorsRef = useRef(0);
  const lastJobIdRef = useRef<string | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const queryClient = useQueryClient();

  useEffect(() => {
    if (lastJobIdRef.current !== jobId) {
      lastJobIdRef.current = jobId;
      setLines([]);
      setLastId(0);
      setStreamPaused(false);
      consecutiveErrorsRef.current = 0;
    }
  }, [jobId]);

  const enabled = jobId !== null && !streamPaused;
  const queryKey = [...getGetGenerationJobLogsQueryKey(jobId ?? ""), "chat-stream"];

  const { data } = useQuery({
    queryKey,
    queryFn: async ({ signal }) => {
      try {
        const result = await getGenerationJobLogs(jobId ?? "", { afterId: lastId }, { signal });
        consecutiveErrorsRef.current = 0;
        return result;
      } catch (error) {
        if (signal?.aborted) throw error;
        consecutiveErrorsRef.current += 1;
        if (consecutiveErrorsRef.current >= 3) setStreamPaused(true);
        throw error;
      }
    },
    enabled,
    refetchInterval: isActive ? 400 : false,
    refetchOnWindowFocus: false,
    staleTime: 0,
    gcTime: 60_000,
    retry: 1,
  });

  useEffect(() => {
    if (!data?.logs?.length) return;
    setLines((prev) => {
      const seen = new Set(prev.map((l: any) => l.id));
      const fresh = data.logs.filter((l: any) => !seen.has(l.id));
      if (fresh.length === 0) return prev;
      return [...prev, ...fresh];
    });
    const newestLog = data.logs[data.logs.length - 1];
    if (newestLog) setLastId(newestLog.id);
  }, [data]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines.length]);

  if (jobId === null) return null;

  return (
    <div className="flex flex-col h-full overflow-auto p-4 space-y-4 custom-scrollbar" ref={scrollRef}>
      {lines.length === 0 && isActive && (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <div className="h-12 w-12 rounded-2xl bg-primary/20 flex items-center justify-center mb-4 animate-pulse">
            <Sparkles className="h-6 w-6 text-primary" />
          </div>
          <p className="text-sm font-semibold text-white/60">Iniciando agentes...</p>
          <p className="text-xs text-white/30 mt-1">Los agentes están preparándose</p>
        </div>
      )}
      {lines.map((line, idx) => (
        <ChatBubble
          key={line.id}
          msg={line}
          isLatest={idx === lines.length - 1}
          isActive={isActive}
        />
      ))}
      <div ref={scrollRef} />
    </div>
  );
}

// ─── Preview Pane ─────────────────────────────────────────────────────────────

function PreviewPane({
  code, isActive, onDeploy, isDeploying, viewMode, setViewMode, phase, isExpanded, onToggleExpand
}: {
  code: string | null | undefined;
  isActive: boolean;
  onDeploy?: () => void;
  isDeploying?: boolean;
  viewMode: "preview" | "code";
  setViewMode: (m: "preview" | "code") => void;
  phase?: string;
  isExpanded?: boolean;
  onToggleExpand?: () => void;
}) {
  const html = bundleToPreviewHtml(code);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const handleRefresh = () => {
    if (iframeRef.current) {
      iframeRef.current.src = iframeRef.current.src;
    }
  };

  return (
    <div className="flex flex-col h-full min-h-0 bg-[#0a0a0f]">
      {/* Preview header */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-white/[0.06] bg-[#0d0d12] shrink-0">
        <div className="flex items-center gap-1 bg-white/[0.04] p-1 rounded-lg border border-white/[0.06]">
          <button
            onClick={() => setViewMode("preview")}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[11px] font-semibold transition-all ${
              viewMode === "preview"
                ? "bg-white/10 text-white shadow-sm"
                : "text-white/40 hover:text-white/70"
            }`}
          >
            <Eye className="h-3 w-3" />
            Preview
          </button>
          <button
            onClick={() => setViewMode("code")}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[11px] font-semibold transition-all ${
              viewMode === "code"
                ? "bg-white/10 text-white shadow-sm"
                : "text-white/40 hover:text-white/70"
            }`}
          >
            <Code2 className="h-3 w-3" />
            Código
          </button>
        </div>

        <div className="flex items-center gap-1.5">
          {onDeploy && (
            <button
              onClick={onDeploy}
              disabled={!onDeploy || isDeploying}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-primary/10 hover:bg-primary/20 text-primary border border-primary/20 rounded-lg transition-all disabled:opacity-40 text-[11px] font-semibold"
            >
              {isDeploying ? <Loader2 className="h-3 w-3 animate-spin" /> : <Rocket className="h-3 w-3" />}
              Deploy
            </button>
          )}
          <button
            onClick={handleRefresh}
            className="p-1.5 hover:bg-white/5 rounded-lg text-white/30 hover:text-white/60 transition-colors"
            title="Refrescar preview"
          >
            <RefreshCcw className="h-3.5 w-3.5" />
          </button>
          {onToggleExpand && (
            <button
              onClick={onToggleExpand}
              className="p-1.5 hover:bg-white/5 rounded-lg text-white/30 hover:text-white/60 transition-colors"
              title={isExpanded ? "Contraer" : "Expandir"}
            >
              {isExpanded ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
            </button>
          )}
        </div>
      </div>

      {/* Preview content */}
      <div className="flex-1 min-h-0 relative">
        {viewMode === "code" ? (
          <div className="w-full h-full overflow-auto p-6 font-mono text-xs text-emerald-400/80 bg-[#080810] custom-scrollbar">
            <pre className="whitespace-pre-wrap leading-relaxed">
              {code || "// Esperando código..."}
            </pre>
          </div>
        ) : !html ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-[#0a0a0f]">
            {/* Loading state */}
            <div className="space-y-6 text-center max-w-xs px-6">
              <div className="relative mx-auto h-16 w-16 rounded-2xl bg-gradient-to-br from-violet-600/30 to-indigo-600/20 border border-violet-500/20 flex items-center justify-center">
                <Sparkles className="h-8 w-8 text-violet-400 animate-pulse" />
                <div className="absolute -top-1 -right-1 h-3 w-3 bg-emerald-500 rounded-full border-2 border-[#0a0a0f] animate-bounce" />
              </div>
              <div>
                <p className="text-sm font-semibold text-white/70 mb-1">Construyendo tu aplicación</p>
                <p className="text-xs text-white/30">{phase || "Los agentes están trabajando..."}</p>
              </div>
              {isActive && (
                <div className="h-1 w-full bg-white/5 rounded-full overflow-hidden">
                  <div className="h-full bg-gradient-to-r from-violet-600 to-indigo-500 rounded-full animate-[shimmer_2s_ease-in-out_infinite]" />
                </div>
              )}
            </div>
            <style>{`
              @keyframes shimmer {
                0% { width: 10%; margin-left: 0%; }
                50% { width: 60%; margin-left: 20%; }
                100% { width: 10%; margin-left: 90%; }
              }
            `}</style>
          </div>
        ) : (
          <iframe
            ref={iframeRef}
            srcDoc={html}
            title="App Preview"
            sandbox="allow-scripts allow-same-origin"
            className="w-full h-full border-0"
          />
        )}
      </div>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function GenerationStudio({ jobId, job, phaseLabel, PhaseIcon, appId }: GenerationStudioProps) {
  const [viewMode, setViewMode] = useState<"preview" | "code">("preview");
  const [message, setMessage] = useState("");
  const [previewExpanded, setPreviewExpanded] = useState(false);
  const [selectedModel, setSelectedModel] = useState(() => localStorage.getItem("maris_ai_selected_model") || "claude-sonnet-4-6");
  const { data: models } = useListModels();
  const { data: me } = useGetMe();
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

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
        console.log("Follow-up generated:", data);
      },
    },
  });

  const pushToGitHubMutation = usePushAppToGitHub({
    mutation: {
      onSuccess: (data: any) => {
        toast({
          title: data?.updated ? "GitHub actualizado" : "Proyecto subido a GitHub",
          description: "El repositorio ya está disponible.",
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

  const handleSendMessage = () => {
    if (!message.trim()) return;
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

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  if (!jobId) return null;

  const isActive = job?.status !== "succeeded" && job?.status !== "failed" && job?.status !== "awaiting_approval";
  const isAwaitingApproval = job?.status === "awaiting_approval";
  const isDone = job?.status === "succeeded";
  const isFailed = job?.status === "failed";
  const partialCode = job?.partialFrontendCode;

  // Current active agent
  const currentPhase = job?.phase || "queued";
  const currentAgent = Object.entries(AGENT_CONFIG).find(([, cfg]) => cfg.phase === currentPhase)?.[0] || "system";
  const currentAgentConfig = AGENT_CONFIG[currentAgent];

  return (
    <div className="flex flex-col h-screen bg-[#0d0d12] overflow-hidden">
      {/* ─── Top Bar ─── */}
      <div className="flex items-center justify-between px-5 py-2.5 border-b border-white/[0.06] bg-[#0d0d12] shrink-0 z-50">
        <div className="flex items-center gap-3">
          {/* Logo */}
          <div className="flex items-center gap-2">
            <div className="h-7 w-7 rounded-lg bg-gradient-to-br from-violet-600 to-indigo-600 flex items-center justify-center shadow-lg shadow-violet-500/20">
              <Sparkles className="h-3.5 w-3.5 text-white" />
            </div>
            <span className="text-sm font-bold text-white/90">Maris AI</span>
          </div>

          {/* Separator */}
          <div className="h-4 w-px bg-white/10" />

          {/* Status */}
          <div className="flex items-center gap-2">
            <div className={`h-2 w-2 rounded-full ${
              isActive ? "bg-emerald-500 animate-pulse" :
              isDone ? "bg-emerald-500" :
              isFailed ? "bg-red-500" :
              "bg-white/20"
            }`} />
            <span className="text-xs text-white/50 font-medium">{phaseLabel}</span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Model selector */}
          <Select
            value={selectedModel}
            onValueChange={(val) => {
              setSelectedModel(val);
              localStorage.setItem("maris_ai_selected_model", val);
            }}
          >
            <SelectTrigger className="h-7 w-[160px] bg-white/[0.04] border-white/[0.08] text-[11px] font-semibold text-white/60 hover:text-white transition-colors">
              <SelectValue placeholder="Modelo" />
            </SelectTrigger>
            <SelectContent className="bg-[#16161e] border-white/10">
              {models?.map((m: any) => (
                <SelectItem key={m.id} value={m.id} className="text-[11px] font-semibold text-white/70 hover:text-white hover:bg-white/5">
                  {m.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* GitHub */}
          {appId && (
            <button
              onClick={handlePushToGitHub}
              disabled={pushToGitHubMutation.isPending}
              className="flex items-center gap-1.5 px-2.5 py-1.5 bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.08] rounded-lg text-[11px] font-semibold text-white/50 hover:text-white transition-all disabled:opacity-40"
            >
              {pushToGitHubMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Github className="h-3 w-3" />}
              GitHub
            </button>
          )}

          {/* Exit */}
          <button
            onClick={() => setLocation("/dashboard")}
            className="flex items-center gap-1.5 px-2.5 py-1.5 bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.08] rounded-lg text-[11px] font-semibold text-white/50 hover:text-white transition-all"
          >
            <X className="h-3 w-3" />
            Salir
          </button>
        </div>
      </div>

      {/* ─── Main Layout ─── */}
      <div className="flex-1 flex min-h-0">
        {/* Left Panel: Chat (like Emergent) */}
        <div className={`${previewExpanded ? "w-0 overflow-hidden" : "w-[480px]"} border-r border-white/[0.06] flex flex-col bg-[#0d0d12] transition-all duration-300`}>
          {/* Chat header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-white/[0.06] bg-[#0a0a0a] shrink-0">
            <div className="flex items-center gap-2">
              {isActive ? (
                <>
                  <AgentAvatar agent={currentAgent} isActive />
                  <div>
                    <p className="text-xs font-bold text-white/80">{currentAgentConfig.label}</p>
                    <p className="text-[10px] text-white/30">Trabajando...</p>
                  </div>
                </>
              ) : isDone ? (
                <>
                  <div className="h-8 w-8 rounded-xl bg-emerald-500/20 flex items-center justify-center">
                    <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                  </div>
                  <div>
                    <p className="text-xs font-bold text-emerald-400">Generación completada</p>
                    <p className="text-[10px] text-white/30">Tu app está lista</p>
                  </div>
                </>
              ) : isFailed ? (
                <>
                  <div className="h-8 w-8 rounded-xl bg-red-500/20 flex items-center justify-center">
                    <X className="h-4 w-4 text-red-400" />
                  </div>
                  <div>
                    <p className="text-xs font-bold text-red-400">Generación fallida</p>
                    <p className="text-[10px] text-white/30">{job?.errorMessage?.slice(0, 40) || "Error desconocido"}</p>
                  </div>
                </>
              ) : (
                <>
                  <div className="h-8 w-8 rounded-xl bg-white/5 flex items-center justify-center">
                    <Terminal className="h-4 w-4 text-white/40" />
                  </div>
                  <p className="text-xs font-bold text-white/50">Consola de agentes</p>
                </>
              )}
            </div>

            {/* Stop button */}
            {isActive && (
              <button
                className="flex items-center gap-1.5 px-2.5 py-1.5 bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 rounded-lg text-[11px] font-semibold text-red-400 hover:text-red-300 transition-all"
                onClick={() => setLocation("/dashboard")}
              >
                <Square className="h-3 w-3 fill-current" />
                Stop
              </button>
            )}
          </div>

          {/* Chat messages */}
          <div className="flex-1 overflow-hidden">
            <ChatLogStream jobId={jobId} isActive={isActive || isAwaitingApproval} />
          </div>

          {/* Message input */}
          <div className="p-3 border-t border-white/[0.06] bg-[#0a0a0a] shrink-0">
            <div className="relative flex flex-col bg-[#16161e] border border-white/[0.08] rounded-xl focus-within:border-primary/40 transition-all">
              <textarea
                ref={textareaRef}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Mensaje a los agentes... (Enter para enviar)"
                className="w-full bg-transparent px-4 pt-3 pb-2 text-sm text-white placeholder:text-white/20 outline-none resize-none h-[72px] custom-scrollbar"
                disabled={generateAppMutation.isPending}
              />
              <div className="flex items-center justify-between px-3 py-2 border-t border-white/[0.05]">
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    className="p-1.5 text-white/30 hover:text-white/60 hover:bg-white/5 rounded-lg transition-all"
                    title="Adjuntar archivo"
                  >
                    <Paperclip className="h-3.5 w-3.5" />
                  </button>
                  {appId && (
                    <button
                      onClick={handlePushToGitHub}
                      className="p-1.5 text-white/30 hover:text-white/60 hover:bg-white/5 rounded-lg transition-all"
                      title="Subir a GitHub"
                    >
                      <Github className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
                <button
                  onClick={handleSendMessage}
                  disabled={!message.trim() || generateAppMutation.isPending}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold transition-all ${
                    message.trim()
                      ? "bg-primary text-white hover:bg-primary/90 shadow-lg shadow-primary/20"
                      : "bg-white/5 text-white/20 cursor-not-allowed"
                  }`}
                >
                  {generateAppMutation.isPending ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Send className="h-3.5 w-3.5" />
                  )}
                  Enviar
                </button>
              </div>
            </div>
            <input ref={fileInputRef} type="file" className="hidden" multiple />
          </div>
        </div>

        {/* Right Panel: Preview */}
        <div className="flex-1 flex flex-col min-w-0 bg-[#080810]">
          <PreviewPane
            code={partialCode}
            isActive={isActive}
            onDeploy={appId ? handleDeploy : undefined}
            isDeploying={deployAppMutation.isPending}
            viewMode={viewMode}
            setViewMode={setViewMode}
            phase={phaseLabel}
            isExpanded={previewExpanded}
            onToggleExpand={() => setPreviewExpanded(p => !p)}
          />
        </div>
      </div>

      {/* ─── Approval Modal ─── */}
      {isAwaitingApproval && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[100] flex items-end justify-center p-6 animate-in fade-in duration-300">
          <div className="w-full max-w-lg bg-[#16161e] border border-primary/30 rounded-2xl p-6 shadow-[0_0_60px_rgba(124,58,237,0.2)] animate-in slide-in-from-bottom-10 duration-400">
            <div className="flex items-center gap-4 mb-5">
              <div className="h-12 w-12 rounded-2xl bg-primary/20 flex items-center justify-center flex-shrink-0">
                <MessageSquare className="h-6 w-6 text-primary" />
              </div>
              <div>
                <h3 className="text-base font-bold text-white">Aprobación requerida</h3>
                <p className="text-sm text-white/40 mt-0.5">El Arquitecto ha terminado los planos. ¿Procedemos?</p>
              </div>
            </div>
            <div className="flex gap-3">
              <Button
                onClick={() => approveMutation.mutate({ id: jobId! })}
                disabled={approveMutation.isPending}
                className="flex-1 bg-primary hover:bg-primary/90 text-white font-semibold h-11"
              >
                {approveMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                ) : (
                  <Zap className="h-4 w-4 mr-2" />
                )}
                Confirmar y construir
              </Button>
              <Button
                variant="outline"
                className="flex-1 border-white/10 hover:bg-white/5 text-white/60 font-semibold h-11"
                onClick={() => setLocation("/dashboard")}
              >
                Cancelar
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
