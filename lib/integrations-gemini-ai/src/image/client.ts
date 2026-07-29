import { anthropic as zocoia } from "@workspace/integrations-anthropic-ai";
import { GoogleGenAI, Modality } from "@google/genai";

// CONEXIÓN EXCLUSIVA A ZOCO IA — el canal de imagen ya no usa claves nativas
// de Gemini: viaja por el gateway multimodal de Zoco IA (ZOCOIA_GEMINI_GATEWAY_URL)
// firmado con la API Key de la organización (ZOCOIA_API_KEY, sk-zoco-...).
// Lazy + Proxy: antes este módulo lanzaba el error EN EL IMPORT (rompía el
// arranque del servidor entero); ahora el error salta solo al primer uso real.
let _ai: GoogleGenAI | null = null;
function getAI(): GoogleGenAI {
  if (_ai) return _ai;
  const apiKey = process.env.ZOCOIA_API_KEY;
  const baseUrl = process.env.ZOCOIA_GEMINI_GATEWAY_URL;
  if (!apiKey || !apiKey.startsWith("sk-zoco-") || !baseUrl) {
    throw new Error(
      "Canal de imagen no configurado: define ZOCOIA_API_KEY (sk-zoco-...) y ZOCOIA_GEMINI_GATEWAY_URL. " +
        "Las claves nativas de Gemini ya no se aceptan: todo el tráfico viaja por zocoia.",
    );
  }
  _ai = new GoogleGenAI({ apiKey, httpOptions: { apiVersion: "", baseUrl } });
  return _ai;
}

export const ai = new Proxy({} as GoogleGenAI, {
  get(_target, prop) {
    return (getAI() as any)[prop];
  },
});

export async function generateImage(
  prompt: string
): Promise<{ b64_json: string; mimeType: string }> {
  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash-image",
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    config: {
      responseModalities: [Modality.TEXT, Modality.IMAGE],
    },
  });

  const candidate = response.candidates?.[0];
  const imagePart = candidate?.content?.parts?.find(
    (part: { inlineData?: { data?: string; mimeType?: string } }) => part.inlineData
  );

  if (!imagePart?.inlineData?.data) {
    throw new Error("No image data in response");
  }

  return {
    b64_json: imagePart.inlineData.data,
    mimeType: imagePart.inlineData.mimeType || "image/png",
  };
}
