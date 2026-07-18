import Anthropic from "@anthropic-ai/sdk";

// ─────────────────────────────────────────────────────────────────────────
// CONEXIÓN EXCLUSIVA A ZOCO IA
//
// Este cliente ya NO se conecta a la API nativa de Anthropic. Todo el
// pipeline multi-agente de Maris AI (Researcher, Architect, Designer,
// Frontend, Backend, QA, Patcher, Repair...) viaja por el endpoint de
// Zoco IA, autenticado y firmado con la API Key de la organización
// (sk-zoco-...), que se gestiona desde el "Almacén de credenciales" del
// Dashboard de Zoco IA.
//
// Variables de entorno (Railway):
//   ZOCOIA_API_URL — base URL del backend de Zoco IA (ej: https://zocoia.es)
//   ZOCOIA_API_KEY — API Key de Zoco IA (sk-zoco-...)
//
// Compatibilidad: el backend de Zoco IA expone POST /v1/messages con el
// formato Messages API, por lo que el SDK de Anthropic funciona sin cambios
// en los consumidores — solo cambia el destino y la credencial.
//
// Los nombres antiguos (AI_INTEGRATIONS_ANTHROPIC_*) se aceptan como alias
// de compatibilidad, pero NO existe ningún fallback automático hacia
// api.anthropic.com: si falta la configuración de Zoco IA, la llamada falla
// con un error claro en vez de fugarse a un proveedor externo.
// ─────────────────────────────────────────────────────────────────────────

let _client: Anthropic | null = null;

function getClient(): Anthropic {
  if (_client) return _client;

  const apiKey =
    process.env.ZOCOIA_API_KEY ||
    process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY; // alias de compatibilidad

  const rawBaseUrl =
    process.env.ZOCOIA_API_URL ||
    process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL; // alias de compatibilidad

  if (!apiKey) {
    throw new Error(
      "Falta la API Key de Zoco IA. Configura ZOCOIA_API_KEY (sk-zoco-...) en las variables de entorno. " +
        "Puedes generarla en el Dashboard de Zoco IA → API Keys y validarla en el Almacén de credenciales.",
    );
  }
  if (!apiKey.startsWith("sk-zoco-")) {
    throw new Error(
      "ZOCOIA_API_KEY no es una clave de Zoco IA válida (debe empezar por sk-zoco-). " +
        "Las claves nativas de Anthropic/OpenAI/Gemini ya no se aceptan: todo el tráfico viaja por Zoco IA.",
    );
  }
  if (!rawBaseUrl) {
    throw new Error(
      "Falta ZOCOIA_API_URL. Configura la URL base del backend de Zoco IA (ej: https://tu-servicio.up.railway.app).",
    );
  }

  // El SDK añade /v1/messages a la baseURL; se normaliza sin barra final.
  const baseURL = rawBaseUrl.replace(/\/+$/, "");

  _client = new Anthropic({
    apiKey,
    baseURL,
    // La autenticación de Zoco IA es Bearer <sk-zoco-...>; el SDK de
    // Anthropic manda la key en el header x-api-key por defecto, así que
    // se añade también Authorization para el authMiddleware de Zoco IA.
    defaultHeaders: { Authorization: `Bearer ${apiKey}` },
  });
  return _client;
}

// Export a Proxy so existing callers can use `anthropic.messages.create(…)`
// without any changes — the real client is only instantiated on first access.
export const anthropic = new Proxy({} as Anthropic, {
  get(_target, prop) {
    return (getClient() as any)[prop];
  },
});
