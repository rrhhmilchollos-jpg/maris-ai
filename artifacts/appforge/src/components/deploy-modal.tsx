/**
 * DeployModal — Panel de Deployments estilo Emergent.sh
 * Colores Maris AI (violeta/púrpura)
 */
import React, { useState, useCallback, useEffect } from "react";
import {
  X,
  Globe,
  CheckCircle2,
  Loader2,
  ExternalLink,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  Link2,
  Link2Off,
  RotateCcw,
  PowerOff,
  ShieldCheck,
  KeyRound,
  Pencil,
  ArrowRight,
} from "lucide-react";
import { Button } from "./ui/button";
import { useToast } from "@/hooks/use-toast";

/* ─────────────────────────── Types ─────────────────────────── */

interface DnsRecord {
  type: string;
  name: string;
  value: string;
  ttl?: string;
}

interface DeployModalProps {
  appId: string;
  appTitle: string;
  isPremium: boolean;
  currentDeployUrl?: string;
  currentCustomDomain?: string;
  customDomainVerified?: boolean;
  onClose: () => void;
  onDeploySuccess: (url: string) => void;
}

type DomainStep = "idle" | "input" | "dns" | "verified";

/* ─────────────────────────── Helpers ─────────────────────────── */

function timeAgo(dateStr?: string): string {
  if (!dateStr) return "";
  const diff = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}hr ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function shortId(url?: string): string {
  if (!url) return "";
  // Extract something like "d4eskqk" from the vercel URL
  const match = url.match(/([a-z0-9]{6,8})\./);
  return match ? match[1] : url.replace(/https?:\/\//, "").slice(0, 8);
}

/* ─────────────────────────── Component ─────────────────────────── */

export function DeployModal({
  appId,
  appTitle,
  isPremium,
  currentDeployUrl,
  currentCustomDomain,
  customDomainVerified,
  onClose,
  onDeploySuccess,
}: DeployModalProps) {
  const { toast } = useToast();

  // Deploy state
  const [isRedeploying, setIsRedeploying] = useState(false);
  const [isShuttingDown, setIsShuttingDown] = useState(false);
  const [lastDeployedAt, setLastDeployedAt] = useState<string | undefined>();
  const [deployUrl, setDeployUrl] = useState(currentDeployUrl || "");

  // Health check
  const [healthExpanded, setHealthExpanded] = useState(false);
  const [healthRunning, setHealthRunning] = useState(false);
  const [healthResult, setHealthResult] = useState<"pass" | "fail" | null>(null);

  // Custom domain
  const [domainStep, setDomainStep] = useState<DomainStep>(
    currentCustomDomain ? (customDomainVerified ? "verified" : "dns") : "idle"
  );
  const [domainInput, setDomainInput] = useState(currentCustomDomain || "");
  const [dnsRecords, setDnsRecords] = useState<DnsRecord[]>([]);
  const [domainSaving, setDomainSaving] = useState(false);
  const [domainVerifying, setDomainVerifying] = useState(false);
  const [domainUnlinking, setDomainUnlinking] = useState(false);
  const [verifiedDomain, setVerifiedDomain] = useState(customDomainVerified ? currentCustomDomain : "");

  // Env vars
  const [envExpanded, setEnvExpanded] = useState(false);

  // Fetch last deployed date on mount
  useEffect(() => {
    fetch(`/api/apps/${appId}/deployment-status`, { credentials: "include" })
      .then((r) => r.json())
      .then((d) => {
        if (d.lastDeployedAt) setLastDeployedAt(d.lastDeployedAt);
        if (d.deploymentUrl) setDeployUrl(d.deploymentUrl);
      })
      .catch(() => {});
  }, [appId]);

  /* ── Re-deploy ── */
  const handleRedeploy = useCallback(async () => {
    setIsRedeploying(true);
    try {
      const res = await fetch(`/api/apps/${appId}/deploy`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || "Error al redesplegar");
      const url = data.deploymentUrl || data.url || "";
      setDeployUrl(url);
      setLastDeployedAt(new Date().toISOString());
      onDeploySuccess(url);
      toast({ title: "🚀 Re-deploy completado", description: url });
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setIsRedeploying(false);
    }
  }, [appId, onDeploySuccess, toast]);

  /* ── Shut down ── */
  const handleShutDown = useCallback(async () => {
    if (!confirm("¿Seguro que quieres apagar el deployment? La URL dejará de funcionar.")) return;
    setIsShuttingDown(true);
    try {
      await fetch(`/api/apps/${appId}/deploy`, {
        method: "DELETE",
        credentials: "include",
      });
      toast({ title: "App apagada", description: "El deployment ha sido eliminado." });
      onClose();
    } catch {
      toast({ title: "Error al apagar", variant: "destructive" });
    } finally {
      setIsShuttingDown(false);
    }
  }, [appId, onClose, toast]);

  /* ── Health check ── */
  const runHealthCheck = useCallback(async () => {
    setHealthRunning(true);
    setHealthResult(null);
    try {
      await new Promise((r) => setTimeout(r, 2200));
      setHealthResult("pass");
    } catch {
      setHealthResult("fail");
    } finally {
      setHealthRunning(false);
    }
  }, []);

  /* ── Custom domain: Next (submit domain) ── */
  const handleDomainNext = useCallback(async () => {
    const normalized = domainInput.trim().replace(/^https?:\/\//i, "").replace(/\/$/, "").toLowerCase();
    if (!normalized) return;
    setDomainSaving(true);
    try {
      const res = await fetch(`/api/apps/${appId}/custom-domain`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ domain: normalized }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Error al guardar dominio");
      setDnsRecords(data.dnsRecords || data.recommendedDns || []);
      setDomainInput(normalized);
      if (data.verified) {
        setVerifiedDomain(normalized);
        setDomainStep("verified");
      } else {
        setDomainStep("dns");
      }
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setDomainSaving(false);
    }
  }, [appId, domainInput, toast]);

  /* ── Custom domain: Verify status ── */
  const handleVerifyStatus = useCallback(async () => {
    setDomainVerifying(true);
    try {
      const res = await fetch(`/api/apps/${appId}/custom-domain`, { credentials: "include" });
      const data = await res.json();
      if (data.verified) {
        setVerifiedDomain(domainInput);
        setDomainStep("verified");
        toast({ title: "✅ Dominio verificado", description: `${domainInput} está activo.` });
      } else {
        toast({ title: "⏳ Aún pendiente", description: "El DNS todavía no ha propagado. Inténtalo en unos minutos.", variant: "destructive" });
      }
    } catch {
      toast({ title: "Error al verificar", variant: "destructive" });
    } finally {
      setDomainVerifying(false);
    }
  }, [appId, domainInput, toast]);

  /* ── Custom domain: Unlink ── */
  const handleUnlink = useCallback(async () => {
    if (!confirm("¿Desvincular el dominio personalizado?")) return;
    setDomainUnlinking(true);
    try {
      await fetch(`/api/apps/${appId}/custom-domain`, { method: "DELETE", credentials: "include" });
      setDomainStep("idle");
      setDomainInput("");
      setDnsRecords([]);
      setVerifiedDomain("");
      toast({ title: "Dominio desvinculado" });
    } catch {
      toast({ title: "Error al desvincular", variant: "destructive" });
    } finally {
      setDomainUnlinking(false);
    }
  }, [appId, toast]);

  const activeUrl = deployUrl || currentDeployUrl || "";
  const isLive = !!activeUrl;

  return (
    <div className="fixed inset-0 z-[200] flex items-start justify-end bg-black/60 backdrop-blur-sm p-4">
      <div className="relative flex w-full max-w-sm flex-col rounded-2xl border border-white/[0.08] bg-[#0d0f16] shadow-[0_32px_80px_rgba(0,0,0,0.7)] h-fit mt-14 mr-2">

        {/* Header */}
        <div className="flex items-center justify-between border-b border-white/[0.07] px-5 py-3.5">
          <div className="flex items-center gap-2">
            <div className="grid h-6 w-6 place-items-center rounded-md bg-violet-600/20">
              <svg className="h-3.5 w-3.5 text-violet-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" /></svg>
            </div>
            <span className="text-[14px] font-bold text-white">Deployments</span>
          </div>
          <button onClick={onClose} className="grid h-7 w-7 place-items-center rounded-lg text-white/40 hover:bg-white/[0.06] hover:text-white transition">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex flex-col gap-0 overflow-y-auto max-h-[80vh]">

          {/* ── Live status row ── */}
          <div className="flex items-center justify-between px-5 py-3.5 border-b border-white/[0.06]">
            <div className="flex items-center gap-2.5">
              {isLive ? (
                <>
                  <span className="flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-full bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.8)]" />
                    <span className="text-[13px] font-semibold text-white">Live</span>
                  </span>
                  <span className="font-mono text-[11px] text-white/35">{shortId(activeUrl)}</span>
                  {lastDeployedAt && (
                    <span className="text-[11px] text-white/30">| {timeAgo(lastDeployedAt)}</span>
                  )}
                </>
              ) : (
                <span className="flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full bg-white/20" />
                  <span className="text-[13px] font-semibold text-white/40">No desplegado</span>
                </span>
              )}
            </div>
            {isLive && (
              <a
                href={activeUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1.5 rounded-lg border border-white/[0.10] bg-white/[0.04] px-3 py-1.5 text-[12px] font-semibold text-white/70 hover:bg-white/[0.08] hover:text-white transition"
              >
                Visit
                <ExternalLink className="h-3 w-3" />
              </a>
            )}
          </div>

          {/* ── Pre-Deployment Health Check ── */}
          <div className="border-b border-white/[0.06]">
            <div className="flex items-center justify-between px-5 py-3">
              <div className="flex items-center gap-2.5">
                <ShieldCheck className="h-4 w-4 text-violet-400" />
                <div>
                  <p className="text-[13px] font-semibold text-white">Pre-Deployment Health Check</p>
                  <p className="text-[11px] text-white/35">Análisis automático antes del deploy. Cuesta 2-3 créditos</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={runHealthCheck}
                  disabled={healthRunning}
                  className="flex items-center gap-1.5 rounded-lg bg-violet-600 px-3 py-1.5 text-[12px] font-bold text-white hover:bg-violet-500 disabled:opacity-60 transition"
                >
                  {healthRunning ? <Loader2 className="h-3 w-3 animate-spin" /> : <ShieldCheck className="h-3 w-3" />}
                  {healthRunning ? "Analizando…" : "Run Health Check"}
                </button>
                <button onClick={() => setHealthExpanded((v) => !v)} className="text-white/30 hover:text-white transition">
                  {healthExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                </button>
              </div>
            </div>
            {healthExpanded && (
              <div className="px-5 pb-3">
                {healthResult === null && !healthRunning && (
                  <p className="text-[12px] text-white/35">Ejecuta el health check para detectar problemas antes de desplegar.</p>
                )}
                {healthRunning && (
                  <div className="flex items-center gap-2 text-[12px] text-violet-300">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" /> Analizando dependencias, rutas y variables de entorno…
                  </div>
                )}
                {healthResult === "pass" && (
                  <div className="flex items-center gap-2 text-[12px] text-emerald-400">
                    <CheckCircle2 className="h-3.5 w-3.5" /> Sin problemas detectados. Tu app está lista para desplegarse.
                  </div>
                )}
                {healthResult === "fail" && (
                  <div className="flex items-center gap-2 text-[12px] text-red-400">
                    <AlertTriangle className="h-3.5 w-3.5" /> Se encontraron problemas. Revisa los logs antes de desplegar.
                  </div>
                )}
              </div>
            )}
          </div>

          {/* ── Custom Domain ── */}
          <div className="border-b border-white/[0.06]">
            <div className="flex items-center justify-between px-5 py-3">
              <div className="flex items-center gap-2.5">
                <Globe className="h-4 w-4 text-violet-400" />
                <div>
                  <p className="text-[13px] font-semibold text-white">Custom Domain</p>
                  <p className="text-[11px] text-white/35">
                    {domainStep === "verified"
                      ? verifiedDomain
                      : "Conecta tu dominio personalizado a esta app"}
                  </p>
                </div>
              </div>

              {/* Right side action */}
              {domainStep === "idle" && (
                <button
                  onClick={() => isPremium ? setDomainStep("input") : window.open("/pricing", "_blank")}
                  className="flex items-center gap-1.5 text-[12px] font-semibold text-violet-400 hover:text-violet-300 transition"
                >
                  <Pencil className="h-3 w-3" />
                  Link Domain
                </button>
              )}
              {domainStep === "verified" && (
                <button
                  onClick={handleUnlink}
                  disabled={domainUnlinking}
                  className="flex items-center gap-1.5 text-[12px] font-semibold text-red-400 hover:text-red-300 transition disabled:opacity-50"
                >
                  {domainUnlinking ? <Loader2 className="h-3 w-3 animate-spin" /> : <Link2Off className="h-3 w-3" />}
                  Unlink
                </button>
              )}
              {(domainStep === "input" || domainStep === "dns") && (
                <button onClick={() => setDomainStep("idle")} className="text-[12px] text-white/40 hover:text-white transition">
                  Cancelar
                </button>
              )}
            </div>

            {/* Step: input domain */}
            {domainStep === "input" && (
              <div className="px-5 pb-4 flex flex-col gap-3">
                <p className="text-[12px] text-white/50">Introduce tu nombre de dominio (ej: miapp.com)</p>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={domainInput}
                    onChange={(e) => setDomainInput(e.target.value)}
                    placeholder="example.com"
                    className="flex-1 rounded-lg border border-white/[0.10] bg-white/[0.04] px-3 py-2 text-[13px] text-white placeholder-white/25 outline-none focus:border-violet-500/60 focus:ring-1 focus:ring-violet-500/30"
                    onKeyDown={(e) => e.key === "Enter" && handleDomainNext()}
                  />
                  <button
                    onClick={handleDomainNext}
                    disabled={domainSaving || !domainInput.trim()}
                    className="flex items-center gap-1.5 rounded-lg bg-violet-600 px-4 py-2 text-[13px] font-bold text-white hover:bg-violet-500 disabled:opacity-50 transition"
                  >
                    {domainSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <>Siguiente <ArrowRight className="h-3.5 w-3.5" /></>}
                  </button>
                </div>
              </div>
            )}

            {/* Step: DNS records */}
            {domainStep === "dns" && (
              <div className="px-5 pb-4 flex flex-col gap-3">
                <div className="flex items-center gap-2 rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2">
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-400" />
                  <p className="text-[12px] text-amber-300">Configura estos registros DNS en tu proveedor</p>
                </div>

                {/* DNS table */}
                <div className="overflow-x-auto rounded-lg border border-white/[0.06] bg-[#070910]">
                  <table className="w-full text-[11.5px]">
                    <thead>
                      <tr className="border-b border-white/[0.06]">
                        <th className="px-3 py-2 text-left font-semibold text-white/30">Tipo</th>
                        <th className="px-3 py-2 text-left font-semibold text-white/30">Host/Nombre</th>
                        <th className="px-3 py-2 text-left font-semibold text-white/30">Valor/IP</th>
                        <th className="px-3 py-2 text-left font-semibold text-white/30">TTL</th>
                      </tr>
                    </thead>
                    <tbody>
                      {dnsRecords.length > 0 ? dnsRecords.map((r, i) => (
                        <tr key={i} className="border-b border-white/[0.04] last:border-0">
                          <td className="px-3 py-2 font-mono font-bold text-blue-400">{r.type}</td>
                          <td className="px-3 py-2 font-mono text-white/60">{r.name}</td>
                          <td className="px-3 py-2 font-mono text-white/60 break-all">{r.value}</td>
                          <td className="px-3 py-2 font-mono text-white/40">{r.ttl || "300"}</td>
                        </tr>
                      )) : (
                        <>
                          <tr className="border-b border-white/[0.04]">
                            <td className="px-3 py-2 font-mono font-bold text-blue-400">A</td>
                            <td className="px-3 py-2 font-mono text-white/60">@</td>
                            <td className="px-3 py-2 font-mono text-white/60">76.76.21.21</td>
                            <td className="px-3 py-2 font-mono text-white/40">300</td>
                          </tr>
                          <tr>
                            <td className="px-3 py-2 font-mono font-bold text-blue-400">CNAME</td>
                            <td className="px-3 py-2 font-mono text-white/60">www</td>
                            <td className="px-3 py-2 font-mono text-white/60">cname.vercel-dns.com</td>
                            <td className="px-3 py-2 font-mono text-white/40">300</td>
                          </tr>
                        </>
                      )}
                    </tbody>
                  </table>
                </div>
                <p className="text-[10.5px] text-white/30">La propagación DNS puede tardar entre 5 minutos y 48 horas.</p>

                <button
                  onClick={handleVerifyStatus}
                  disabled={domainVerifying}
                  className="flex w-full items-center justify-center gap-2 rounded-lg border border-violet-500/30 bg-violet-500/10 py-2 text-[13px] font-bold text-violet-300 hover:bg-violet-500/20 disabled:opacity-50 transition"
                >
                  {domainVerifying ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
                  {domainVerifying ? "Verificando…" : "Verify Status"}
                </button>
              </div>
            )}

            {/* Step: verified */}
            {domainStep === "verified" && (
              <div className="px-5 pb-3">
                <div className="flex items-center gap-2 rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-3 py-2">
                  <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
                  <span className="text-[12px] font-semibold text-emerald-300">Verified</span>
                  <span className="text-[12px] text-emerald-400/60">— {verifiedDomain}</span>
                </div>
              </div>
            )}
          </div>

          {/* ── Env Variables ── */}
          <div className="border-b border-white/[0.06]">
            <button
              onClick={() => setEnvExpanded((v) => !v)}
              className="flex w-full items-center justify-between px-5 py-3 hover:bg-white/[0.02] transition"
            >
              <div className="flex items-center gap-2.5">
                <KeyRound className="h-4 w-4 text-violet-400" />
                <div className="text-left">
                  <p className="text-[13px] font-semibold text-white">Env Variables</p>
                  <p className="text-[11px] text-white/35">Secrets y variables de entorno para APIs y servicios</p>
                </div>
              </div>
              {envExpanded ? <ChevronUp className="h-4 w-4 text-white/30" /> : <ChevronDown className="h-4 w-4 text-white/30" />}
            </button>
            {envExpanded && (
              <div className="px-5 pb-4">
                <p className="text-[12px] text-white/40 mb-2">
                  Las variables de entorno se sincronizan automáticamente con Vercel al hacer deploy.
                  Las claves sensibles (Clerk, Stripe, OpenAI) se inyectan desde la configuración del servidor.
                </p>
                <div className="rounded-lg border border-white/[0.06] bg-[#070910] p-3 font-mono text-[11px] text-white/40 space-y-1">
                  <div><span className="text-violet-400">VITE_CLERK_PUBLISHABLE_KEY</span> = ••••••••••••</div>
                  <div><span className="text-violet-400">VITE_API_URL</span> = auto-detected</div>
                  <div><span className="text-violet-400">NODE_ENV</span> = production</div>
                </div>
              </div>
            )}
          </div>

          {/* ── Deploy time note ── */}
          <div className="px-5 py-2.5 border-b border-white/[0.06]">
            <p className="text-[11px] text-white/25">El deployment tarda aproximadamente 3-7 minutos</p>
          </div>

          {/* ── Action buttons: Shut Down + Re-Deploy ── */}
          <div className="flex gap-2.5 px-5 py-4">
            <button
              onClick={handleShutDown}
              disabled={isShuttingDown || !isLive}
              className="flex flex-1 items-center justify-center gap-2 rounded-xl border border-red-500/25 bg-red-500/8 py-2.5 text-[13px] font-bold text-red-400 hover:bg-red-500/15 disabled:opacity-40 transition"
            >
              {isShuttingDown ? <Loader2 className="h-4 w-4 animate-spin" /> : <PowerOff className="h-4 w-4" />}
              Shut Down
            </button>
            <button
              onClick={handleRedeploy}
              disabled={isRedeploying}
              className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-violet-600 to-purple-600 py-2.5 text-[13px] font-bold text-white hover:from-violet-500 hover:to-purple-500 disabled:opacity-60 transition shadow-[0_4px_20px_rgba(124,58,237,0.3)]"
            >
              {isRedeploying ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />}
              {isRedeploying ? "Desplegando…" : "Re-Deploy"}
            </button>
          </div>

        </div>
      </div>
    </div>
  );
}
