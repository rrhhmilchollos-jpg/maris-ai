import { GoogleGenAI } from "@google/genai";

// Lazy initialization: do NOT throw at import time.
// The error is deferred until the client is actually used so the server
// can start even when GEMINI_API_KEY is not configured.
let _ai: GoogleGenAI | null = null;

function getAI(): GoogleGenAI {
  if (_ai) return _ai;

  // UNIFICADO a petición del usuario: antes video.ts, imageAgent.ts y este
  // cliente compartido buscaban la clave con 3 nombres de variable
  // distintos y en distinto orden -- si en Railway solo estaba puesta UNA
  // de las tres, unas funciones de Gemini trabajaban y otras no, segun
  // cual coincidiera. Ahora los 3 sitios usan exactamente el mismo orden.
  const apiKey =
    process.env.AI_INTEGRATIONS_GEMINI_API_KEY ||
    process.env.GOOGLE_GENAI_API_KEY ||
    process.env.GEMINI_API_KEY;
  const baseUrl = process.env.AI_INTEGRATIONS_GEMINI_BASE_URL;

  if (!apiKey) {
    throw new Error(
      "Falta configurar la clave de Gemini. Pon AI_INTEGRATIONS_GEMINI_API_KEY (o GOOGLE_GENAI_API_KEY / GEMINI_API_KEY) en las variables de entorno de Railway.",
    );
  }

  const opts: ConstructorParameters<typeof GoogleGenAI>[0] = { apiKey };
  if (baseUrl) {
    opts.httpOptions = { apiVersion: "", baseUrl };
  }

  _ai = new GoogleGenAI(opts);
  return _ai;
}

// Export a Proxy so existing callers can use `ai.models.generateContent(…)`
// without any changes — the real client is only instantiated on first access.
export const ai = new Proxy({} as GoogleGenAI, {
  get(_target, prop) {
    return (getAI() as any)[prop];
  },
});
