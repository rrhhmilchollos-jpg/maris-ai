/**
 * Live Preview Component
 *
 * Muestra una vista previa en tiempo real de la app generada.
 * Soporta URL de Vercel y ejecución local con WebContainer.
 * Incluye consola de PC integrada (terminal integrada).
 */

import React, { useState, useRef, useEffect, useCallback } from "react";
import {
  RefreshCw,
  Share2,
  Maximize2,
  X,
  Play,
  AlertTriangle,
  Terminal,
  ChevronDown,
  ChevronUp,
  Zap,
} from "lucide-react";
import { Button } from "./ui/button";
import { parseBundle, buildSandpackFiles, SANDPACK_DEPENDENCIES } from "@/lib/parseBundle";
import { SandpackProvider, SandpackPreview } from "@codesandbox/sandpack-react";
import {
  buildFileTree,
  ensureDevScript,
  isStaticHtmlProject,
  patchViteConfig,
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
  appId: string;
  appName: string;
  frontendCode: string;
  vercelUrl?: string;
  isBuilding?: boolean;
  onShare?: () => void;
  onDeploy?: () => void;
  onClose?: () => void;
  /** Se llama cuando el iframe de preview reporta que #root quedó vacío
   *  (la app no renderizó nada) — permite al editor disparar una
   *  auto-reparación y avisar al usuario en el chat. */
  onFatalError?: (detail: string) => void;
}

/** Colorea una línea de log según su contenido */
function logLineColor(line: string): string {
  if (/✗|error|Error|FAILED|failed/i.test(line)) return "text-red-400";
  if (/warn|warning/i.test(line)) return "text-amber-400";
  if (/✓|ready|OK|listo|success/i.test(line)) return "text-emerald-400";
  if (/^📦|^📁|^🚀|^⏳/.test(line)) return "text-blue-400";
  return "text-slate-300";
}

export function LivePreview({
  appId,
  appName,
  frontendCode,
  vercelUrl,
  isBuilding = false,
  onShare,
  onDeploy,
  onClose,
  onFatalError,
}: LivePreviewProps) {
  const [phase, setPhase] = useState<Phase>(vercelUrl ? "ready" : "idle");
  const [serverUrl, setServerUrl] = useState<string | null>(vercelUrl || null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [supported] = useState(() => isWebContainerSupported());
  const [isExpanded, setIsExpanded] = useState(false);
  const [showConsole, setShowConsole] = useState(false);
  // Usar preview del servidor cuando hay appId — es el más fiable (esbuild compilado)
  // Sandpack como fallback solo cuando no hay appId
  const [useSandpackFallback, setUseSandpackFallback] = useState(!isWebContainerSupported() && !appId);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const devProcRef = useRef<{ kill: () => void } | null>(null);
  const startingRef = useRef(false);
  const consoleEndRef = useRef<HTMLDivElement | null>(null);

  const appendLog = useCallback((line: string) => {
    setLogs((prev) => {
      const next = [...prev, line];
      return next.length > 500 ? next.slice(next.length - 500) : next;
    });
  }, []);

  // El iframe de preview (vía deployBundle.ts) hace postMessage cuando #root
  // queda vacío 12s después de cargar — la app no renderizó nada. No
  // comprobamos event.origin: los iframes srcdoc/cross-origin reportan
  // origin "null", así que filtramos solo por el marcador __marisPreview.
  useEffect(() => {
    if (!onFatalError) return;
    const handler = (event: MessageEvent) => {
      const data = event.data;
      if (data && typeof data === "object" && data.__marisPreview && data.type === "fatal-error") {
        onFatalError(String(data.detail || ""));
      }
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, [onFatalError]);

  // Auto-scroll de la consola al fondo cuando llegan nuevas líneas
  useEffect(() => {
    if (showConsole && consoleEndRef.current) {
      consoleEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [logs, showConsole]);

  // Mostrar consola automáticamente cuando arranca el WebContainer
  useEffect(() => {
    if (phase !== "idle" && phase !== "ready") {
      setShowConsole(true);
    }
    if (phase === "ready") {
      // Ocultar consola cuando el preview está listo (pero permitir reabrirla)
      setTimeout(() => setShowConsole(false), 2000);
    }
    if (phase === "error") {
      setShowConsole(true);
    }
  }, [phase]);

  const startWebContainer = useCallback(async () => {
    if (startingRef.current) return;
    startingRef.current = true;
    setErrorMsg(null);
    setLogs([]);
    setServerUrl(null);
    setShowConsole(true);
    try {
      setPhase("booting");
      appendLog("⏳ Arrancando WebContainer (Node.js en el navegador)…");
      const wc = await getWebContainer();
      appendLog("✓ WebContainer listo");

      setPhase("mounting");
      const parsed = parseBundle(frontendCode);
      const isStatic = isStaticHtmlProject(parsed);
      parsed["package.json"] = ensureDevScript(parsed["package.json"], isStatic);
      // Desactivar el overlay de error de Vite HMR — los errores se muestran en la consola inferior
      const viteConfigKey = parsed["vite.config.ts"] !== undefined
        ? "vite.config.ts"
        : parsed["vite.config.js"] !== undefined
        ? "vite.config.js"
        : null;
      if (viteConfigKey) {
        parsed[viteConfigKey] = patchViteConfig(parsed[viteConfigKey]);
      } else {
        parsed["vite.config.ts"] = patchViteConfig(undefined);
      }
      const tree = buildFileTree(parsed);
      appendLog(`📁 Montando ${Object.keys(parsed).length} archivos en el container…`);
      await wc.mount(tree);
      appendLog("✓ Archivos montados");

      if (!isStatic) {
        setPhase("installing");
        appendLog("📦 Ejecutando npm install…");
        const install = await wc.spawn("npm", ["install", "--no-audit", "--no-fund"]);
        install.output.pipeTo(
          new WritableStream({
            write: (chunk) => {
              const clean = chunk.replace(/\x1b\[[0-9;]*[A-Za-z]/g, "").trimEnd();
              if (clean) appendLog(clean);
            },
          }),
        );
        const installExit = await install.exit;
        if (installExit !== 0) throw new Error(`npm install falló (exit ${installExit})`);
        appendLog("✓ Instalación OK");
      } else {
        appendLog("✓ Proyecto HTML estático — omitiendo npm install");
      }

      setPhase("starting");
      appendLog("🚀 Iniciando npm run dev…");
      if (devProcRef.current) {
        try { devProcRef.current.kill(); } catch {}
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

      const url = await new Promise<string>((resolve, reject) => {
        let settled = false;
        let offReady: (() => void) | undefined;
        let timeoutId: ReturnType<typeof setTimeout> | undefined;

        const cleanup = () => {
          if (offReady) { try { offReady(); } catch {} offReady = undefined; }
          if (timeoutId !== undefined) { clearTimeout(timeoutId); timeoutId = undefined; }
        };

        offReady = wc.on("server-ready", (_port: number, readyUrl: string) => {
          if (!settled) { settled = true; cleanup(); resolve(readyUrl); }
        });

        dev.exit.then((code) => {
          if (code !== 0 && !settled) {
            settled = true; cleanup();
            reject(new Error(`vite dev terminó con exit ${code}`));
          }
        });

        timeoutId = setTimeout(() => {
          if (!settled) { settled = true; cleanup(); reject(new Error("Timeout: vite no abrió puerto en 60s")); }
        }, 60000);
      });

      setServerUrl(url);
      setPhase("ready");
      appendLog(`✓ Servidor listo en ${url}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const isInstanceLimit = /unable to create more instances/i.test(msg) || /can only be created once/i.test(msg);
      const friendlyMsg = isInstanceLimit
        ? "Ya hay un Live Preview activo en otra pestaña. Cierra las demás pestañas de Maris AI y pulsa Reintentar."
        : msg;
      setErrorMsg(friendlyMsg);
      setPhase("error");
      // Activar Sandpack como fallback automático cuando WebContainer falla
      setUseSandpackFallback(true);
      appendLog(`✗ ${friendlyMsg}`);
    } finally {
      startingRef.current = false;
    }
  }, [frontendCode, appendLog]);

  useEffect(() => {
    if (vercelUrl) {
      setServerUrl(vercelUrl);
      setPhase("ready");
    }
  }, [vercelUrl]);

  useEffect(() => {
    return () => {
      if (devProcRef.current) {
        try { devProcRef.current.kill(); } catch {}
        devProcRef.current = null;
      }
    };
  }, []);

  // Llamar al backend para actualizar el sandbox E2B tras una edicion
  const handleSandboxUpdate = async () => {
    try {
      const res = await fetch(`/api/apps/${appId}/preview/update`, { method: "POST" });
      const data = await res.json();
      if (data.previewUrl && iframeRef.current) {
        iframeRef.current.src = data.previewUrl;
        setServerUrl(data.previewUrl);
      } else {
        handleRefresh();
      }
    } catch {
      handleRefresh();
    }
  };

  const handleRefresh = () => {
    if (iframeRef.current) {
      const currentSrc = iframeRef.current.src;
      iframeRef.current.src = 'about:blank';
      setTimeout(() => {
        if (iframeRef.current) iframeRef.current.src = currentSrc;
      }, 10);
    }
  };

  const handleExpand = () => setIsExpanded(!isExpanded);

  // ── Consola de PC integrada ──────────────────────────────────────────
  const renderConsole = () => (
    <div className="border-t border-white/10 bg-[#0a0a0f] flex flex-col" style={{ height: showConsole ? "200px" : "36px" }}>
      {/* Barra de título de la consola */}
      <button
        onClick={() => setShowConsole((v) => !v)}
        className="flex items-center justify-between px-4 py-2 w-full hover:bg-white/5 transition-colors shrink-0"
      >
        <div className="flex items-center gap-2">
          {/* Tres círculos estilo macOS */}
          <div className="flex items-center gap-1.5">
            <div className="w-3 h-3 rounded-full bg-red-500/80" />
            <div className="w-3 h-3 rounded-full bg-amber-500/80" />
            <div className="w-3 h-3 rounded-full bg-emerald-500/80" />
          </div>
          <Terminal className="w-3.5 h-3.5 text-white/40" />
          <span className="text-[11px] font-mono font-bold text-white/50 uppercase tracking-widest">
            Consola — WebContainer
          </span>
          {phase !== "idle" && phase !== "ready" && (
            <span className="flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-ping" />
              <span className="text-[10px] text-blue-400 font-mono">{phase}…</span>
            </span>
          )}
          {phase === "ready" && (
            <span className="text-[10px] text-emerald-400 font-mono">● listo</span>
          )}
          {phase === "error" && (
            <span className="text-[10px] text-red-400 font-mono">✗ error</span>
          )}
        </div>
        {showConsole ? (
          <ChevronDown className="w-3.5 h-3.5 text-white/30" />
        ) : (
          <ChevronUp className="w-3.5 h-3.5 text-white/30" />
        )}
      </button>

      {/* Cuerpo de la consola */}
      {showConsole && (
        <div className="flex-1 overflow-y-auto px-4 py-2 font-mono text-[11px] leading-relaxed space-y-0.5 custom-scrollbar">
          {logs.length === 0 ? (
            <span className="text-white/20">Esperando actividad del container…</span>
          ) : (
            logs.map((line, i) => (
              <div key={i} className={`whitespace-pre-wrap break-all ${logLineColor(line)}`}>
                <span className="text-white/20 select-none mr-2">$</span>{line}
              </div>
            ))
          )}
          <div ref={consoleEndRef} />
        </div>
      )}
    </div>
  );

  // ── Header ──────────────────────────────────────────────────────────────
  const renderHeader = () => (
    <div className="flex items-center justify-between px-4 py-2.5 border-b border-white/10 bg-[#0d0d12]">
      <div className="flex items-center gap-2">
        <div className={`w-2 h-2 rounded-full ${
          phase === "ready" ? "bg-emerald-500 animate-pulse" :
          phase === "error" ? "bg-red-500" :
          phase === "idle" ? "bg-slate-600" :
          "bg-blue-500 animate-pulse"
        }`} />
        <h3 className="text-sm font-medium text-white">{appName || "App Preview"}</h3>
      </div>
      <div className="flex items-center gap-1.5">
        <button
          onClick={() => setShowConsole((v) => !v)}
          title="Consola"
          className={`p-1.5 rounded transition-colors ${showConsole ? "bg-white/10 text-white" : "hover:bg-white/10 text-slate-400 hover:text-white"}`}
        >
          <Terminal className="w-4 h-4" />
        </button>
        <button onClick={handleExpand} className="p-1.5 hover:bg-white/10 rounded text-slate-400 hover:text-white transition-colors">
          <Maximize2 className="w-4 h-4" />
        </button>
        <button onClick={handleRefresh} className="p-1.5 hover:bg-white/10 rounded text-slate-400 hover:text-white transition-colors">
          <RefreshCw className="w-4 h-4" />
        </button>
        {serverUrl && (
          <button 
            onClick={() => window.open(serverUrl, '_blank')} 
            className="p-1.5 hover:bg-white/10 rounded text-slate-400 hover:text-white transition-colors"
            title="Abrir en nueva pestaña"
          >
            <Maximize2 className="w-4 h-4" />
          </button>
        )}
        <Button variant="ghost" size="sm" onClick={onShare} className="h-8 px-2 text-xs text-slate-400 hover:text-white hover:bg-white/10">
          <Share2 className="w-3.5 h-3.5 mr-1.5" />
          Share
        </Button>
        <Button size="sm" onClick={onDeploy} className="h-8 px-3 text-xs bg-blue-600 hover:bg-blue-500 text-white font-medium">
          <Play className="w-3.5 h-3.5 mr-1.5" />
          Desplegar
        </Button>
      </div>
    </div>
  );

  // ── Contenido principal ─────────────────────────────────────────────────
  const renderContent = () => {
    if (phase === "ready" && serverUrl) {
      const isVercel = serverUrl.includes('vercel.app');
      
      return (
        <div className="relative w-full h-full bg-white">
          <iframe
            ref={iframeRef}
            src={serverUrl}
            className="w-full h-full border-0 bg-white"
            title="App Preview"
            sandbox="allow-scripts allow-same-origin allow-forms allow-modals allow-popups allow-popups-to-escape-sandbox"
            allow="cross-origin-isolated; clipboard-read; clipboard-write"
            loading="lazy"
          />
          {/* Overlay de carga o error si fuera necesario, pero permitimos el iframe directo */}
          {/* Fallback siempre visible si el iframe falla o para dar la opción */}
          <div className="absolute bottom-4 right-4 z-20">
             <Button 
                size="sm"
                onClick={() => window.open(serverUrl, '_blank')}
                className="bg-white/10 backdrop-blur-md border border-white/20 text-white hover:bg-white/20 shadow-xl"
              >
                <Maximize2 className="w-3.5 h-3.5 mr-2" />
                Abrir Externamente
              </Button>
          </div>
        </div>
      );
    }

    // ── Sandpack fallback (cuando WebContainer no está disponible) ──────────
    if (useSandpackFallback && frontendCode) {
      // Si tenemos appId, usar el endpoint del servidor que compila correctamente con esbuild
      if (appId) {
        const API_BASE = import.meta.env.VITE_API_URL || "";
        return (
          <div className="w-full h-full flex flex-col">
            <div className="flex items-center gap-2 px-3 py-1.5 bg-emerald-500/10 border-b border-emerald-500/20 shrink-0">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
              <span className="text-[11px] text-emerald-300">Vista previa en vivo</span>
              <button
                onClick={() => window.open(`${API_BASE}/api/apps/${appId}/preview`, "_blank")}
                className="ml-auto text-[10px] text-emerald-400 hover:text-emerald-200 underline"
              >
                Abrir en nueva pestaña ↗
              </button>
            </div>
            <div className="flex-1 min-h-0">
              <iframe
                src={`${API_BASE}/api/apps/${appId}/preview`}
                className="w-full h-full border-0"
                title="App Preview"
                allow="cross-origin-isolated"
              />
            </div>
          </div>
        );
      }
      // Sin appId — usar Sandpack
      const sandpackFiles = buildSandpackFiles(parseBundle(frontendCode));
      return (
        <div className="w-full h-full flex flex-col">
          {/* Banner informativo */}
          <div className="flex items-center gap-2 px-3 py-1.5 bg-violet-500/10 border-b border-violet-500/20 shrink-0">
            <Zap className="w-3.5 h-3.5 text-violet-400" />
            <span className="text-[11px] text-violet-300">Preview rápido (Sandpack) — Para el preview completo con Node.js, despliega la app</span>
            <button
              onClick={() => { setUseSandpackFallback(false); startWebContainer(); }}
              className="ml-auto text-[10px] text-violet-400 hover:text-violet-200 underline"
            >
              Intentar WebContainer
            </button>
          </div>
          <div className="flex-1 min-h-0">
            <SandpackProvider
              template="vite-react-ts"
              files={sandpackFiles}
              customSetup={{ dependencies: SANDPACK_DEPENDENCIES }}
              options={{ externalResources: ["https://cdn.tailwindcss.com"] }}
              theme="dark"
            >
              <SandpackPreview
                style={{ height: "100%", minHeight: 0 }}
                showNavigator={false}
                showOpenInCodeSandbox={false}
              />
            </SandpackProvider>
          </div>
        </div>
      );
    }

    if (phase === "idle") {
      return (
        <div className="w-full h-full flex flex-col items-center justify-center p-6 text-center space-y-4">
          <div className="w-16 h-16 rounded-full bg-blue-500/10 border border-blue-500/30 flex items-center justify-center">
            <Play className="h-6 w-6 text-blue-400" />
          </div>
          <div className="space-y-2">
            <h4 className="text-white font-semibold">Live Preview</h4>
            <p className="text-xs text-slate-400 max-w-xs">
              Arranca un entorno Node.js real en el navegador para ver tu app con máxima fidelidad.
            </p>
          </div>
          <Button onClick={startWebContainer} className="bg-blue-600 hover:bg-blue-500 text-white">
            Arrancar Live Preview
          </Button>
        </div>
      );
    }

    return (
      <div className="w-full h-full flex flex-col items-center justify-center p-6 text-center">
        {phase === "error" ? (
          <div className="space-y-4">
            <AlertTriangle className="h-12 w-12 text-red-500 mx-auto" />
            <div className="space-y-1">
              <h4 className="text-white font-semibold">Error en el Preview</h4>
              <p className="text-xs text-red-400 max-w-xs">{errorMsg}</p>
            </div>
            <Button variant="outline" onClick={startWebContainer} className="border-white/10 text-white hover:bg-white/5">
              Reintentar
            </Button>
          </div>
        ) : (
          <div className="space-y-6">
            <div className="relative">
              <div className="w-20 h-20 rounded-full border-4 border-blue-500/10 border-t-blue-500 animate-spin mx-auto" />
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="w-10 h-10 bg-blue-500/20 rounded-full flex items-center justify-center">
                  <div className="w-2 h-2 bg-blue-400 rounded-full animate-ping" />
                </div>
              </div>
            </div>
            <div className="space-y-2">
              <h4 className="text-lg text-white font-medium">Construyendo tu app…</h4>
              <p className="text-xs text-slate-500 font-mono">
                {phase === "booting" && "Iniciando Node.js container…"}
                {phase === "mounting" && "Montando archivos fuente…"}
                {phase === "installing" && "Instalando dependencias (npm install)…"}
                {phase === "starting" && "Iniciando servidor de desarrollo…"}
              </p>
            </div>
          </div>
        )}
      </div>
    );
  };

  if (isExpanded) {
    return (
      <div className="fixed inset-0 z-[100] bg-black flex flex-col">
        {renderHeader()}
        <div className="flex-1 overflow-hidden">
          {renderContent()}
        </div>
        {renderConsole()}
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-[#0d0d12] border-l border-white/10 overflow-hidden">
      {renderHeader()}
      <div className="flex-1 overflow-hidden bg-black relative min-h-0">
        {renderContent()}
      </div>
      {renderConsole()}
    </div>
  );
}
