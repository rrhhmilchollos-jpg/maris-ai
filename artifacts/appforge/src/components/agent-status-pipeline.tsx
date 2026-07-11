/**
 * agent-status-pipeline.tsx
 *
 * Pipeline visual de agentes en vivo (estilo Emergent.sh): muestra qué
 * micro-agente está trabajando ahora mismo (Orchestrator / File Editor /
 * Testing Agent) y cuántos créditos se están gastando en tiempo real,
 * usando datos que YA llegan cada 1s vía useGetGenerationJob — no abre
 * ninguna conexión nueva, solo lee lo que app-detail.tsx ya está
 * sondeando (internalApiCostCents vía usageMeter.ts, expuesto ahora en
 * GET /api/jobs/:id como spentCreditsEquivalent).
 */
import { useEffect, useRef, useState } from "react";
import { Bot, FileEdit, FlaskConical, Zap } from "lucide-react";
import { cn } from "@/lib/utils";

type PipelineStage = "idle" | "orchestrator" | "file_editor" | "testing_agent";

function stageFromJob(job: any): PipelineStage {
  if (!job || job.status === "succeeded" || job.status === "failed") return "idle";
  const agent = (job.currentAgent || "").toLowerCase();
  const phase = (job.phase || "").toLowerCase();
  if (agent.includes("test") || agent.includes("eval") || agent.includes("qa") || phase.includes("test") || phase.includes("valid") || phase.includes("repair")) {
    return "testing_agent";
  }
  if (agent.includes("patch") || agent.includes("editor") || phase.includes("patch") || phase.includes("edit")) {
    return "file_editor";
  }
  return "orchestrator";
}

const STAGES: { key: PipelineStage; label: string; Icon: typeof Bot }[] = [
  { key: "orchestrator", label: "Orchestrator", Icon: Bot },
  { key: "file_editor", label: "Editor de archivos", Icon: FileEdit },
  { key: "testing_agent", label: "Testing Agent", Icon: FlaskConical },
];

export function AgentStatusPipeline({ job }: { job: any }) {
  const stage = stageFromJob(job);
  const isWarning = !!job?.stuckLoopDetected || !!job?.budgetExceeded;
  const isFrozen = isWarning; // congelado = mismo estado visual, el modal aparte explica el detalle

  // Créditos/seg entre dos lecturas — el dato del backend es acumulado
  // (spentCreditsEquivalent), la tasa "en vivo" se calcula aquí mismo.
  const prevRef = useRef<{ spent: number; at: number } | null>(null);
  const [burnRatePerSecond, setBurnRatePerSecond] = useState(0);

  useEffect(() => {
    if (stage === "idle") {
      setBurnRatePerSecond(0);
      prevRef.current = null;
      return;
    }
    const spent = job?.spentCreditsEquivalent ?? 0;
    const now = Date.now();
    if (prevRef.current) {
      const elapsedSec = Math.max((now - prevRef.current.at) / 1000, 0.001);
      const rate = Math.max(0, (spent - prevRef.current.spent) / elapsedSec);
      setBurnRatePerSecond(Math.round(rate * 100) / 100);
    }
    prevRef.current = { spent, at: now };
  }, [job?.spentCreditsEquivalent, stage]);

  if (stage === "idle") return null;

  return (
    <div className="flex items-center justify-between gap-3 px-3 py-2 rounded-lg bg-white/5 border border-white/10 mb-3">
      <div className="flex items-center gap-2">
        {STAGES.map(({ key, label, Icon }) => {
          const active = key === stage;
          const warn = active && isWarning;
          return (
            <div
              key={key}
              className={cn(
                "flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-medium transition-colors",
                warn
                  ? "bg-amber-500/15 text-amber-400 animate-pulse"
                  : active
                  ? "bg-emerald-500/15 text-emerald-400 animate-pulse"
                  : "text-white/30",
              )}
            >
              <Icon className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">{label}</span>
            </div>
          );
        })}
      </div>

      <div
        className={cn(
          "flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-mono font-bold",
          isFrozen
            ? "bg-blue-500/15 text-blue-400"
            : burnRatePerSecond > 0
            ? "bg-red-500/15 text-red-400 animate-pulse"
            : "text-white/40",
        )}
      >
        <Zap className="h-3.5 w-3.5" />
        {isFrozen ? "CONGELADO" : `${burnRatePerSecond.toFixed(2)} créditos/seg`}
      </div>
    </div>
  );
}
