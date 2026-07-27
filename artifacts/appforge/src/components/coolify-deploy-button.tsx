/**
 * coolify-deploy-button.tsx
 *
 * Despliega el backend real de la app al servidor Coolify propio — cierra
 * el hueco encontrado de que el backend Express generado nunca llegaba a
 * producción de forma persistente, solo el frontend a Vercel. Ya no hay
 * que conectar ninguna cuenta ni pegar ningún token: el servidor Coolify
 * es propio de Maris AI, así que basta con pulsar "Desplegar".
 */
import { useState } from "react";
import { Loader2, Rocket, ExternalLink, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { apiFetch } from "@/lib/api-client";
import { useToast } from "@/hooks/use-toast";

interface CoolifyDeployButtonProps {
  appId: string;
  githubRepoFullName?: string;
  coolifyBackendUrl?: string;
  coolifyDeploymentStatus?: "not_deployed" | "deploying" | "deployed" | "failed";
}

export function CoolifyDeployButton({ appId, githubRepoFullName, coolifyBackendUrl }: CoolifyDeployButtonProps) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [deploying, setDeploying] = useState(false);
  const [backendUrl, setBackendUrl] = useState(coolifyBackendUrl ?? "");
  const [deployError, setDeployError] = useState<string | null>(null);

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
        title="Desplegar backend real"
        aria-label="Desplegar backend real"
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
              Pon tu backend real en producción, persistente, en el servidor Coolify de Maris AI.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {!githubRepoFullName && (
              <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-400">
                <div className="flex items-start gap-2">
                  <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                  <p>Exporta esta app a GitHub primero — el despliegue se hace directamente desde tu repositorio.</p>
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
        </DialogContent>
      </Dialog>
    </>
  );
}
