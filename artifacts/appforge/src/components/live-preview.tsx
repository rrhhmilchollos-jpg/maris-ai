/**
 * Live Preview Component (Emergent.sh Clone)
 * 
 * Displays a real-time preview of the app being built.
 * Supports both Vercel deployment URL and local WebContainer execution.
 */

import React, { useState, useRef, useEffect, useCallback } from "react";
import { RefreshCw, Share2, Maximize2, X, Play, Loader2, AlertTriangle, ExternalLink } from "lucide-react";
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
  appId: string;
  appName: string;
  frontendCode: string;
  vercelUrl?: string;
  isBuilding?: boolean;
  onShare?: () => void;
  onDeploy?: () => void;
  onClose?: () => void;
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
}: LivePreviewProps) {
  const [phase, setPhase] = useState<Phase>(vercelUrl ? "ready" : "idle");
  const [serverUrl, setServerUrl] = useState<string | null>(vercelUrl || null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [supported] = useState(() => isWebContainerSupported());
  const [isExpanded, setIsExpanded] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const devProcRef = useRef<{ kill: () => void } | null>(null);
  const startingRef = useRef(false);

  const appendLog = useCallback((line: string) => {
    setLogs((prev) => {
      const next = [...prev, line];
      return next.length > 500 ? next.slice(next.length - 500) : next;
    });
  }, []);

  const startWebContainer = useCallback(async () => {
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
      parsed["package.json"] = ensureDevScript(parsed["package.json"]);
      const tree = buildFileTree(parsed);
      appendLog(`📁 Montando archivos en el container…`);
      await wc.mount(tree);

      setPhase("installing");
      appendLog("📦 Ejecutando `npm install`…");
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

      setPhase("starting");
      appendLog("🚀 Iniciando `npm run dev`…");
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

  useEffect(() => {
    // If we have a Vercel URL, use it immediately
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

  const handleRefresh = () => {
    if (iframeRef.current) {
      iframeRef.current.src = iframeRef.current.src;
    }
  };

  const handleExpand = () => {
    setIsExpanded(!isExpanded);
  };

  // Render the header (Emergent style)
  const renderHeader = () => (
    <div className="flex items-center justify-between px-4 py-2.5 border-b border-white/10 bg-[#0d0d12]">
      <h3 className="text-sm font-medium text-white">App Preview</h3>
      <div className="flex items-center gap-1.5">
        <button onClick={handleExpand} className="p-1.5 hover:bg-white/10 rounded text-slate-400 hover:text-white transition-colors">
          <Maximize2 className="w-4 h-4" />
        </button>
        <button onClick={handleRefresh} className="p-1.5 hover:bg-white/10 rounded text-slate-400 hover:text-white transition-colors">
          <RefreshCw className="w-4 h-4" />
        </button>
        <Button variant="ghost" size="sm" onClick={onShare} className="h-8 px-2 text-xs text-slate-400 hover:text-white hover:bg-white/10">
          <Share2 className="w-3.5 h-3.5 mr-1.5" />
          Share
        </Button>
        <Button size="sm" onClick={onDeploy} className="h-8 px-3 text-xs bg-blue-600 hover:bg-blue-500 text-white font-medium">
          <Play className="w-3.5 h-3.5 mr-1.5" />
          Desplegar
        </Button>
        {onClose && (
          <button onClick={onClose} className="p-1.5 hover:bg-white/10 rounded text-slate-400 hover:text-white transition-colors">
            <X className="w-4 h-4" />
          </button>
        )}
      </div>
    </div>
  );

  // Render the main content
  const renderContent = () => {
    if (phase === "ready" && serverUrl) {
      return (
        <iframe
          ref={iframeRef}
          src={serverUrl}
          className="w-full h-full bg-white border-0"
          title="App Preview"
          sandbox="allow-scripts allow-same-origin allow-forms allow-modals allow-popups allow-popups-to-escape-sandbox"
          allow="cross-origin-isolated"
        />
      );
    }

    if (phase === "idle") {
      return (
        <div className="w-full h-full flex flex-col items-center justify-center p-6 text-center space-y-4">
          <div className="w-16 h-16 rounded-full bg-blue-500/10 border border-blue-500/30 flex items-center justify-center">
            <Play className="h-6 w-6 text-blue-400" />
          </div>
          <div className="space-y-2">
            <h4 className="text-white font-semibold">Ready to preview</h4>
            <p className="text-xs text-slate-400 max-w-xs">
              Start a real Node.js environment to preview your app with full fidelity.
            </p>
          </div>
          <Button onClick={startWebContainer} className="bg-blue-600 hover:bg-blue-500 text-white">
            Arrancar Live Preview
          </Button>
        </div>
      );
    }

    // Loading / Error states
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
              <h4 className="text-lg text-white font-medium">Building something incredible ~!</h4>
              <p className="text-xs text-slate-500 font-mono">
                {phase === "booting" && "Booting Node.js container..."}
                {phase === "mounting" && "Mounting source files..."}
                {phase === "installing" && "Installing dependencies..."}
                {phase === "starting" && "Starting dev server..."}
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
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-[#0d0d12] border-l border-white/10 overflow-hidden">
      {renderHeader()}
      <div className="flex-1 overflow-hidden bg-black relative">
        {renderContent()}
      </div>
      
      {/* Footer (Emergent style) */}
      <div className="px-4 py-2.5 border-t border-white/10 bg-[#0d0d12]/80 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full ${phase === 'ready' ? 'bg-emerald-500 animate-pulse' : 'bg-slate-600'}`} />
          <p className="text-[11px] text-slate-400">
            {phase === 'ready' ? "You're viewing a live preview. Resume to interact with the app." : "Preview status: " + phase}
          </p>
        </div>
        {phase !== 'ready' && phase !== 'idle' && (
          <Button variant="ghost" size="sm" className="h-6 px-2 text-[10px] text-blue-400 hover:text-blue-300 hover:bg-blue-500/10">
            Resume Preview
          </Button>
        )}
        <div className="text-[10px] text-slate-600 font-medium flex items-center gap-1">
          <div className="w-3 h-3 bg-white/10 rounded-full flex items-center justify-center text-[8px]">M</div>
          Made with Maris AI
        </div>
      </div>
    </div>
  );
}
