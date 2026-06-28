/**
 * railway-deploy-button.tsx
 *
 * Conecta la cuenta de Railway del usuario y despliega el backend real de
 * la app — cierra el hueco encontrado de que el backend Express generado
 * nunca llegaba a producción de forma persistente, solo el frontend a
 * Vercel. Sigue el mismo patrón de UX que GitHubButton (modal con estado
 * conectado/no conectado), por coherencia.
 */
import { useState, useEffect } from "react";
import { Loader2, Rocket, ExternalLink, Check, AlertCircle, Unlink } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiFetch } from "@/lib/api-client";
import { useToast } from "@/hooks/use-toast";

interface RailwayStatus {
  connected: boolean;
  connectedAt?: string | null;
}

interface RailwayDeployButtonProps {
  appId: string;
  githubRepoFullName?: string;
  railwayBackendUrl?: string;
  railwayDeploymentStatus?: "not_deployed" | "deploying" | "deployed" | "failed";
}

export function RailwayDeployButton({ appId, githubRepoFullName, railwayBackendUrl }: RailwayDeployButtonProps) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<RailwayStatus | null>(null);
  const [loadingStatus, setLoadingStatus] = useState(false);
  const [tokenInput, setTokenInput] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [deploying, setDeploying] = useState(false);
  const [backendUrl, setBackendUrl] = useState(railwayBackendUrl ?? "");
  const [deployError, setDeployError] = useState<string | null>(null);

  const fetchStatus = async () => {
    setLoadingStatus(true);
    try {
      const data = await apiFetch<RailwayStatus>("/api/railway/status");
      setStatus(data);
    } catch {
      setStatus({ connected: false });
    } finally {
      setLoadingStatus(false);
    }
  };

  useEffect(() => {
    if (open) fetchStatus();
  }, [open]);

  const handleConnect = async () => {
    if (!tokenInput.trim()) return;
    setConnecting(true);
    try {
      await apiFetch("/api/railway/connect", { method: "POST", body: JSON.stringify({ apiToken: tokenInput.trim() }) });
      setTokenInput("");
      await fetchStatus();
      toast({ title: "✅ Railway conectado", description: "Tu cuenta de Railway está vinculada correctamente." });
    } catch (err: any) {
      toast({ title: "No se pudo conectar Railway", description: err?.message ?? "Revisa el token e inténtalo de nuevo.", variant: "destructive" });
    } finally {
      setConnecting(false);
    }
  };

  const handleDisconnect = async () => {
    setDisconnecting(true);
    try {
      await apiFetch("/api/railway/disconnect", { method: "DELETE" });
      setStatus({ connected: false });
      toast({ title: "Railway desconectado", description: "Tu cuenta de Railway ha sido desvinculada." });
    } catch {
      toast({ title: "Error", description: "No se pudo desconectar Railway.", variant: "destructive" });
    } finally {
      setDisconnecting(false);
    }
  };

  const handleDeploy = async () => {
    setDeploying(true);
    setDeployError(null);
    try {
      const result = await apiFetch<{ ok: boolean; backendUrl: string }>(`/api/apps/${appId}/deploy-backend`, { method: "POST" });
      setBackendUrl(result.backendUrl);
      toast({ title: "🚀 Backend desplegado", description: `Tu backend está en producción en ${result.backendUrl}` });
    } catch (err: any) {
      const message = err?.message ?? "Error desconocido al desplegar el backend.";
      setDeployError(message);
      toast({ title: "Error al desplegar el backend", description: message, variant: "destructive" });
    } finally {
      setDeploying(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="Desplegar backend real a Railway"
        aria-label="Desplegar backend real a Railway"
        className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-white/10 bg-white/[0.04] text-white/70 transition hover:border-white/20 hover:bg-white/[0.08] hover:text-white"
      >
        <Rocket className="h-[18px] w-[18px]" />
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="border-white/10 bg-[#0f1320] text-white sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-white">
              <Rocket className="h-5 w-5" />
              Desplegar backend
            </DialogTitle>
            <DialogDescription className="text-white/55">
              Pon tu backend real en producción, persistente, en tu propia cuenta de Railway.
            </DialogDescription>
          </DialogHeader>

          {loadingStatus ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-white/40" />
            </div>
          ) : !status?.connected ? (
            <div className="space-y-4 py-2">
              <div className="rounded-lg border border-white/10 bg-white/[0.03] p-4 text-sm text-white/70">
                <p>Conecta tu cuenta de Railway para desplegar tu backend de forma real y persistente — no solo en la vista previa.</p>
                <ul className="mt-3 space-y-1.5 text-white/55">
                  <li className="flex items-center gap-2"><Check className="h-3.5 w-3.5 text-emerald-400" /> Tu backend queda en TU cuenta de Railway, no en la de Maris AI</li>
                  <li className="flex items-center gap-2"><Check className="h-3.5 w-3.5 text-emerald-400" /> URL pública real para que tu frontend lo use</li>
                  <li className="flex items-center gap-2"><Check className="h-3.5 w-3.5 text-emerald-400" /> Railway requiere un plan de pago (desde ~$5/mes) para uso persistente</li>
                </ul>
              </div>
              <div className="space-y-1.5">
                <Label className="text-sm text-white/70">Token de la API de Railway</Label>
                <Input
                  type="password"
                  value={tokenInput}
                  onChange={(e) => setTokenInput(e.target.value)}
                  placeholder="Pégalo aquí"
                  className="border-white/10 bg-white/[0.04] text-white placeholder:text-white/30 focus:border-[#7c3aed]/60"
                />
                <a href="https://railway.app/account/tokens" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs text-sky-400 hover:underline">
                  Crear un token en railway.app/account/tokens <ExternalLink className="h-3 w-3" />
                </a>
              </div>
              <Button onClick={handleConnect} disabled={connecting || !tokenInput.trim()} className="w-full bg-[#0B0D0E] text-white hover:bg-[#1a1d1f]">
                {connecting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Rocket className="mr-2 h-4 w-4" />}
                Conectar con Railway
              </Button>
            </div>
          ) : (
            <div className="space-y-4 py-2">
              <div className="flex items-center justify-between rounded-lg border border-white/10 bg-white/[0.03] px-4 py-3">
                <div>
                  <p className="text-sm font-medium text-white">Railway conectado</p>
                  <p className="text-xs text-white/45">Listo para desplegar</p>
                </div>
                <button
                  type="button"
                  onClick={handleDisconnect}
                  disabled={disconnecting}
                  title="Desconectar Railway"
                  className="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-white/40 transition hover:bg-red-500/10 hover:text-red-400"
                >
                  {disconnecting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Unlink className="h-3.5 w-3.5" />}
                  Desconectar
                </button>
              </div>

              {!githubRepoFullName && (
                <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-400">
                  <div className="flex items-start gap-2">
                    <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                    <p>Exporta esta app a GitHub primero — Railway despliega directamente desde tu repositorio.</p>
                  </div>
                </div>
              )}

              {backendUrl && (
                <a
                  href={backendUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-between rounded-md border border-emerald-500/20 bg-emerald-500/5 px-4 py-2.5 text-sm text-emerald-400 transition hover:bg-emerald-500/10"
                >
                  <span className="truncate">{backendUrl.replace("https://", "")}</span>
                  <ExternalLink className="ml-2 h-4 w-4 shrink-0" />
                </a>
              )}

              {deployError && (
                <p className="rounded-md border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-400">{deployError}</p>
              )}

              <Button
                onClick={handleDeploy}
                disabled={deploying || !githubRepoFullName}
                className="w-full bg-gradient-to-r from-[#7c3aed] to-[#9333ea] font-bold text-white hover:from-[#8b5cf6] hover:to-[#a855f7] disabled:opacity-50"
              >
                {deploying ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Desplegando backend…
                  </>
                ) : (
                  <>
                    <Rocket className="mr-2 h-4 w-4" />
                    {backendUrl ? "Volver a desplegar" : "Desplegar backend"}
                  </>
                )}
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
