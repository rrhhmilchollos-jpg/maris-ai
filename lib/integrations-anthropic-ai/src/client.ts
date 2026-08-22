// Cliente histórico compatible con la interfaz messages de Anthropic.
// Maris AI usa ahora un motor Ollama PROPIO configurado por MARIS_LLM_URL.
// La antigua pasarela de Zoco solo puede activarse de forma explícita para una
// migración controlada; nunca es el valor por defecto.

export type LocalMessageParams = {
  model?: string;
  max_tokens?: number;
  temperature?: number;
  system?: string | Array<{ type?: string; text?: string }>;
  messages: Array<Record<string, unknown>>;
  metadata?: Record<string, unknown>;
  tools?: unknown[];
  tool_choice?: unknown;
  stream?: boolean;
};

type LocalMessageResponse = {
  id?: string;
  type?: string;
  role?: string;
  model?: string;
  content: Array<{ type: string; text?: string; [key: string]: unknown }>;
  stop_reason?: string | null;
  stop_sequence?: string | null;
  usage?: { input_tokens?: number; output_tokens?: number; [key: string]: unknown };
};

type LlmConfig = { baseUrl: string; apiKey: string; mode: "maris" | "legacy" };
const LOCAL_REQUEST_TIMEOUT_MS = Number(process.env.MARIS_LLM_REQUEST_TIMEOUT_MS || 70_000);
const LOCAL_MAX_COMPLETION_TOKENS = Number(process.env.MARIS_LLM_MAX_COMPLETION_TOKENS || 512);

const MARIS_MODELS = {
  fast: process.env.MARIS_LLM_MODEL_FAST || process.env.MARIS_LLM_MODEL || "qwen2.5-coder:1.5b",
  standard: process.env.MARIS_LLM_MODEL_STANDARD || process.env.MARIS_LLM_MODEL || "qwen2.5-coder:1.5b",
  max: process.env.MARIS_LLM_MODEL_MAX || process.env.MARIS_LLM_MODEL || "qwen2.5-coder:1.5b",
} as const;

// Export histórico para los consumidores existentes del monorepo.
export const CLAUDE_MODELS = MARIS_MODELS;

export function resolveClaudeModel(model?: string | null): string {
  const requested = String(model || "maris-standard").trim();
  const lower = requested.toLowerCase();
  if (requested.includes(":") || requested.includes("/")) return requested;
  if (lower.includes("flash") || lower.includes("haiku") || lower.includes("mini")) return MARIS_MODELS.fast;
  if (lower.includes("max") || lower.includes("opus") || lower.includes("70b") || lower.includes("405b")) return MARIS_MODELS.max;
  return MARIS_MODELS.standard;
}

function normalizeContent(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    const text = value
      .filter((block) => block && typeof block === "object" && (block as any).type === "text")
      .map((block) => String((block as any).text || ""))
      .join("\n");
    return text || JSON.stringify(value);
  }
  return value == null ? "" : JSON.stringify(value);
}

function getConfig(): LlmConfig {
  const ownUrl = String(process.env.MARIS_LLM_URL || "").trim();
  if (ownUrl) {
    return {
      baseUrl: ownUrl.replace(/\/+$/, ""),
      apiKey: String(process.env.MARIS_LLM_API_KEY || "").trim(),
      mode: "maris",
    };
  }

  // Migración excepcional, expresamente opt-in. Así Maris no vuelve a
  // depender silenciosamente de Zoco ni de sus límites de inferencia.
  if (process.env.MARIS_ALLOW_LEGACY_ZOCO_FALLBACK === "true") {
    const apiKey = process.env.ZOCOIA_API_KEY || process.env.LOCAL_LLM_API_KEY || "";
    const baseUrl = process.env.ZOCOIA_API_URL || process.env.LOCAL_LLM_BASE_URL || "";
    if (apiKey && baseUrl) return { baseUrl: baseUrl.replace(/\/+$/, ""), apiKey, mode: "legacy" };
  }

  throw new Error("El motor propio de Maris AI no está configurado. Define MARIS_LLM_URL y MARIS_LLM_MODEL.");
}

function normalizeLegacyParams(params: LocalMessageParams): Record<string, unknown> {
  const normalizedMessages = (params.messages || []).map((message) => ({ ...message, content: normalizeContent(message.content) }));
  const system = params.system == null ? undefined : normalizeContent(params.system);
  return {
    model: resolveClaudeModel(params.model),
    max_tokens: params.max_tokens || 4096,
    ...(params.temperature == null ? {} : { temperature: params.temperature }),
    ...(system ? { system } : {}),
    messages: normalizedMessages,
    stream: false,
  };
}

function normalizeMarisMessages(params: LocalMessageParams) {
  const messages: Array<{ role: string; content: string }> = [];
  const system = params.system == null ? "" : normalizeContent(params.system);
  if (system) messages.push({ role: "system", content: system });
  for (const message of params.messages || []) {
    messages.push({ role: String(message.role || "user"), content: normalizeContent(message.content) });
  }
  return messages;
}

function boundedLocalMaxTokens(requested?: number): number {
  const intended = Number.isFinite(requested) && Number(requested) > 0 ? Number(requested) : LOCAL_MAX_COMPLETION_TOKENS;
  return Math.max(128, Math.min(intended, LOCAL_MAX_COMPLETION_TOKENS));
}

async function requestLocalModel(params: LocalMessageParams, signal?: AbortSignal): Promise<LocalMessageResponse> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), LOCAL_REQUEST_TIMEOUT_MS);
  const abortFromParent = () => controller.abort();
  signal?.addEventListener("abort", abortFromParent, { once: true });
  try {
    const config = getConfig();
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (config.apiKey) headers.Authorization = `Bearer ${config.apiKey}`;

    if (config.mode === "maris") {
      const response = await fetch(`${config.baseUrl}/chat/completions`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          model: resolveClaudeModel(params.model),
          messages: normalizeMarisMessages(params),
          max_tokens: boundedLocalMaxTokens(params.max_tokens),
          temperature: params.temperature ?? 0.2,
          stream: false,
        }),
        signal: controller.signal,
      });
      const body: any = await response.json().catch(() => ({}));
      if (!response.ok) {
        const error = new Error(body?.error?.message || body?.error || `El motor propio de Maris respondió HTTP ${response.status}`) as Error & { status?: number };
        error.status = response.status;
        throw error;
      }
      const text = String(body?.choices?.[0]?.message?.content || "").trim();
      if (!text) throw new Error("El motor propio de Maris devolvió una respuesta vacía.");
      return {
        id: body?.id,
        type: "message",
        role: "assistant",
        model: body?.model || resolveClaudeModel(params.model),
        content: [{ type: "text", text }],
        stop_reason: body?.choices?.[0]?.finish_reason || "end_turn",
        usage: {
          input_tokens: Number(body?.usage?.prompt_tokens || 0),
          output_tokens: Number(body?.usage?.completion_tokens || 0),
        },
      };
    }

    const response = await fetch(`${config.baseUrl}/v1/messages`, {
      method: "POST",
      headers,
      body: JSON.stringify(normalizeLegacyParams(params)),
      signal: controller.signal,
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error((body as any)?.error?.message || `La pasarela heredada respondió HTTP ${response.status}`) as Error & { status?: number };
      error.status = response.status;
      throw error;
    }
    return body as LocalMessageResponse;
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", abortFromParent);
  }
}

class LocalMessageStream {
  private readonly promise: Promise<LocalMessageResponse>;
  private readonly listeners = new Map<string, Array<(...args: any[]) => void>>();

  constructor(params: LocalMessageParams, signal?: AbortSignal) {
    this.promise = requestLocalModel(params, signal).then((message) => {
      const text = message.content?.filter((block) => block.type === "text").map((block) => block.text || "").join("") || "";
      for (const listener of this.listeners.get("text") || []) listener(text);
      for (const listener of this.listeners.get("end") || []) listener();
      return message;
    });
  }

  on(event: string, listener: (...args: any[]) => void): this {
    const existing = this.listeners.get(event) || [];
    existing.push(listener);
    this.listeners.set(event, existing);
    return this;
  }

  once(event: string, listener: (...args: any[]) => void): this { return this.on(event, listener); }
  finalMessage(): Promise<LocalMessageResponse> { return this.promise; }

  async *[Symbol.asyncIterator](): AsyncGenerator<Record<string, unknown>> {
    const message = await this.promise;
    const text = message.content?.filter((block) => block.type === "text").map((block) => block.text || "").join("") || "";
    yield { type: "message_start", message: { id: message.id, role: "assistant", model: message.model, usage: { input_tokens: message.usage?.input_tokens || 0, output_tokens: 0 } } };
    yield { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } };
    if (text) yield { type: "content_block_delta", index: 0, delta: { type: "text_delta", text } };
    yield { type: "content_block_stop", index: 0 };
    yield { type: "message_delta", delta: { stop_reason: message.stop_reason || "end_turn" }, usage: { output_tokens: message.usage?.output_tokens || 0 } };
    yield { type: "message_stop" };
  }
}

export const anthropic = {
  messages: {
    create: (params: LocalMessageParams, options?: { signal?: AbortSignal }) => requestLocalModel(params, options?.signal),
    stream: (params: LocalMessageParams, options?: { signal?: AbortSignal }) => new LocalMessageStream(params, options?.signal),
  },
} as any;
