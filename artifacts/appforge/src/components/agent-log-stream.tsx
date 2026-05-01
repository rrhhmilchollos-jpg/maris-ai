import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getGenerationJobLogs,
  getGetGenerationJobLogsQueryKey,
  type JobLogEntry,
} from "@workspace/api-client-react";
import { Bot } from "lucide-react";

// We deliberately collapse every internal agent role (researcher, architect,
// designer, integration, coder, qa, validator, patcher, system) into a single
// user-facing "Robot" persona. The end user doesn't care which sub-agent is
// running — they want a single friendly assistant. The original `agent` field
// is still preserved on the data row (for analytics / debugging) but is not
// surfaced in the UI label.
const ROBOT_LABEL = "Robot";
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
  jobId: number | null;
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
  const [lastId, setLastId] = useState(0);
  const lastJobIdRef = useRef<number | null>(null);
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
  const queryKey = [...getGetGenerationJobLogsQueryKey(jobId ?? 0), "stream"];
  const { data } = useQuery({
    // Use only the jobId in the key so re-renders from `lastId` changes don't
    // create infinite new query keys. The afterId is passed via queryFn.
    queryKey,
    queryFn: ({ signal }) =>
      // Forward React Query's AbortSignal so an in-flight poll is cancelled
      // when the job switches or the component unmounts. Without this, the
      // tail of a long request can resolve after teardown and stamp stale
      // lines into the next job's stream.
      getGenerationJobLogs(jobId ?? 0, { afterId: lastId }, { signal }),
    enabled,
    // Poll fast while running; stop once the job terminates. Tail-loss (lines
    // committed by the unawaited fire-and-forget INSERT after the job is
    // marked succeeded) is mitigated by the explicit final fetch effect below.
    // 600 ms feels close-to-realtime in the UI without putting noticeable
    // load on the API server (the response is tiny — only NEW lines after
    // the cursor — and the route is a single indexed SELECT).
    refetchInterval: isActive ? 600 : false,
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
      const seen = new Set(prev.map((l) => l.id));
      const fresh = data.logs.filter((l) => !seen.has(l.id));
      if (fresh.length === 0) return prev;
      return [...prev, ...fresh];
    });
    const newest = Math.max(...data.logs.map((l) => l.id));
    setLastId((prev) => (newest > prev ? newest : prev));
  }, [data]);

  // Auto-scroll to bottom on new lines.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines.length]);

  if (!enabled) return null;

  return (
    <div
      className="rounded-md border border-border/40 bg-black/40 font-mono text-[11px] leading-relaxed"
      data-testid="agent-log-stream"
    >
      <div className="flex items-center justify-between border-b border-border/40 px-3 py-1.5">
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
          Logs en vivo del agente
        </span>
        <span
          className="text-[10px] tabular-nums text-muted-foreground"
          data-testid="agent-log-count"
        >
          {lines.length} línea{lines.length === 1 ? "" : "s"}
        </span>
      </div>
      <div
        ref={scrollRef}
        className="max-h-56 overflow-y-auto px-3 py-2 space-y-1"
      >
        {lines.length === 0 ? (
          <div className="text-muted-foreground/60 italic">
            Esperando primer paso del pipeline…
          </div>
        ) : (
          lines.map((line, idx) => {
            const levelClass =
              line.level === "error"
                ? "text-red-300"
                : line.level === "warn"
                ? "text-amber-200"
                : "text-foreground/90";
            // Vibrate ONLY the icon on the most recent line and ONLY while
            // the job is still active, so the user's eye is naturally drawn
            // to "what the robot is doing right now" without a wall of
            // moving icons.
            const isLatest = idx === lines.length - 1;
            const vibrate = isActive && isLatest ? "robot-vibrate" : "";
            return (
              <div
                key={line.id}
                className="flex items-start gap-2"
                data-testid={`agent-log-line-${line.id}`}
                data-agent={line.agent}
                data-level={line.level}
              >
                <span className="text-muted-foreground/60 tabular-nums shrink-0">
                  {timeOf(line.createdAt)}
                </span>
                <Bot
                  className={`h-3.5 w-3.5 mt-0.5 shrink-0 ${ROBOT_COLOR} ${vibrate}`}
                />
                <span className={`shrink-0 ${ROBOT_COLOR}`}>{ROBOT_LABEL}</span>
                <span className="text-muted-foreground/40">›</span>
                <span className={`min-w-0 break-words ${levelClass}`}>
                  {line.message}
                </span>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
