import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getGenerationJobLogs,
  getGetGenerationJobLogsQueryKey,
  type JobLogEntry,
} from "@/lib/api-client";
import { JOB_POLLING, pollingInterval, pollingRetryDelay, retryPollingRequest } from "@/lib/job-polling";
import {
  Bot, Code2, Search, Sparkles, Server, Zap, CheckCircle2,
  Terminal, ShieldCheck, Wrench, Bug, Eye, FolderOpen, ChevronDown, ChevronRight,
  Layers, Puzzle,
} from "lucide-react";

// ─── Configuración de agentes ────────────────────────────────────────────────
// Lista verificada contra el código real del pipeline (no contra marketing):
// Researcher, Architect, Designer, Frontend Engineer, Backend Engineer,
// API Integrator, QA Reviewer, Testing Agent, PM Agent, Image Agent,
// Visual Evaluator. "Database"/"schema" NO es un agente separado — el
// diseño de datos vive dentro de la salida del Architect, así que se
// fusiona bajo la misma etiqueta en vez de aparentar un paso que no
// existe. PM Agent comparte el mismo canal de log ("qa") que QA Reviewer
// en el pipeline real (routes/apps.ts, fase "qa") — el propio texto del
// mensaje ya dice "PM Agent: ..." cuando corresponde, así que quedan
// agrupados bajo la misma etiqueta visual en vez de fingir un tag que no
// existe en el backend.
const AGENT_CONFIG: Record<string, { label: string; icon: any; color: string; bgColor: string }> = {
  researcher:   { label: "Researcher",          icon: Search,       color: "text-blue-400",    bgColor: "bg-blue-400/10" },
  architect:    { label: "Architect",            icon: Layers,       color: "text-indigo-400",  bgColor: "bg-indigo-400/10" },
  schema:       { label: "Architect",            icon: Layers,       color: "text-indigo-400",  bgColor: "bg-indigo-400/10" },
  database:     { label: "Architect",            icon: Layers,       color: "text-indigo-400",  bgColor: "bg-indigo-400/10" },
  designer:     { label: "Designer",             icon: Sparkles,     color: "text-pink-400",    bgColor: "bg-pink-400/10" },
  frontend:     { label: "Frontend Engineer",    icon: Zap,          color: "text-emerald-400", bgColor: "bg-emerald-400/10" },
  coder:        { label: "Frontend Engineer",    icon: Code2,        color: "text-emerald-400", bgColor: "bg-emerald-400/10" },
  backend:      { label: "Backend Engineer",     icon: Server,       color: "text-cyan-400",    bgColor: "bg-cyan-400/10" },
  integrations: { label: "API Integrator",       icon: Puzzle,       color: "text-orange-400",  bgColor: "bg-orange-400/10" },
  integration:  { label: "API Integrator",       icon: Puzzle,       color: "text-orange-400",  bgColor: "bg-orange-400/10" },
  // "qa" cubre tanto al QA Reviewer como al PM Agent (Quality Gate final)
  // -- ambos loguean bajo el mismo tag "qa" en apps.ts, el texto del
  // mensaje ya distingue cuál habla en cada momento.
  qa:           { label: "QA Reviewer / PM Agent", icon: CheckCircle2, color: "text-cyan-400",  bgColor: "bg-cyan-400/10" },
  // testing-agent — nombre en azul cielo
  patcher:      { label: "testing-agent",        icon: Bug,          color: "text-sky-400",     bgColor: "bg-sky-400/10" },
  testing:      { label: "testing-agent",        icon: Bug,          color: "text-sky-400",     bgColor: "bg-sky-400/10" },
  validator:    { label: "testing-agent",        icon: ShieldCheck,  color: "text-sky-400",     bgColor: "bg-sky-400/10" },
  repair:       { label: "testing-agent",        icon: Wrench,       color: "text-sky-400",     bgColor: "bg-sky-400/10" },
  // Visual Evaluator (Claude Vision) — escribe con agent:"evaluator" en JobLog
  evaluator:    { label: "Visual Evaluator",     icon: Eye,          color: "text-violet-400",  bgColor: "bg-violet-400/10" },
  // Image Agent genera imágenes en segundo plano sin log visible por
  // diseño (no bloquea ni se muestra como paso de espera al cliente) —
  // por eso no tiene entrada aquí: no hay ningún log real con ese tag.
  system:       { label: "Sistema",              icon: Bot,          color: "text-white/60",    bgColor: "bg-white/5" },
};

// ─── Helpers ──────────────────────────────────────────────────────────────────
function timeOf(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString("es-ES", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
  } catch {
    return "";
  }
}

function extractFilePath(message: string): string | null {
  const fileMatch = message.match(/FILE:\s*(.+)/);
  if (fileMatch) return fileMatch[1].trim();
  const pathMatch = message.match(/(?:Creando|Editando|Escribiendo|Created|Edited|Viewed|Writing)\s+([\/\w\-\.]+\.\w+)/i);
  if (pathMatch) return pathMatch[1].trim();
  return null;
}

function hasCodeContent(message: string): boolean {
  return (
    message.includes("```") ||
    message.includes("FILE:") ||
    message.includes("diff --") ||
    (message.includes("import ") && message.length > 80) ||
    (message.includes("{") && message.includes("}") && message.length > 150)
  );
}

function getActionIcon(message: string) {
  const lower = message.toLowerCase();
  if (lower.includes("view") || lower.includes("viendo") || lower.includes("leyendo")) return Eye;
  if (lower.includes("edit") || lower.includes("crean") || lower.includes("escribi") || lower.includes("file:")) return FolderOpen;
  if (lower.includes("ejecut") || lower.includes("exec") || lower.includes("run") || lower.includes("build")) return Terminal;
  if (lower.includes("repar") || lower.includes("fix") || lower.includes("patch")) return Wrench;
  if (lower.includes("test") || lower.includes("valid")) return ShieldCheck;
  return Code2;
}

function extractCode(message: string): string {
  const codeBlockMatch = message.match(/```[\w]*\n?([\s\S]*?)```/);
  if (codeBlockMatch) return codeBlockMatch[1].trim();
  const fileMatch = message.match(/FILE:\s*\S+\n([\s\S]+)/);
  if (fileMatch) return fileMatch[1].trim();
  return message;
}

// ─── Componente de entrada de log ─────────────────────────────────────────────
interface LogEntryProps {
  line: JobLogEntry;
  isLatest: boolean;
}

function LogEntry({ line, isLatest }: LogEntryProps) {
  const [expanded, setExpanded] = useState(false);
  const config = AGENT_CONFIG[line.agent] || AGENT_CONFIG.system;
  const Icon = config.icon;
  const filePath = extractFilePath(line.message);
  const isCodeBlock = hasCodeContent(line.message);
  const ActionIcon = getActionIcon(line.message);
  const isExpandable = isCodeBlock || filePath !== null;
  const isError = line.level === "error";
  const isWarn = line.level === "warn";
  const actionLabel = /view|viendo|leyendo/i.test(line.message)
    ? "Consultado"
    : /edit|editando|actualizando|escribiendo/i.test(line.message)
    ? "Editado"
    : /creando|created/i.test(line.message)
    ? "Creado"
    : /test|valid/i.test(line.message)
    ? "Validado"
    : "Actividad";

  const summaryText = filePath
    ? line.message.replace(/FILE:\s*\S+/, "").trim() || filePath
    : line.message.length > 100
    ? line.message.slice(0, 100) + "…"
    : line.message;

  return (
    <article className={`flex gap-3 py-3 ${isError ? "rounded-xl border border-red-400/25 bg-red-500/[0.07] px-3" : isWarn ? "rounded-xl border border-amber-300/20 bg-amber-400/[0.06] px-3" : ""}`}>
      <div className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-white/10 ${config.bgColor}`}>
        <Icon className={`h-3.5 w-3.5 ${config.color}`} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="mb-1 flex items-center gap-2">
          <span className={`text-[10px] font-bold tracking-wide ${config.color}`}>{config.label}</span>
          <span className="text-[10px] text-white/25">{timeOf(line.createdAt)}</span>
          {isLatest && <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" aria-label="evento actual" />}
        </div>
        {filePath ? (
          <button
            type="button"
            onClick={() => setExpanded((value) => !value)}
            className="flex w-full items-center gap-2 rounded-lg border border-white/[0.06] bg-white/[0.035] px-3 py-2 text-left transition-colors hover:bg-white/[0.07]"
          >
            <ActionIcon className="h-3.5 w-3.5 shrink-0 text-white/45" />
            <span className="shrink-0 text-[10px] text-white/45">{actionLabel}</span>
            <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-fuchsia-300">{filePath}</span>
            {expanded ? <ChevronDown className="h-3.5 w-3.5 text-white/30" /> : <ChevronRight className="h-3.5 w-3.5 text-white/30" />}
          </button>
        ) : (
          <p className={`whitespace-pre-wrap break-words text-[12px] leading-5 ${isError ? "text-red-200" : isWarn ? "text-amber-100" : "text-white/75"}`}>{summaryText}</p>
        )}
        {isExpandable && expanded && (
          <pre className="mt-2 overflow-x-auto rounded-lg border border-white/[0.06] bg-black/30 p-3 whitespace-pre-wrap break-words font-mono text-[10px] leading-relaxed text-white/65">
            {extractCode(line.message)}
          </pre>
        )}
      </div>
    </article>
  );
}

// ─── Componente principal ─────────────────────────────────────────────────────
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
  const bottomRef = useRef<HTMLDivElement | null>(null);

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
    // Un stream a 400 ms multiplica las solicitudes por cada pestaña abierta
    // y activa el limitador global. Se consulta cada 8 s y se aplica backoff
    // exponencial ante errores, especialmente HTTP 429.
    refetchInterval: (query) => pollingInterval(query, isActive, JOB_POLLING.logs),
    refetchOnWindowFocus: false,
    staleTime: 0,
    gcTime: 60_000,
    retry: retryPollingRequest,
    retryDelay: pollingRetryDelay,
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
    if (bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [lines.length]);

  if (jobId === null) return null;

  return (
    <div className="flex h-full flex-col overflow-auto bg-[#111111] px-5 py-6 custom-scrollbar">
      <div className="mx-auto flex w-full max-w-[650px] flex-col pb-44">
      {lines.length === 0 && isActive && (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <div className="relative mb-4">
            <div className="absolute inset-0 rounded-full bg-[#7c3aed]/20 blur-xl animate-pulse" />
            <div className="relative grid h-12 w-12 place-items-center rounded-full border border-[#7c3aed]/30 bg-[#111827]">
              <Terminal className="h-5 w-5 text-[#a78bfa] animate-pulse" />
            </div>
          </div>
          <p className="text-[11px] font-black uppercase tracking-widest text-white/30">
            Conectando con los agentes…
          </p>
        </div>
      )}

      {lines.map((line, idx) => (
        <LogEntry
          key={line.id}
          line={line}
          isLatest={idx === lines.length - 1 && isActive}
        />
      ))}

        <div ref={bottomRef} />
      </div>
    </div>
  );
}
