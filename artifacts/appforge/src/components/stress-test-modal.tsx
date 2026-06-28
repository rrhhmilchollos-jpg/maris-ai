/**
 * stress-test-modal.tsx
 *
 * Lanza una prueba de carga real contra el deploy en producción de la app
 * (POST /api/apps/:appId/stress-test) y muestra los resultados con
 * latencia/throughput/errores y un veredicto claro — cierra el hueco de
 * "sin pruebas de estrés automatizadas" señalado externamente.
 */
import { useState } from "react";
import { Activity, X, Loader2, Zap, AlertTriangle, CheckCircle2, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { apiFetch } from "@/lib/api-client";
import { cn } from "@/lib/utils";

interface StressTestResult {
  targetUrl: string;
  durationSeconds: number;
  connections: number;
  requestsPerSecond: number;
  totalRequests: number;
  latency: { averageMs: number; p50Ms: number; p99Ms: number };
  throughputMbps: number;
  errors: number;
  non2xxResponses: number;
  errorRatePercent: number;
  verdict: "good" | "warning" | "critical";
}

const VERDICT_META = {
  good: { label: "La app aguantó bien la carga", color: "text-emerald-400", bg: "bg-emerald-500/10 border-emerald-500/25", Icon: CheckCircle2 },
  warning: { label: "Hay señales de presión bajo carga", color: "text-amber-400", bg: "bg-amber-500/10 border-amber-500/25", Icon: AlertTriangle },
  critical: { label: "La app no soportó bien esta carga", color: "text-red-400", bg: "bg-red-500/10 border-red-500/25", Icon: XCircle },
};

export function StressTestModal({ appId, isDeployed, onClose }: { appId: string; isDeployed: boolean; onClose: () => void }) {
  const [connections, setConnections] = useState(10);
  const [durationSeconds, setDurationSeconds] = useState(10);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<StressTestResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleRun = async () => {
    setRunning(true);
    setError(null);
    try {
      const res = await apiFetch<StressTestResult>(`/api/apps/${appId}/stress-test`, {
        method: "POST",
        body: JSON.stringify({ connections, durationSeconds }),
      });
      setResult(res);
    } catch (err: any) {
      setError(err?.message || "No se pudo ejecutar la prueba de estrés.");
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className="w-full max-w-lg rounded-2xl border border-white/[0.09] bg-[#0d0f1a] shadow-2xl">
        <div className="flex items-center gap-3 border-b border-white/[0.07] px-5 py-4">
          <div className="grid h-8 w-8 place-items-center rounded-lg bg-[#7c3aed]/20">
            <Activity className="h-4 w-4 text-[#c084fc]" />
          </div>
          <div>
            <p className="text-base font-bold text-white">Prueba de estrés</p>
            <p className="text-[12px] text-white/40">Lanza tráfico real contra tu app desplegada y mide cómo responde.</p>
          </div>
          <button onClick={onClose} className="ml-auto grid h-8 w-8 place-items-center rounded-lg text-white/40 hover:bg-white/[0.06] hover:text-white">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="p-5">
          {!isDeployed ? (
            <div className="rounded-xl border border-amber-500/25 bg-amber-500/10 px-4 py-3 text-[13px] text-amber-200">
              Despliega esta app primero — las pruebas de estrés solo pueden medir tráfico real contra una versión publicada, no contra la vista previa.
            </div>
          ) : !result ? (
            <div className="space-y-5">
              <div>
                <div className="mb-2 flex items-center justify-between text-[12px] text-white/60">
                  <span>Usuarios simultáneos</span>
                  <span className="font-mono text-white/85">{connections}</span>
                </div>
                <Slider value={[connections]} onValueChange={([v]) => setConnections(v)} min={1} max={20} step={1} disabled={running} />
              </div>
              <div>
                <div className="mb-2 flex items-center justify-between text-[12px] text-white/60">
                  <span>Duración</span>
                  <span className="font-mono text-white/85">{durationSeconds}s</span>
                </div>
                <Slider value={[durationSeconds]} onValueChange={([v]) => setDurationSeconds(v)} min={5} max={15} step={1} disabled={running} />
              </div>
              <p className="text-[11px] text-white/30">Coste: 5 créditos por prueba.</p>
              {error && <p className="text-[12px] text-red-400">{error}</p>}
              <Button onClick={handleRun} disabled={running} className="h-10 w-full bg-[#7c3aed] text-[13px] font-bold text-white hover:bg-[#8b5cf6]">
                {running ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Zap className="mr-2 h-4 w-4" />}
                {running ? "Lanzando tráfico de prueba…" : "Ejecutar prueba"}
              </Button>
            </div>
          ) : (
            <div className="space-y-4">
              {(() => {
                const meta = VERDICT_META[result.verdict];
                const Icon = meta.Icon;
                return (
                  <div className={cn("flex items-center gap-2.5 rounded-xl border px-4 py-3", meta.bg)}>
                    <Icon className={cn("h-4.5 w-4.5 shrink-0", meta.color)} />
                    <span className={cn("text-[13px] font-semibold", meta.color)}>{meta.label}</span>
                  </div>
                );
              })()}

              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-xl border border-white/8 bg-white/[0.03] p-3">
                  <p className="text-[10px] uppercase tracking-wide text-white/35">Peticiones/seg</p>
                  <p className="mt-1 text-lg font-bold text-white">{result.requestsPerSecond}</p>
                </div>
                <div className="rounded-xl border border-white/8 bg-white/[0.03] p-3">
                  <p className="text-[10px] uppercase tracking-wide text-white/35">Latencia media</p>
                  <p className="mt-1 text-lg font-bold text-white">{result.latency.averageMs}ms</p>
                </div>
                <div className="rounded-xl border border-white/8 bg-white/[0.03] p-3">
                  <p className="text-[10px] uppercase tracking-wide text-white/35">Latencia p99</p>
                  <p className="mt-1 text-lg font-bold text-white">{result.latency.p99Ms}ms</p>
                </div>
                <div className="rounded-xl border border-white/8 bg-white/[0.03] p-3">
                  <p className="text-[10px] uppercase tracking-wide text-white/35">Errores</p>
                  <p className={cn("mt-1 text-lg font-bold", result.errorRatePercent > 2 ? "text-red-400" : "text-white")}>{result.errorRatePercent}%</p>
                </div>
              </div>

              <p className="text-[11px] text-white/35">
                {result.totalRequests.toLocaleString("es-ES")} peticiones en {result.durationSeconds}s, {result.connections} usuarios simultáneos, contra {result.targetUrl}
              </p>

              <Button onClick={() => setResult(null)} variant="outline" className="h-9 w-full border-white/10 bg-white/[0.04] text-[12px] text-white hover:bg-white/[0.08]">
                Ejecutar otra prueba
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
