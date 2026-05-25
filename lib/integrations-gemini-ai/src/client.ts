import { GoogleGenAI } from "@google/genai";

// Lazy initialization: do NOT throw at import time.
// The error is deferred until the client is actually used so the server
// can start even when GEMINI_API_KEY is not configured.
let _ai: GoogleGenAI | null = null;

function getAI(): GoogleGenAI {
  if (_ai) return _ai;

  const apiKey =
    process.env.AI_INTEGRATIONS_GEMINI_API_KEY ||
    process.env.GEMINI_API_KEY;
  const baseUrl = process.env.AI_INTEGRATIONS_GEMINI_BASE_URL;

  if (!apiKey) {
    throw new Error(
      "AI_INTEGRATIONS_GEMINI_API_KEY must be set. Did you forget to provision the Gemini AI integration?",
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
