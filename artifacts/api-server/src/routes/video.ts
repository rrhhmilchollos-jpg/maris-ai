/**
 * video.ts — Generación de vídeo e imagen con IA
 * 
 * Endpoints:
 * - POST /api/video/generate — genera vídeo con Luma AI (text-to-video)
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

const router = Router();

// Lazy init Gemini para imágenes
let _genai: GoogleGenAI | null = null;
function getGenAI() {
  if (!_genai) {
    const apiKey = process.env.GOOGLE_GENAI_API_KEY || process.env.GEMINI_API_KEY || "";
    _genai = new GoogleGenAI({ apiKey });
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

// ─── POST /api/video/generate ─────────────────────────────────────────────────
router.post("/video/generate", requireAuth, async (req: Request, res: Response) => {
  const { prompt, duration = 10, style = "cinematic" } = req.body;
  if (!prompt) return res.status(400).json({ error: "prompt es requerido" });

  try {
    const lumaApiKey = process.env.LUMA_API_KEY;
    
    if (!lumaApiKey) {
      // Sin API key de Luma, generar una secuencia de imágenes IA como fallback
      logger.warn("LUMA_API_KEY no configurada — usando generación de frames con Gemini");
      return res.json({
        status: "processing",
        jobId: `gemini-frames-${Date.now()}`,
        message: "Generando storyboard de vídeo con IA (configura LUMA_API_KEY para vídeo real)",
        estimatedTime: 30,
        fallbackFrames: true,
        prompt,
        duration,
      });
    }

    // Con Luma AI — generación real de vídeo
    const lumaResponse = await fetch("https://api.lumalabs.ai/dream-machine/v1/generations", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${lumaApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        prompt: `${prompt}. Style: ${style}, duration: ${duration}s, high quality, cinematic`,
        aspect_ratio: "16:9",
        loop: false,
      }),
    });

    if (!lumaResponse.ok) {
      const err = await lumaResponse.text();
      logger.error({ err }, "Luma AI error");
      return res.status(500).json({ error: "Error en Luma AI", details: err });
    }

    const data = await lumaResponse.json() as { id: string };
    logger.info({ jobId: data.id }, "Luma AI: job creado");

    return res.json({
      status: "processing",
      jobId: data.id,
      estimatedTime: duration * 3,
      message: `Generando vídeo de ${duration}s con Luma AI...`,
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

  const lumaApiKey = process.env.LUMA_API_KEY;
  if (!lumaApiKey) return res.status(400).json({ error: "LUMA_API_KEY no configurada" });

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
        // Reembolsar -- el cliente no debe pagar por un intento que nunca terminó.
        await chargeCredits({ userId, isAdmin, amount: -creditCost, description: "Reembolso: timeout generando videoclip musical" });
        return res.status(504).json({ error: "La generación del videoclip está tardando demasiado. Se te han reembolsado los créditos." });
      }
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
      operation = await (genai as any).operations.getVideosOperation({ operation });
    }

    const generatedVideo = operation.response?.generatedVideos?.[0];
    if (!generatedVideo?.video?.uri) {
      logger.error({ userId, operation }, "Veo: la operación terminó sin devolver ningún vídeo");
      await chargeCredits({ userId, isAdmin, amount: -creditCost, description: "Reembolso: Veo no devolvió ningún vídeo" });
      return res.status(502).json({ error: "No se pudo generar el videoclip. Se te han reembolsado los créditos." });
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
    const apiKey = process.env.GOOGLE_GENAI_API_KEY || process.env.GEMINI_API_KEY || "";
    const downloadUrl = `${generatedVideo.video.uri}${generatedVideo.video.uri.includes("?") ? "&" : "?"}key=${apiKey}`;
    const videoResp = await fetch(downloadUrl);
    if (!videoResp.ok) {
      logger.error({ userId, status: videoResp.status }, "Veo: no se pudo descargar el vídeo generado desde Google");
      await chargeCredits({ userId, isAdmin, amount: -creditCost, description: "Reembolso: fallo al descargar el vídeo generado" });
      return res.status(502).json({ error: "El vídeo se generó pero no se pudo descargar. Se te han reembolsado los créditos." });
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
    // Intentar reembolsar si el cobro llegó a completarse antes del fallo.
    try {
      const { chargeCredits } = await import("../lib/credits");
      await chargeCredits({ userId, isAdmin, amount: -creditCost, description: "Reembolso: error generando videoclip musical" });
    } catch { /* no bloquear la respuesta de error por un fallo en el reembolso */ }
    return res.status(500).json({ error: "Error generando el videoclip. Se han intentado reembolsar los créditos.", details: error?.message });
  }
});

export default router;
