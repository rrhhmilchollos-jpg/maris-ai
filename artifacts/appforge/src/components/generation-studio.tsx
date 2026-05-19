import { useEffect, useRef, useState, useCallback } from "react";
import { Bot, Code2, Eye, EyeOff, Loader2, CheckCircle2, XCircle, Zap } from "lucide-react";
import { AgentLogStream } from "@/components/agent-log-stream";
import { Progress } from "@/components/ui/progress";

// ─── Types ────────────────────────────────────────────────────────────────────

interface JobState {
  status?: string;
  phase?: string;
  progress?: number;
  partialFrontendCode?: string | null;
  errorMessage?: string | null;
  awaitingApproval?: boolean;
  checkpointData?: any;
}

interface GenerationStudioProps {
  /** ID del job activo. null = no mostrar nada. */
  jobId: number | null;
  /** Estado actual del job (de useGetGenerationJob). */
  job: JobState | null | undefined;
  /** Label + icono de la fase actual. */
  phaseLabel: string;
  PhaseIcon: React.ComponentType<{ className?: string }>;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Convierte un bundle de texto con separadores "// === FILE: <path> ==="
 * en un HTML mínimo que podemos meter en un srcdoc del iframe.
 * Si el bundle contiene un index.html lo usa directamente.
 * En otro caso devuelve un placeholder animado.
 */
function bundleToPreviewHtml(code: string | null | undefined): string | null {
  if (!code || code.length < 200) return null;

  // Si el bundle ya contiene un index.html úsalo
  const htmlMatch = code.match(
    /\/\/ === FILE: index\.html ===([\s\S]*?)(?:\/\/ === FILE:|$)/,
  );
  if (htmlMatch) {
    const raw = htmlMatch[1].trim();
    if (raw.length > 50) return raw;
  }

  // Fallback: mostrar un placeholder bonito con stats del bundle
  const fileMatches = [...code.matchAll(/\/\/ === FILE: ([^\n]+) ===/g)];
  const files = fileMatches.map((m) => m[1]).slice(0, 12);
  const kb = Math.round(code.length / 1000);

  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: 'JetBrains Mono', 'Fira Code', monospace;
    background: #0a0a0f;
    color: #e2e8f0;
    min-height: 100vh;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 2rem;
    gap: 1.5rem;
  }
  .badge {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    background: #7c3aed22;
    border: 1px solid #7c3aed66;
    color: #a78bfa;
    padding: 0.3rem 0.8rem;
    border-radius: 999px;
    font-size: 0.7rem;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }
  .dot { width: 6px; height: 6px; border-radius: 50%; background: #7c3aed; animation: pulse 1.2s ease-in-out infinite; }
  @keyframes pulse { 0%,100%{opacity:1;transform:scale(1)} 50%{opacity:.4;transform:scale(0.8)} }
  h1 { font-size: 1.1rem; color: #f8fafc; letter-spacing: -0.01em; }
  .stat { color: #94a3b8; font-size: 0.72rem; }
  .stat span { color: #7c3aed; }
  .files { display: flex; flex-wrap: wrap; gap: 0.4rem; justify-content: center; max-width: 480px; }
  .file {
    background: #1e1e2e;
    border: 1px solid #2d2d3f;
    color: #94a3b8;
    padding: 0.2rem 0.6rem;
    border-radius: 4px;
    font-size: 0.65rem;
  }
  .bar-wrap { width: 260px; height: 3px; background: #1e1e2e; border-radius: 2px; overflow: hidden; }
  .bar { height: 100%; background: linear-gradient(90deg,#7c3aed,#06b6d4); border-radius: 2px; animation: progress 2s ease-in-out infinite alternate; }
  @keyframes progress { from{width:30%} to{width:85%} }
</style>
</head>
<body>
  <div class="badge"><div class="dot"></div>Generando bundle</div>
  <h1>Escribiendo tu aplicación…</h1>
  <p class="stat"><span>${kb} KB</span> generados · <span>${files.length}</span> archivo(s) detectado(s)</p>
  <div class="bar-wrap"><div class="bar"></div></div>
  ${files.length > 0 ? `<div class="files">${files.map((f) => `<div class="file">${f}</div>`).join("")}</div>` : ""}
</body>
</html>`;
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function PreviewPane({
  code,
  isActive,
}: {
  code: string | null | undefined;
  isActive: boolean;
}) {
  const html = bundleToPreviewHtml(code);
  const [showPreview, setShowPreview] = useState(true);

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-white/5 bg-black/20 shrink-0">
        <div className="flex items-center gap-2">
          <Eye className="h-3.5 w-3.5 text-cyan-400" />
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
            Preview en vivo
          </span>
          {isActive && (
            <span className="flex items-center gap-1 text-[10px] text-cyan-400">
              <span className="h-1.5 w-1.5 rounded-full bg-cyan-400 animate-pulse inline-block" />
              generando…
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={() => setShowPreview((v) => !v)}
          className="text-muted-foreground/50 hover:text-muted-foreground transition-colors"
          title={showPreview ? "Ocultar preview" : "Mostrar preview"}
        >
          {showPreview ? (
            <EyeOff className="h-3.5 w-3.5" />
          ) : (
            <Eye className="h-3.5 w-3.5" />
          )}
        </button>
      </div>

      {/* Preview area */}
      <div className="flex-1 min-h-0 relative bg-[#0d0d12]">
        {!showPreview ? (
          <div className="absolute inset-0 flex items-center justify-center text-muted-foreground/30 text-xs">
            Preview oculto
          </div>
        ) : !html ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-muted-foreground/40">
            <Code2 className="h-8 w-8 opacity-30" />
            <p className="text-xs">Esperando código del frontend…</p>
            <div className="flex gap-1">
              {[0, 1, 2].map((i) => (
                <span
                  key={i}
                  className="h-1.5 w-1.5 rounded-full bg-purple-500/40 animate-bounce"
                  style={{ animationDelay: `${i * 0.15}s` }}
                />
              ))}
            </div>
          </div>
        ) : (
          <iframe
            key={html.length > 500 ? Math.floor(html.length / 5000) : "placeholder"}
            srcDoc={html}
            title="Preview parcial"
            sandbox="allow-scripts allow-same-origin allow-forms allow-modals"
            className="w-full h-full border-0"
          />
        )}
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

import { useApproveFacet } from "@/lib/api-client";
import { useQueryClient } from "@tanstack/react-query";
import { getGetGenerationJobQueryKey } from "@/lib/api-client";

export function GenerationStudio({
  jobId,
  job,
  phaseLabel,
  PhaseIcon,
}: GenerationStudioProps) {
  const queryClient = useQueryClient();
  const approveMutation = useApproveFacet({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetGenerationJobQueryKey(jobId ?? 0) });
      }
    }
  });

  const isActive =
    job?.status !== "succeeded" && job?.status !== "failed" && jobId !== null && job?.status !== "awaiting_approval";
  const isAwaitingApproval = job?.status === "awaiting_approval";
  const isDone = job?.status === "succeeded";
  const isFailed = job?.status === "failed";
  const progressValue = job?.progress ?? 0;
  const partialCode = job?.partialFrontendCode;

  // Para el panel derecho sólo mostramos preview cuando estamos en fase de generación o posterior
  const generatingPhases = [
    "generating",
    "reviewing",
    "validating",
    "fixing",
    "parsing",
    "ready",
  ];
  const showPreview = generatingPhases.includes(job?.phase ?? "");

  if (!jobId) return null;

  return (
    <div
      className="rounded-xl border border-primary/20 bg-black/30 backdrop-blur overflow-hidden"
      data-testid="generation-studio"
    >
      {/* ── Top bar ── */}
      <div className="flex items-center justify-between gap-4 px-4 py-2.5 border-b border-white/5 bg-primary/5">
        <div className="flex items-center gap-2.5 min-w-0">
          {isFailed ? (
            <XCircle className="h-4 w-4 text-red-400 shrink-0" />
          ) : isDone ? (
            <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />
          ) : (
            <PhaseIcon
              className={`h-4 w-4 text-primary shrink-0 ${isActive ? "animate-spin" : ""}`}
            />
          )}
          <p className="text-sm font-medium text-white truncate">{phaseLabel}</p>
          {isActive && (
            <span className="hidden sm:flex items-center gap-1 text-[10px] text-muted-foreground">
              <Zap className="h-3 w-3 text-yellow-400" />
              Multi-agente activo
            </span>
          )}
        </div>
        <span className="text-sm font-mono text-primary tabular-nums shrink-0">
          {progressValue}%
        </span>
      </div>

      {/* ── Progress bar ── */}
      <Progress value={progressValue} className="h-[2px] rounded-none" />

      {/* ── Split panels ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 divide-y lg:divide-y-0 lg:divide-x divide-white/5">
        {/* Left — agent logs */}
        <div className="flex flex-col min-h-0 p-3 gap-2">
          <div className="flex items-center gap-1.5 mb-1">
            <Bot className="h-3.5 w-3.5 text-emerald-400" />
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Agentes
            <div className="space-y-4">
            {isAwaitingApproval && (
              <div className="p-4 rounded-lg border border-primary/30 bg-primary/5 animate-in fade-in slide-in-from-bottom-2 duration-500">
                <div className="flex items-center gap-3 mb-3">
                  <div className="h-8 w-8 rounded-full bg-primary/20 flex items-center justify-center">
                    <Bot className="h-5 w-5 text-primary robot-vibrate" />
                  </div>
                  <div>
                    <h4 className="text-sm font-bold text-primary">¡He terminado la estructura!</h4>
                    <p className="text-xs text-muted-foreground">Revisa el plan y dame el visto bueno para empezar a programar.</p>
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button 
                    size="sm" 
                    className="flex-1 gap-2" 
                    onClick={() => approveMutation.mutate({ id: String(jobId), data: { facet: "structure" } })}
                    disabled={approveMutation.isPending}
                  >
                    {approveMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />}
                    Aprobar y continuar
                  </Button>
                </div>
              </div>
            )}
            <AgentLogStream jobId={jobId} isActive={isActive || isAwaitingApproval} />
          </div>

        {/* Right — preview */}
        <div
          className="min-h-[260px] lg:min-h-[320px]"
          style={{ height: "clamp(260px,38vh,480px)" }}
        >
          <PreviewPane code={partialCode} isActive={isActive && showPreview} />
        </div>
      </div>

      {/* ── Footer hint ── */}
      <div className="px-4 py-2 border-t border-white/5 bg-black/20">
        <p className="text-[10px] text-muted-foreground/50 text-center">
          {isFailed
            ? "La generación falló. Ajusta el prompt e inténtalo de nuevo."
            : isDone
            ? "¡Generación completada! Redirigiendo…"
            : "La generación puede tardar entre 30 s y 2 min según la complejidad del proyecto."}
        </p>
      </div>
    </div>
  );
}
