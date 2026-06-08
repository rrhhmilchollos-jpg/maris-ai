import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getGenerationJobLogs,
  getGetGenerationJobLogsQueryKey,
  type JobLogEntry,
} from "@/lib/api-client";
import {
  Bot, Code2, Search, Sparkles, Database, Server, Zap, CheckCircle2,
  Terminal, ShieldCheck, Wrench, Bug, Eye, FolderOpen, ChevronDown, ChevronRight,
  Layers, Puzzle,
} from "lucide-react";

// ─── Configuración de agentes ────────────────────────────────────────────────
const AGENT_CONFIG: Record<string, { label: string; icon: any; color: string; bgColor: string }> = {
  researcher:   { label: "Researcher",          icon: Search,       color: "text-blue-400",    bgColor: "bg-blue-400/10" },
  architect:    { label: "Architect",            icon: Layers,       color: "text-indigo-400",  bgColor: "bg-indigo-400/10" },
  designer:     { label: "Designer",             icon: Sparkles,     color: "text-pink-400",    bgColor: "bg-pink-400/10" },
  schema:       { label: "Database",             icon: Database,     color: "text-yellow-400",  bgColor: "bg-yellow-400/10" },
  database:     { label: "Database",             icon: Database,     color: "text-yellow-400",  bgColor: "bg-yellow-400/10" },
  frontend:     { label: "Frontend Engineer",    icon: Zap,          color: "text-emerald-400", bgColor: "bg-emerald-400/10" },
  backend:      { label: "Backend Engineer",     icon: Server,       color: "text-cyan-400",    bgColor: "bg-cyan-400/10" },
  integrations: { label: "API Integrator",       icon: Puzzle,       color: "text-orange-400",  bgColor: "bg-orange-400/10" },
  integration:  { label: "API Integrator",       icon: Puzzle,       color: "text-orange-400",  bgColor: "bg-orange-400/10" },
  qa:           { label: "QA Specialist",        icon: CheckCircle2, color: "text-cyan-400",    bgColor: "bg-cyan-400/10" },
  // testing-agent — nombre en azul cielo
  patcher:      { label: "testing-agent",        icon: Bug,          color: "text-sky-400",     bgColor: "bg-sky-400/10" },
  testing:      { label: "testing-agent",        icon: Bug,          color: "text-sky-400",     bgColor: "bg-sky-400/10" },
  validator:    { label: "testing-agent",        icon: ShieldCheck,  color: "text-sky-400",     bgColor: "bg-sky-400/10" },
  repair:       { label: "testing-agent",        icon: Wrench,       color: "text-sky-400",     bgColor: "bg-sky-400/10" },
  coder:        { label: "Frontend Engineer",    icon: Code2,        color: "text-emerald-400", bgColor: "bg-emerald-400/10" },
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

  const summaryText = filePath
    ? line.message.replace(/FILE:\s*\S+/, "").trim() || filePath
    : line.message.length > 100
    ? line.message.slice(0, 100) + "…"
    : line.message;

  return (
    <div
      className={`group rounded-lg border transition-all duration-200 animate-in fade-in slide-in-from-left-1 ${
        isError
          ? "border-red-500/20 bg-red-500/5"
          : isWarn
          ? "border-amber-500/20 bg-amber-500/5"
          : "border-white/[0.06] bg-white/[0.02] hover:bg-white/[0.035]"
      } ${isLatest ? "ring-1 ring-[#7c3aed]/25" : ""}`}
    >
      {/* Cabecera del bloque */}
      <div
        className={`flex items-center gap-2 px-3 py-2 ${isExpandable ? "cursor-pointer select-none" : ""}`}
        onClick={isExpandable ? () => setExpanded((v) => !v) : undefined}
      >
        {/* Icono del agente */}
        <div className={`flex h-5 w-5 shrink-0 items-center justify-center rounded ${config.bgColor}`}>
          <Icon className={`h-3 w-3 ${config.color}`} />
        </div>

        {/* Nombre del agente */}
        <span className={`text-[10px] font-black uppercase tracking-widest ${config.color} shrink-0`}>
          {config.label}
        </span>

        {/* Icono de acción si hay ruta de archivo */}
        {filePath && (
          <ActionIcon className="h-3 w-3 text-white/25 shrink-0" />
        )}

        {/* Texto del mensaje */}
        <span
          className={`flex-1 truncate font-mono text-[10.5px] ${
            isError ? "text-red-400" : isWarn ? "text-amber-400" : "text-white/50"
          }`}
        >
          {filePath ? (
            <span className="text-white/65">{filePath}</span>
          ) : (
            summaryText
          )}
        </span>

        {/* Hora */}
        <span className="shrink-0 font-mono text-[9px] text-white/20">{timeOf(line.createdAt)}</span>

        {/* Indicador de activo */}
        {isLatest && (
          <div className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-400 animate-ping" />
        )}

        {/* Flecha expandir */}
        {isExpandable && (
          <div className="shrink-0 text-white/25 transition-transform duration-200">
            {expanded ? (
              <ChevronDown className="h-3.5 w-3.5" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5" />
            )}
          </div>
        )}
      </div>

      {/* Contenido expandido */}
      {isExpandable && expanded && (
        <div className="border-t border-white/[0.05] bg-[#060810] px-4 py-3">
          <pre className="overflow-x-auto whitespace-pre-wrap break-words font-mono text-[10px] leading-relaxed text-white/65">
            {extractCode(line.message)}
          </pre>
        </div>
      )}
    </div>
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
    if (bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [lines.length]);

  if (jobId === null) return null;

  return (
    <div className="flex flex-col h-full overflow-auto custom-scrollbar bg-[#080a12] p-3 gap-1">
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
  );
}
