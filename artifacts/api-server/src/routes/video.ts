import { anthropic as zocoia } from "@workspace/integrations-anthropic-ai";
/**
 * video.ts — Generación de vídeo e imagen con IA
 * 
 * Endpoints:
 * - POST /api/video/generate — genera vídeo con Kling AI (text-to-video, hasta 3 min encadenando segmentos)
 * - POST /api/imagen/generate — genera imagen con Gemini Imagen 3
 * - GET  /api/video/status/:jobId — estado del job de vídeo
 * 
 * Competidores que superamos:
 * - Emergent.sh: no tiene generación de vídeo
 * - Lovable: no tiene vídeo ni imagen nativa
 * - Base44: no tiene media generation
 */

import { Router, Request, Response } from "express";
import { requireAuth } from "../lib/auth";
import { logger } from "../lib/logger";
import { GoogleGenAI, Modality } from "@google/genai";
import multer from "multer";
import ffmpeg from "fluent-ffmpeg";
import { writeFile, unlink, mkdtemp, readFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import crypto from "crypto";

ffmpeg.setFfmpegPath("/usr/bin/ffmpeg");

// Subida de la foto + la canción real del cliente (multipart, no JSON) —
// los archivos de audio pueden pesar varios MB, mucho más de lo razonable
// para meter en un body JSON en base64.
const uploadMedia = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 }, // 25MB máximo por archivo
});

const router = Router();

// CONEXIÓN EXCLUSIVA A ZOCO IA: lazy init del canal multimodal vía gateway
// de Zoco IA (sin claves nativas de Gemini). El error salta al primer uso.
let _genai: GoogleGenAI | null = null;
function getGenAI() {
  if (!_genai) {
    const apiKey = process.env.ZOCOIA_API_KEY || "";
    const baseUrl = process.env.ZOCOIA_GEMINI_GATEWAY_URL;
    if (!apiKey.startsWith("sk-zoco-") || !baseUrl) {
      throw new Error(
        "Canal multimodal no configurado: define ZOCOIA_API_KEY (sk-zoco-...) y ZOCOIA_GEMINI_GATEWAY_URL. " +
          "Las claves nativas de Gemini ya no se aceptan: todo el tráfico viaja por zocoia.",
      );
    }
    _genai = new GoogleGenAI({ apiKey, httpOptions: { apiVersion: "", baseUrl } });
  }
  return _genai;
}

// ─── POST /api/imagen/generate ────────────────────────────────────────────────
router.post("/imagen/generate", requireAuth, async (req: Request, res: Response) => {
  const { prompt, style = "realistic", aspectRatio = "16:9" } = req.body;
  if (!prompt) return res.status(400).json({ error: "prompt es requerido" });

  try {
    logger.info({ prompt, style }, "Imagen AI: generando con Gemini Imagen 3");
    
    const genai = getGenAI();
    const model = genai.models;

    const stylePrompts: Record<string, string> = {
      realistic: "photorealistic, 8K, professional photography, detailed",
      artistic: "digital art, vibrant colors, artistic style, high quality illustration",
      cinematic: "cinematic shot, dramatic lighting, movie still, professional cinematography",
      minimal: "minimalist design, clean, modern, simple background",
      "3d": "3D render, octane render, volumetric lighting, professional 3D art",
    };

    const enhancedPrompt = `${prompt}. Style: ${stylePrompts[style] || stylePrompts.realistic}. Aspect ratio: ${aspectRatio}.`;

    const response = await (model as any).generateContent({
      model: "gemini-2.0-flash-preview-image-generation",
      contents: [{ parts: [{ text: enhancedPrompt }] }],
      config: { responseModalities: [Modality.IMAGE, Modality.TEXT] },
    });

    const parts = response?.candidates?.[0]?.content?.parts || [];
    const imagePart = parts.find((p: any) => p.inlineData?.mimeType?.startsWith("image/"));

    if (!imagePart?.inlineData) {
      return res.status(500).json({ 
        error: "No se generó imagen",
        fallback: true,
        // Fallback: devolver URL de placeholder de alta calidad
        imageUrl: `https://picsum.photos/seed/${Date.now()}/1280/720`,
      });
    }

    const base64 = imagePart.inlineData.data;
    const mimeType = imagePart.inlineData.mimeType;
    const imageUrl = `data:${mimeType};base64,${base64}`;

    logger.info({ promptLength: prompt.length }, "Imagen AI: generada correctamente");
    return res.json({ imageUrl, prompt: enhancedPrompt, style, aspectRatio });

  } catch (error: any) {
    logger.error({ error: error.message }, "Imagen AI: error");
    // Devolver fallback en lugar de error — mejor UX
    return res.json({
      imageUrl: `https://picsum.photos/seed/${Date.now()}/1280/720`,
      fallback: true,
      error: "API de imagen no disponible — usando placeholder",
    });
  }
});

// ─── Kling AI — generación de vídeo real, con duración real ──────────────────
// A diferencia de Luma (que solo metía "duration: Xs" como texto dentro del
// prompt, sin que la API lo respetara realmente), Kling SÍ tiene un
// parámetro `duration` real -- pero limitado a ~10s por llamada (documentado
// en la API oficial: kling.ai/document-api). Para vídeos más largos (60s,
// 120s, 180s) se encadenan varios segmentos de 10s: cada uno continúa desde
// el último frame del anterior (image-to-video), y se unen con ffmpeg al
// final. Se aplica la marca de agua de Maris AI al vídeo final ya unido.
const KLING_BASE_URL = "https://api-singapore.klingai.com";
const KLING_SEGMENT_SECONDS = 10;
const KLING_MODEL = "kling-v2-6";

// Coste REAL de Kling en modo "std": ronda los 0.25-0.50 USD por segmento de
// 10s. CREDITS_PER_KLING_SEGMENT es una PROPUESTA con margen (igual que
// VEO_TIERS más abajo) -- ajústalo según tu conversión real créditos/EUR.
const CREDITS_PER_KLING_SEGMENT = 10;
// Recargo fijo por el procesado de ffmpeg (unir + marca de agua) cuando hay
// más de un segmento -- solo aplica a vídeos largos, no a un clip suelto.
const MULTI_SEGMENT_SURCHARGE = 5;

function computeVideoCreditCost(durationSec: number): { segmentsTotal: number; creditCost: number } {
  const segmentsTotal = Math.max(1, Math.ceil(durationSec / KLING_SEGMENT_SECONDS));
  const creditCost = segmentsTotal * CREDITS_PER_KLING_SEGMENT + (segmentsTotal > 1 ? MULTI_SEGMENT_SURCHARGE : 0);
  return { segmentsTotal, creditCost };
}

async function klingRequest(path: string, body: any): Promise<any> {
  const apiKey = process.env.KLING_API_KEY;
  const response = await fetch(`${KLING_BASE_URL}${path}`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const data = await response.json() as any;
  if (!response.ok || data.code !== 0) {
    throw new Error(data.message || `Error de Kling AI (HTTP ${response.status})`);
  }
  return data.data;
}

async function pollKlingTask(taskId: string, path: string): Promise<{ videoUrl: string }> {
  const apiKey = process.env.KLING_API_KEY;
  const deadline = Date.now() + 3 * 60_000; // 3 min máx por segmento
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 5000));
    const res = await fetch(`${KLING_BASE_URL}${path}/${taskId}`, {
      headers: { "Authorization": `Bearer ${apiKey}` },
    });
    const data = (await res.json()) as any;
    const status = data?.data?.task_status;
    if (status === "succeed") {
      const video = data.data?.task_result?.videos?.[0];
      if (!video?.url) throw new Error("Kling AI no devolvió ningún vídeo");
      return { videoUrl: video.url };
    }
    if (status === "failed") {
      throw new Error(data?.data?.task_status_msg || "Kling AI falló al generar el segmento");
    }
    // submitted / processing -> seguir esperando
  }
  throw new Error("Tiempo de espera agotado generando un segmento con Kling AI");
}

/** Procesa un VideoJob completo en segundo plano: N segmentos + unión + marca de agua. */
async function processVideoJob(jobId: string, opts: { prompt: string; style: string; segmentsTotal: number }): Promise<void> {
  const { VideoJob } = await import("@workspace/db/schema");
  let tempDir: string | null = null;
  try {
    tempDir = await mkdtemp(join(tmpdir(), "maris-video-"));
    const segmentPaths: string[] = [];
    let lastFramePath: string | null = null;

    for (let i = 0; i < opts.segmentsTotal; i++) {
      const segmentDuration = i === 0 ? Math.min(10, KLING_SEGMENT_SECONDS) : KLING_SEGMENT_SECONDS;
      let taskData: any;
      if (i === 0) {
        taskData = await klingRequest("/v1/videos/text2video", {
          model_name: KLING_MODEL,
          prompt: `${opts.prompt}. Style: ${opts.style}, high quality, cinematic.`,
          duration: String(segmentDuration),
          mode: "std",
          aspect_ratio: "16:9",
        });
      } else {
        // Continuación desde el último frame del segmento anterior, para
        // dar sensación de escena continua en vez de cortes bruscos.
        const frameBuffer = await readFile(lastFramePath!);
        taskData = await klingRequest("/v1/videos/image2video", {
          model_name: KLING_MODEL,
          image: frameBuffer.toString("base64"),
          prompt: `${opts.prompt}. Continue the scene naturally. Style: ${opts.style}.`,
          duration: String(segmentDuration),
          mode: "std",
        });
      }

      const { videoUrl } = await pollKlingTask(taskData.task_id, i === 0 ? "/v1/videos/text2video" : "/v1/videos/image2video");
      const segResp = await fetch(videoUrl);
      const segBuffer = Buffer.from(await segResp.arrayBuffer());
      const segPath = join(tempDir, `segment_${i}.mp4`);
      await writeFile(segPath, segBuffer);
      segmentPaths.push(segPath);

      await VideoJob.findByIdAndUpdate(jobId, { $set: { segmentsDone: i + 1 } });

      if (i < opts.segmentsTotal - 1) {
        lastFramePath = join(tempDir, `frame_${i}.jpg`);
        await new Promise<void>((resolve, reject) => {
          ffmpeg(segPath)
            .screenshots({ timestamps: ["99%"], filename: `frame_${i}.jpg`, folder: tempDir! })
            .on("end", () => resolve())
            .on("error", (err) => reject(err));
        });
      }
    }

    // Unir todos los segmentos con el demuxer concat de ffmpeg.
    const concatListPath = join(tempDir, "concat.txt");
    await writeFile(concatListPath, segmentPaths.map((p) => `file '${p}'`).join("\n"));
    const joinedPath = join(tempDir, "joined.mp4");
    if (segmentPaths.length > 1) {
      await new Promise<void>((resolve, reject) => {
        ffmpeg()
          .input(concatListPath)
          .inputOptions(["-f concat", "-safe 0"])
          .outputOptions(["-c copy"])
          .save(joinedPath)
          .on("end", () => resolve())
          .on("error", (err) => reject(err));
      });
    }
    const preWatermarkPath = segmentPaths.length > 1 ? joinedPath : segmentPaths[0];

    // Marca de agua "Maris AI" -- esquina inferior derecha, semitransparente.
    const finalPath = join(tempDir, "final.mp4");
    await new Promise<void>((resolve, reject) => {
      ffmpeg(preWatermarkPath)
        .videoFilters([
          {
            filter: "drawtext",
            options: {
              text: "Maris AI",
              fontcolor: "white@0.75",
              fontsize: 28,
              box: 1,
              boxcolor: "black@0.35",
              boxborderw: 10,
              x: "w-tw-24",
              y: "h-th-24",
            },
          },
        ])
        .outputOptions(["-c:a copy"])
        .save(finalPath)
        .on("end", () => resolve())
        .on("error", (err) => reject(err));
    });

    const finalBuffer = await readFile(finalPath);
    await VideoJob.findByIdAndUpdate(jobId, {
      $set: { status: "succeeded", videoUrl: `data:video/mp4;base64,${finalBuffer.toString("base64")}` },
    });
    logger.info({ jobId, segments: opts.segmentsTotal }, "VideoJob (Kling AI) completado");
  } catch (error: any) {
    logger.error({ jobId, error: error?.message }, "VideoJob (Kling AI) falló");
    await VideoJob.findByIdAndUpdate(jobId, { $set: { status: "failed", errorMessage: error?.message } }).catch(() => {});
  } finally {
    if (tempDir) {
      try {
        const { rm } = await import("fs/promises");
        await rm(tempDir, { recursive: true, force: true });
      } catch { /* limpieza best-effort */ }
    }
  }
}

// ─── POST /api/video/generate ─────────────────────────────────────────────────
router.post("/video/generate", requireAuth, async (req: Request, res: Response) => {
  const { prompt, duration = 10, style = "cinematic" } = req.body;
  const userId = (req as any).userId as string;
  const isAdmin = !!(req as any).dbUser?.isAdmin;
  if (!prompt) return res.status(400).json({ error: "prompt es requerido" });

  const klingApiKey = process.env.KLING_API_KEY;
  if (!klingApiKey) {
    logger.warn("KLING_API_KEY no configurada — usando generación de frames con Gemini");
    return res.json({
      status: "processing",
      jobId: `gemini-frames-${Date.now()}`,
      message: "Generando storyboard de vídeo con IA (configura KLING_API_KEY para vídeo real)",
      estimatedTime: 30,
      fallbackFrames: true,
      prompt,
      duration,
    });
  }

  const { segmentsTotal, creditCost } = computeVideoCreditCost(Number(duration));

  try {
    const { chargeCredits } = await import("../lib/credits");
    const charge = await chargeCredits({
      userId,
      isAdmin,
      amount: creditCost,
      description: `Vídeo con IA (Kling): ${duration}s (${segmentsTotal} segmento${segmentsTotal > 1 ? "s" : ""})`,
    });
    if (!charge.ok) {
      return res.status(402).json({ error: `Créditos insuficientes. Este vídeo de ${duration}s cuesta ${creditCost} créditos.` });
    }

    const { VideoJob } = await import("@workspace/db/schema");
    const jobId = crypto.randomUUID();
    await VideoJob.create({
      _id: jobId,
      userId,
      prompt,
      style,
      requestedDurationSec: Number(duration),
      segmentsTotal,
      segmentsDone: 0,
      status: "processing",
      creditsCharged: creditCost,
    });

    // Fire-and-forget -- el polling del frontend sigue el progreso vía
    // GET /video/status/:jobId. No await aquí: un vídeo de 180s puede tardar
    // muchos minutos (18 segmentos encadenados) y esto es un solo request HTTP.
    processVideoJob(jobId, { prompt, style, segmentsTotal }).catch((err) =>
      logger.error({ err, jobId }, "processVideoJob: fallo no capturado"),
    );

    return res.json({
      status: "processing",
      jobId,
      estimatedTime: segmentsTotal * 90,
      segmentsTotal,
      creditsCharged: creditCost,
      message: `Generando vídeo de ${duration}s con Kling AI (${segmentsTotal} segmento${segmentsTotal > 1 ? "s encadenados" : ""})...`,
      prompt,
    });
  } catch (error: any) {
    logger.error({ error: error.message }, "Video AI: error");
    return res.status(500).json({ error: error.message });
  }
});

// ─── GET /api/video/status/:jobId ────────────────────────────────────────────
router.get("/video/status/:jobId", requireAuth, async (req: Request, res: Response) => {
  const jobId = String(req.params.jobId);

  // Fallback frame-based jobs
  if (jobId.startsWith("gemini-frames-")) {
    return res.json({ status: "completed", videoUrl: null, fallbackFrames: true });
  }

  try {
    const { VideoJob } = await import("@workspace/db/schema");
    const job = await VideoJob.findById(jobId).lean();
    if (job) {
      return res.json({
        status: job.status === "succeeded" ? "completed" : job.status === "failed" ? "error" : "processing",
        videoUrl: job.videoUrl || null,
        segmentsDone: job.segmentsDone,
        segmentsTotal: job.segmentsTotal,
        errorMessage: job.errorMessage,
        progress: Math.round((job.segmentsDone / job.segmentsTotal) * 100),
      });
    }
  } catch (err: any) {
    logger.error({ err: err.message, jobId }, "Error consultando VideoJob");
  }

  // Compatibilidad con jobs viejos de Luma que pudieran seguir en curso en
  // el momento del despliegue de este cambio.
  const lumaApiKey = process.env.LUMA_API_KEY;
  if (!lumaApiKey) return res.status(404).json({ error: "Job no encontrado" });

  try {
    const response = await fetch(`https://api.lumalabs.ai/dream-machine/v1/generations/${jobId}`, {
      headers: { "Authorization": `Bearer ${lumaApiKey}` },
    });
    const data = await response.json() as { state?: string; assets?: { video?: string; image?: string } };

    return res.json({
      status: data.state === "completed" ? "completed" : data.state === "failed" ? "error" : "processing",
      videoUrl: data.assets?.video || null,
      thumbnailUrl: data.assets?.image || null,
      progress: data.state === "completed" ? 100 : 50,
    });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

// ─── POST /api/video/music-video-from-photo ────────────────────────────────
// A peticion explicita del usuario: funcion tipo Pollo AI (foto -> videoclip
// musical), implementada como capacidad ADICIONAL de Maris AI, sin tocar
// nada del pipeline de generacion de apps/webs/juegos existente -- es una
// ruta y un flujo completamente aparte.
//
// USA VEO (Google), no Luma -- reutiliza la MISMA clave de Gemini que ya
// esta configurada para el Image Agent (GOOGLE_GENAI_API_KEY/GEMINI_API_KEY),
// sin necesidad de que el usuario de de alta ninguna cuenta ni clave nueva.
//
// LIMITE HONESTO DE ALCANCE (a diferencia de Pollo AI real): esto genera un
// video con el AUDIO PROPIO que Veo compone a partir de la descripcion del
// estilo/mood -- NO sincroniza la cancion REAL que el cliente suba. Hacerlo
// con la cancion real del cliente necesitaria un paso adicional de mezcla
// de audio/video (ffmpeg) que no esta construido todavia -- documentado
// como mejora futura, no prometido como ya hecho.
//
// COSTE REAL, NO SIMBOLICO: a diferencia del resto de generaciones de Maris
// AI (centimos de coste real), Veo cuesta desde ~0.24-0.40 EUR (Lite, 8s)
// hasta ~2-3 EUR (Quality, 8s) POR CADA GENERACION -- los precios en
// creditos de abajo son una PROPUESTA con margen, no un hecho consumado:
// revisalos y ajustalos segun tu propio margen antes de activarlo para
// clientes reales.
const VEO_TIERS: Record<string, { model: string; creditCost: number; label: string }> = {
  lite: { model: "veo-3.1-lite-generate-preview", creditCost: 20, label: "Básico (rápido, calidad estándar)" },
  fast: { model: "veo-3.1-fast-generate-preview", creditCost: 50, label: "Equilibrado (mejor calidad y velocidad)" },
  quality: { model: "veo-3.1-generate-preview", creditCost: 100, label: "Máxima calidad (cinematográfico)" },
};

router.post("/video/music-video-from-photo", requireAuth, async (req: Request, res: Response) => {
  const { photoBase64, mimeType, styleDescription, tier = "lite" } = req.body;
  const userId = (req as any).userId as string;
  const isAdmin = !!(req as any).dbUser?.isAdmin;

  if (!photoBase64 || !mimeType) {
    return res.status(400).json({ error: "photoBase64 y mimeType son obligatorios (la foto del cliente)." });
  }
  if (!styleDescription || String(styleDescription).trim().length < 5) {
    return res.status(400).json({ error: "Describe brevemente el estilo/mood del videoclip (ej. \"pop energético, luces de neón, baile\")." });
  }
  const selectedTier = VEO_TIERS[tier] ? tier : "lite";
  const { model, creditCost } = VEO_TIERS[selectedTier];

  try {
    const { chargeCredits } = await import("../lib/credits");
    const charge = await chargeCredits({
      userId,
      isAdmin,
      amount: creditCost,
      description: `Videoclip musical desde foto (Veo, calidad: ${selectedTier})`,
    });
    if (!charge.ok) {
      return res.status(402).json({ error: "Créditos insuficientes para este tipo de generación." });
    }

    const genai = getGenAI();
    const prompt =
      `Music video style clip. The person in the reference photo is the main subject, ` +
      `performing/featured in a ${styleDescription} music video. Cinematic camera movement, ` +
      `dynamic lighting matching the mood, native synchronized music and sound that fits: ${styleDescription}.`;

    logger.info({ userId, tier: selectedTier, model }, "Veo: generando videoclip musical desde foto");

    let operation = await (genai as any).models.generateVideos({
      model,
      prompt,
      image: { imageBytes: photoBase64, mimeType },
    });

    // Veo es asíncrono -- hay que hacer polling hasta que la operación termine.
    // Timeout defensivo: nunca esperar indefinidamente si algo se cuelga.
    const POLL_INTERVAL_MS = 5000;
    const MAX_WAIT_MS = 5 * 60_000;
    const deadline = Date.now() + MAX_WAIT_MS;
    while (!operation.done) {
      if (Date.now() > deadline) {
        logger.error({ userId }, "Veo: timeout esperando la generación del videoclip");
        return res.status(504).json({ error: "La generación del videoclip está tardando demasiado. Si deseas solicitar una compensación, abre un ticket de soporte para revisión manual." });
      }
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
      operation = await (genai as any).operations.getVideosOperation({ operation });
    }

    const generatedVideo = operation.response?.generatedVideos?.[0];
    if (!generatedVideo?.video?.uri) {
      logger.error({ userId, operation }, "Veo: la operación terminó sin devolver ningún vídeo");
      return res.status(502).json({ error: "No se pudo generar el videoclip. Si deseas solicitar una compensación, abre un ticket de soporte para revisión manual." });
    }

    // IMPORTANTE (encontrado revisando la documentacion oficial antes de dar
    // esto por terminado): la URI que devuelve Veo requiere la clave de API
    // pegada como query param para poder descargarse -- NUNCA se debe
    // devolver esa URI tal cual al cliente, expondria la clave server-side
    // en el propio navegador. Se descarga aqui, en el servidor, y se
    // devuelve el vídeo ya como base64 -- mismo patron que ya usa este
    // archivo para las imagenes de /api/imagen/generate.
    //
    // LIMITE CONOCIDO, no resuelto en esta primera version: para vídeos
    // largos/alta calidad esto puede pesar varios MB en la respuesta JSON.
    // Para producción con volumen real, lo correcto sería subir el vídeo a
    // almacenamiento propio (blob storage) y devolver una URL corta, no
    // embeber el archivo entero -- documentado como mejora futura.
    const apiKey = process.env.ZOCOIA_API_KEY || ""; // CONEXIÓN EXCLUSIVA A ZOCO IA
    const downloadUrl = `${generatedVideo.video.uri}${generatedVideo.video.uri.includes("?") ? "&" : "?"}key=${apiKey}`;
    const videoResp = await fetch(downloadUrl);
    if (!videoResp.ok) {
      logger.error({ userId, status: videoResp.status }, "Veo: no se pudo descargar el vídeo generado desde Google");
      return res.status(502).json({ error: "El vídeo se generó pero no se pudo descargar. Si deseas solicitar una compensación, abre un ticket de soporte para revisión manual." });
    }
    const videoBuffer = Buffer.from(await videoResp.arrayBuffer());
    const videoBase64 = videoBuffer.toString("base64");

    logger.info({ userId, tier: selectedTier, sizeKB: Math.round(videoBuffer.length / 1024) }, "Veo: videoclip musical generado y descargado correctamente");
    return res.json({
      ok: true,
      videoUrl: `data:video/mp4;base64,${videoBase64}`,
      tier: selectedTier,
      creditsCharged: creditCost,
      note: "Este vídeo incluye música/sonido generado por IA a partir de la descripción — no es tu canción real subida. Sincronizar tu propia canción es una mejora pendiente.",
    });
  } catch (error: any) {
    logger.error({ error: error?.message, userId }, "Veo: error generando videoclip musical");
    return res.status(500).json({ error: "Error generando el videoclip. Si deseas solicitar una compensación, abre un ticket de soporte para revisión manual.", details: error?.message });
  }
});

// ─── POST /api/video/music-video-with-real-song ────────────────────────────
// Segunda parte de la funcion "tipo Pollo AI", completando el hueco que se
// dejo documentado en el endpoint anterior: aqui SI se usa la cancion REAL
// que el cliente sube, no el audio que compone Veo por su cuenta.
//
// FLUJO:
//   1. Veo genera el VIDEO a partir de la foto (igual que el endpoint
//      anterior) -- se descarta su audio propio.
//   2. ffmpeg recorta la cancion real del cliente a la duracion del video.
//   3. ffmpeg mezcla el video (sin audio) + la cancion recortada (como
//      unico audio) en un archivo final.
//
// LIMITE HONESTO: Veo genera clips de 8 segundos por llamada -- esta
// primera version sincroniza los primeros 8 segundos de la cancion real
// del cliente con un clip de 8 segundos, no un videoclip completo de
// duracion real (2-4 minutos). Encadenar varias generaciones de Veo para
// cubrir la cancion entera es tecnicamente posible (Veo soporta extension
// de escena) pero es una ampliacion aparte, no construida aqui -- cada
// 8 segundos adicionales vuelve a costar lo mismo en la API de Veo.
router.post(
  "/video/music-video-with-real-song",
  requireAuth,
  uploadMedia.fields([{ name: "photo", maxCount: 1 }, { name: "song", maxCount: 1 }]),
  async (req: Request, res: Response) => {
    const files = req.files as { [field: string]: Express.Multer.File[] } | undefined;
    const photoFile = files?.photo?.[0];
    const songFile = files?.song?.[0];
    const { styleDescription, tier = "lite" } = req.body;
    const userId = (req as any).userId as string;
    const isAdmin = !!(req as any).dbUser?.isAdmin;

    if (!photoFile) return res.status(400).json({ error: "Falta la foto (campo 'photo')." });
    if (!songFile) return res.status(400).json({ error: "Falta la canción real (campo 'song')." });
    if (!styleDescription || String(styleDescription).trim().length < 5) {
      return res.status(400).json({ error: "Describe brevemente el estilo/mood del videoclip." });
    }

    const selectedTier = VEO_TIERS[tier] ? tier : "lite";
    const { model, creditCost: baseCost } = VEO_TIERS[selectedTier];
    // +10 créditos extra sobre el coste base -- cubre el procesado de ffmpeg
    // (CPU/tiempo real del servidor, no solo la llamada a Veo). Propuesta,
    // igual que el resto de precios de esta función — ajustar según margen.
    const creditCost = baseCost + 10;

    let tempDir: string | null = null;

    try {
      const { chargeCredits } = await import("../lib/credits");
      const charge = await chargeCredits({
        userId,
        isAdmin,
        amount: creditCost,
        description: `Videoclip musical con canción real (Veo + ffmpeg, calidad: ${selectedTier})`,
      });
      if (!charge.ok) {
        return res.status(402).json({ error: "Créditos insuficientes para este tipo de generación." });
      }

      const genai = getGenAI();
      const prompt =
        `Music video style clip. The person in the reference photo is the main subject, ` +
        `performing/featured in a ${styleDescription} music video. Cinematic camera movement, ` +
        `dynamic lighting matching the mood: ${styleDescription}.`;

      logger.info({ userId, tier: selectedTier }, "Veo: generando vídeo (sin audio propio) para mezclar con canción real");

      let operation = await (genai as any).models.generateVideos({
        model,
        prompt,
        image: { imageBytes: photoFile.buffer.toString("base64"), mimeType: photoFile.mimetype },
      });

      const POLL_INTERVAL_MS = 5000;
      const MAX_WAIT_MS = 5 * 60_000;
      const deadline = Date.now() + MAX_WAIT_MS;
      while (!operation.done) {
        if (Date.now() > deadline) {
          return res.status(504).json({ error: "La generación está tardando demasiado. Si deseas solicitar una compensación, abre un ticket de soporte para revisión manual." });
        }
        await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
        operation = await (genai as any).operations.getVideosOperation({ operation });
      }

      const generatedVideo = operation.response?.generatedVideos?.[0];
      if (!generatedVideo?.video?.uri) {
        return res.status(502).json({ error: "No se pudo generar el vídeo base. Si deseas solicitar una compensación, abre un ticket de soporte para revisión manual." });
      }

      const apiKey = process.env.ZOCOIA_API_KEY || ""; // CONEXIÓN EXCLUSIVA A ZOCO IA
      const downloadUrl = `${generatedVideo.video.uri}${generatedVideo.video.uri.includes("?") ? "&" : "?"}key=${apiKey}`;
      const videoResp = await fetch(downloadUrl);
      if (!videoResp.ok) {
        return res.status(502).json({ error: "El vídeo se generó pero no se pudo descargar. Si deseas solicitar una compensación, abre un ticket de soporte para revisión manual." });
      }
      const videoBuffer = Buffer.from(await videoResp.arrayBuffer());

      // Archivos temporales para el procesado de ffmpeg -- limpiados SIEMPRE
      // en el finally, generación exitosa o no.
      tempDir = await mkdtemp(join(tmpdir(), "maris-mv-"));
      const rawVideoPath = join(tempDir, "raw.mp4");
      const songPath = join(tempDir, `song.${songFile.originalname.split(".").pop() || "mp3"}`);
      const finalPath = join(tempDir, "final.mp4");

      await writeFile(rawVideoPath, videoBuffer);
      await writeFile(songPath, songFile.buffer);

      // Duración real del vídeo generado por Veo, para recortar la canción
      // a esa misma duración exacta (nunca al revés — el vídeo manda).
      const videoDurationSec: number = await new Promise((resolve, reject) => {
        ffmpeg.ffprobe(rawVideoPath, (err, data) => {
          if (err) return reject(err);
          resolve(data.format.duration ?? 8);
        });
      });

      logger.info({ userId, videoDurationSec }, "ffmpeg: mezclando vídeo de Veo con la canción real del cliente");

      await new Promise<void>((resolve, reject) => {
        ffmpeg()
          .input(rawVideoPath)
          .input(songPath)
          .outputOptions([
            "-map 0:v:0", // vídeo: solo la pista de vídeo del clip de Veo
            "-map 1:a:0", // audio: solo la pista de audio de la canción real
            "-c:v copy", // no recodificar el vídeo — más rápido, sin pérdida
            "-c:a aac",
            "-shortest", // cortar al más corto de los dos (el vídeo, normalmente)
          ])
          .duration(videoDurationSec)
          .save(finalPath)
          .on("end", () => resolve())
          .on("error", (err) => reject(err));
      });

      const finalBuffer = await readFile(finalPath);
      const finalBase64 = finalBuffer.toString("base64");

      logger.info({ userId, sizeKB: Math.round(finalBuffer.length / 1024) }, "Videoclip con canción real generado correctamente");
      return res.json({
        ok: true,
        videoUrl: `data:video/mp4;base64,${finalBase64}`,
        tier: selectedTier,
        creditsCharged: creditCost,
        durationSeconds: videoDurationSec,
        note: `Clip de ${Math.round(videoDurationSec)}s sincronizado con los primeros segundos de tu canción real — no es el videoclip completo de la canción entera (eso necesitaría encadenar varias generaciones de Veo, con su coste correspondiente).`,
      });
    } catch (error: any) {
      logger.error({ error: error?.message, userId }, "Error generando videoclip con canción real");
      return res.status(500).json({ error: "Error generando el videoclip. Si deseas solicitar una compensación, abre un ticket de soporte para revisión manual.", details: error?.message });
    } finally {
      // Limpieza de archivos temporales — siempre, haya ido bien o mal.
      if (tempDir) {
        await Promise.all(
          ["raw.mp4", `song.${songFile?.originalname.split(".").pop() || "mp3"}`, "final.mp4"].map((f) =>
            unlink(join(tempDir!, f)).catch(() => {}),
          ),
        );
      }
    }
  },
);

export default router;
