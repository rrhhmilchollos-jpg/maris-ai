import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getGenerationJobLogs,
  getGetGenerationJobLogsQueryKey,
  type JobLogEntry,
} from "@/lib/api-client";
import { Bot, Code2, FlaskConical, Search, Layout, Sparkles, Database, Server, Zap, CheckCircle2, Rocket, Terminal, ShieldCheck, Wrench, Bug } from "lucide-react";

const AGENT_CONFIG: Record<string, { label: string, icon: any, color: string }> = {
  researcher:  { label: "Product Researcher",  icon: Search,       color: "text-blue-400" },
  architect:   { label: "System Architect",     icon: Layout,       color: "text-purple-400" },
  designer:    { label: "UI/UX Designer",        icon: Sparkles,     color: "text-pink-400" },
  database:    { label: "Database Engineer",     icon: Database,     color: "text-amber-400" },
  frontend:    { label: "Frontend Engineer",     icon: Code2,        color: "text-emerald-400" },
  backend:     { label: "Backend Engineer",      icon: Server,       color: "text-indigo-400" },
  integration: { label: "API Integrator",        icon: Zap,          color: "text-yellow-400" },
  qa:          { label: "QA Specialist",          icon: CheckCircle2, color: "text-cyan-400" },
  // testing-agent: experto técnico de reparación — nombre en azul cielo
  patcher:     { label: "testing-agent",         icon: Bug,          color: "text-sky-400" },
  testing:     { label: "testing-agent",         icon: Bug,          color: "text-sky-400" },
  validator:   { label: "testing-agent",         icon: ShieldCheck,  color: "text-sky-400" },
  repair:      { label: "testing-agent",         icon: Wrench,       color: "text-sky-400" },
  coder:       { label: "Frontend Engineer",     icon: Code2,        color: "text-emerald-400" },
  system:      { label: "Core System",           icon: Bot,          color: "text-white" },
};

function timeOf(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString("es-ES", {
      hour12: false,
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return "";
  }
}

interface AgentLogStreamProps {
  jobId: string | null;
  isActive: boolean;
}

export function AgentLogStream({ jobId, isActive }: AgentLogStreamProps) {
  const [lines, setLines] = useState<JobLogEntry[]>([]);
  const [lastId, setLastId] = useState<number | string>(0);
  const [streamPaused, setStreamPaused] = useState(false);
  const consecutiveErrorsRef = useRef(0);
  const lastJobIdRef = useRef<string | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

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
  const queryClient = useQueryClient();
  const queryKey = [...getGetGenerationJobLogsQueryKey(jobId ?? ""), "stream"];

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
    <div className="flex flex-col h-full bg-[#0d0d12] font-mono text-[11px] leading-relaxed custom-scrollbar overflow-auto p-4 space-y-3">
      {lines.length === 0 && isActive && (
        <div className="flex flex-col items-center justify-center py-12 text-center animate-pulse">
          <Terminal className="h-6 w-6 text-primary mb-2" />
          <p className="text-white/40 uppercase tracking-widest font-black">Esperando señal de los agentes...</p>
        </div>
      )}
      
      {lines.map((line, idx) => {
        const config = AGENT_CONFIG[line.agent] || AGENT_CONFIG.system;
        const Icon = config.icon;
        const isLatest = idx === lines.length - 1 && isActive;

        return (
          <div key={line.id} className={`group flex flex-col gap-1 animate-in fade-in slide-in-from-left-2 duration-300`}>
            <div className="flex items-center gap-2 opacity-60 group-hover:opacity-100 transition-opacity">
              <Icon className={`h-3 w-3 ${config.color}`} />
              <span className={`font-black uppercase tracking-tighter ${config.color}`}>{config.label}</span>
              <span className="text-[9px] text-white/20">{timeOf(line.createdAt)}</span>
              {isLatest && <div className="h-1 w-1 rounded-full bg-emerald-500 animate-ping" />}
            </div>
            <div className={`pl-5 border-l border-white/5 py-1 ${line.level === 'error' ? 'text-red-400' : line.level === 'warn' ? 'text-amber-400' : 'text-white/60'}`}>
              {line.message.includes("FILE:") ? (
                <div className="flex items-center gap-2 bg-white/[0.03] p-2 rounded-lg border border-white/5">
                  <Code2 className="h-3 w-3 text-emerald-400" />
                  <span className="text-emerald-400/80">{line.message.replace("FILE:", "📄")}</span>
                </div>
              ) : (
                <p className="whitespace-pre-wrap">{line.message}</p>
              )}
            </div>
          </div>
        );
      })}
      <div ref={scrollRef} />
    </div>
  );
}
