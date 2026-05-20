import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getGenerationJobLogs,
  getGetGenerationJobLogsQueryKey,
  type JobLogEntry,
} from "@/lib/api-client";
import { Bot, Code2 } from "lucide-react";

// We deliberately collapse every internal agent role (researcher, architect,
// designer, integration, coder, qa, validator, patcher, system) into a single
// user-facing "Robot" persona. The end user doesn't care which sub-agent is
// running — they want a single friendly assistant. The original `agent` field
// is still preserved on the data row (for analytics / debugging) but is not
// surfaced in the UI label.
const AGENT_LABELS: Record<string, string> = {
  researcher: "Investigador",
  architect: "Arquitecto",
  designer: "Diseñador",
  integration: "Integraciones",
  coder: "Ingeniero",
  frontend: "Frontend",
  backend: "Backend",
  qa: "QA Reviewer",
  validator: "Validador",
  patcher: "Patcher",
  system: "Sistema",
  memory: "Memoria",
  planner: "Planner",
};

const ROBOT_COLOR = "text-emerald-300";

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
  /** Job id whose logs to stream. Pass null to render nothing. */
  jobId: string | null;
  /** Whether the job is still running — when false we stop polling. */
  isActive: boolean;
}

/**
 * Live, terminal-style log of every agent step for a single generation job.
 *
 * Polls `/api/generate/jobs/:id/logs?afterId=N` every ~1.2s while the job
 * is active, accumulates the lines locally (so the user keeps seeing the
 * full history even after the job finishes), and auto-scrolls to the bottom
 * when new lines arrive. Stops polling once `isActive` is false.
 *
 * The component owns its own line buffer keyed by jobId — switching to a
 * different jobId resets the buffer, so opening a fresh generation never
 * shows stale lines from the previous one.
 */
export function AgentLogStream({ jobId, isActive }: AgentLogStreamProps) {
  // Local accumulating buffer. We can't rely on react-query data as the source
  // of truth because each poll only returns NEW lines (afterId > lastSeen).
  const [lines, setLines] = useState<JobLogEntry[]>([]);
  const [lastId, setLastId] = useState<number | string>(0);
  const lastJobIdRef = useRef<string | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // Reset buffer whenever the job switches.
  useEffect(() => {
    if (lastJobIdRef.current !== jobId) {
      lastJobIdRef.current = jobId;
      setLines([]);
      setLastId(0);
    }
  }, [jobId]);

  const enabled = jobId !== null;
  const queryClient = useQueryClient();
  const queryKey = [...getGetGenerationJobLogsQueryKey(jobId ?? ""), "stream"];
  const { data } = useQuery({
    // Use only the jobId in the key so re-renders from `lastId` changes don't
    // create infinite new query keys. The afterId is passed via queryFn.
    queryKey,
    queryFn: ({ signal }) =>
      // Forward React Query's AbortSignal so an in-flight poll is cancelled
      // when the job switches or the component unmounts. Without this, the
      // tail of a long request can resolve after teardown and stamp stale
      // lines into the next job's stream.
      getGenerationJobLogs(jobId ?? "", { afterId: lastId }, { signal }),
    enabled,
    // Poll fast while running; stop once the job terminates. Tail-loss (lines
    // committed by the unawaited fire-and-forget INSERT after the job is
    // marked succeeded) is mitigated by the explicit final fetch effect below.
    // 600 ms feels close-to-realtime in the UI without putting noticeable
    // load on the API server (the response is tiny — only NEW lines after
    // the cursor — and the route is a single indexed SELECT).
    refetchInterval: isActive ? 400 : false,
    refetchOnWindowFocus: false,
    // Don't dedupe — we always want the freshest cursor.
    staleTime: 0,
    gcTime: 60_000,
  });

  // Tail-loss mitigation: when the job transitions from active → terminal,
  // do TWO extra fetches ~1.5s and ~3s after, since the pipeline's logging is
  // fire-and-forget — a final "Generación completada" line can land in the DB
  // a few ms after the job row flips to "succeeded". Without these we'd often
  // truncate the very last line the user sees. We invalidate the query rather
  // than calling getGenerationJobLogs directly so the queryFn — which closes
  // over the latest `lastId` — is the single source of fetching truth.
  const wasActiveRef = useRef(isActive);
  useEffect(() => {
    const justFinished = wasActiveRef.current && !isActive && enabled;
    wasActiveRef.current = isActive;
    if (!justFinished) return undefined;
    const t1 = window.setTimeout(() => {
      queryClient.invalidateQueries({ queryKey });
    }, 1500);
    const t2 = window.setTimeout(() => {
      queryClient.invalidateQueries({ queryKey });
    }, 3000);
    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
    };
    // queryKey is recreated each render but stable per (jobId), and we only
    // care that it points at the right job; it's fine to omit from deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isActive, enabled, jobId, queryClient]);

  // Append new lines whenever a poll returns. Defensive: dedupe by id in case
  // a slow request returns lines a faster one already appended.
  useEffect(() => {
    if (!data?.logs?.length) return;
    setLines((prev) => {
      const seen = new Set(prev.map((l: any) => l.id));
      const fresh = data.logs.filter((l: any) => !seen.has(l.id));
      if (fresh.length === 0) return prev;
      return [...prev, ...fresh];
    });
    
    // MongoDB IDs are strings and not strictly comparable via Math.max.
    // However, the API server handles 'afterId' by timestamp or insertion order.
    // We just need to track the last ID we've seen to pass it back.
    const newestLog = data.logs[data.logs.length - 1];
    if (newestLog) {
      setLastId(newestLog.id);
    }
  }, [data]);

  // Auto-scroll to bottom on new lines.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines.length]);

  if (!enabled) return null;

  return (
    <div
      className="space-y-4"
      data-testid="agent-log-stream"
    >
      {lines.length === 0 && isActive ? (
        <div className="flex flex-col items-center justify-center py-12 text-center space-y-4 animate-in fade-in duration-700">
          <div className="relative">
            <div className="h-16 w-16 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center">
              <Bot className="h-8 w-8 text-primary animate-pulse" />
            </div>
            <div className="absolute -top-1 -right-1 h-4 w-4 bg-emerald-500 rounded-full border-4 border-[#0d0d12] animate-pulse" />
          </div>
          <div className="space-y-1">
            <p className="text-sm font-bold text-white tracking-tight">Iniciando sistema...</p>
            <p className="text-xs text-white/40">Conectando con el equipo de ingenieros de Maris AI</p>
          </div>
        </div>
      ) : lines.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-center space-y-4">
          <div className="h-12 w-12 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center">
            <Bot className="h-6 w-6 text-white/20" />
          </div>
          <p className="text-sm text-white/40 font-medium">No hay actividad registrada todavía.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {lines.map((line, idx) => {
            const isError = line.level === "error";
            const isWarn = line.level === "warn";
            const isLatest = idx === lines.length - 1;
            const vibrate = isActive && isLatest ? "robot-vibrate" : "";
            
            return (
              <div
                key={line.id}
                className={`flex items-start gap-4 group animate-in fade-in slide-in-from-bottom-2 duration-500`}
                style={{ animationDelay: `${Math.min(idx * 50, 500)}ms` }}
              >
                <div className={`h-8 w-8 rounded-full flex items-center justify-center border shrink-0 transition-all ${
                  isError ? 'bg-red-500/10 border-red-500/30' : 
                  isWarn ? 'bg-amber-500/10 border-amber-500/30' : 
                  'bg-white/5 border-white/10 group-hover:border-primary/30'
                }`}>
                  <Bot className={`h-4 w-4 ${
                    isError ? 'text-red-400' : 
                    isWarn ? 'text-amber-400' : 
                    'text-primary'
                  } ${vibrate}`} />
                </div>
                
                <div className="flex-1 min-w-0 space-y-1">
                  <div className="flex items-center gap-2">
                    <span className={`text-[11px] font-bold uppercase tracking-tight ${
                      isError ? 'text-red-400' : 
                      isWarn ? 'text-amber-400' : 
                      'text-white/80'
                    }`}>
                      {AGENT_LABELS[line.agent] || line.agent}
                    </span>
                    <span className="text-[10px] text-white/20 font-mono">
                      {timeOf(line.createdAt)}
                    </span>
                  </div>
                  
                  <div className={`p-3 rounded-2xl text-sm leading-relaxed border transition-all ${
                    isError ? 'bg-red-500/5 border-red-500/20 text-red-200' : 
                    isWarn ? 'bg-amber-500/5 border-amber-500/20 text-amber-200' : 
                    'bg-white/[0.03] border-white/5 text-white/70 group-hover:bg-white/[0.05]'
                  }`}>
                    {line.message.includes("FILE:") || line.message.includes("Carpeta:") ? (
                      <div className="flex items-center gap-2 font-mono text-[12px] text-primary">
                        <Code2 className="h-3.5 w-3.5" />
                        <span className="bg-primary/10 px-2 py-0.5 rounded border border-primary/20">
                          {line.message.replace("FILE:", "📄 Archivo:").replace("Carpeta:", "📁 Carpeta:")}
                        </span>
                      </div>
                    ) : (
                      line.message
                    )}
                  </div>
                </div>
              </div>
            );
          })}
          <div ref={scrollRef} className="h-1" />
        </div>
      )}
    </div>
  );
}
