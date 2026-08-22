/**
 * Live Preview Component
 *
 * Muestra una vista previa en tiempo real de la app generada.
 * Usa el endpoint /api/apps/:id/preview (iframe directo) o la URL de Vercel.
 * WebContainer eliminado — era incompatible con SharedArrayBuffer sin COOP/COEP
 * y redundante con el sistema de preview existente.
 */

import React, { useRef, useEffect, useCallback } from "react";
import { RefreshCw, Share2, X, ExternalLink } from "lucide-react";
import { Button } from "./ui/button";
import { getApiUrl } from "@/lib/api-client";

interface LivePreviewProps {
  appId: string;
  appName: string;
  frontendCode: string;
  vercelUrl?: string;
  isBuilding?: boolean;
  onShare?: () => void;
  onDeploy?: () => void;
  onClose?: () => void;
  onFatalError?: (detail: string) => void;
  previewUrl?: string;
}

export function LivePreview({
  appId,
  appName,
  frontendCode,
  vercelUrl,
  isBuilding,
  onShare,
  onDeploy,
  onClose,
  onFatalError,
  previewUrl: externalPreviewUrl,
}: LivePreviewProps) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);

  // URL final: Vercel URL si existe, si no el endpoint de preview interno
  const src = vercelUrl
    || externalPreviewUrl
    || (appId ? getApiUrl(`/api/apps/${appId}/preview`) : "");

  // La versión es local al bundle actual. Permite cachear brevemente el HTML
  // en el borde sin mostrar una versión anterior tras editar una aplicación.
  let previewHash = 2166136261;
  for (let index = 0; index < frontendCode.length; index += 1) {
    previewHash = Math.imul(previewHash ^ frontendCode.charCodeAt(index), 16777619);
  }
  const previewVersion = `${frontendCode.length.toString(36)}-${(previewHash >>> 0).toString(36)}`;
  const iframeSrc = src && !vercelUrl && !externalPreviewUrl
    ? `${src}${src.includes("?") ? "&" : "?"}pv=${previewVersion}`
    : src;

  // Escuchar mensajes del iframe (root vacío = error fatal)
  useEffect(() => {
    function onMessage(e: MessageEvent) {
      if (e.data?.type === "maris-preview-empty-root") {
        onFatalError?.("La app no renderizó contenido (#root vacío)");
      }
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [onFatalError]);

  const handleRefresh = useCallback(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;
    const current = iframe.src;
    iframe.src = "about:blank";
    setTimeout(() => { if (iframeRef.current) iframeRef.current.src = current; }, 50);
  }, []);

  if (!src) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 bg-[#0a0a0f] text-white/40">
        <div className="text-4xl">🔨</div>
        <p className="text-sm">Construyendo la app…</p>
        {isBuilding && (
          <div className="flex items-center gap-2 text-xs text-violet-400">
            <div className="h-1.5 w-1.5 animate-ping rounded-full bg-violet-400" />
            Generando código
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="relative flex h-full w-full min-w-0 flex-col bg-[#0a0a0f]">
      {/* Toolbar mínimo */}
      <div className="flex shrink-0 items-center gap-1 border-b border-white/[0.06] px-2 py-1">
        <span className="min-w-0 flex-1 truncate text-[11px] text-white/30">{iframeSrc}</span>
        <button
          onClick={handleRefresh}
          title="Recargar preview"
          className="grid h-6 w-6 place-items-center rounded text-white/30 hover:bg-white/5 hover:text-white/70 transition"
        >
          <RefreshCw className="h-3.5 w-3.5" />
        </button>
        {vercelUrl && (
          <a
            href={vercelUrl}
            target="_blank"
            rel="noopener noreferrer"
            title="Abrir en nueva pestaña"
            className="grid h-6 w-6 place-items-center rounded text-white/30 hover:bg-white/5 hover:text-white/70 transition"
          >
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        )}
        {onShare && (
          <button onClick={onShare} title="Compartir" className="grid h-6 w-6 place-items-center rounded text-white/30 hover:bg-white/5 hover:text-white/70 transition">
            <Share2 className="h-3.5 w-3.5" />
          </button>
        )}
        {onClose && (
          <button onClick={onClose} title="Cerrar preview" className="grid h-6 w-6 place-items-center rounded text-white/30 hover:bg-white/5 hover:text-white/70 transition">
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {/* iframe de preview */}
      <iframe
        ref={iframeRef}
        src={iframeSrc}
        title={`Preview — ${appName}`}
        className="h-full w-full flex-1 border-0 bg-white"
        sandbox="allow-scripts allow-forms allow-modals allow-popups"
        allow="clipboard-read; clipboard-write"
      />
    </div>
  );
}
