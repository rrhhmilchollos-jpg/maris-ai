import { useState, useEffect, useRef } from "react";
import {
  Code2, Eye, Loader2, CheckCircle2, Zap, Rocket, RefreshCcw,
  Paperclip, Send, Sparkles, Github, Search,
  Database, Server, MessageSquare, Terminal, Square,
  ChevronRight, FileCode2, Layout as LayoutIcon, Palette,
  Shield, Plug, Wrench, X, Maximize2, Minimize2, AlertTriangle,
  Clock, CheckCheck, Play, Globe, Bug, ShieldCheck
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  useApproveFacet, useListModels, useGenerateApp,
  useGetMe, usePushAppToGitHub, useDeployApp
} from "@/lib/api-client";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue
} from "@/components/ui/select";
import { useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { getGetGenerationJobQueryKey, getGenerationJobLogs, getGetGenerationJobLogsQueryKey } from "@/lib/api-client";
import { useToast } from "@/hooks/use-toast";
import { useQuery } from "@tanstack/react-query";

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

interface ChatMessage {
  id: string | number;
  agent: string;
  message: string;
  level: string;
  createdAt: string;
}

// ─── Agent Config (matches generate.ts phases exactly) ────────────────────────

const AGENT_CONFIG: Record<string, {
  label: string;
  shortLabel: string;
  icon: React.ComponentType<{ className?: string }>;
  color: string;
  bg: string;
  borderColor: string;
  phase: string;
}> = {
  researcher:  { label: "Researcher",        shortLabel: "R",  icon: Search,       color: "text-blue-400",    bg: "bg-blue-500/15",    borderColor: "border-blue-500/30",    phase: "researching" },
  architect:   { label: "Architect",         shortLabel: "A",  icon: LayoutIcon,   color: "text-purple-400",  bg: "bg-purple-500/15",  borderColor: "border-purple-500/30",  phase: "architecting" },
  designer:    { label: "Designer",          shortLabel: "D",  icon: Palette,      color: "text-pink-400",    bg: "bg-pink-500/15",    borderColor: "border-pink-500/30",    phase: "designing" },
  database:    { label: "Database",          shortLabel: "DB", icon: Database,     color: "text-amber-400",   bg: "bg-amber-500/15",   borderColor: "border-amber-500/30",   phase: "schema" },
  frontend:    { label: "Frontend Engineer", shortLabel: "FE", icon: Code2,        color: "text-emerald-400", bg: "bg-emerald-500/15", borderColor: "border-emerald-500/30", phase: "frontend" },
  backend:     { label: "Backend Engineer",  shortLabel: "BE", icon: Server,       color: "text-indigo-400",  bg: "bg-indigo-500/15",  borderColor: "border-indigo-500/30",  phase: "backend" },
  integration: { label: "API Integrator",    shortLabel: "AI", icon: Plug,         color: "text-yellow-400",  bg: "bg-yellow-500/15",  borderColor: "border-yellow-500/30",  phase: "integrations" },
  qa:          { label: "QA Specialist",     shortLabel: "QA", icon: Shield,       color: "text-cyan-400",    bg: "bg-cyan-500/15",    borderColor: "border-cyan-500/30",    phase: "testing" },
  // testing-agent: experto técnico de reparación — nombre en azul cielo
  patcher:     { label: "testing-agent",     shortLabel: "TA", icon: Bug,          color: "text-sky-400",     bg: "bg-sky-500/15",     borderColor: "border-sky-500/30",     phase: "patching" },
  testing:     { label: "testing-agent",     shortLabel: "TA", icon: Bug,          color: "text-sky-400",     bg: "bg-sky-500/15",     borderColor: "border-sky-500/30",     phase: "testing" },
  validator:   { label: "testing-agent",     shortLabel: "TA", icon: ShieldCheck,  color: "text-sky-400",     bg: "bg-sky-500/15",     borderColor: "border-sky-500/30",     phase: "validating" },
  repair:      { label: "testing-agent",     shortLabel: "TA", icon: Wrench,       color: "text-sky-400",     bg: "bg-sky-500/15",     borderColor: "border-sky-500/30",     phase: "fixing" },
  coder:       { label: "Frontend Engineer", shortLabel: "FE", icon: Code2,        color: "text-emerald-400", bg: "bg-emerald-500/15", borderColor: "border-emerald-500/30", phase: "frontend" },
  system:      { label: "Maris AI",          shortLabel: "M",  icon: Sparkles,     color: "text-violet-400",  bg: "bg-violet-500/15",  borderColor: "border-violet-500/30",  phase: "" },
};

// Map server phase → agent key
const PHASE_TO_AGENT: Record<string, string> = {
  researching: "researcher",
  architecting: "architect",
  designing: "designer",
  schema: "database",
  frontend: "frontend",
  backend: "backend",
  integrations: "integration",
  testing:    "testing",
  patching:   "patcher",
  validating: "validator",
  fixing:     "repair",
  parsing: "system",
  starting: "system",
  queued: "system",
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
  const fileCount = files.length;

  return `<!DOCTYPE html><html><head>
    <script src="https://cdn.tailwindcss.com"></script>
    ${css}
    <style>
      @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;900&display=swap');
      body { font-family: 'Inter', sans-serif; }
      @keyframes pulse-ring { 0%,100%{opacity:.6;transform:scale(1)} 50%{opacity:1;transform:scale(1.05)} }
      @keyframes float { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-6px)} }
      @keyframes shimmer { 0%{background-position:-200% 0} 100%{background-position:200% 0} }
      .shimmer { background:linear-gradient(90deg,#7c3aed22 25%,#7c3aed55 50%,#7c3aed22 75%);background-size:200% 100%;animation:shimmer 2s infinite; }
    </style>
  </head>
  <body class="bg-[#0a0a0f] text-white flex flex-col items-center justify-center min-h-screen p-8">
    <div class="max-w-sm w-full space-y-8 text-center">
      <div style="animation:float 3s ease-in-out infinite" class="relative inline-flex items-center justify-center h-24 w-24 rounded-3xl bg-gradient-to-br from-violet-600 to-indigo-600 shadow-[0_0_60px_rgba(124,58,237,0.5)] mx-auto">
        <svg class="h-12 w-12 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z"/></svg>
        <div class="absolute -top-1.5 -right-1.5 h-5 w-5 bg-emerald-500 rounded-full border-2 border-[#0a0a0f] flex items-center justify-center">
          <div class="h-2 w-2 bg-white rounded-full animate-ping"></div>
        </div>
      </div>
      <div>
        <h2 class="text-2xl font-black tracking-tight text-white mb-2">Construyendo tu app</h2>
        <p class="text-sm text-white/40">Los agentes de IA están trabajando en tu proyecto</p>
      </div>
      <div class="bg-white/[0.04] border border-white/[0.08] rounded-2xl p-5 text-left space-y-3">
        <div class="flex items-center gap-2.5 mb-3">
          <div class="h-2 w-2 rounded-full bg-emerald-500 animate-ping"></div>
          <span class="text-[11px] font-bold text-emerald-400 uppercase tracking-widest">Archivo en proceso</span>
        </div>
        <code class="text-xs text-emerald-400/80 font-mono break-all block">${lastFile}</code>
        <div class="h-1.5 w-full bg-white/5 rounded-full overflow-hidden mt-3">
          <div class="shimmer h-full rounded-full w-3/4"></div>
        </div>
      </div>
      <p class="text-[11px] text-white/20">${fileCount} archivo${fileCount !== 1 ? 's' : ''} generado${fileCount !== 1 ? 's' : ''} · El preview aparecerá cuando el Frontend Engineer termine</p>
    </div>
  </body></html>`;
}

function timeOf(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString("es-ES", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
  } catch { return ""; }
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function AgentAvatar({ agent, isActive, size = "md" }: { agent: string; isActive?: boolean; size?: "sm" | "md" }) {
  const config = AGENT_CONFIG[agent] || AGENT_CONFIG.system;
  const Icon = config.icon;
  const sz = size === "sm" ? "h-7 w-7" : "h-9 w-9";
  const iconSz = size === "sm" ? "h-3.5 w-3.5" : "h-4 w-4";
  return (
    <div className={`relative flex-shrink-0 ${sz} rounded-xl ${config.bg} border ${config.borderColor} flex items-center justify-center shadow-sm`}>
      <Icon className={`${iconSz} ${config.color}`} />
      {isActive && (
        <span className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full bg-emerald-500 border-2 border-[#0d0d12] flex items-center justify-center">
          <span className="h-1.5 w-1.5 rounded-full bg-white animate-ping" />
        </span>
      )}
    </div>
  );
}

function FileEditCard({ filename, agent }: { filename: string; agent: string }) {
  const config = AGENT_CONFIG[agent] || AGENT_CONFIG.system;
  return (
    <div className={`flex items-center gap-2.5 ${config.bg} border ${config.borderColor} rounded-xl px-3.5 py-2.5 mt-2 group hover:opacity-90 transition-all cursor-default`}>
      <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 flex-shrink-0" />
      <FileCode2 className="h-3.5 w-3.5 text-white/40 flex-shrink-0" />
      <span className={`text-xs ${config.color} font-mono truncate flex-1`}>{filename}</span>
      <ChevronRight className="h-3 w-3 text-white/20 group-hover:text-white/40 transition-colors flex-shrink-0" />
    </div>
  );
}

function ChatBubble({ msg, isLatest, isActive }: { msg: ChatMessage; isLatest: boolean; isActive: boolean }) {
  const config = AGENT_CONFIG[msg.agent] || AGENT_CONFIG.system;
  const isFile = msg.message.includes("FILE:") || msg.message.includes("=== FILE");
  const isError = msg.level === "error";
  const isWarn = msg.level === "warn";
  const isSuccess = msg.level === "success" || msg.message.toLowerCase().includes("completado") || msg.message.toLowerCase().includes("listo");

  const fileMatch = msg.message.match(/(?:FILE:|=== FILE: )(.*?)(?:\s*===|$)/);
  const filename = fileMatch ? fileMatch[1].trim() : null;

  if (isFile && filename) {
    return (
      <div className="flex items-start gap-3 group animate-in fade-in slide-in-from-bottom-2 duration-300">
        <AgentAvatar agent={msg.agent} isActive={isLatest && isActive} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className={`text-[11px] font-bold ${config.color}`}>{config.label}</span>
            <span className="text-[10px] text-white/20">{timeOf(msg.createdAt)}</span>
          </div>
          <FileEditCard filename={filename} agent={msg.agent} />
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
            <div className="flex items-center gap-0.5 ml-1">
              {[0, 150, 300].map(delay => (
                <div key={delay} className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-bounce" style={{ animationDelay: `${delay}ms` }} />
              ))}
            </div>
          )}
        </div>
        <div className={`rounded-2xl rounded-tl-sm px-4 py-3 text-sm leading-relaxed max-w-[calc(100%-0.5rem)] ${
          isError
            ? "bg-red-500/10 border border-red-500/20 text-red-300"
            : isWarn
            ? "bg-amber-500/10 border border-amber-500/20 text-amber-300"
            : isSuccess
            ? "bg-emerald-500/10 border border-emerald-500/20 text-emerald-300"
            : "bg-white/[0.05] border border-white/[0.07] text-white/80"
        }`}>
          {isError && <AlertTriangle className="h-3.5 w-3.5 inline mr-1.5 mb-0.5" />}
          {isSuccess && <CheckCheck className="h-3.5 w-3.5 inline mr-1.5 mb-0.5" />}
          <span className="whitespace-pre-wrap break-words">{msg.message}</span>
        </div>
      </div>
    </div>
  );
}

// ─── Chat Log Stream ──────────────────────────────────────────────────────────

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
      const fresh = (data.logs as any[]).filter((l: any) => !seen.has(l.id));
      if (fresh.length === 0) return prev;
      return [...prev, ...fresh];
    });
    const newestLog = (data.logs as any[])[data.logs.length - 1];
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
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <div className="relative h-14 w-14 rounded-2xl bg-violet-500/20 border border-violet-500/30 flex items-center justify-center mb-5">
            <Sparkles className="h-7 w-7 text-violet-400 animate-pulse" />
            <div className="absolute -top-1 -right-1 h-3.5 w-3.5 bg-emerald-500 rounded-full border-2 border-[#0d0d12] animate-bounce" />
          </div>
          <p className="text-sm font-bold text-white/60 mb-1">Iniciando agentes...</p>
          <p className="text-xs text-white/25">Los 9 agentes se están preparando</p>
          <div className="flex items-center gap-1.5 mt-4">
            {[0, 150, 300, 450, 600].map(d => (
              <div key={d} className="h-1.5 w-1.5 rounded-full bg-violet-500/60 animate-bounce" style={{ animationDelay: `${d}ms` }} />
            ))}
          </div>
        </div>
      )}
      {lines.length === 0 && !isActive && (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <Terminal className="h-10 w-10 text-white/10 mb-4" />
          <p className="text-sm text-white/30">No hay logs disponibles</p>
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

// ─── Progress Bar ─────────────────────────────────────────────────────────────

function ProgressBar({ progress, isActive }: { progress?: number; isActive: boolean }) {
  const pct = Math.max(0, Math.min(100, progress ?? 0));
  return (
    <div className="w-full h-1 bg-white/[0.06] rounded-full overflow-hidden">
      <div
        className={`h-full rounded-full transition-all duration-700 ${
          isActive
            ? "bg-gradient-to-r from-violet-600 via-indigo-500 to-violet-600 bg-[length:200%_100%] animate-[shimmer_2s_linear_infinite]"
            : pct === 100
            ? "bg-emerald-500"
            : "bg-violet-600"
        }`}
        style={{ width: `${pct}%` }}
      />
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
      const src = iframeRef.current.src;
      iframeRef.current.src = "about:blank";
      setTimeout(() => { if (iframeRef.current) iframeRef.current.src = src; }, 50);
    }
  };

  return (
    <div className="flex flex-col h-full min-h-0 bg-[#080810]">
      {/* Preview header */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-white/[0.06] bg-[#0c0c14] shrink-0">
        <div className="flex items-center gap-1 bg-white/[0.04] p-1 rounded-xl border border-white/[0.06]">
          <button
            onClick={() => setViewMode("preview")}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold transition-all ${
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
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold transition-all ${
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
              disabled={isDeploying}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-violet-600/20 hover:bg-violet-600/30 text-violet-400 border border-violet-500/30 rounded-lg transition-all disabled:opacity-40 text-[11px] font-semibold"
            >
              {isDeploying ? <Loader2 className="h-3 w-3 animate-spin" /> : <Globe className="h-3 w-3" />}
              Publicar
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
          <div className="w-full h-full overflow-auto p-6 font-mono text-xs text-emerald-400/80 bg-[#060610] custom-scrollbar">
            <pre className="whitespace-pre-wrap leading-relaxed">
              {code || "// Esperando código..."}
            </pre>
          </div>
        ) : !html ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-[#080810]">
            <div className="space-y-6 text-center max-w-xs px-6">
              <div className="relative mx-auto h-20 w-20 rounded-3xl bg-gradient-to-br from-violet-600/20 to-indigo-600/10 border border-violet-500/20 flex items-center justify-center">
                <Sparkles className="h-10 w-10 text-violet-400 animate-pulse" />
                <div className="absolute -top-1.5 -right-1.5 h-4 w-4 bg-emerald-500 rounded-full border-2 border-[#080810] animate-bounce" />
              </div>
              <div>
                <p className="text-sm font-bold text-white/70 mb-1.5">Construyendo tu aplicación</p>
                <p className="text-xs text-white/30 leading-relaxed">{phase || "Los agentes están trabajando..."}</p>
              </div>
              {isActive && (
                <div className="h-1.5 w-full bg-white/5 rounded-full overflow-hidden">
                  <div className="h-full bg-gradient-to-r from-violet-600 to-indigo-500 rounded-full animate-[shimmer_2s_ease-in-out_infinite]" />
                </div>
              )}
              <p className="text-[11px] text-white/20">El preview aparecerá cuando el Frontend Engineer termine</p>
            </div>
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

// ─── Agent Activity Bar ───────────────────────────────────────────────────────

function AgentActivityBar({ currentPhase, progress }: { currentPhase: string; progress?: number }) {
  const agents = Object.entries(AGENT_CONFIG).filter(([k]) => k !== "system");
  const currentAgentKey = PHASE_TO_AGENT[currentPhase] || "system";

  return (
    <div className="flex items-center gap-1 px-4 py-2 border-b border-white/[0.04] bg-[#0a0a10] overflow-x-auto custom-scrollbar">
      {agents.map(([key, cfg]) => {
        const Icon = cfg.icon;
        const isActive = key === currentAgentKey;
        const agentPhaseIndex = agents.findIndex(([k]) => k === currentAgentKey);
        const thisIndex = agents.findIndex(([k]) => k === key);
        const isDone = thisIndex < agentPhaseIndex;
        return (
          <div
            key={key}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[10px] font-semibold transition-all whitespace-nowrap ${
              isActive
                ? `${cfg.bg} border ${cfg.borderColor} ${cfg.color}`
                : isDone
                ? "text-emerald-500/60 bg-emerald-500/5"
                : "text-white/20 bg-transparent"
            }`}
          >
            {isDone ? (
              <CheckCircle2 className="h-3 w-3 text-emerald-500/60" />
            ) : isActive ? (
              <Icon className={`h-3 w-3 ${cfg.color} animate-pulse`} />
            ) : (
              <Icon className="h-3 w-3 text-white/20" />
            )}
            {cfg.shortLabel}
          </div>
        );
      })}
      <div className="ml-auto flex-shrink-0 text-[10px] text-white/20 font-mono">
        {progress ?? 0}%
      </div>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function GenerationStudio({ jobId, job, phaseLabel, PhaseIcon, appId }: GenerationStudioProps) {
  const [viewMode, setViewMode] = useState<"preview" | "code">("preview");
  const [message, setMessage] = useState("");
  const [previewExpanded, setPreviewExpanded] = useState(false);
  const [selectedModel, setSelectedModel] = useState(
    () => localStorage.getItem("maris_ai_selected_model") || "claude-sonnet-4-6"
  );
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
      onSuccess: () => {
        toast({ title: "Mensaje enviado", description: "Los agentes procesarán tu solicitud." });
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

  // Auto-resize textarea
  const handleTextareaChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setMessage(e.target.value);
    const ta = e.target;
    ta.style.height = "auto";
    ta.style.height = `${Math.min(ta.scrollHeight, 120)}px`;
  };

  if (!jobId) return null;

  const isActive = job?.status !== "succeeded" && job?.status !== "failed" && job?.status !== "awaiting_approval";
  const isAwaitingApproval = job?.status === "awaiting_approval";
  const isDone = job?.status === "succeeded";
  const isFailed = job?.status === "failed";
  const partialCode = job?.partialFrontendCode;

  const currentPhase = job?.phase || "queued";
  const currentAgentKey = PHASE_TO_AGENT[currentPhase] || "system";
  const currentAgentConfig = AGENT_CONFIG[currentAgentKey];

  return (
    <div className="flex flex-col h-screen bg-[#0d0d12] overflow-hidden">
      {/* ─── Top Bar ─── */}
      <div className="flex items-center justify-between px-5 py-2.5 border-b border-white/[0.06] bg-[#0d0d12] shrink-0 z-50">
        <div className="flex items-center gap-3">
          {/* Logo */}
          <div className="flex items-center gap-2.5">
            <div className="h-8 w-8 rounded-xl bg-gradient-to-br from-violet-600 to-indigo-600 flex items-center justify-center shadow-lg shadow-violet-500/25">
              <Sparkles className="h-4 w-4 text-white" />
            </div>
            <span className="text-sm font-bold text-white/90 tracking-tight">Maris AI</span>
          </div>

          <div className="h-4 w-px bg-white/10" />

          {/* Status indicator */}
          <div className="flex items-center gap-2">
            <div className={`h-2 w-2 rounded-full transition-colors ${
              isActive ? "bg-emerald-500 animate-pulse" :
              isDone ? "bg-emerald-500" :
              isFailed ? "bg-red-500" :
              isAwaitingApproval ? "bg-amber-500 animate-pulse" :
              "bg-white/20"
            }`} />
            <span className="text-xs text-white/50 font-medium max-w-[200px] truncate">{phaseLabel}</span>
          </div>

          {/* Progress */}
          {isActive && (
            <div className="hidden sm:flex items-center gap-2 w-32">
              <ProgressBar progress={job?.progress} isActive={isActive} />
              <span className="text-[10px] text-white/30 font-mono w-8 text-right">{job?.progress ?? 0}%</span>
            </div>
          )}
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
            <SelectTrigger className="h-7 w-[150px] bg-white/[0.04] border-white/[0.08] text-[11px] font-semibold text-white/50 hover:text-white/80 transition-colors rounded-lg">
              <SelectValue placeholder="Modelo" />
            </SelectTrigger>
            <SelectContent className="bg-[#16161e] border-white/10">
              {(models as any[] | undefined)?.map((m: any) => (
                <SelectItem key={m.id} value={m.id} className="text-[11px] font-semibold text-white/70 hover:text-white">
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
              <span className="hidden sm:inline">GitHub</span>
            </button>
          )}

          {/* Exit */}
          <button
            onClick={() => setLocation("/dashboard")}
            className="flex items-center gap-1.5 px-2.5 py-1.5 bg-white/[0.04] hover:bg-red-500/10 border border-white/[0.08] hover:border-red-500/20 rounded-lg text-[11px] font-semibold text-white/50 hover:text-red-400 transition-all"
          >
            <X className="h-3 w-3" />
            <span className="hidden sm:inline">Salir</span>
          </button>
        </div>
      </div>

      {/* ─── Agent Activity Bar ─── */}
      {(isActive || isDone) && (
        <AgentActivityBar currentPhase={currentPhase} progress={job?.progress} />
      )}

      {/* ─── Main Layout ─── */}
      <div className="flex-1 flex min-h-0">
        {/* Left Panel: Chat */}
        <div className={`${previewExpanded ? "w-0 overflow-hidden" : "w-[460px] min-w-[460px]"} border-r border-white/[0.06] flex flex-col bg-[#0d0d12] transition-all duration-300`}>
          {/* Chat header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-white/[0.06] bg-[#0a0a10] shrink-0">
            <div className="flex items-center gap-3">
              {isActive ? (
                <>
                  <AgentAvatar agent={currentAgentKey} isActive size="sm" />
                  <div>
                    <p className="text-xs font-bold text-white/90">{currentAgentConfig.label}</p>
                    <p className="text-[10px] text-white/30">Trabajando en tu app...</p>
                  </div>
                </>
              ) : isDone ? (
                <>
                  <div className="h-7 w-7 rounded-xl bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center">
                    <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                  </div>
                  <div>
                    <p className="text-xs font-bold text-emerald-400">Generación completada</p>
                    <p className="text-[10px] text-white/30">Tu app está lista</p>
                  </div>
                </>
              ) : isFailed ? (
                <>
                  <div className="h-7 w-7 rounded-xl bg-red-500/20 border border-red-500/30 flex items-center justify-center">
                    <AlertTriangle className="h-3.5 w-3.5 text-red-400" />
                  </div>
                  <div>
                    <p className="text-xs font-bold text-red-400">Generación fallida</p>
                    <p className="text-[10px] text-white/30 max-w-[200px] truncate">{job?.errorMessage?.slice(0, 50) || "Error desconocido"}</p>
                  </div>
                </>
              ) : isAwaitingApproval ? (
                <>
                  <div className="h-7 w-7 rounded-xl bg-amber-500/20 border border-amber-500/30 flex items-center justify-center">
                    <MessageSquare className="h-3.5 w-3.5 text-amber-400 animate-pulse" />
                  </div>
                  <div>
                    <p className="text-xs font-bold text-amber-400">Aprobación requerida</p>
                    <p className="text-[10px] text-white/30">El Arquitecto espera tu OK</p>
                  </div>
                </>
              ) : (
                <>
                  <div className="h-7 w-7 rounded-xl bg-white/5 flex items-center justify-center">
                    <Terminal className="h-3.5 w-3.5 text-white/40" />
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
            {isDone && appId && (
              <button
                onClick={handleDeploy}
                disabled={deployAppMutation.isPending}
                className="flex items-center gap-1.5 px-2.5 py-1.5 bg-violet-600/20 hover:bg-violet-600/30 border border-violet-500/30 rounded-lg text-[11px] font-semibold text-violet-400 hover:text-violet-300 transition-all disabled:opacity-40"
              >
                {deployAppMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Rocket className="h-3 w-3" />}
                Deploy
              </button>
            )}
          </div>

          {/* Chat messages */}
          <div className="flex-1 overflow-hidden">
            <ChatLogStream jobId={jobId} isActive={isActive || isAwaitingApproval} />
          </div>

          {/* Message input */}
          <div className="p-3 border-t border-white/[0.06] bg-[#0a0a10] shrink-0">
            {isDone && (
              <p className="text-[10px] text-white/30 text-center mb-2">
                Puedes pedir cambios o mejoras a tu app
              </p>
            )}
            <div className="relative flex flex-col bg-[#16161e] border border-white/[0.08] rounded-xl focus-within:border-violet-500/40 transition-all">
              <textarea
                ref={textareaRef}
                value={message}
                onChange={handleTextareaChange}
                onKeyDown={handleKeyDown}
                placeholder={isDone ? "Pide cambios a tu app... (Enter para enviar)" : "Mensaje a los agentes..."}
                className="w-full bg-transparent px-4 pt-3 pb-2 text-sm text-white placeholder:text-white/20 outline-none resize-none min-h-[60px] max-h-[120px] custom-scrollbar"
                disabled={generateAppMutation.isPending || (isActive && !isDone)}
                rows={2}
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
                      disabled={pushToGitHubMutation.isPending}
                      className="p-1.5 text-white/30 hover:text-white/60 hover:bg-white/5 rounded-lg transition-all disabled:opacity-40"
                      title="Subir a GitHub"
                    >
                      {pushToGitHubMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Github className="h-3.5 w-3.5" />}
                    </button>
                  )}
                  <div className="text-[10px] text-white/20 ml-1">
                    {isActive ? <><Clock className="h-3 w-3 inline mr-1" />Generando...</> : "Enter para enviar"}
                  </div>
                </div>
                <button
                  onClick={handleSendMessage}
                  disabled={!message.trim() || generateAppMutation.isPending || (isActive && !isDone)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold transition-all ${
                    message.trim() && !isActive
                      ? "bg-violet-600 text-white hover:bg-violet-500 shadow-lg shadow-violet-500/20"
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
            onDeploy={appId && isDone ? handleDeploy : undefined}
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
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-[100] flex items-end justify-center p-6 animate-in fade-in duration-300">
          <div className="w-full max-w-lg bg-[#16161e] border border-amber-500/30 rounded-2xl p-6 shadow-[0_0_80px_rgba(245,158,11,0.15)] animate-in slide-in-from-bottom-10 duration-400">
            <div className="flex items-center gap-4 mb-5">
              <div className="h-12 w-12 rounded-2xl bg-amber-500/20 border border-amber-500/30 flex items-center justify-center flex-shrink-0">
                <MessageSquare className="h-6 w-6 text-amber-400" />
              </div>
              <div>
                <h3 className="text-base font-bold text-white">Aprobación del Arquitecto</h3>
                <p className="text-sm text-white/40 mt-0.5">El Arquitecto ha terminado los planos. ¿Procedemos con la construcción?</p>
              </div>
            </div>
            <div className="flex gap-3">
              <Button
                onClick={() => approveMutation.mutate({ id: jobId! })}
                disabled={approveMutation.isPending}
                className="flex-1 bg-violet-600 hover:bg-violet-500 text-white font-semibold h-11 shadow-lg shadow-violet-500/20"
              >
                {approveMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                ) : (
                  <Play className="h-4 w-4 mr-2" />
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
