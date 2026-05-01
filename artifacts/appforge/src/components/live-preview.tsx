import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Play, RefreshCw, AlertTriangle, ExternalLink } from "lucide-react";
import { Button } from "./ui/button";
import { parseBundle } from "@/lib/parseBundle";
import {
  buildFileTree,
  ensureDevScript,
  getWebContainer,
  isWebContainerSupported,
} from "@/lib/webcontainerHost";

type Phase =
  | "idle"
  | "booting"
  | "mounting"
  | "installing"
  | "starting"
  | "ready"
  | "error";

interface LivePreviewProps {
  /**
   * The full `frontendCode` blob with `// === FILE: <path> ===` separators.
   * Re-running the preview when this changes is the caller's responsibility
   * (we expose a manual "Reiniciar" button rather than auto-restarting on
   * every keystroke — npm install is too expensive to redo eagerly).
   */
  frontendCode: string;
}

/**
 * Live (real) preview powered by WebContainer. Boots a Node.js runtime in
 * the browser, mounts the generated bundle, runs `npm install` and
 * `npm run dev`, then renders the resulting Vite dev server URL inside an
 * iframe. This is the production-grade alternative to the Sandpack tab —
 * higher fidelity (real npm graph, real Vite HMR, real tailwind/postcss
 * pipeline) at the cost of ~30-90s install time the first time.
 *
 * Why a manual start button: WebContainer install is expensive. Auto-running
 * it for every user that lands on the preview tab would burn CPU/memory and
 * block the UI thread on slower laptops. The Sandpack tab covers the
 * "instant preview" use case.
 */
export function LivePreview({ frontendCode }: LivePreviewProps) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [serverUrl, setServerUrl] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [supported] = useState(() => isWebContainerSupported());
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  // Track the active dev server process so we can kill it on restart without
  // re-booting the whole container — much faster than the cold path.
  const devProcRef = useRef<{ kill: () => void } | null>(null);
  // Guard against React StrictMode double-effect mounting both calling start.
  const startingRef = useRef(false);

  const appendLog = useCallback((line: string) => {
    setLogs((prev) => {
      const next = [...prev, line];
      // Cap to avoid unbounded growth during long install logs.
      return next.length > 500 ? next.slice(next.length - 500) : next;
    });
  }, []);

  const start = useCallback(async () => {
    if (startingRef.current) return;
    startingRef.current = true;
    setErrorMsg(null);
    setLogs([]);
    setServerUrl(null);
    try {
      setPhase("booting");
      appendLog("⏳ Arrancando WebContainer (Node.js en el navegador)…");
      const wc = await getWebContainer();
      appendLog("✓ WebContainer listo");

      setPhase("mounting");
      const parsed = parseBundle(frontendCode);
      // Repair package.json if the model omitted scripts.dev or shipped
      // something unparseable. Without a working dev script the install
      // succeeds but `npm run dev` exits 1 immediately and the user just
      // sees a blank screen.
      parsed["package.json"] = ensureDevScript(parsed["package.json"]);
      const tree = buildFileTree(parsed);
      const fileCount = Object.keys(parsed).length;
      appendLog(`📁 Montando ${fileCount} archivo(s) en el container…`);
      await wc.mount(tree);

      setPhase("installing");
      appendLog("📦 Ejecutando `npm install` (puede tardar 30-90s la primera vez)…");
      const install = await wc.spawn("npm", ["install", "--no-audit", "--no-fund"]);
      install.output.pipeTo(
        new WritableStream({
          write: (chunk) => {
            // Trim ANSI noise to keep logs readable.
            const clean = chunk.replace(/\x1b\[[0-9;]*[A-Za-z]/g, "").trimEnd();
            if (clean) appendLog(clean);
          },
        }),
      );
      const installExit = await install.exit;
      if (installExit !== 0) {
        throw new Error(`npm install falló (exit ${installExit})`);
      }
      appendLog("✓ Instalación OK");

      setPhase("starting");
      appendLog("🚀 Iniciando `npm run dev`…");
      // Kill any previous dev process before spawning a new one (restart path).
      if (devProcRef.current) {
        try {
          devProcRef.current.kill();
        } catch {
          /* best effort */
        }
      }
      const dev = await wc.spawn("npm", ["run", "dev"]);
      devProcRef.current = dev;
      dev.output.pipeTo(
        new WritableStream({
          write: (chunk) => {
            const clean = chunk.replace(/\x1b\[[0-9;]*[A-Za-z]/g, "").trimEnd();
            if (clean) appendLog(clean);
          },
        }),
      );

      // The container fires `server-ready` when any spawned process binds a
      // listener. We wait for that — racing it against an exit also tells us
      // if the dev script crashed before binding.
      //
      // Cleanup is critical: every Promise path (resolve, exit-failure,
      // timeout) MUST clear the timer AND unsubscribe `server-ready`.
      // Previously the timeout id and the listener leaked on the failure
      // paths, so retries accumulated handlers/timers.
      const url = await new Promise<string>((resolve, reject) => {
        let settled = false;
        let offReady: (() => void) | undefined;
        let timeoutId: ReturnType<typeof setTimeout> | undefined;
        const cleanup = () => {
          if (offReady) {
            try {
              offReady();
            } catch {
              /* ignore */
            }
            offReady = undefined;
          }
          if (timeoutId !== undefined) {
            clearTimeout(timeoutId);
            timeoutId = undefined;
          }
        };
        const settle = (fn: () => void) => {
          if (settled) return;
          settled = true;
          cleanup();
          fn();
        };
        offReady = wc.on("server-ready", (_port: number, readyUrl: string) => {
          settle(() => resolve(readyUrl));
        });
        dev.exit.then((code) => {
          if (code !== 0) {
            settle(() =>
              reject(new Error(`vite dev terminó con exit ${code} antes de servir`)),
            );
          }
        });
        timeoutId = setTimeout(
          () => settle(() => reject(new Error("Timeout: vite no abrió puerto en 60s"))),
          60_000,
        );
      });

      setServerUrl(url);
      setPhase("ready");
      appendLog(`✓ Listo en ${url}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setErrorMsg(msg);
      setPhase("error");
      appendLog(`✗ ${msg}`);
    } finally {
      startingRef.current = false;
    }
  }, [frontendCode, appendLog]);

  // Cleanup the dev process if the component unmounts. We intentionally do
  // NOT teardown the container itself — boot is expensive and the singleton
  // can be reused if the user re-enters the tab.
  useEffect(() => {
    return () => {
      if (devProcRef.current) {
        try {
          devProcRef.current.kill();
        } catch {
          /* ignore */
        }
        devProcRef.current = null;
      }
    };
  }, []);

  if (!supported) {
    return (
      <div className="absolute inset-0 flex items-center justify-center p-6 bg-[#0d0d12]">
        <div className="max-w-md text-center space-y-3">
          <AlertTriangle className="h-10 w-10 mx-auto text-amber-400" />
          <h3 className="text-white text-lg font-semibold">
            Live Preview no disponible
          </h3>
          <p className="text-sm text-muted-foreground">
            La vista previa real requiere un navegador basado en Chromium con
            aislamiento cross-origin (Chrome o Edge actualizados). Usa la
            pestaña <span className="text-white">Preview</span> que sí
            funciona en cualquier navegador.
          </p>
        </div>
      </div>
    );
  }

  if (phase === "idle") {
    return (
      <div className="absolute inset-0 flex items-center justify-center p-6 bg-[#0d0d12]">
        <div className="max-w-md text-center space-y-4">
          <div className="h-12 w-12 mx-auto rounded-full bg-blue-500/10 border border-blue-500/30 flex items-center justify-center">
            <Play className="h-5 w-5 text-blue-400" />
          </div>
          <div>
            <h3 className="text-white text-lg font-semibold">
              Preview real con Node.js
            </h3>
            <p className="text-sm text-muted-foreground mt-2">
              Arranca un Node real en tu navegador, instala las dependencias
              de la app generada y la ejecuta con Vite — tal cual la verías
              tras desplegar. La primera vez tarda 30-90 segundos.
            </p>
          </div>
          <Button onClick={start} className="bg-blue-600 hover:bg-blue-500 text-white">
            <Play className="h-4 w-4 mr-2" />
            Arrancar Live Preview
          </Button>
        </div>
      </div>
    );
  }

  if (phase === "ready" && serverUrl) {
    return (
      <div className="absolute inset-0 flex flex-col bg-white">
        <div className="flex items-center justify-between px-3 py-2 bg-[#0d0d12] border-b border-white/10 text-xs text-muted-foreground">
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
            <span className="text-emerald-300">Live</span>
            <span className="text-muted-foreground/70 truncate max-w-[420px]">
              {serverUrl}
            </span>
          </div>
          <div className="flex items-center gap-1">
            <Button
              size="sm"
              variant="ghost"
              className="h-7 text-muted-foreground hover:text-white hover:bg-white/10"
              onClick={() => {
                if (iframeRef.current) {
                  // Force reload by re-assigning src.
                  const u = serverUrl;
                  iframeRef.current.src = "about:blank";
                  setTimeout(() => {
                    if (iframeRef.current) iframeRef.current.src = u;
                  }, 50);
                }
              }}
              title="Recargar iframe"
            >
              <RefreshCw className="h-3.5 w-3.5 mr-1" />
              Recargar
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 text-muted-foreground hover:text-white hover:bg-white/10"
              onClick={() => {
                if (typeof window !== "undefined") {
                  window.open(serverUrl, "_blank", "noopener,noreferrer");
                }
              }}
              title="Abrir en pestaña nueva"
            >
              <ExternalLink className="h-3.5 w-3.5" />
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 text-muted-foreground hover:text-white hover:bg-white/10"
              onClick={() => {
                setPhase("idle");
                setServerUrl(null);
              }}
              title="Detener"
            >
              Detener
            </Button>
          </div>
        </div>
        <iframe
          ref={iframeRef}
          src={serverUrl}
          title="Live preview"
          // The previewed code is generated by an LLM from a user prompt and
          // therefore untrusted. We deliberately constrain its capabilities:
          //   - allow-scripts: needed to run the generated app at all
          //   - allow-same-origin: needed for localStorage / fetch to its own
          //     WebContainer origin (NOT our origin — the iframe lives on
          //     webcontainer.io, so this does not grant DOM access to us)
          //   - allow-forms / allow-modals / allow-popups: realistic UX
          //   - allow-popups-to-escape-sandbox: opened tabs behave normally
          // We omit allow-top-navigation* so a malicious app cannot hijack
          // the parent tab.
          sandbox="allow-scripts allow-same-origin allow-forms allow-modals allow-popups allow-popups-to-escape-sandbox"
          // Treat this iframe as another browsing context for COEP purposes
          // — required because the parent page is cross-origin-isolated.
          allow="cross-origin-isolated"
          className="flex-1 w-full bg-white"
        />
      </div>
    );
  }

  // Booting / mounting / installing / starting / error → show progress + logs.
  return (
    <div className="absolute inset-0 flex flex-col bg-[#0d0d12] text-white">
      <div className="px-4 py-3 border-b border-white/10 flex items-center gap-3">
        {phase === "error" ? (
          <AlertTriangle className="h-5 w-5 text-red-400" />
        ) : (
          <Loader2 className="h-5 w-5 animate-spin text-blue-400" />
        )}
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium">
            {phase === "booting" && "Arrancando WebContainer…"}
            {phase === "mounting" && "Montando archivos…"}
            {phase === "installing" && "Instalando dependencias…"}
            {phase === "starting" && "Iniciando vite dev…"}
            {phase === "error" && "Error en Live Preview"}
          </div>
          {errorMsg && (
            <div className="text-xs text-red-300/90 mt-1 truncate">{errorMsg}</div>
          )}
        </div>
        {phase === "error" && (
          <Button
            size="sm"
            variant="outline"
            className="border-white/20 bg-white/5 hover:bg-white/10 text-white"
            onClick={start}
          >
            <RefreshCw className="h-3.5 w-3.5 mr-2" />
            Reintentar
          </Button>
        )}
      </div>
      <div className="flex-1 overflow-auto bg-black/40 p-3 font-mono text-[11px] leading-snug text-gray-300">
        {logs.length === 0 ? (
          <div className="text-muted-foreground">Esperando salida…</div>
        ) : (
          logs.map((l, i) => (
            <div key={i} className="whitespace-pre-wrap break-words">
              {l}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
