/**
 * media-ai-generator.tsx
 * 
 * Generador de vídeo e imagen con IA para Maris AI.
 * Aparece en el dashboard cuando el usuario selecciona kind="video-ai" o "imagen-ai".
 * 
 * Capacidades:
 * - Imagen: Gemini Imagen 3 (text-to-image, múltiples estilos)
 * - Vídeo: Kling AI (text-to-video, 5s-3min encadenando segmentos)
 * 
 * Supera a Emergent, Lovable, Base44 — ninguno tiene generación nativa de media.
 */

import { useState, useRef } from "react";
import { 
  ImagePlay, Video, Loader2, Download, RefreshCw, 
  Sparkles, Play, Pause, AlertCircle, CheckCircle2,
  Wand2, Film, Camera
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { apiFetch } from "@/lib/api-client";

type MediaMode = "imagen-ai" | "video-ai";

const IMAGE_STYLES = [
  { id: "realistic", label: "Fotorrealista", emoji: "📷" },
  { id: "artistic", label: "Arte digital", emoji: "🎨" },
  { id: "cinematic", label: "Cinematográfico", emoji: "🎬" },
  { id: "minimal", label: "Minimalista", emoji: "⬜" },
  { id: "3d", label: "3D Render", emoji: "🎮" },
];

const VIDEO_STYLES = [
  { id: "cinematic", label: "Cinematográfico", emoji: "🎬" },
  { id: "documentary", label: "Documental", emoji: "📽️" },
  { id: "commercial", label: "Publicitario", emoji: "📺" },
  { id: "animated", label: "Animado", emoji: "✨" },
];

const VIDEO_DURATIONS = [5, 10, 15, 20, 30, 60, 120, 180];

interface MediaAIGeneratorProps {
  mode: MediaMode;
  token?: string;
}

export function MediaAIGenerator({ mode, token }: MediaAIGeneratorProps) {
  const [prompt, setPrompt] = useState("");
  const [style, setStyle] = useState("cinematic");
  const [duration, setDuration] = useState(10);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ imageUrl?: string; videoUrl?: string; jobId?: string; fallback?: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [polling, setPolling] = useState(false);
  const [videoPlaying, setVideoPlaying] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const pollRef = useRef<NodeJS.Timeout | undefined>(undefined);

  const isVideo = mode === "video-ai";

  const EXAMPLE_PROMPTS = isVideo
    ? [
        "Un producto de lujo flotando en agua cristalina con burbujas y luz dorada",
        "Una ciudad futurista con coches voladores al atardecer, estilo cyberpunk",
        "Un logotipo moderno que se forma con partículas de luz sobre fondo oscuro",
        "Una naturaleza timelapse: flores abriéndose en cámara rápida, primavera",
      ]
    : [
        "Un robot amigable en una ciudad futurista al amanecer",
        "Producto de skincare en fondo minimalista blanco con luz suave",
        "Paisaje de montaña con aurora boreal y lago espejo",
        "Logo 3D metálico con fondo degradado oscuro y destellos de luz",
      ];

  async function generate() {
    if (!prompt.trim() || loading) return;
    setLoading(true);
    setError(null);
    setResult(null);

    try {
      if (isVideo) {
        const data = await apiFetch<any>("/api/video/generate", {
          method: "POST",
          body: JSON.stringify({ prompt, style, duration }),
        });
        
        if (data.jobId) {
          setResult({ jobId: data.jobId, fallback: data.fallbackFrames });
          if (!data.fallbackFrames) {
            // Cada segmento de Kling puede tardar hasta ~3 min; un vídeo de
            // 180s son 18 segmentos encadenados, así que el sondeo tiene que
            // escalar con la duración pedida en vez de un tope fijo de 2 min
            // (que dejaba vídeos largos marcados como "tiempo agotado"
            // aunque siguieran generándose bien en segundo plano).
            const segmentsTotal = data.segmentsTotal ?? Math.max(1, Math.ceil(duration / 10));
            pollVideoStatus(data.jobId, segmentsTotal);
          }
        }
      } else {
        const data = await apiFetch<any>("/api/imagen/generate", {
          method: "POST",
          body: JSON.stringify({ prompt, style, aspectRatio: "16:9" }),
        });
        setResult({ imageUrl: data.imageUrl, fallback: data.fallback });
      }
    } catch (err: any) {
      setError(err.message || "Error al generar");
    } finally {
      setLoading(false);
    }
  }

  function pollVideoStatus(jobId: string, segmentsTotal: number = 1) {
    setPolling(true);
    let attempts = 0;
    // ~3 min por segmento (tope real de Kling) + margen, dividido en
    // intervalos de 5s. Para 1 solo clip corto esto sigue siendo ~2 min,
    // igual que antes; para vídeos largos escala de verdad.
    const maxAttempts = Math.ceil((segmentsTotal * 3.5 * 60) / 5);

    pollRef.current = setInterval(async () => {
      attempts++;
      if (attempts > maxAttempts) {
        clearInterval(pollRef.current);
        setPolling(false);
        setError("Tiempo de espera agotado. El vídeo puede tardar más de lo esperado.");
        return;
      }

      try {
        const data = await apiFetch<any>(`/api/video/status/${jobId}`);
        if (data.status === "completed") {
          clearInterval(pollRef.current);
          setPolling(false);
          setResult(prev => ({ ...prev, videoUrl: data.videoUrl, thumbnailUrl: data.thumbnailUrl }));
        } else if (data.status === "error") {
          clearInterval(pollRef.current);
          setPolling(false);
          setError(data.errorMessage || "Error en la generación del vídeo");
        } else if (typeof data.segmentsDone === "number" && typeof data.segmentsTotal === "number") {
          setResult(prev => ({ ...prev, segmentsDone: data.segmentsDone, segmentsTotal: data.segmentsTotal }));
        }
      } catch {}
    }, 5000);
  }

  function downloadMedia() {
    const url = result?.imageUrl || result?.videoUrl;
    if (!url || url.startsWith("data:")) {
      // base64 download
      const a = document.createElement("a");
      a.href = url!;
      a.download = `maris-ai-${mode}-${Date.now()}.${isVideo ? "mp4" : "png"}`;
      a.click();
    } else {
      window.open(url, "_blank");
    }
  }

  return (
    <div className="space-y-4 p-4 rounded-2xl border border-white/[0.08] bg-[#0d0d12]">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className={cn(
          "w-9 h-9 rounded-xl flex items-center justify-center",
          isVideo ? "bg-rose-500/15 border border-rose-500/25" : "bg-violet-500/15 border border-violet-500/25"
        )}>
          {isVideo ? <Film className="h-4 w-4 text-rose-400" /> : <Camera className="h-4 w-4 text-violet-400" />}
        </div>
        <div>
          <div className="text-sm font-bold text-white flex items-center gap-2">
            {isVideo ? "Generador de Vídeo IA" : "Generador de Imagen IA"}
            <Badge className={cn(
              "text-[9px] py-0",
              isVideo ? "bg-rose-500/20 text-rose-300 border-rose-500/30" : "bg-violet-500/20 text-violet-300 border-violet-500/30"
            )}>
              {isVideo ? "Kling AI" : "Gemini Imagen 3"}
            </Badge>
          </div>
          <p className="text-[11px] text-white/40">
            {isVideo
              ? "Genera vídeos de 5-30 segundos desde texto. Exclusivo de Maris AI."
              : "Genera imágenes de alta calidad con IA. En segundos."}
          </p>
        </div>
      </div>

      {/* Style selector */}
      <div>
        <p className="text-[10px] text-white/40 mb-1.5">Estilo</p>
        <div className="flex gap-1 flex-wrap">
          {(isVideo ? VIDEO_STYLES : IMAGE_STYLES).map(s => (
            <button
              key={s.id}
              onClick={() => setStyle(s.id)}
              className={cn(
                "px-2 py-1 rounded-lg text-[10px] font-medium transition-colors border",
                style === s.id
                  ? "bg-violet-600/30 text-violet-300 border-violet-500/40"
                  : "text-white/30 border-white/10 hover:text-white/60 hover:border-white/20"
              )}
            >
              {s.emoji} {s.label}
            </button>
          ))}
        </div>
      </div>

      {/* Duration (video only) */}
      {isVideo && (
        <div>
          <p className="text-[10px] text-white/40 mb-1.5">Duración</p>
          <div className="flex gap-1.5 flex-wrap">
            {VIDEO_DURATIONS.map(d => (
              <button
                key={d}
                onClick={() => setDuration(d)}
                className={cn(
                  "px-2.5 py-1 rounded-lg text-[10px] font-medium transition-colors border",
                  duration === d
                    ? "bg-rose-600/30 text-rose-300 border-rose-500/40"
                    : "text-white/30 border-white/10 hover:text-white/60"
                )}
              >
                {d < 60 ? `${d}s` : `${d / 60} min`}
              </button>
            ))}
          </div>
          {duration >= 60 && (
            <p className="text-[10px] text-white/30 mt-1.5">
              Los vídeos de 1 min o más se generan encadenando varios clips — puede tardar varios minutos.
            </p>
          )}
        </div>
      )}

      {/* Prompt */}
      <div>
        <p className="text-[10px] text-white/40 mb-1.5">Describe lo que quieres generar</p>
        <Textarea
          value={prompt}
          onChange={e => setPrompt(e.target.value)}
          placeholder={isVideo
            ? "ej. Un producto de lujo flotando en agua cristalina con luz dorada..."
            : "ej. Un robot amigable en una ciudad futurista al amanecer..."
          }
          className="min-h-[70px] text-sm bg-white/[0.04] border-white/10 text-white placeholder:text-white/20 resize-none"
        />
        {/* Example prompts */}
        <div className="mt-1.5 flex gap-1 flex-wrap">
          {EXAMPLE_PROMPTS.slice(0, 2).map((ex, i) => (
            <button
              key={i}
              onClick={() => setPrompt(ex)}
              className="text-[9px] text-white/25 hover:text-white/50 border border-white/[0.06] hover:border-white/15 px-2 py-0.5 rounded-full transition-colors truncate max-w-[200px]"
            >
              {ex}
            </button>
          ))}
        </div>
      </div>

      {/* Generate button */}
      <Button
        onClick={generate}
        disabled={loading || !prompt.trim() || polling}
        className={cn(
          "w-full h-9 text-sm font-bold",
          isVideo
            ? "bg-rose-600 hover:bg-rose-700 shadow-lg shadow-rose-500/20"
            : "bg-violet-600 hover:bg-violet-700 shadow-lg shadow-violet-500/20"
        )}
      >
        {loading ? (
          <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Generando...</>
        ) : (
          <><Wand2 className="mr-2 h-4 w-4" />Generar {isVideo ? "vídeo" : "imagen"}</>
        )}
      </Button>

      {/* Polling status */}
      {polling && (
        <div className="flex items-center gap-2 text-[11px] text-white/50 bg-white/[0.03] rounded-lg px-3 py-2">
          <Loader2 className="h-3.5 w-3.5 animate-spin text-rose-400" />
          {result?.segmentsTotal
            ? `Generando con Kling AI: segmento ${result.segmentsDone ?? 0}/${result.segmentsTotal}...`
            : "Procesando vídeo con Kling AI... puede tardar 1-3 minutos"}
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="flex items-center gap-2 text-[11px] text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
          <AlertCircle className="h-3.5 w-3.5 shrink-0" />
          {error}
        </div>
      )}

      {/* Result — Imagen */}
      {result?.imageUrl && !isVideo && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5 text-[11px] text-emerald-400">
              <CheckCircle2 className="h-3.5 w-3.5" />
              {result.fallback ? "Imagen placeholder (activa GOOGLE_GENAI_API_KEY para imágenes reales)" : "Imagen generada con Gemini Imagen 3"}
            </div>
            <div className="flex gap-1.5">
              <Button variant="outline" size="sm" onClick={generate} className="h-6 text-[10px] border-white/10 text-white/50 hover:text-white px-2">
                <RefreshCw className="h-3 w-3 mr-1" />Nueva
              </Button>
              <Button variant="outline" size="sm" onClick={downloadMedia} className="h-6 text-[10px] border-white/10 text-white/50 hover:text-white px-2">
                <Download className="h-3 w-3 mr-1" />Descargar
              </Button>
            </div>
          </div>
          <img
            src={result.imageUrl}
            alt={prompt}
            className="w-full rounded-xl border border-white/10 object-cover max-h-80"
          />
        </div>
      )}

      {/* Result — Vídeo */}
      {result?.videoUrl && isVideo && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5 text-[11px] text-emerald-400">
              <CheckCircle2 className="h-3.5 w-3.5" />
              Vídeo generado con Kling AI ({duration}s)
            </div>
            <Button variant="outline" size="sm" onClick={downloadMedia} className="h-6 text-[10px] border-white/10 text-white/50 hover:text-white px-2">
              <Download className="h-3 w-3 mr-1" />Descargar
            </Button>
          </div>
          <div className="relative rounded-xl overflow-hidden border border-white/10">
            <video
              ref={videoRef}
              src={result.videoUrl}
              className="w-full"
              onPlay={() => setVideoPlaying(true)}
              onPause={() => setVideoPlaying(false)}
            />
            <button
              onClick={() => videoPlaying ? videoRef.current?.pause() : videoRef.current?.play()}
              className="absolute inset-0 flex items-center justify-center bg-black/30 hover:bg-black/20 transition-colors"
            >
              {videoPlaying
                ? <Pause className="h-10 w-10 text-white drop-shadow-lg" />
                : <Play className="h-10 w-10 text-white drop-shadow-lg" />
              }
            </button>
          </div>
        </div>
      )}

      {/* Fallback video job queued */}
      {result?.jobId && !result?.videoUrl && isVideo && !polling && result.fallback && (
        <div className="text-[11px] text-amber-400/80 bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2">
          ⚡ Vídeo IA real disponible configurando <code className="bg-white/10 px-1 rounded">LUMA_API_KEY</code> en Railway.
          Actualmente en modo storyboard con imágenes IA.
        </div>
      )}
    </div>
  );
}
