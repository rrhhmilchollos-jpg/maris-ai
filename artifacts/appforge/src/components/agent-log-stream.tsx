import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getGenerationJobLogs,
  getGetGenerationJobLogsQueryKey,
  type JobLogEntry,
} from "@/lib/api-client";
import { Bot, Code2, FlaskConical } from "lucide-react";

const AGENT_LABELS: Record<string, string> = {
  researcher: "Product Researcher",
  architect: "System Architect",
  designer: "UI/UX Designer",
  database: "Database Engineer",
  frontend: "Frontend Engineer",
  backend: "Backend Engineer",
  integration: "API Integrator",
  qa: "QA Specialist",
  patcher: "DevOps Patcher",
  validator: "Security Validator",
  testing: "Testing Agent",
  system: "Core System",
  memory: "Neural Memory",
  planner: "Strategy Planner",
};

/** Agentes que usan el color rosa fucsia del Testing Agent */
const TESTING_AGENTS = new Set(["testing"]);

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
 * Polls `/api/generate/jobs/:id/logs?afterId=N` every ~400ms while the job
 * is active, accumulates las líneas localmente y auto-scrollea al fondo.
 * Detiene el polling cuando `isActive` es false.
 *
 * El Testing Agent se muestra con letras ROSA FUCSIA y un icono de tubo de ensayo.
 */
export function AgentLogStream({ jobId, isActive }: AgentLogStreamProps) {
  const [lines, setLines] = useState<JobLogEntry[]>([]);
  const [lastId, setLastId] = useState<number | string>(0);
  const [streamPaused, setStreamPaused] = useState(false);
  const consecutiveErrorsRef = useRef(0);
  const lastJobIdRef = useRef<string | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // Reset buffer whenever the job switches.
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
        const message = error instanceof Error ? error.message : String(error);
        const shouldPause =
          /unauthorized/i.test(message) ||
          /HTTP\s*40[13]/i.test(message) ||
          /HTTP\s*50[0234]/i.test(message) ||
          consecutiveErrorsRef.current >= 3;
        if (shouldPause) setStreamPaused(true);
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

  // Tail-loss mitigation: dos fetches extra tras finalizar el job.
  const wasActiveRef = useRef(isActive);
  useEffect(() => {
    const justFinished = wasActiveRef.current && !isActive && enabled;
    wasActiveRef.current = isActive;
    if (!justFinished) return undefined;
    const t1 = window.setTimeout(() => queryClient.invalidateQueries({ queryKey }), 1500);
    const t2 = window.setTimeout(() => queryClient.invalidateQueries({ queryKey }), 3000);
    return () => { window.clearTimeout(t1); window.clearTimeout(t2); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isActive, enabled, jobId, queryClient]);

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

  // Auto-scroll al fondo cuando llegan nuevas líneas.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines.length]);

  if (jobId === null) return null;

  return (
    <div className="space-y-4" data-testid="agent-log-stream">
      {streamPaused && lines.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-center space-y-3">
          <div className="h-12 w-12 rounded-2xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center">
            <Bot className="h-6 w-6 text-amber-300" />
          </div>
          <div className="space-y-1">
            <p className="text-sm text-white/70 font-semibold">Reconectando con el agente...</p>
            <p className="text-xs text-white/40">La generación sigue protegida; se reintentará al actualizar la vista.</p>
          </div>
        </div>
      ) : lines.length === 0 && isActive ? (
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
            const isTesting = TESTING_AGENTS.has(line.agent);
            const isError = line.level === "error";
            const isWarn = line.level === "warn";
            const isLatest = idx === lines.length - 1;
            const vibrate = isActive && isLatest ? "robot-vibrate" : "";

            // ── Testing Agent: estilos rosa fucsia ──────────────────────
            if (isTesting) {
              return (
                <div
                  key={line.id}
                  className="flex items-start gap-4 group animate-in fade-in slide-in-from-bottom-2 duration-500"
                  style={{ animationDelay: `${Math.min(idx * 50, 500)}ms` }}
                >
                  {/* Icono rosa fucsia con brillo */}
                  <div className={`h-8 w-8 rounded-full flex items-center justify-center border shrink-0 transition-all ${
                    isError
                      ? "bg-red-500/10 border-red-500/30"
                      : "bg-fuchsia-500/15 border-fuchsia-500/40 shadow-[0_0_8px_rgba(217,70,239,0.3)]"
                  }`}>
                    <FlaskConical className={`h-4 w-4 ${
                      isError ? "text-red-400" : `text-fuchsia-400 ${vibrate}`
                    }`} />
                  </div>

                  <div className="flex-1 min-w-0 space-y-1">
                    <div className="flex items-center gap-2">
                      {/* Etiqueta rosa fucsia en negrita */}
                      <span className={`text-[11px] font-black uppercase tracking-tight ${
                        isError ? "text-red-400" : isWarn ? "text-amber-400" : "text-fuchsia-400"
                      }`}>
                        {AGENT_LABELS[line.agent] || line.agent}
                      </span>
                      {/* Badge "TESTING" */}
                      {!isError && !isWarn && (
                        <span className="px-1.5 py-0.5 rounded text-[9px] font-black uppercase tracking-widest bg-fuchsia-500/20 text-fuchsia-300 border border-fuchsia-500/30">
                          LIVE
                        </span>
                      )}
                      <span className="text-[10px] text-white/20 font-mono">
                        {timeOf(line.createdAt)}
                      </span>
                    </div>

                    <div className={`p-3 rounded-2xl text-sm leading-relaxed border transition-all ${
                      isError
                        ? "bg-red-500/5 border-red-500/20 text-red-200"
                        : isWarn
                        ? "bg-amber-500/5 border-amber-500/20 text-amber-200"
                        : "bg-fuchsia-500/5 border-fuchsia-500/20 text-fuchsia-100 group-hover:bg-fuchsia-500/10"
                    }`}>
                      {line.message}
                    </div>
                  </div>
                </div>
              );
            }

            // ── Agentes normales ─────────────────────────────────────────
            return (
              <div
                key={line.id}
                className="flex items-start gap-4 group animate-in fade-in slide-in-from-bottom-2 duration-500"
                style={{ animationDelay: `${Math.min(idx * 50, 500)}ms` }}
              >
                <div className={`h-8 w-8 rounded-full flex items-center justify-center border shrink-0 transition-all ${
                  isError ? "bg-red-500/10 border-red-500/30" :
                  isWarn ? "bg-amber-500/10 border-amber-500/30" :
                  "bg-white/5 border-white/10 group-hover:border-primary/30"
                }`}>
                  <Bot className={`h-4 w-4 ${
                    isError ? "text-red-400" :
                    isWarn ? "text-amber-400" :
                    "text-primary"
                  } ${vibrate}`} />
                </div>

                <div className="flex-1 min-w-0 space-y-1">
                  <div className="flex items-center gap-2">
                    <span className={`text-[11px] font-bold uppercase tracking-tight ${
                      isError ? "text-red-400" :
                      isWarn ? "text-amber-400" :
                      "text-white/80"
                    }`}>
                      {AGENT_LABELS[line.agent] || line.agent}
                    </span>
                    <span className="text-[10px] text-white/20 font-mono">
                      {timeOf(line.createdAt)}
                    </span>
                  </div>

                  <div className={`p-3 rounded-2xl text-sm leading-relaxed border transition-all ${
                    isError ? "bg-red-500/5 border-red-500/20 text-red-200" :
                    isWarn ? "bg-amber-500/5 border-amber-500/20 text-amber-200" :
                    "bg-white/[0.03] border-white/5 text-white/70 group-hover:bg-white/[0.05]"
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
