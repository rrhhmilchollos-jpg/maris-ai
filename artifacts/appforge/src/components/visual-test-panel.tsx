/**
 * visual-test-panel.tsx
 * 
 * Panel de testing visual con IA que aparece en la consola de chat.
 * Hace screenshots reales del deploy, Claude Vision analiza los errores,
 * y muestra las imágenes con anotaciones de problemas detectados.
 * 
 * Exclusivo de Maris AI — ningún competidor (Emergent, Lovable, Base44)
 * tiene visual testing nativo con screenshots en la consola de chat.
 */

import { useState } from "react";
import {
  Camera, Loader2, CheckCircle2, AlertTriangle, XCircle,
  Wand2, Monitor, Tablet, Smartphone, ChevronDown, ChevronUp,
  Eye, Zap, Bug, RefreshCw
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { apiFetch } from "@/lib/api";

interface VisualIssue {
  severity: "critical" | "major" | "minor";
  type: string;
  viewport: string;
  description: string;
  cssfix?: string;
}

interface Screenshot {
  viewport: string;
  dataUrl: string;
}

interface VisualTestResult {
  visuallyCorrect: boolean;
  overallScore: number;
  issues: VisualIssue[];
  screenshots: Screenshot[];
  fixesApplied: number;
}

interface VisualTestPanelProps {
  appId: string;
  appSlug?: string;
  className?: string;
}

const VIEWPORT_ICONS = {
  desktop: Monitor,
  tablet: Tablet,
  mobile: Smartphone,
};

const SEVERITY_CONFIG = {
  critical: { label: "Crítico", color: "text-red-400", bg: "bg-red-500/10 border-red-500/25", icon: XCircle },
  major: { label: "Mayor", color: "text-amber-400", bg: "bg-amber-500/10 border-amber-500/25", icon: AlertTriangle },
  minor: { label: "Menor", color: "text-blue-400", bg: "bg-blue-500/10 border-blue-500/25", icon: Bug },
};

export function VisualTestPanel({ appId, appSlug, className }: VisualTestPanelProps) {
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<VisualTestResult | null>(null);
  const [beforeResult, setBeforeResult] = useState<VisualTestResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeViewport, setActiveViewport] = useState<string>("desktop");
  const [showIssues, setShowIssues] = useState(true);
  const [autoFixing, setAutoFixing] = useState(false);
  const [compareMode, setCompareMode] = useState(false);

  async function runTest(autoFix = false) {
    if (!appSlug) {
      setError("La app debe estar desplegada públicamente para el test visual. Despliégala primero.");
      return;
    }

    if (autoFix) {
      setAutoFixing(true);
      // Save current result as "before" for comparison
      if (result) setBeforeResult(result);
      setCompareMode(false);
    } else {
      setRunning(true);
      setBeforeResult(null);
      setCompareMode(false);
    }
    setError(null);

    try {
      const data = await apiFetch<any>(`/api/apps/${appId}/visual-test`, {
        method: "POST",
        body: JSON.stringify({ autoFix }),
      });

      setResult(data);
      if (data.screenshots?.length > 0) {
        setActiveViewport(data.screenshots[0].viewport);
      }
      // If autoFix was applied and there were fixes, activate compare mode
      if (autoFix && data.fixesApplied > 0) {
        setCompareMode(true);
      }
    } catch (err: any) {
      setError(err.message || "Error en el test visual");
    } finally {
      setRunning(false);
      setAutoFixing(false);
    }
  }

  const activeShot = result?.screenshots?.find(s => s.viewport === activeViewport);
  const activeIssues = result?.issues?.filter(i => i.viewport === activeViewport) || [];
  const criticalCount = result?.issues?.filter(i => i.severity === "critical").length || 0;
  const majorCount = result?.issues?.filter(i => i.severity === "major").length || 0;

  return (
    <div className={cn("rounded-xl border border-white/[0.08] bg-[#0d0d12] overflow-hidden", className)}>
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-white/[0.06]">
        <div className="w-8 h-8 rounded-lg bg-cyan-500/15 border border-cyan-500/25 flex items-center justify-center">
          <Eye className="h-4 w-4 text-cyan-400" />
        </div>
        <div className="flex-1">
          <div className="text-sm font-bold text-white flex items-center gap-2">
            Testing Visual IA
            <Badge className="bg-cyan-500/20 text-cyan-300 border-cyan-500/30 text-[9px] py-0">
              Claude Vision
            </Badge>
            {result && (
              <Badge className={cn(
                "text-[9px] py-0",
                result.visuallyCorrect
                  ? "bg-emerald-500/20 text-emerald-400 border-emerald-500/30"
                  : criticalCount > 0
                  ? "bg-red-500/20 text-red-400 border-red-500/30"
                  : "bg-amber-500/20 text-amber-400 border-amber-500/30"
              )}>
                {result.overallScore}/100
              </Badge>
            )}
          </div>
          <p className="text-[10px] text-white/40">
            Screenshots reales · Detección IA de errores · Autofix integrado
          </p>
        </div>
        <div className="flex gap-2 shrink-0">
          {result && !result.visuallyCorrect && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => runTest(true)}
              disabled={autoFixing}
              className="h-7 text-[10px] border-violet-500/30 text-violet-400 hover:bg-violet-500/10 px-2"
            >
              {autoFixing
                ? <><Loader2 className="h-3 w-3 mr-1 animate-spin" />Reparando...</>
                : <><Wand2 className="h-3 w-3 mr-1" />Autofix IA</>
              }
            </Button>
          )}
          <Button
            size="sm"
            onClick={() => runTest(false)}
            disabled={running || autoFixing}
            className="h-7 text-[10px] bg-cyan-600 hover:bg-cyan-700 text-white px-2"
          >
            {running
              ? <><Loader2 className="h-3 w-3 mr-1 animate-spin" />Analizando...</>
              : result
              ? <><RefreshCw className="h-3 w-3 mr-1" />Re-test</>
              : <><Camera className="h-3 w-3 mr-1" />Analizar</>
            }
          </Button>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="mx-4 my-3 flex items-start gap-2 text-[11px] text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
          <XCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
          {error}
        </div>
      )}

      {/* Loading state */}
      {running && (
        <div className="p-6 text-center space-y-2">
          <Loader2 className="h-8 w-8 text-cyan-400 animate-spin mx-auto" />
          <p className="text-sm text-white/60 font-medium">Capturando screenshots...</p>
          <p className="text-[11px] text-white/30">Claude Vision está analizando el diseño en 3 viewports</p>
          <div className="flex justify-center gap-3 mt-3">
            {["desktop", "tablet", "mobile"].map(v => (
              <div key={v} className="flex items-center gap-1 text-[10px] text-white/30">
                <Loader2 className="h-3 w-3 animate-spin" />
                {v}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Results */}
      {result && !running && (
        <div>
          {/* Score bar */}
          <div className="px-4 py-2 border-b border-white/[0.06]">
            <div className="flex items-center justify-between mb-1">
              <span className="text-[10px] text-white/40">Puntuación visual</span>
              <span className={cn(
                "text-[11px] font-bold",
                result.overallScore >= 80 ? "text-emerald-400" :
                result.overallScore >= 60 ? "text-amber-400" : "text-red-400"
              )}>
                {result.overallScore}/100
              </span>
            </div>
            <div className="h-1.5 bg-white/[0.06] rounded-full overflow-hidden">
              <div
                className={cn(
                  "h-full rounded-full transition-all",
                  result.overallScore >= 80 ? "bg-emerald-500" :
                  result.overallScore >= 60 ? "bg-amber-500" : "bg-red-500"
                )}
                style={{ width: `${result.overallScore}%` }}
              />
            </div>
            <div className="flex gap-3 mt-1.5">
              {criticalCount > 0 && (
                <span className="text-[10px] text-red-400 flex items-center gap-0.5">
                  <XCircle className="h-2.5 w-2.5" />{criticalCount} crítico{criticalCount !== 1 ? "s" : ""}
                </span>
              )}
              {majorCount > 0 && (
                <span className="text-[10px] text-amber-400 flex items-center gap-0.5">
                  <AlertTriangle className="h-2.5 w-2.5" />{majorCount} mayor{majorCount !== 1 ? "es" : ""}
                </span>
              )}
              {result.fixesApplied > 0 && (
                <span className="text-[10px] text-violet-400 flex items-center gap-0.5">
                  <Zap className="h-2.5 w-2.5" />{result.fixesApplied} fix{result.fixesApplied !== 1 ? "es" : ""} aplicado{result.fixesApplied !== 1 ? "s" : ""}
                </span>
              )}
              {result.visuallyCorrect && (
                <span className="text-[10px] text-emerald-400 flex items-center gap-0.5">
                  <CheckCircle2 className="h-2.5 w-2.5" />Sin problemas visuales
                </span>
              )}
            </div>
          </div>

          {/* Viewport tabs */}
          {result.screenshots?.length > 0 && (
            <>
              <div className="flex border-b border-white/[0.06]">
                {result.screenshots.map(shot => {
                  const Icon = VIEWPORT_ICONS[shot.viewport as keyof typeof VIEWPORT_ICONS] || Monitor;
                  const issueCount = result.issues?.filter(i => i.viewport === shot.viewport).length || 0;
                  return (
                    <button
                      key={shot.viewport}
                      onClick={() => setActiveViewport(shot.viewport)}
                      className={cn(
                        "flex items-center gap-1.5 px-3 py-2 text-[10px] font-medium transition-colors border-b-2 -mb-px",
                        activeViewport === shot.viewport
                          ? "border-cyan-500 text-cyan-400"
                          : "border-transparent text-white/30 hover:text-white/60"
                      )}
                    >
                      <Icon className="h-3 w-3" />
                      {shot.viewport}
                      {issueCount > 0 && (
                        <span className="bg-red-500/20 text-red-400 text-[8px] px-1 rounded-full">{issueCount}</span>
                      )}
                    </button>
                  );
                })}
              </div>

              {/* Before/After toggle */}
              {compareMode && beforeResult && (
                <div className="flex items-center gap-2 px-3 py-2 bg-emerald-500/10 border-b border-emerald-500/20">
                  <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
                  <span className="text-[11px] text-emerald-400 font-medium">
                    IA aplicó {result?.fixesApplied} fix{result?.fixesApplied !== 1 ? "es" : ""} — comparando antes vs después
                  </span>
                  <div className="ml-auto flex gap-1 bg-white/[0.06] rounded-lg p-0.5">
                    <button onClick={() => setCompareMode(false)}
                      className="px-2 py-0.5 rounded-md text-[10px] font-medium bg-white/[0.1] text-white">
                      Después ✓
                    </button>
                    <button onClick={() => setCompareMode(true)}
                      className="px-2 py-0.5 rounded-md text-[10px] font-medium text-white/40 hover:text-white/70">
                      Comparar
                    </button>
                  </div>
                </div>
              )}

              {/* Screenshot — Before/After split or single */}
              {activeShot && (
                <div className="relative border-b border-white/[0.06]">
                  {compareMode && beforeResult ? (
                    /* Side by side comparison */
                    <div className="flex gap-0.5 bg-black">
                      <div className="flex-1 relative">
                        <div className="absolute top-1 left-1 z-10 bg-black/70 text-red-400 text-[9px] font-bold px-1.5 py-0.5 rounded">
                          ANTES
                        </div>
                        <img
                          src={beforeResult.screenshots?.find(s => s.viewport === activeViewport)?.dataUrl || ""}
                          alt="Antes"
                          className="w-full object-cover object-top opacity-80"
                          style={{ maxHeight: "350px" }}
                        />
                        {/* Before issues overlay */}
                        <div className="absolute bottom-1 left-1 right-1 flex flex-wrap gap-0.5">
                          {(beforeResult.issues?.filter(i => i.viewport === activeViewport) || []).slice(0,3).map((issue,i) => {
                            const cfg = SEVERITY_CONFIG[issue.severity];
                            return <div key={i} className={cn("text-[8px] px-1.5 py-0.5 rounded border font-medium", cfg.bg, cfg.color)}>{issue.type}</div>;
                          })}
                        </div>
                      </div>
                      <div className="w-0.5 bg-white/10" />
                      <div className="flex-1 relative">
                        <div className="absolute top-1 left-1 z-10 bg-black/70 text-emerald-400 text-[9px] font-bold px-1.5 py-0.5 rounded">
                          DESPUÉS ✓
                        </div>
                        <img
                          src={activeShot.dataUrl}
                          alt="Después"
                          className="w-full object-cover object-top"
                          style={{ maxHeight: "350px" }}
                        />
                        {/* After score badge */}
                        <div className="absolute bottom-1 right-1 bg-emerald-500/80 text-white text-[9px] font-bold px-1.5 py-0.5 rounded">
                          {result?.overallScore}/100
                        </div>
                      </div>
                    </div>
                  ) : (
                    /* Single screenshot */
                    <div className="relative">
                      <img
                        src={activeShot.dataUrl}
                        alt={`Screenshot ${activeViewport}`}
                        className="w-full"
                        style={{ maxHeight: "400px", objectFit: "cover", objectPosition: "top" }}
                      />
                      {/* Issue overlays */}
                      {activeIssues.length > 0 && (
                        <div className="absolute top-2 right-2 flex flex-col gap-1">
                          {activeIssues.slice(0, 3).map((issue, i) => {
                            const cfg = SEVERITY_CONFIG[issue.severity];
                            const Icon = cfg.icon;
                            return (
                              <div key={i} className={cn("flex items-center gap-1 px-2 py-1 rounded-lg border text-[9px] font-medium", cfg.bg, cfg.color)}>
                                <Icon className="h-2.5 w-2.5 shrink-0" />
                                {issue.type}
                              </div>
                            );
                          })}
                        </div>
                      )}
                      {/* Score badge */}
                      <div className={cn(
                        "absolute bottom-2 left-2 text-[10px] font-bold px-2 py-0.5 rounded-full",
                        result && result.overallScore >= 80 ? "bg-emerald-500/80 text-white" :
                        result && result.overallScore >= 60 ? "bg-amber-500/80 text-white" : "bg-red-500/80 text-white"
                      )}>
                        {result?.overallScore}/100
                      </div>
                    </div>
                  )}
                </div>
              )}
            </>
          )}

          {/* Issues list */}
          {result.issues?.length > 0 && (
            <div>
              <button
                onClick={() => setShowIssues(v => !v)}
                className="w-full flex items-center justify-between px-4 py-2 text-[10px] text-white/40 hover:text-white/60 transition-colors border-b border-white/[0.06]"
              >
                <span className="font-medium">
                  {result.issues.length} problema{result.issues.length !== 1 ? "s" : ""} detectado{result.issues.length !== 1 ? "s" : ""}
                </span>
                {showIssues ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
              </button>

              {showIssues && (
                <div className="divide-y divide-white/[0.04] max-h-64 overflow-y-auto">
                  {result.issues.map((issue, i) => {
                    const cfg = SEVERITY_CONFIG[issue.severity];
                    const Icon = cfg.icon;
                    return (
                      <div key={i} className="px-4 py-2.5">
                        <div className="flex items-center gap-2 mb-1">
                          <Icon className={cn("h-3 w-3 shrink-0", cfg.color)} />
                          <span className={cn("text-[10px] font-semibold", cfg.color)}>{cfg.label}</span>
                          <span className="text-[10px] text-white/30">·</span>
                          <span className="text-[10px] text-white/50">{issue.type}</span>
                          <span className="text-[9px] text-white/25 ml-auto">{issue.viewport}</span>
                        </div>
                        <p className="text-[11px] text-white/60 leading-relaxed">{issue.description}</p>
                        {issue.cssfix && (
                          <code className="mt-1 block text-[9px] text-emerald-400 bg-emerald-500/10 px-2 py-1 rounded font-mono">
                            {issue.cssfix}
                          </code>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {result.visuallyCorrect && (
            <div className="px-4 py-3 flex items-center gap-2 text-[11px] text-emerald-400">
              <CheckCircle2 className="h-4 w-4" />
              La app no tiene problemas visuales detectables. ¡Excelente trabajo!
            </div>
          )}
        </div>
      )}

      {/* Empty state */}
      {!result && !running && !error && (
        <div className="p-6 text-center">
          <Camera className="h-8 w-8 text-white/15 mx-auto mb-2" />
          <p className="text-[11px] text-white/40">
            Captura screenshots reales de tu app y detecta errores visuales con Claude Vision.
          </p>
          <p className="text-[10px] text-white/25 mt-1">
            Analiza diseño responsivo en desktop, tablet y móvil simultáneamente.
          </p>
        </div>
      )}
    </div>
  );
}
