/**
 * GitHubButton — Botón del octocat para subir proyectos a GitHub
 * ─────────────────────────────────────────────────────────────────
 * Flujo mejorado:
 *  1. Si el usuario NO tiene GitHub conectado → abre modal para conectar via OAuth
 *  2. Si el usuario SÍ tiene GitHub conectado → abre modal para subir el proyecto
 *  3. NUEVO: Detecta si el repo previo pertenece a otra cuenta y avisa al usuario
 */

import { useState, useEffect } from "react";
import { Loader2, Github, ExternalLink, Check, AlertCircle, Unlink } from "lucide-react";
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
import { Switch } from "@/components/ui/switch";
import { apiFetch } from "@/lib/api-client";
import { useToast } from "@/hooks/use-toast";

interface GitHubStatus {
  connected: boolean;
  login?: string;
  avatarUrl?: string;
  connectedAt?: string;
}

interface GitHubButtonProps {
  appId: string;
  appTitle: string;
  appDescription?: string;
  /** URL del repo si ya fue subido antes */
  githubRepoUrl?: string;
  onSuccess?: (repoUrl: string) => void;
}

export function GitHubButton({ appId, appTitle, appDescription, githubRepoUrl, onSuccess }: GitHubButtonProps) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<GitHubStatus | null>(null);
  const [loadingStatus, setLoadingStatus] = useState(false);
  const [pushing, setPushing] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [pushed, setPushed] = useState(false);
  const [repoUrl, setRepoUrl] = useState(githubRepoUrl ?? "");

  // Form state
  const [repoName, setRepoName] = useState(
    appTitle.toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-").slice(0, 100)
  );
  const [isPrivate, setIsPrivate] = useState(true);

  const fetchStatus = async () => {
    setLoadingStatus(true);
    try {
      const data = await apiFetch<GitHubStatus>("/api/github/status");
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

  // Detectar si volvemos del callback de GitHub OAuth
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("github_connected") === "1") {
      toast({ title: "✅ GitHub conectado", description: "Tu cuenta de GitHub está vinculada correctamente." });
      // Limpiar el parámetro de la URL
      const url = new URL(window.location.href);
      url.searchParams.delete("github_connected");
      window.history.replaceState({}, "", url.toString());
    }
    if (params.get("github_error")) {
      const err = params.get("github_error");
      toast({ title: "Error al conectar GitHub", description: `Error: ${err}`, variant: "destructive" });
      const url = new URL(window.location.href);
      url.searchParams.delete("github_error");
      window.history.replaceState({}, "", url.toString());
    }
  }, []);

  const handleConnect = async () => {
    try {
      const returnTo = `${window.location.pathname}${window.location.search}`;
      const data = await apiFetch<{ url: string }>(`/api/github/connect-url?returnTo=${encodeURIComponent(returnTo)}`);
      window.location.href = data.url;
    } catch (err: any) {
      toast({
        title: "No se pudo abrir GitHub",
        description: err?.message ?? "Revisa que GitHub OAuth esté configurado en el backend.",
        variant: "destructive",
      });
    }
  };

  const handleDisconnect = async () => {
    setDisconnecting(true);
    try {
      await apiFetch("/api/github/disconnect", { method: "DELETE" });
      setStatus({ connected: false });
      toast({ title: "GitHub desconectado", description: "Tu cuenta de GitHub ha sido desvinculada." });
    } catch {
      toast({ title: "Error", description: "No se pudo desconectar GitHub.", variant: "destructive" });
    } finally {
      setDisconnecting(false);
    }
  };

  const handlePush = async () => {
    if (!status?.connected) return;
    setPushing(true);
    try {
      const result = await apiFetch<{ ok?: boolean; url: string; repoFullName: string; updated?: boolean }>(
        `/api/apps/${appId}/github`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ repoName, isPrivate, description: appDescription ?? "" }),
        }
      );
      setRepoUrl(result.url);
      setPushed(true);
      onSuccess?.(result.url);
      toast({
        title: result.updated ? "🐙 Repositorio actualizado" : "🐙 Proyecto subido a GitHub",
        description: `Repositorio: ${result.repoFullName}`,
      });
    } catch (err: any) {
      toast({
        title: "Error al subir a GitHub",
        description: err?.message ?? "Error desconocido",
        variant: "destructive",
      });
    } finally {
      setPushing(false);
    }
  };

  // Detectar si el repo pertenece a otra cuenta
  const isRepoFromOtherAccount = githubRepoUrl && status?.login && !githubRepoUrl.includes(`/${status.login}/`);

  return (
    <>
      {/* Botón del Octocat */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="Subir proyecto a GitHub"
        aria-label="Subir proyecto a GitHub"
        className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-white/10 bg-white/[0.04] text-white/70 transition hover:border-white/20 hover:bg-white/[0.08] hover:text-white"
      >
        {/* Octocat SVG oficial de GitHub */}
        <svg viewBox="0 0 16 16" className="h-[18px] w-[18px] fill-current" aria-hidden="true">
          <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
        </svg>
      </button>

      {/* Modal */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="border-white/10 bg-[#0f1320] text-white sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-white">
              <Github className="h-5 w-5" />
              GitHub
            </DialogTitle>
            <DialogDescription className="text-white/55">
              Sube tu proyecto a tu cuenta personal de GitHub como repositorio.
            </DialogDescription>
          </DialogHeader>

          {loadingStatus ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-white/40" />
            </div>
          ) : !status?.connected ? (
            /* ── Estado: No conectado ── */
            <div className="space-y-4 py-2">
              <div className="rounded-lg border border-white/10 bg-white/[0.03] p-4 text-sm text-white/70">
                <p>Conecta tu cuenta de GitHub para poder subir tus proyectos generados con Maris AI directamente a tus repositorios personales.</p>
                <ul className="mt-3 space-y-1.5 text-white/55">
                  <li className="flex items-center gap-2"><Check className="h-3.5 w-3.5 text-emerald-400" /> Repositorios públicos o privados</li>
                  <li className="flex items-center gap-2"><Check className="h-3.5 w-3.5 text-emerald-400" /> Cada usuario tiene su propia cuenta</li>
                  <li className="flex items-center gap-2"><Check className="h-3.5 w-3.5 text-emerald-400" /> Código completo con todos los archivos</li>
                </ul>
              </div>
              <Button
                onClick={handleConnect}
                className="w-full bg-[#24292f] text-white hover:bg-[#32383f]"
              >
                <Github className="mr-2 h-4 w-4" />
                Conectar con GitHub
              </Button>
            </div>
          ) : pushed && repoUrl ? (
            /* ── Estado: Subido con éxito ── */
            <div className="space-y-4 py-2">
              <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-4">
                <div className="flex items-center gap-2 text-emerald-400">
                  <Check className="h-5 w-5" />
                  <span className="font-semibold">¡Proyecto subido con éxito!</span>
                </div>
                <p className="mt-1 text-sm text-white/60">Tu proyecto está disponible en GitHub.</p>
              </div>
              <a
                href={repoUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-between rounded-md border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-white/80 transition hover:bg-white/[0.08]"
              >
                <span className="truncate">{repoUrl.replace("https://github.com/", "")}</span>
                <ExternalLink className="ml-2 h-4 w-4 shrink-0 text-white/40" />
              </a>
              <Button
                onClick={() => { setPushed(false); }}
                variant="outline"
                className="w-full border-white/10 text-white/70 hover:bg-white/5 hover:text-white"
              >
                Subir de nuevo
              </Button>
            </div>
          ) : (
            /* ── Estado: Conectado, listo para subir ── */
            <div className="space-y-4 py-2">
              {/* Info de la cuenta conectada */}
              <div className="flex items-center justify-between rounded-lg border border-white/10 bg-white/[0.03] px-4 py-3">
                <div className="flex items-center gap-3">
                  {status.avatarUrl && (
                    <img src={status.avatarUrl} alt={status.login} className="h-8 w-8 rounded-full" />
                  )}
                  <div>
                    <p className="text-sm font-medium text-white">@{status.login}</p>
                    <p className="text-xs text-white/45">Cuenta conectada</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={handleDisconnect}
                  disabled={disconnecting}
                  title="Desconectar GitHub"
                  className="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-white/40 transition hover:bg-red-500/10 hover:text-red-400"
                >
                  {disconnecting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Unlink className="h-3.5 w-3.5" />}
                  Desconectar
                </button>
              </div>

              {/* NUEVO: Advertencia si el repo pertenece a otra cuenta */}
              {isRepoFromOtherAccount && (
                <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-400">
                  <div className="flex items-start gap-2">
                    <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                    <div>
                      <p className="font-medium">Repositorio de otra cuenta</p>
                      <p className="text-xs text-amber-400/70 mt-1">Este proyecto estaba vinculado a otra cuenta de GitHub. Se creará un nuevo repositorio en tu cuenta actual (@{status.login}).</p>
                    </div>
                  </div>
                </div>
              )}

              {/* Si ya tiene repo, mostrarlo */}
              {githubRepoUrl && (
                <a
                  href={githubRepoUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-between rounded-md border border-sky-500/20 bg-sky-500/5 px-4 py-2.5 text-sm text-sky-400 transition hover:bg-sky-500/10"
                >
                  <span className="truncate">{githubRepoUrl.replace("https://github.com/", "")}</span>
                  <ExternalLink className="ml-2 h-4 w-4 shrink-0" />
                </a>
              )}

              {/* Formulario */}
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <Label className="text-sm text-white/70">Nombre del repositorio</Label>
                  <Input
                    value={repoName}
                    onChange={(e) => setRepoName(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-"))}
                    placeholder="mi-proyecto"
                    className="border-white/10 bg-white/[0.04] text-white placeholder:text-white/30 focus:border-[#7c3aed]/60"
                  />
                  <p className="text-xs text-white/35">github.com/{status.login}/{repoName}</p>
                </div>

                <div className="flex items-center justify-between rounded-md border border-white/10 bg-white/[0.03] px-4 py-3">
                  <div>
                    <p className="text-sm text-white/80">Repositorio privado</p>
                    <p className="text-xs text-white/40">Solo tú podrás verlo</p>
                  </div>
                  <Switch
                    checked={isPrivate}
                    onCheckedChange={setIsPrivate}
                    className="data-[state=checked]:bg-[#7c3aed]"
                  />
                </div>
              </div>

              <Button
                onClick={handlePush}
                disabled={pushing || !repoName}
                className="w-full bg-[#24292f] text-white hover:bg-[#32383f] disabled:opacity-50"
              >
                {pushing ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Subiendo proyecto…
                  </>
                ) : (
                  <>
                    <Github className="mr-2 h-4 w-4" />
                    {isRepoFromOtherAccount ? "Crear nuevo repositorio" : (githubRepoUrl ? "Actualizar repositorio" : "Crear repositorio y subir")}
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
