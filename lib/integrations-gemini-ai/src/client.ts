import { GoogleGenAI } from "@google/genai";

// CONEXIÓN EXCLUSIVA A ZOCO IA — este cliente ya NO se conecta a la API
// nativa de Google Gemini. Cualquier función visual/multimodal debe pasar
// por el gateway de Zoco IA:
//   ZOCOIA_GEMINI_GATEWAY_URL — endpoint del gateway multimodal de Zoco IA
//   ZOCOIA_API_KEY            — API Key de la organización (sk-zoco-...)
// Si el gateway no está configurado, la llamada falla con un error claro en
// vez de fugarse a generativelanguage.googleapis.com.
// Lazy initialization: do NOT throw at import time.
let _ai: GoogleGenAI | null = null;

function getAI(): GoogleGenAI {
  if (_ai) return _ai;

  const apiKey = process.env.ZOCOIA_API_KEY;
  const baseUrl = process.env.ZOCOIA_GEMINI_GATEWAY_URL;

  if (!apiKey || !apiKey.startsWith("sk-zoco-")) {
    throw new Error(
      "Conexión multimodal no configurada: define ZOCOIA_API_KEY (sk-zoco-...) en Railway. " +
        "Las claves nativas de Gemini ya no se aceptan: todo el tráfico viaja por Zoco IA.",
    );
  }
  if (!baseUrl) {
    throw new Error(
      "Falta ZOCOIA_GEMINI_GATEWAY_URL: el canal multimodal de Maris AI solo funciona a través del gateway de Zoco IA (sin fallback a la API nativa de Google).",
    );
  }

  _ai = new GoogleGenAI({ apiKey, httpOptions: { apiVersion: "", baseUrl } });
  return _ai;
}

// Export a Proxy so existing callers can use `ai.models.generateContent(…)`
// without any changes — the real client is only instantiated on first access.
export const ai = new Proxy({} as GoogleGenAI, {
  get(_target, prop) {
    return (getAI() as any)[prop];
  },
});
