import Anthropic from "@anthropic-ai/sdk";

// ─────────────────────────────────────────────────────────────────────────
// CONEXIÓN NATIVA A CLAUDE (ANTHROPIC)
//
// Este cliente se conecta directamente a la API oficial de Anthropic
// (https://api.anthropic.com). Todo el pipeline multi-agente de Maris AI
// (Researcher, Architect, Designer, Frontend, Backend, QA, Patcher,
// Repair...) usa los modelos Claude de forma nativa.
//
// Variables de entorno (Coolify / Render / Vercel):
//   ANTHROPIC_API_KEY      — API Key de Anthropic (sk-ant-...)   [OBLIGATORIA]
//   ANTHROPIC_BASE_URL     — opcional, por defecto https://api.anthropic.com
//   ANTHROPIC_MODEL_FAST     — opcional, por defecto claude-haiku-4-5
//   ANTHROPIC_MODEL_STANDARD — opcional, por defecto claude-sonnet-4-5
//   ANTHROPIC_MODEL_MAX      — opcional, por defecto claude-opus-4-5
//
// Compatibilidad: los alias internos de modelo (zoco-flash, zoco-plus,
// zoco-max y variantes maris-*) se siguen aceptando en todo el código y se
// traducen automáticamente al modelo Claude correspondiente mediante
// resolveClaudeModel(), de modo que ningún consumidor necesita cambios.
// ─────────────────────────────────────────────────────────────────────────

let _client: Anthropic | null = null;

/** Modelos Claude por nivel de capacidad (sobreescribibles por entorno). */
export const CLAUDE_MODELS = {
  fast: process.env.ANTHROPIC_MODEL_FAST || "claude-haiku-4-5",
  standard: process.env.ANTHROPIC_MODEL_STANDARD || "claude-sonnet-4-5",
  max: process.env.ANTHROPIC_MODEL_MAX || "claude-opus-4-5",
} as const;

/**
 * Traduce cualquier alias interno (zoco-*, maris-*, nombres antiguos de
 * Ollama, etc.) al ID de modelo Claude real. Si ya recibe un ID de Claude
 * (claude-*), lo devuelve tal cual.
 */
export function resolveClaudeModel(model?: string | null): string {
  const m = (model || "").toLowerCase().trim();
  if (m.startsWith("claude-")) return model as string;

  // Nivel rápido / económico
  if (
    m.includes("flash") ||
    m.includes("haiku") ||
    m.includes("mini") ||
    m.includes("qwen") ||
    m.includes("llama3") ||
    m.includes("gemma") ||
    m.includes("phi")
  ) {
    return CLAUDE_MODELS.fast;
  }

  // Nivel máximo
  if (
    m.includes("max") ||
    m.includes("opus") ||
    m.includes("deepseek-r1") ||
    m.includes("r1:") ||
    m.includes("70b") ||
    m.includes("405b")
  ) {
    return CLAUDE_MODELS.max;
  }

  // Nivel estándar (zoco-plus, sonnet, deepseek-v3, mixtral, …) y default
  return CLAUDE_MODELS.standard;
}

function getClient(): Anthropic {
  if (_client) return _client;

  const apiKey =
    process.env.ANTHROPIC_API_KEY ||
    process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY; // alias de compatibilidad

  const rawBaseUrl =
    process.env.ANTHROPIC_BASE_URL ||
    process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL || // alias de compatibilidad
    "https://api.anthropic.com";

  if (!apiKey) {
    throw new Error(
      "Falta la API Key de Anthropic. Configura ANTHROPIC_API_KEY (sk-ant-...) en las variables de entorno. " +
        "Puedes generarla en https://console.anthropic.com/settings/keys",
    );
  }

  // Normaliza la baseURL sin barra final (el SDK añade /v1/messages).
  const baseURL = rawBaseUrl.replace(/\/+$/, "");

  _client = new Anthropic({ apiKey, baseURL });
  return _client;
}

// Export a Proxy so existing callers can use `anthropic.messages.create(…)`
// without any changes — the real client is only instantiated on first access.
export const anthropic = new Proxy({} as Anthropic, {
  get(_target, prop) {
    return (getClient() as any)[prop];
  },
});
