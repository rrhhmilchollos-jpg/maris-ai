import OpenAI from "openai";

let cachedClient: OpenAI | null = null;

/**
 * Lazy OpenAI client. Throwing at module-import time would crash the whole
 * server boot if env vars happened to be missing — instead, fail only at the
 * first call site that actually needs it (and let the caller handle it).
 */
export function getOpenAI(): OpenAI {
  if (cachedClient) return cachedClient;
  const baseURL = process.env.AI_INTEGRATIONS_OPENAI_BASE_URL;
  const apiKey = process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
  if (!baseURL || !apiKey) {
    throw new Error(
      "OpenAI proxy env vars missing (AI_INTEGRATIONS_OPENAI_BASE_URL / AI_INTEGRATIONS_OPENAI_API_KEY).",
    );
  }
  cachedClient = new OpenAI({ baseURL, apiKey });
  return cachedClient;
}
