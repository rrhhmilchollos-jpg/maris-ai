/**
 * DeployModal — Deployments estilo Emergent.sh con colores Maris AI (violeta/púrpura)
 *
 * Flujo de pantallas:
 *  1. "initial"   → ¡Publica tu aplicación! (selector plan, toggle anual, créditos, Iniciar despliegue + tarjetas Revisión/Health)
 *  2. "live"      → Estado Live (subdominio gratuito marisai.es, dominio personalizado, health check, re-deploy, apagar)
 *  3. "providers" → Conectar dominio personalizado (input + grid de 8 proveedores)
 *  4. "dns"       → Registros DNS de Maris AI (tabla A/CNAME/TXT + Verificar conexión)
 */
import React, { useState, useCallback, useEffect } from "react";
import {
  X,
  Globe,
  CheckCircle2,
  Circle,
  Loader2,
  ExternalLink,
  AlertTriangle,
  History,
  RotateCcw,
  PowerOff,
  ShieldCheck,
  ArrowLeft,
  Copy,
  Code2,
  Lock,
  Sparkles,
  Cpu,
  Rocket,
  ChevronDown,
  KeyRound,
  ChevronUp,
  Tag,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiFetch, getGetMyStatsQueryKey } from "@/lib/api-client";
import { useQueryClient } from "@tanstack/react-query";
import { MatrixBackground } from "@/components/matrix-background";
import { MCPIntegrationsPanel } from "@/components/mcp-integrations-panel";

/* ─────────────────────────── Types ─────────────────────────── */
interface DnsRecord {
  type: string;
  name: string;
  value: string;
  ttl?: string;
}
interface HealthCheckResponse {
  ok?: boolean;
  status?: string;
  issues?: string[];
  repaired?: boolean;
  creditsCharged?: number;
  creditsRemaining?: number;
  error?: string;
  creditsRequired?: number;
  warning?: string;
  instructions?: string[];
}
interface CodeReviewResponse {
  ok?: boolean;
  score?: number;
  issues?: string[];
  suggestions?: string[];
  summary?: string;
}
interface DeploymentStatusResponse {
  lastDeployedAt?: string;
  deploymentUrl?: string;
  subdomain?: string;
  customDomain?: string;
  customDomainVerified?: boolean;
}
interface DeployResponse {
  success?: boolean;
  deploymentUrl?: string;
  url?: string;
  subdomain?: string;
  error?: string;
  warning?: string;
  instructions?: string[];
}
interface CustomDomainResponse {
  verified?: boolean;
  provider?: string | null;
  dnsRecords?: DnsRecord[];
  recommendedDns?: DnsRecord[];
  pendingVerification?: Array<{ type: string; domain: string; value: string }>;
  error?: string;
  warning?: string;
  instructions?: string[];
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
type Screen = "initial" | "live" | "providers" | "dns" | "connectors" | "deploying" | "rollback";
type PlanId = "starter" | "pro" | "enterprise";

/* ─────────────────────────── Plan data ─────────────────────────── */
const PLANS: Array<{ id: PlanId; name: string; specs: string; credits: number; monthlyPrice: number }> = [
  { id: "starter",    name: "Starter",    specs: "0.05 vCPU · 200 MB RAM",  credits: 50,  monthlyPrice: 0  },
  { id: "pro",        name: "Pro",        specs: "0.5 vCPU · 1 GB RAM",     credits: 200, monthlyPrice: 19 },
  { id: "enterprise", name: "Enterprise", specs: "2 vCPU · 4 GB RAM",       credits: 999, monthlyPrice: 79 },
];

/* ─────────────────────────── Domain providers ─────────────────────────── */
const DOMAIN_PROVIDERS = [
  { id: "godaddy",    name: "GoDaddy",       initials: "GD", color: "#1bdbad", connectUrl: "https://dcc.godaddy.com/control/portfolio" },
  { id: "namecheap",  name: "Namecheap",     initials: "NC", color: "#de3723", connectUrl: "https://ap.www.namecheap.com/domains/list/" },
  { id: "cloudflare", name: "Cloudflare",    initials: "CF", color: "#f6821f", connectUrl: "https://dash.cloudflare.com/" },
  { id: "google",     name: "Google Domains",initials: "GG", color: "#4285f4", connectUrl: "https://domains.google.com/registrar/" },
  { id: "ionos",      name: "IONOS",         initials: "IO", color: "#003d8f", connectUrl: "https://my.ionos.es/domains" },
  { id: "hostinger",  name: "Hostinger",     initials: "HG", color: "#7c3aed", connectUrl: "https://hpanel.hostinger.com/domains" },
  { id: "arsys",      name: "Arsys",         initials: "AR", color: "#e11d48", connectUrl: "https://www.arsys.es/clientes" },
  { id: "ovhcloud",   name: "OVHcloud",      initials: "OV", color: "#123f6d", connectUrl: "https://www.ovh.com/manager/#/web/domain" },
  { id: "other",      name: "Otro proveedor",initials: "?",  color: "#6b7280", connectUrl: null },
];

/* ─────────────────────────── Helpers ─────────────────────────── */
function timeAgo(dateStr?: string): string {
  if (!dateStr) return "";
  const diff = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}hr ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}
function toSubdomain(title: string, id: string): string {
  const slug = title.toLowerCase().replace(/[^a-z0-9]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "").slice(0, 30);
  return `${slug}-${id.slice(0, 8)}`;
}
function copyToClipboard(text: string, label: string, toast: any) {
  navigator.clipboard.writeText(text).then(() => toast({ title: `✅ ${label} copiado` }));
}
function displayDnsNameForProvider(name: string, domain: string, providerId?: string | null): string {
  if (providerId === "arsys" && name === "@") return domain || "tu-dominio.es";
  return name;
}

/* ─────────────────────────── DNS badge ─────────────────────────── */
function DnsBadge({ type }: { type: string }) {
  const colors: Record<string, string> = {
    A:     "bg-[#7c3aed]/20 text-[#c084fc] border-[#7c3aed]/40",
    CNAME: "bg-blue-500/20 text-blue-300 border-blue-500/40",
    TXT:   "bg-emerald-500/20 text-emerald-300 border-emerald-500/40",
  };
  return (
    <span className={`inline-flex items-center justify-center rounded-md border px-2 py-0.5 text-xs font-bold font-mono ${colors[type] ?? "bg-white/10 text-white/60 border-white/20"}`}>
      {type}
    </span>
  );
}

/* ── Stepper de deploy real (estilo Emergent.sh, 6 fases verídicas) ──
   Cada key coincide EXACTAMENTE con el deployPhase escrito en MongoDB
   dentro de deployAppToVercel — no hay temporizadores ni fases inventadas. */
const DEPLOY_STEPS: Array<{ key: string; label: string }> = [
  { key: "health_check", label: "Comprobación inicial del proyecto" },
  { key: "preparing_bundle", label: "Preparando el paquete de la app" },
  { key: "syncing_env", label: "Sincronizando configuración" },
  { key: "deploying", label: "Desplegando a la infraestructura" },
  { key: "waiting_ready", label: "Esperando confirmación del servidor" },
  { key: "final_check", label: "Verificación final" },
];

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
  const queryClient = useQueryClient();

  /* ── Screen state ── */
  const [screen, setScreen] = useState<Screen>(currentDeployUrl ? "live" : "initial");

  /* ── Plan selector ── */
  const [selectedPlan, setSelectedPlan] = useState<PlanId>("starter");
  const [annualToggle, setAnnualToggle] = useState(false);
  const [planDropdownOpen, setPlanDropdownOpen] = useState(false);

  /* ── Deploy state ── */
  const [isDeploying, setIsDeploying] = useState(false);
  const [isRedeploying, setIsRedeploying] = useState(false);
  // A petición explícita del usuario: stepper de progreso REAL en vivo,
  // estilo Emergent.sh — conectado al flujo asíncrono real del backend
  // (POST /apps/:id/deploy ahora responde 202 de inmediato y lanza el
  // deploy en segundo plano; GET /apps/:id/deploy-status expone
  // deployPhase, escrito en vivo dentro de deployAppToVercel en cada fase
  // verídica del proceso real contra la API de Vercel — no temporizadores
  // inventados). Reutiliza el DeployModal ya existente (no se crea un
  // modal nuevo en paralelo) — solo se conecta su flujo de deploy.
  const [deployPhase, setDeployPhase] = useState<string | null>(null);
  const [deployStartedAt, setDeployStartedAt] = useState<string | null>(null);
  const [deployErrorMsg, setDeployErrorMsg] = useState<string | null>(null);
  const [isShuttingDown, setIsShuttingDown] = useState(false);
  const [deployUrl, setDeployUrl] = useState(currentDeployUrl || "");
  const [lastDeployedAt, setLastDeployedAt] = useState<string | undefined>();
  const [subdomain, setSubdomain] = useState<string>("");

  /* ── Health check ── */
  const [healthRunning, setHealthRunning] = useState(false);
  const [healthResult, setHealthResult] = useState<"pass" | "fail" | null>(null);
  const [healthIssues, setHealthIssues] = useState<string[]>([]);

  /* ── Code review ── */
  const [reviewRunning, setReviewRunning] = useState(false);
  const [reviewResult, setReviewResult] = useState<CodeReviewResponse | null>(null);

  /* ── Custom domain ── */
  const [domainInput, setDomainInput] = useState(currentCustomDomain || "");
  const [dnsRecords, setDnsRecords] = useState<DnsRecord[]>([]);
  const [domainSaving, setDomainSaving] = useState(false);
  const [loadingProvider, setLoadingProvider] = useState<string | null>(null); // FIX: track which provider is loading
  const [domainVerifying, setDomainVerifying] = useState(false);
  const [domainUnlinking, setDomainUnlinking] = useState(false);
  const [verifiedDomain, setVerifiedDomain] = useState(customDomainVerified ? currentCustomDomain : "");
  const [selectedProvider, setSelectedProvider] = useState<string | null>(null);

  /* ── Env vars (variables de entorno reales del cliente, cifradas en backend) ── */
  const [envExpanded, setEnvExpanded] = useState(false);
  interface EnvVarRow { name: string; why: string; isSet: boolean; maskedValue: string | null }
  const [envVars, setEnvVars] = useState<EnvVarRow[]>([]);
  const [envLoading, setEnvLoading] = useState(false);
  const [envDrafts, setEnvDrafts] = useState<Record<string, string>>({});
  const [envSaving, setEnvSaving] = useState(false);

  const loadEnvVars = useCallback(() => {
    setEnvLoading(true);
    apiFetch<{ envVars: EnvVarRow[] }>(`/api/apps/${appId}/env`)
      .then((d) => setEnvVars(d.envVars || []))
      .catch(() => {})
      .finally(() => setEnvLoading(false));
  }, [appId]);

  useEffect(() => {
    if (envExpanded && envVars.length === 0 && !envLoading) loadEnvVars();
  }, [envExpanded]);

  const handleSaveEnvVars = useCallback(async () => {
    const values = Object.fromEntries(Object.entries(envDrafts).filter(([, v]) => v.trim()));
    if (Object.keys(values).length === 0) return;
    setEnvSaving(true);
    try {
      await apiFetch(`/api/apps/${appId}/env`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ values }),
      });
      toast({ title: "✅ Variables guardadas", description: "Se cifrarán e inyectarán automáticamente en tu próximo deploy." });
      setEnvDrafts({});
      loadEnvVars();
    } catch (err: any) {
      toast({ title: "Error al guardar", description: err?.message, variant: "destructive" });
    } finally {
      setEnvSaving(false);
    }
  }, [appId, envDrafts, loadEnvVars, toast]);

  /* ── Watermark removal ── */
  const [watermarkHasMark, setWatermarkHasMark] = useState<boolean | null>(null);
  const [watermarkPrice, setWatermarkPrice] = useState<number>(9.99);
  const [watermarkLoading, setWatermarkLoading] = useState(false);

  /* ── Fetch deployment status on mount ── */
  useEffect(() => {
    apiFetch<DeploymentStatusResponse>(`/api/apps/${appId}/deployment-status`)
      .then((d) => {
        if (d.lastDeployedAt) setLastDeployedAt(d.lastDeployedAt);
        if (d.deploymentUrl) {
          setDeployUrl(d.deploymentUrl);
          setScreen("live");
        }
        if (d.subdomain) setSubdomain(d.subdomain);
      })
      .catch(() => {});
  }, [appId]);

  /* ── Fetch watermark status on mount ── */
  useEffect(() => {
    apiFetch<{ hasWatermark: boolean; watermarkRemovalPrice: number }>(`/api/watermark/${appId}/status`)
      .then((d) => {
        setWatermarkHasMark(d.hasWatermark);
        setWatermarkPrice(d.watermarkRemovalPrice ?? 9.99);
      })
      .catch(() => {});
  }, [appId]);

  const handleRemoveWatermark = useCallback(async () => {
    setWatermarkLoading(true);
    try {
      const data = await apiFetch<{ checkoutUrl?: string; error?: string }>(`/api/watermark/${appId}/remove-viva`, { method: "POST" });
      if (data.checkoutUrl) {
        window.location.href = data.checkoutUrl;
      } else {
        throw new Error(data.error || "No se pudo iniciar el pago");
      }
    } catch (err: any) {
      toast({ title: "Error", description: err?.message || "No se pudo iniciar el pago", variant: "destructive" });
    } finally {
      setWatermarkLoading(false);
    }
  }, [appId, toast]);

  /* ── Watermark removal: verificar tras volver de Viva.com ── */
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("watermark_removed") !== "true") return;

    // Viva.com vuelve con ?t=<transactionId> añadido automáticamente a la
    // Success URL configurada en su panel — confirmado contra la
    // documentación oficial de Viva.com.
    const vivaTransactionId = params.get("t");
    if (!vivaTransactionId) return;

    apiFetch<{ success: boolean; hasWatermark: boolean }>(`/api/watermark/${appId}/verify-removal-viva`, {
      method: "POST",
      body: JSON.stringify({ transactionId: vivaTransactionId }),
    })
      .then((d) => {
        if (d.success) {
          setWatermarkHasMark(false);
          toast({ title: "✅ Marca de agua eliminada", description: "Tu app ya no muestra 'Hecho con Maris AI'." });
        }
      })
      .catch(() => {});
  }, [appId, toast]);

  /* ── Polling real del deploy en curso — frecuencia 2.5s, se auto-apaga al llegar a done/error ── */
  const pollDeployStatus = useCallback(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const status = await apiFetch<{ phase: string | null; startedAt: string | null; error: string | null; deploymentUrl: string | null }>(
          `/api/apps/${appId}/deploy-status`,
        );
        if (cancelled) return;
        setDeployPhase(status.phase);
        setDeployStartedAt(status.startedAt);
        if (status.phase === "done") {
          setDeployUrl(status.deploymentUrl || "");
          setLastDeployedAt(new Date().toISOString());
          setIsDeploying(false);
          setIsRedeploying(false);
          onDeploySuccess(status.deploymentUrl || "");
          toast({ title: "🚀 ¡App publicada!", description: status.deploymentUrl || "" });
          setScreen("live");
          return; // auto-apagado: no se programa el siguiente tick
        }
        if (status.phase === "error") {
          setDeployErrorMsg(status.error || "El despliegue no se pudo completar.");
          setIsDeploying(false);
          setIsRedeploying(false);
          toast({ title: "Error al desplegar", description: status.error || "Inténtalo de nuevo.", variant: "destructive" });
          return; // auto-apagado
        }
        setTimeout(tick, 2500);
      } catch {
        if (!cancelled) setTimeout(tick, 2500);
      }
    };
    tick();
    return () => { cancelled = true; };
  }, [appId, onDeploySuccess, toast]);

  /* ── Time Machine (historial de revisiones + rollback) ──
     A petición explícita del usuario: usa los campos REALES del backend
     (sourceLabel, summary — no "versionName"/"description", que no
     existen en el schema real de AppRevision). */
  interface RevisionRow { id: string; sourceLabel: string; summary: string; createdAt: string }
  const [revisions, setRevisions] = useState<RevisionRow[] | null>(null);
  const [revisionsError, setRevisionsError] = useState<string | null>(null);
  const [confirmingRevisionId, setConfirmingRevisionId] = useState<string | null>(null);
  const [rollbackSubmitting, setRollbackSubmitting] = useState(false);

  const loadRevisions = useCallback(() => {
    setRevisionsError(null);
    apiFetch<{ revisions: RevisionRow[] }>(`/api/apps/${appId}/revisions`)
      .then((d) => setRevisions(d.revisions || []))
      .catch((err: any) => setRevisionsError(err?.message || "No se pudo cargar el historial de versiones."));
  }, [appId]);

  useEffect(() => {
    if (screen === "rollback" && revisions === null) loadRevisions();
  }, [screen]);

  const handleConfirmRollback = useCallback(async () => {
    if (!confirmingRevisionId) return;
    setRollbackSubmitting(true);
    try {
      await apiFetch(`/api/apps/${appId}/rollback`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ revisionId: confirmingRevisionId }),
      });
      setConfirmingRevisionId(null);
      toast({ title: "✅ Versión restaurada", description: "Se ha iniciado un redespliegue automático con la versión anterior." });
      // Reutiliza el mismo flujo asíncrono real ya instrumentado — el
      // stepper muestra el progreso REAL del redeploy disparado por el rollback.
      setScreen("deploying");
      setIsDeploying(true);
      pollDeployStatus();
    } catch (err: any) {
      const isPaymentRequired = err?.error === "Créditos insuficientes";
      toast({
        title: isPaymentRequired ? "Créditos insuficientes" : "No se pudo restaurar",
        description: isPaymentRequired ? err?.hint : (err?.message ?? err?.error ?? "Error"),
        variant: "destructive",
      });
    } finally {
      setRollbackSubmitting(false);
    }
  }, [appId, confirmingRevisionId, pollDeployStatus, toast]);

  /* ── Initial deploy ── */
  const handleInitialDeploy = useCallback(async () => {
    setIsDeploying(true);
    setDeployErrorMsg(null);
    setDeployPhase(null);
    setScreen("deploying");
    try {
      const data = await apiFetch<{ status?: string; error?: string; hint?: string; creditsCharged?: number; freeRedeploy?: boolean }>(
        `/api/apps/${appId}/deploy`,
        { method: "POST" },
      );
      if (data.error) throw new Error(data.hint || data.error);
      if (data.freeRedeploy) {
        toast({ title: "Re-deploy gratuito", description: "Dentro de la ventana de 5 minutos del último deploy — sin coste." });
      }
      pollDeployStatus();
    } catch (err: any) {
      toast({ title: "Error al desplegar", description: err.message, variant: "destructive" });
      setIsDeploying(false);
      setScreen("initial");
    }
  }, [appId, pollDeployStatus, toast]);

  /* ── Re-deploy ── */
  const handleRedeploy = useCallback(async () => {
    setIsRedeploying(true);
    setDeployErrorMsg(null);
    setDeployPhase(null);
    setScreen("deploying");
    try {
      const data = await apiFetch<{ status?: string; error?: string; hint?: string; creditsCharged?: number; freeRedeploy?: boolean }>(
        `/api/apps/${appId}/deploy`,
        { method: "POST" },
      );
      if (data.error) throw new Error(data.hint || data.error);
      if (data.freeRedeploy) {
        toast({ title: "Re-deploy gratuito", description: "Dentro de la ventana de 5 minutos del último deploy — sin coste." });
      }
      pollDeployStatus();
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
      setIsRedeploying(false);
      setScreen("live");
    }
  }, [appId, pollDeployStatus, toast]);

  /* ── Shut down ── */
  const handleShutDown = useCallback(async () => {
    if (!confirm("¿Seguro que quieres apagar el deployment? La URL dejará de funcionar.")) return;
    setIsShuttingDown(true);
    try {
      await apiFetch(`/api/apps/${appId}/deploy`, { method: "DELETE" });
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
    setHealthIssues([]);
    try {
      const data = await apiFetch<HealthCheckResponse>(`/api/apps/${appId}/health`, { method: "POST" });
      const passed = data.ok === true || data.status === "pass";
      setHealthResult(passed ? "pass" : "fail");
      setHealthIssues(Array.isArray(data.issues) ? data.issues : []);
      queryClient.invalidateQueries({ queryKey: getGetMyStatsQueryKey() });

      const repairedNote = data.repaired ? " Se repararon automáticamente los problemas encontrados." : "";
      const creditsNote = typeof data.creditsCharged === "number" && data.creditsCharged > 0
        ? ` (−${data.creditsCharged} créditos, quedan ${data.creditsRemaining})`
        : "";
      toast({
        title: passed ? "✅ Health check superado" : "⚠️ Health check con incidencias",
        description: (passed ? `La app está lista para producción.${repairedNote}` : (data.issues?.join(" · ") || "Revisa la configuración.") + repairedNote) + creditsNote,
        variant: passed ? "default" : "destructive",
      });
    } catch (err: any) {
      setHealthResult("fail");
      if (err?.status === 402 || /créditos/i.test(err?.message || "")) {
        toast({
          title: "Créditos insuficientes",
          description: `El Health Check cuesta 30 créditos. Recarga tu saldo para usarlo.`,
          variant: "destructive",
        });
      } else {
        toast({ title: "Error en el health check", description: err?.message, variant: "destructive" });
      }
    } finally {
      setHealthRunning(false);
    }
  }, [appId, toast, queryClient]);

  /* ── Code review ── */
  const runCodeReview = useCallback(async () => {
    setReviewRunning(true);
    setReviewResult(null);
    try {
      const data = await apiFetch<CodeReviewResponse>(`/api/apps/${appId}/code-review`, { method: "POST" });
      setReviewResult(data);
      toast({
        title: data.ok ? `✅ Código listo (${data.score}/100)` : `⚠️ ${data.issues?.length} problema(s) encontrado(s)`,
        description: data.summary,
        variant: data.ok ? "default" : "destructive",
      });
    } catch (err: any) {
      toast({ title: "Error en la revisión", description: err?.message, variant: "destructive" });
    } finally {
      setReviewRunning(false);
    }
  }, [appId, toast]);

  /* ── Connect custom domain ── */
  const handleConnectDomain = useCallback(async (providerId?: string) => {
    const normalized = domainInput.trim().replace(/^https?:\/\//i, "").replace(/\/$/, "").toLowerCase();
    if (!normalized) return;
    setDomainSaving(true);
    setLoadingProvider(providerId || "other"); // FIX: track which provider is loading
    try {
      const data = await apiFetch<CustomDomainResponse>(`/api/apps/${appId}/custom-domain`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ domain: normalized, provider: providerId || selectedProvider || "other" }),
      });
      const records = data.dnsRecords || data.recommendedDns || [];
      setDnsRecords(records);
      setDomainInput(normalized);
      if (data.warning) {
        toast({ title: "Dominio pendiente en Vercel", description: data.warning, variant: "destructive" });
      }
      if (data.verified) {
        setVerifiedDomain(normalized);
        toast({ title: "✅ Dominio verificado", description: `${normalized} está activo.` });
        setScreen("live");
      } else {
        setScreen("dns");
      }
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setDomainSaving(false);
      setLoadingProvider(null); // FIX: reset loading provider
    }
  }, [appId, domainInput, selectedProvider, toast]);

  /* ── Verify domain status ── */
  const handleVerifyStatus = useCallback(async () => {
    setDomainVerifying(true);
    try {
      const data = await apiFetch<CustomDomainResponse>(`/api/apps/${appId}/custom-domain`);
      if (data.verified) {
        setVerifiedDomain(domainInput);
        toast({ title: "✅ Dominio verificado", description: `${domainInput} está activo.` });
        setScreen("live");
      } else {
        toast({ title: "⏳ Aún pendiente", description: "El DNS todavía no ha propagado. Inténtalo en unos minutos.", variant: "destructive" });
      }
    } catch {
      toast({ title: "Error al verificar", variant: "destructive" });
    } finally {
      setDomainVerifying(false);
    }
  }, [appId, domainInput, toast]);

  /* ── Unlink domain ── */
  const handleUnlink = useCallback(async () => {
    if (!confirm("¿Desvincular el dominio personalizado?")) return;
    setDomainUnlinking(true);
    try {
      await apiFetch(`/api/apps/${appId}/custom-domain`, { method: "DELETE" });
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

  /* ── Computed values ── */
  const activePlan = PLANS.find((p) => p.id === selectedPlan) ?? PLANS[0];
  const freeSubdomain = subdomain
    ? `https://${subdomain}.marisai.es`
    : deployUrl || `https://${toSubdomain(appTitle, appId)}.marisai.es`;
  const isLive = !!deployUrl;
  const shortDeployId = subdomain?.slice(0, 12) || appId.slice(0, 8);

  /* ════════════════════════════════════════════════════════════
     RENDER
  ════════════════════════════════════════════════════════════ */
  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">

      {/* Matrix overlay during redeploy */}
      {isRedeploying && (
        <div className="fixed inset-0 z-[250] flex items-center justify-center bg-black/90">
          <MatrixBackground opacity={0.7} />
          <div className="relative z-10 flex flex-col items-center gap-6 text-center px-8">
            <div className="flex h-20 w-20 items-center justify-center rounded-3xl bg-gradient-to-br from-violet-600 to-indigo-600 shadow-[0_0_60px_rgba(124,58,237,0.6)]">
              <svg viewBox="0 0 40 40" fill="none" className="h-10 w-10">
                <path d="M8 32 L20 8 L32 32" stroke="white" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" />
                <circle cx="20" cy="34" r="2.5" fill="white" />
              </svg>
            </div>
            <div>
              <h2 className="text-2xl font-black text-white tracking-tight">Maris AI</h2>
              <p className="mt-2 text-lg font-bold text-white/80">Desplegando tu app…</p>
            </div>
            <div className="flex items-center gap-2 text-[13px] text-cyan-400 font-mono">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span>testing-agent verificando el bundle…</span>
            </div>
            <button onClick={onClose} className="mt-2 flex items-center gap-2 rounded-xl border border-white/15 bg-white/5 px-6 py-2.5 text-sm font-semibold text-white/70 hover:bg-white/10 hover:text-white transition">
              <X className="h-4 w-4" /> Cancelar
            </button>
          </div>
        </div>
      )}

      {/* Modal card */}
      <div className="relative w-full max-w-[480px] rounded-2xl border border-white/[0.08] bg-[#0d0f16] shadow-2xl shadow-black/60 overflow-hidden max-h-[90vh] overflow-y-auto">

        {/* ══════════════ SCREEN: DEPLOYING (stepper real, estilo Emergent.sh) ══════════════ */}
        {screen === "deploying" && (
          <div className="p-6">
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-base font-bold text-white">Desplegando tu app</h3>
              {deployStartedAt && (
                <span className="text-xs text-white/40">
                  Iniciado a las {new Date(deployStartedAt).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" })}
                </span>
              )}
            </div>
            <div className="space-y-2.5">
              {DEPLOY_STEPS.map((step) => {
                const stepIndex = DEPLOY_STEPS.findIndex((s) => s.key === step.key);
                const currentIndex = DEPLOY_STEPS.findIndex((s) => s.key === deployPhase);
                const isDone = deployPhase === "done";
                const isErrored = deployPhase === "error";
                const completed = isDone || (currentIndex >= 0 && stepIndex < currentIndex);
                const isCurrent = !isDone && !isErrored && stepIndex === currentIndex;
                return (
                  <div key={step.key} className="flex items-center gap-3">
                    {completed ? (
                      <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-400" />
                    ) : isCurrent ? (
                      <Loader2 className="h-5 w-5 shrink-0 animate-spin text-sky-400" />
                    ) : (
                      <Circle className="h-5 w-5 shrink-0 text-white/20" />
                    )}
                    <span className={`text-sm ${completed ? "text-emerald-300" : isCurrent ? "text-sky-300 font-medium" : "text-white/40"}`}>
                      {step.label}
                    </span>
                  </div>
                );
              })}
            </div>
            {deployErrorMsg && (
              <div className="mt-4 rounded-lg border border-red-500/20 bg-red-500/[0.06] p-3">
                <p className="text-sm text-red-400">{deployErrorMsg}</p>
                <button
                  onClick={() => setScreen(currentDeployUrl ? "live" : "initial")}
                  className="mt-3 rounded-lg border border-white/15 bg-white/5 px-4 py-1.5 text-xs font-semibold text-white/70 hover:bg-white/10 hover:text-white transition"
                >
                  Cerrar
                </button>
              </div>
            )}
          </div>
        )}

        {/* ══════════════ SCREEN 1: INITIAL ══════════════ */}
        {screen === "initial" && (
          <>
            {/* Header */}
            <div className="flex items-center gap-3 border-b border-white/[0.07] px-5 py-4">
              <div className="grid h-8 w-8 place-items-center rounded-lg bg-[#7c3aed]/20">
                <Rocket className="h-4 w-4 text-[#c084fc]" />
              </div>
              <span className="text-base font-bold text-white">Deployments</span>
              <button onClick={onClose} className="ml-auto grid h-7 w-7 place-items-center rounded-lg text-white/40 hover:bg-white/[0.06] hover:text-white transition">
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Hero */}
            <div className="px-6 pt-7 pb-4 text-center">
              <h2 className="text-2xl font-black text-white">¡Publica tu aplicación!</h2>
              <p className="mt-2 text-sm text-white/45 leading-relaxed">
                Despliega en un entorno de producción alojado por<br />Maris AI y obtén una URL en vivo para tu app.
              </p>
            </div>

            {/* Plan selector */}
            <div className="mx-5 mb-4 rounded-xl border border-white/[0.08] bg-white/[0.03] overflow-hidden">
              {/* Selected plan row */}
              <button
                onClick={() => setPlanDropdownOpen((v) => !v)}
                className="flex w-full items-center gap-3 px-4 py-3.5 hover:bg-white/[0.03] transition"
              >
                <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-[#7c3aed]/20">
                  <Cpu className="h-4 w-4 text-[#c084fc]" />
                </div>
                <div className="text-left flex-1">
                  <p className="text-sm font-bold text-white">{activePlan.name}</p>
                  <p className="text-xs text-white/40">{activePlan.specs}</p>
                </div>
                <ChevronDown className={`h-4 w-4 text-white/40 transition-transform ${planDropdownOpen ? "rotate-180" : ""}`} />
              </button>

              {/* Plan dropdown */}
              {planDropdownOpen && (
                <div className="border-t border-white/[0.07]">
                  {PLANS.filter((p) => p.id !== selectedPlan).map((plan) => (
                    <button
                      key={plan.id}
                      onClick={() => { setSelectedPlan(plan.id); setPlanDropdownOpen(false); }}
                      className="flex w-full items-center gap-3 px-4 py-3 hover:bg-white/[0.04] transition"
                    >
                      <div className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-white/[0.05]">
                        <Cpu className="h-3.5 w-3.5 text-white/50" />
                      </div>
                      <div className="text-left flex-1">
                        <p className="text-sm font-semibold text-white">{plan.name}</p>
                        <p className="text-xs text-white/35">{plan.specs}</p>
                      </div>
                      {plan.monthlyPrice > 0 && (
                        <span className="text-xs font-bold text-[#c084fc]">{plan.monthlyPrice} €/mes</span>
                      )}
                    </button>
                  ))}
                </div>
              )}

              {/* Annual toggle */}
              <div className="flex items-center gap-3 border-t border-white/[0.07] px-4 py-3">
                <Sparkles className="h-4 w-4 text-[#c084fc] shrink-0" />
                <span className="flex-1 text-sm text-white/55">2 meses gratis en el plan anual</span>
                <button
                  onClick={() => setAnnualToggle((v) => !v)}
                  className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${annualToggle ? "bg-[#7c3aed]" : "bg-white/20"}`}
                >
                  <span className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${annualToggle ? "translate-x-4" : "translate-x-0"}`} />
                </button>
              </div>

              {/* Credits */}
              <div className="flex items-center justify-center gap-2 border-t border-white/[0.07] px-4 py-3">
                <span className="text-lg">🪙</span>
                <span className="text-sm font-bold text-yellow-400">{activePlan.credits} créditos / mes</span>
              </div>
            </div>

            {/* Deploy button */}
            <div className="px-5 pb-4">
              <button
                onClick={handleInitialDeploy}
                disabled={isDeploying}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-[#7c3aed] to-[#9333ea] py-3.5 text-sm font-bold text-white shadow-lg shadow-[#7c3aed]/30 hover:from-[#8b5cf6] hover:to-[#a855f7] transition disabled:opacity-60"
              >
                {isDeploying ? <><Loader2 className="h-4 w-4 animate-spin" /> Desplegando...</> : <><Rocket className="h-4 w-4" /> Iniciar despliegue</>}
              </button>
            </div>

            {/* Action cards */}
            <div className="grid grid-cols-2 gap-3 px-5 pb-6">
              {/* Code review */}
              <div className="flex flex-col gap-3 rounded-xl border border-white/[0.07] bg-white/[0.02] p-4">
                <Code2 className="h-6 w-6 text-[#c084fc]" />
                <div>
                  <p className="text-sm font-bold text-white leading-tight">Mejorar la calidad del código</p>
                  <p className="mt-0.5 text-xs text-white/40">Limpia y fortalece tu código</p>
                </div>
                {reviewResult && (
                  <div className={`rounded-lg px-2.5 py-1.5 text-xs font-mono ${reviewResult.ok ? "bg-emerald-500/10 text-emerald-300" : "bg-red-500/10 text-red-300"}`}>
                    {reviewResult.summary}
                  </div>
                )}
                <button
                  onClick={runCodeReview}
                  disabled={reviewRunning}
                  className="mt-auto rounded-lg border border-[#7c3aed]/50 px-3 py-2 text-xs font-semibold text-[#c084fc] hover:bg-[#7c3aed]/10 transition disabled:opacity-50"
                >
                  {reviewRunning
                    ? <span className="flex items-center gap-1.5 justify-center"><Loader2 className="h-3 w-3 animate-spin" />Analizando...</span>
                    : "Ejecutar revisión de código"}
                </button>
              </div>

              {/* Health check */}
              <div className="flex flex-col gap-3 rounded-xl border border-white/[0.07] bg-white/[0.02] p-4">
                <ShieldCheck className="h-6 w-6 text-[#c084fc]" />
                <div>
                  <p className="text-sm font-bold text-white leading-tight">Verificar preparación para despliegue</p>
                  <p className="mt-0.5 text-xs text-white/40">Detecta bloqueos antes de lanzar</p>
                </div>
                {healthResult && (
                  <div className={`rounded-lg px-2.5 py-1.5 text-xs font-mono ${healthResult === "pass" ? "bg-emerald-500/10 text-emerald-300" : "bg-red-500/10 text-red-300"}`}>
                    {healthResult === "pass" ? "✅ Lista para producción" : `⚠️ ${healthIssues.length} incidencia(s)`}
                  </div>
                )}
                <button
                  onClick={runHealthCheck}
                  disabled={healthRunning}
                  className="mt-auto rounded-lg border border-[#7c3aed]/50 px-3 py-2 text-xs font-semibold text-[#c084fc] hover:bg-[#7c3aed]/10 transition disabled:opacity-50"
                >
                  {healthRunning
                    ? <span className="flex items-center gap-1.5 justify-center"><Loader2 className="h-3 w-3 animate-spin" />Verificando...</span>
                    : "Ejecutar verificación de salud"}
                </button>
              </div>
            </div>
          </>
        )}

        {/* ══════════════ SCREEN 2: LIVE ══════════════ */}
        {screen === "live" && (
          <>
            {/* Header */}
            <div className="flex items-center gap-3 border-b border-white/[0.07] px-5 py-4">
              <div className="grid h-8 w-8 place-items-center rounded-lg bg-[#7c3aed]/20">
                <Rocket className="h-4 w-4 text-[#c084fc]" />
              </div>
              <span className="text-base font-bold text-white">Deployments</span>
              <button onClick={onClose} className="ml-auto grid h-7 w-7 place-items-center rounded-lg text-white/40 hover:bg-white/[0.06] hover:text-white transition">
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Live status row */}
            <div className="flex items-center gap-3 border-b border-white/[0.07] px-5 py-3.5">
              <span className="relative flex h-2.5 w-2.5 shrink-0">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-500" />
              </span>
              <span className="text-sm font-bold text-white">Live</span>
              <span className="font-mono text-xs text-white/35">{shortDeployId}</span>
              {lastDeployedAt && <span className="text-xs text-white/25">| {timeAgo(lastDeployedAt)}</span>}
              <a
                href={deployUrl || freeSubdomain}
                target="_blank"
                rel="noopener noreferrer"
                className="ml-auto flex items-center gap-1.5 rounded-lg border border-white/[0.10] bg-white/[0.04] px-3 py-1.5 text-xs font-semibold text-white hover:bg-white/[0.08] transition"
              >
                <ExternalLink className="h-3 w-3" />
                Visit
              </a>
            </div>

            {/* Free subdomain */}
            <div className="border-b border-white/[0.07] px-5 py-4">
              <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-[#c084fc]">Tu subdominio gratuito</p>
              <div className="flex items-center gap-2 rounded-xl border border-white/[0.08] bg-white/[0.03] px-3 py-2.5">
                <span className="flex-1 truncate font-mono text-sm text-white">{freeSubdomain}</span>
                <button
                  onClick={() => copyToClipboard(freeSubdomain, "URL", toast)}
                  className="grid h-7 w-7 shrink-0 place-items-center rounded-lg text-white/40 hover:bg-white/[0.08] hover:text-white transition"
                >
                  <Copy className="h-3.5 w-3.5" />
                </button>
              </div>
              <p className="mt-1.5 text-xs text-white/30">Incluido en todos los planes · marisai.es</p>
            </div>

            {/* Custom domain */}
            <div className="border-b border-white/[0.07] px-5 py-4">
              <div className="flex items-center gap-3">
                <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-white/[0.04]">
                  <Globe className="h-4 w-4 text-[#c084fc]" />
                </div>
                <div className="flex-1">
                  <p className="text-sm font-bold text-white">Dominio personalizado</p>
                  {verifiedDomain ? (
                    <p className="text-xs text-emerald-400 flex items-center gap-1">
                      <CheckCircle2 className="h-3 w-3" />{verifiedDomain}
                    </p>
                  ) : (
                    <p className="text-xs text-white/35">Solo disponible en planes de pago</p>
                  )}
                </div>
                <button
                  onClick={() => {
                    if (!isPremium) {
                      toast({ title: "Plan de pago requerido", description: "Actualiza tu plan para conectar un dominio personalizado.", variant: "destructive" });
                      return;
                    }
                    setScreen("providers");
                  }}
                  className={`rounded-lg px-3 py-2 text-xs font-semibold transition ${isPremium ? "bg-[#7c3aed] text-white hover:bg-[#8b5cf6]" : "bg-white/[0.05] text-white/40 cursor-not-allowed"}`}
                >
                  {verifiedDomain ? "Cambiar dominio" : "Conectar dominio"}
                </button>
                <button
                  onClick={() => setScreen("connectors")}
                  className="rounded-lg px-3 py-2 text-xs font-semibold transition bg-[#1e2030] text-white/60 hover:bg-white/[0.08] hover:text-white border border-white/[0.06] flex items-center gap-1.5"
                >
                  <span>🔌</span> Conectores
                </button>
              </div>
              {!isPremium && (
                <div className="mt-2.5 flex items-center gap-2 rounded-lg border border-yellow-500/20 bg-yellow-500/5 px-3 py-2">
                  <Lock className="h-3.5 w-3.5 text-yellow-500 shrink-0" />
                  <p className="text-xs text-yellow-400">Actualiza tu plan para conectar tu propio dominio</p>
                </div>
              )}
            </div>

            {/* Watermark removal */}
            <div className="border-b border-white/[0.07] px-5 py-4">
              <div className="flex items-center gap-3">
                <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-white/[0.04]">
                  <Tag className={`h-4 w-4 ${watermarkHasMark === false ? "text-emerald-400" : "text-[#c084fc]"}`} />
                </div>
                <div className="flex-1">
                  <p className="text-sm font-bold text-white">Marca de agua "Hecho con Maris AI"</p>
                  {watermarkHasMark === false ? (
                    <p className="text-xs text-emerald-400 flex items-center gap-1">
                      <CheckCircle2 className="h-3 w-3" />Eliminada — tu app no la muestra
                    </p>
                  ) : (
                    <p className="text-xs text-white/35">Tu app muestra "Hecho con Maris AI" en una esquina</p>
                  )}
                </div>
                {watermarkHasMark !== false && (
                  <button
                    onClick={handleRemoveWatermark}
                    disabled={watermarkLoading || watermarkHasMark === null}
                    className="rounded-lg bg-[#7c3aed] px-3 py-2 text-xs font-semibold text-white hover:bg-[#8b5cf6] transition disabled:opacity-50"
                  >
                    {watermarkLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : `Eliminar por ${watermarkPrice.toFixed(2).replace(".", ",")} €`}
                  </button>
                )}
              </div>
              {watermarkHasMark !== false && (
                <p className="mt-2.5 text-xs text-white/25">
                  Pago único con tarjeta bancaria. Tu app deja de mostrar la marca de agua y el enlace a Maris AI permanentemente.
                </p>
              )}
            </div>

            {/* Health check */}
            <div className="border-b border-white/[0.07] px-5 py-4">
              <div className="flex items-center gap-3">
                <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-white/[0.04]">
                  <ShieldCheck className={`h-4 w-4 ${healthResult === "pass" ? "text-emerald-400" : healthResult === "fail" ? "text-red-400" : "text-[#c084fc]"}`} />
                </div>
                <div className="flex-1">
                  <p className="text-sm font-bold text-white">Pre-Deployment Health Check</p>
                  <p className="text-xs text-white/35">
                    {healthResult === "pass" ? "✅ Superado — lista para producción" : healthResult === "fail" ? `⚠️ ${healthIssues.length} incidencia(s)` : "Análisis automático antes del deploy · 30 créditos"}
                  </p>
                </div>
                <button
                  onClick={runHealthCheck}
                  disabled={healthRunning}
                  className="rounded-lg bg-[#7c3aed] px-3 py-2 text-xs font-semibold text-white hover:bg-[#8b5cf6] transition disabled:opacity-50"
                >
                  {healthRunning ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Run Health Check"}
                </button>
              </div>
              {healthIssues.length > 0 && (
                <div className="mt-2 space-y-1">
                  {healthIssues.map((issue, i) => (
                    <div key={i} className="flex items-start gap-2 rounded-lg bg-red-500/10 px-3 py-1.5">
                      <AlertTriangle className="h-3.5 w-3.5 text-red-400 shrink-0 mt-0.5" />
                      <p className="text-xs text-red-300">{issue}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Env vars */}
            <div className="border-b border-white/[0.07]">
              <button
                onClick={() => setEnvExpanded((v) => !v)}
                className="flex w-full items-center justify-between px-5 py-3.5 hover:bg-white/[0.02] transition"
              >
                <div className="flex items-center gap-2.5">
                  <KeyRound className="h-4 w-4 text-[#c084fc]" />
                  <div className="text-left">
                    <p className="text-sm font-semibold text-white">Variables de entorno</p>
                    <p className="text-xs text-white/35">Secrets y claves de API para producción</p>
                  </div>
                </div>
                {envExpanded ? <ChevronUp className="h-4 w-4 text-white/30" /> : <ChevronDown className="h-4 w-4 text-white/30" />}
              </button>
              {envExpanded && (
                <div className="px-5 pb-4">
                  <p className="text-xs text-white/40 mb-3">Tu app necesita estas claves para conectarse a servicios externos. Se cifran y se inyectan automáticamente al hacer deploy.</p>
                  {envLoading ? (
                    <div className="flex items-center gap-2 text-xs text-white/40 py-2"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Cargando…</div>
                  ) : envVars.length === 0 ? (
                    <p className="text-xs text-white/30 py-2">Esta app no necesita ninguna variable de entorno.</p>
                  ) : (
                    <div className="space-y-3">
                      {envVars.map((v) => (
                        <div key={v.name}>
                          <div className="flex items-center gap-2 mb-1">
                            <span className="text-xs font-mono font-semibold text-[#c084fc]">{v.name}</span>
                            {v.isSet && <CheckCircle2 className="h-3 w-3 text-emerald-400" />}
                          </div>
                          {v.why && <p className="text-[11px] text-white/35 mb-1.5">{v.why}</p>}
                          <input
                            type="password"
                            value={envDrafts[v.name] ?? ""}
                            onChange={(e) => setEnvDrafts((d) => ({ ...d, [v.name]: e.target.value }))}
                            placeholder={v.isSet ? `Configurado: ${v.maskedValue}` : "Introduce el valor…"}
                            className="w-full rounded-lg border border-white/[0.10] bg-[#070910] px-3 py-2 text-xs font-mono text-white placeholder:text-white/25 focus:border-[#c084fc]/50 focus:outline-none"
                          />
                        </div>
                      ))}
                      <button
                        onClick={handleSaveEnvVars}
                        disabled={envSaving || Object.values(envDrafts).every((v) => !v.trim())}
                        className="w-full rounded-lg border border-[#c084fc]/30 bg-[#c084fc]/10 py-2 text-xs font-semibold text-[#c084fc] hover:bg-[#c084fc]/20 transition disabled:opacity-40"
                      >
                        {envSaving ? <Loader2 className="mx-auto h-3.5 w-3.5 animate-spin" /> : "Guardar variables"}
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Time Machine */}
            <div className="px-5 pb-3">
              <button
                onClick={() => setScreen("rollback")}
                className="flex w-full items-center gap-2.5 rounded-xl border border-white/[0.10] bg-white/[0.04] px-4 py-3 text-sm font-semibold text-white hover:bg-white/[0.08] transition"
              >
                <History className="h-4 w-4 text-sky-400" />
                Historial de versiones
              </button>
            </div>

            {/* Re-deploy + Shut down */}
            <div className="grid grid-cols-2 gap-3 px-5 py-4">
              <button
                onClick={handleRedeploy}
                disabled={isRedeploying || isShuttingDown}
                className="flex items-center justify-center gap-2 rounded-xl border border-white/[0.10] bg-white/[0.04] py-3 text-sm font-semibold text-white hover:bg-white/[0.08] transition disabled:opacity-50"
              >
                <RotateCcw className="h-4 w-4" />
                Re-deploy
              </button>
              <button
                onClick={handleShutDown}
                disabled={isShuttingDown || isRedeploying}
                className="flex items-center justify-center gap-2 rounded-xl border border-red-500/30 bg-red-500/10 py-3 text-sm font-semibold text-red-400 hover:bg-red-500/20 transition disabled:opacity-50"
              >
                {isShuttingDown ? <Loader2 className="h-4 w-4 animate-spin" /> : <PowerOff className="h-4 w-4" />}
                Apagar
              </button>
            </div>
          </>
        )}

        {/* ══════════════ SCREEN: ROLLBACK (Time Machine) ══════════════ */}
        {screen === "rollback" && (
          <>
            <div className="flex items-center gap-3 border-b border-white/[0.07] px-5 py-4">
              <button onClick={() => setScreen("live")} className="grid h-7 w-7 place-items-center rounded-lg text-white/40 hover:bg-white/[0.06] hover:text-white transition">
                <ArrowLeft className="h-4 w-4" />
              </button>
              <span className="text-base font-bold text-white">Historial de versiones</span>
              <button onClick={onClose} className="ml-auto grid h-7 w-7 place-items-center rounded-lg text-white/40 hover:bg-white/[0.06] hover:text-white transition">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="max-h-[60vh] overflow-y-auto p-5">
              <p className="mb-4 text-xs text-white/40">¿Algo ha salido mal? Restaura tu app a cualquier punto anterior — se desplegará automáticamente en cuanto la restaures.</p>
              {revisionsError ? (
                <div className="py-10 text-center">
                  <p className="text-[13px] text-red-400">{revisionsError}</p>
                  <button onClick={loadRevisions} className="mt-3 rounded-lg border border-white/15 bg-white/5 px-4 py-1.5 text-xs font-semibold text-white/70 hover:bg-white/10 hover:text-white transition">
                    Reintentar
                  </button>
                </div>
              ) : revisions === null ? (
                <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-white/30" /></div>
              ) : revisions.length === 0 ? (
                <div className="py-10 text-center">
                  <History className="mx-auto mb-3 h-8 w-8 text-white/15" />
                  <p className="text-[13px] text-white/40">Todavía no hay versiones anteriores guardadas.</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {revisions.map((rev) => (
                    <div key={rev.id} className="flex items-center justify-between rounded-xl border border-white/[0.07] bg-white/[0.02] px-4 py-3">
                      <div className="min-w-0">
                        <p className="text-xs font-semibold text-sky-400">{rev.sourceLabel}</p>
                        {rev.summary && <p className="mt-0.5 truncate text-[13px] text-white/70">{rev.summary}</p>}
                        <p className="mt-0.5 text-[11px] text-white/35">{new Date(rev.createdAt).toLocaleString("es-ES", { dateStyle: "medium", timeStyle: "short" })}</p>
                      </div>
                      <button
                        onClick={() => setConfirmingRevisionId(rev.id)}
                        className="ml-3 flex shrink-0 items-center gap-1.5 rounded-lg border border-white/[0.10] bg-white/[0.04] px-3 py-1.5 text-xs font-semibold text-white hover:bg-white/[0.08] transition"
                      >
                        <RotateCcw className="h-3.5 w-3.5" />
                        Restaurar
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}

        {/* ══════════════ SCREEN 3: PROVIDERS ══════════════ */}
        {screen === "providers" && (
          <>
            {/* Header */}
            <div className="flex items-center gap-3 border-b border-white/[0.07] px-5 py-4">
              <button onClick={() => setScreen("live")} className="grid h-7 w-7 place-items-center rounded-lg text-white/40 hover:bg-white/[0.06] hover:text-white transition">
                <ArrowLeft className="h-4 w-4" />
              </button>
              <span className="text-base font-bold text-white">Conectar dominio personalizado</span>
              <button onClick={onClose} className="ml-auto grid h-7 w-7 place-items-center rounded-lg text-white/40 hover:bg-white/[0.06] hover:text-white transition">
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="px-5 py-4 space-y-4">
              {/* Domain input */}
              <div>
                <p className="mb-1.5 text-[10px] font-bold uppercase tracking-widest text-white/40">Tu dominio</p>
                <div className="flex items-center gap-2 rounded-xl border border-white/[0.10] bg-white/[0.03] px-3 py-2.5">
                  <Globe className="h-4 w-4 text-white/30 shrink-0" />
                  <input
                    type="text"
                    value={domainInput}
                    onChange={(e) => setDomainInput(e.target.value)}
                    placeholder="ej. midominio.com"
                    className="flex-1 bg-transparent text-sm text-white placeholder:text-white/25 outline-none"
                  />
                </div>
                <p className="mt-1 text-xs text-white/25">Introduce el dominio sin https://</p>
              </div>

              {/* Provider grid */}
              <div>
                <p className="mb-2.5 text-[10px] font-bold uppercase tracking-widest text-white/40">Selecciona tu proveedor</p>
                <div className="grid grid-cols-2 gap-2.5">
                  {DOMAIN_PROVIDERS.map((provider) => (
                    <div
                      key={provider.id}
                      className={`flex flex-col items-center gap-2.5 rounded-xl border px-3 py-3.5 transition ${selectedProvider === provider.id ? "border-[#7c3aed]/70 bg-[#7c3aed]/10" : "border-white/[0.07] bg-white/[0.02] hover:border-[#7c3aed]/40 hover:bg-[#7c3aed]/5"}`}
                    >
                      <div
                        className="grid h-10 w-10 place-items-center rounded-xl font-black text-sm"
                        style={{ backgroundColor: provider.color + "22", border: `1px solid ${provider.color}44`, color: provider.color }}
                      >
                        {provider.initials}
                      </div>
                      <p className="text-xs font-semibold text-white text-center leading-tight">{provider.name}</p>
                      <button
                        onClick={() => {
                          if (!domainInput.trim()) {
                            toast({ title: "Introduce tu dominio primero", variant: "destructive" });
                            return;
                          }
                          setSelectedProvider(provider.id);
                          if (provider.connectUrl && provider.id !== "arsys" && provider.id !== "other") {
                            window.open(provider.connectUrl, "_blank");
                          }
                          handleConnectDomain(provider.id);
                        }}
                        disabled={loadingProvider === provider.id} // FIX: solo deshabilita el botón pulsado
                        className="w-full rounded-lg bg-[#7c3aed] px-2 py-1.5 text-xs font-semibold text-white hover:bg-[#8b5cf6] transition disabled:opacity-50"
                      >
                        {loadingProvider === provider.id // FIX: solo muestra spinner en el botón pulsado
                          ? <Loader2 className="h-3 w-3 animate-spin mx-auto" />
                          : provider.id === "other" ? "Ver DNS" : "Conectar"}
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              <p className="text-center text-xs italic text-white/25 pb-2">
                En Arsys y otros proveedores puedes abrir el panel DNS y después Maris AI te mostrará los registros exactos
              </p>
            </div>
          </>
        )}

        {/* ══════════════ SCREEN 4: DNS ══════════════ */}
        {screen === "dns" && (
          <>
            {/* Header */}
            <div className="flex items-center gap-3 border-b border-white/[0.07] px-5 py-4">
              <button onClick={() => setScreen("providers")} className="grid h-7 w-7 place-items-center rounded-lg text-white/40 hover:bg-white/[0.06] hover:text-white transition">
                <ArrowLeft className="h-4 w-4" />
              </button>
              <span className="text-base font-bold text-white truncate">DNS para {domainInput || "tu dominio"}</span>
              <button onClick={onClose} className="ml-auto grid h-7 w-7 place-items-center rounded-lg text-white/40 hover:bg-white/[0.06] hover:text-white transition">
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="px-5 py-4 space-y-4">
              {/* Warning */}
              <div className="flex gap-3 rounded-xl border border-yellow-500/30 bg-yellow-500/10 px-4 py-3">
                <AlertTriangle className="h-4 w-4 text-yellow-400 shrink-0 mt-0.5" />
                <p className="text-xs text-yellow-200/80 leading-relaxed">
                  Añade los siguientes registros DNS en el panel de tu proveedor de dominios. Los cambios pueden tardar hasta 48h en propagarse.
                </p>
              </div>

              {/* DNS records table */}
              <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] overflow-hidden">
                <div className="grid grid-cols-[60px_70px_1fr_36px] gap-2 border-b border-white/[0.07] px-3 py-2">
                  {["TIPO", "NOMBRE", "VALOR", ""].map((h, i) => (
                    <span key={i} className="text-[10px] font-bold uppercase tracking-widest text-white/30">{h}</span>
                  ))}
                </div>
                {(dnsRecords.length > 0 ? dnsRecords : [
                  { type: "A",     name: domainInput || "tu-dominio.es",   value: "76.76.21.21" },
                  { type: "CNAME", name: "www", value: "cname.vercel-dns.com" },
                ]).map((record, i) => (
                  <div key={i} className="grid grid-cols-[60px_70px_1fr_36px] gap-2 items-center border-b border-white/[0.04] last:border-0 px-3 py-2.5">
                    <DnsBadge type={record.type} />
                    <span className="font-mono text-xs text-white">{displayDnsNameForProvider(record.name, domainInput, selectedProvider)}</span>
                    <span className="font-mono text-xs text-white/70 truncate">{record.value}</span>
                    <button
                      onClick={() => copyToClipboard(record.value, record.type, toast)}
                      className="grid h-7 w-7 place-items-center rounded-lg text-white/30 hover:bg-white/[0.08] hover:text-white transition"
                    >
                      <Copy className="h-3 w-3" />
                    </button>
                  </div>
                ))}
              </div>

              {/* Arsys quick guide */}
              <div className="rounded-xl border border-[#e11d48]/25 bg-[#e11d48]/10 px-4 py-3">
                <p className="text-xs font-bold uppercase tracking-widest text-[#fb7185]">Guía rápida para Arsys</p>
                <p className="mt-2 text-xs text-white/60 leading-relaxed">
                  Entra en <span className="font-semibold text-white">Arsys Área de cliente</span> → <span className="font-semibold text-white">Dominios</span> → selecciona <span className="font-semibold text-white">{domainInput || "tu dominio"}</span> → <span className="font-semibold text-white">DNS / Zona DNS</span>.
                  Crea el registro <span className="font-mono text-white">A {domainInput || "tu-dominio.es"} → 76.76.21.21</span> y el registro <span className="font-mono text-white">CNAME www → cname.vercel-dns.com</span>.
                </p>
                <p className="mt-1.5 text-xs text-white/35">No añadas https:// ni barras. En Arsys, para el dominio raíz normalmente no se escribe @: usa el dominio completo ({domainInput || "tu-dominio.es"}) o deja el campo Entrada DNS/Host vacío si el panel lo permite.</p>
              </div>

              {/* Maris AI branding */}
              <div className="flex items-center gap-3 rounded-xl border border-[#7c3aed]/20 bg-[#7c3aed]/10 px-4 py-3">
                <div className="grid h-8 w-8 place-items-center rounded-lg bg-[#7c3aed]/20 shrink-0">
                  <span className="text-sm font-black text-[#c084fc]">M</span>
                </div>
                <p className="text-xs text-white/50">
                  Infraestructura alojada por <span className="text-[#c084fc] font-semibold">Maris AI</span> · marisai.es
                </p>
              </div>

              {/* Verify button */}
              <button
                onClick={handleVerifyStatus}
                disabled={domainVerifying}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-[#7c3aed] to-[#9333ea] py-3.5 text-sm font-bold text-white hover:from-[#8b5cf6] hover:to-[#a855f7] transition disabled:opacity-60"
              >
                {domainVerifying ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
                Verificar conexión
              </button>
              <p className="text-center text-xs text-white/25">Verificaremos automáticamente cada 5 minutos</p>

              {/* Pending status */}
              <div className="flex items-center justify-center gap-2 pb-2">
                <span className="relative flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-yellow-400 opacity-75" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-yellow-500" />
                </span>
                <span className="font-mono text-xs text-white/35">Pendiente de propagación DNS...</span>
              </div>
            </div>
          </>
        )}


        {screen === "connectors" && (
          <div className="flex flex-col h-full">
            <div className="flex items-center gap-3 px-5 pt-5 pb-4 border-b border-white/[0.07] shrink-0">
              <button onClick={() => setScreen("live")} className="text-white/40 hover:text-white transition">
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
              </button>
              <div>
                <h3 className="text-sm font-bold text-white">Conectores MCP</h3>
                <p className="text-[11px] text-white/40">Conecta servicios externos a tu proyecto</p>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto px-5 py-4">
              <MCPIntegrationsPanel
                onConnectorChange={() => {}}
                className=""
              />
            </div>
          </div>
        )}
      </div>

      {/* Modal de confirmación de rollback */}
      {confirmingRevisionId && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4" onClick={() => !rollbackSubmitting && setConfirmingRevisionId(null)}>
          <div className="w-full max-w-sm rounded-2xl border border-red-500/20 border-t-4 border-t-red-500 bg-[#0d0f16] p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="mx-auto mb-4 grid h-12 w-12 place-items-center rounded-full bg-red-500/10">
              <AlertTriangle className="h-6 w-6 text-red-400" />
            </div>
            <p className="text-center text-sm font-semibold text-white">¿Restaurar esta versión?</p>
            <p className="mt-2 text-center text-xs text-white/40">El código actual de tu app se reemplazará por esta versión anterior, y se desplegará automáticamente. La versión que tienes ahora se guarda como copia de seguridad por si quieres deshacerlo.</p>
            <div className="mt-4 flex items-center justify-between rounded-lg border border-white/[0.07] bg-white/[0.02] px-3 py-2 text-xs">
              <span className="text-white/40">Coste</span>
              <span className="font-semibold text-emerald-400">1 crédito</span>
            </div>
            <div className="mt-4 space-y-2">
              <button
                onClick={handleConfirmRollback}
                disabled={rollbackSubmitting}
                className="w-full rounded-lg bg-red-600 py-2.5 text-xs font-semibold text-white transition hover:bg-red-500 disabled:opacity-50"
              >
                {rollbackSubmitting ? "Restaurando…" : "Sí, restaurar esta versión"}
              </button>
              <button
                onClick={() => setConfirmingRevisionId(null)}
                disabled={rollbackSubmitting}
                className="w-full rounded-lg bg-white/5 py-2.5 text-xs font-semibold text-white/70 transition hover:bg-white/10"
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
