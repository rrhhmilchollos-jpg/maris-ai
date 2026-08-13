// Cliente de modelo local para Maris AI.
//
// El nombre histórico del paquete se conserva por compatibilidad del monorepo,
// pero no se importa ni se llama al SDK de Anthropic. Todas las peticiones van
// al gateway interno de Zoco IA, cuyo proveedor real es Ollama en Hetzner.

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

const OLLAMA_MODELS = {
  fast: process.env.OLLAMA_MODEL_FLASH || "qwen2.5-coder:3b",
  standard: process.env.OLLAMA_MODEL_PLUS || "qwen2.5-coder:3b",
  max: process.env.OLLAMA_MODEL_MAX || "qwen2.5-coder:3b",
} as const;

// Export histórico para que los consumidores existentes no necesiten cambios.
export const CLAUDE_MODELS = OLLAMA_MODELS;

export function resolveClaudeModel(model?: string | null): string {
  const requested = String(model || "zoco-plus").trim();
  const lower = requested.toLowerCase();
  if (requested.includes(":") || requested.includes("/")) return requested;
  if (lower.includes("flash") || lower.includes("haiku") || lower.includes("mini")) return OLLAMA_MODELS.fast;
  if (lower.includes("max") || lower.includes("opus") || lower.includes("70b") || lower.includes("405b")) return OLLAMA_MODELS.max;
  return OLLAMA_MODELS.standard;
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

function normalizeParams(params: LocalMessageParams): Record<string, unknown> {
  const normalizedMessages = (params.messages || []).map((message) => ({
    ...message,
    content: normalizeContent(message.content),
  }));
  const system = params.system == null ? undefined : normalizeContent(params.system);
  return {
    model: resolveClaudeModel(params.model),
    max_tokens: params.max_tokens || 4096,
    ...(params.temperature == null ? {} : { temperature: params.temperature }),
    ...(system ? { system } : {}),
    messages: normalizedMessages,
    ...(params.metadata ? { metadata: params.metadata } : {}),
    ...(params.tools ? { tools: params.tools } : {}),
    ...(params.tool_choice ? { tool_choice: params.tool_choice } : {}),
    stream: false,
  };
}

function getConfig(): { baseUrl: string; apiKey: string } {
  const apiKey = process.env.ZOCOIA_API_KEY || process.env.LOCAL_LLM_API_KEY || "";
  const baseUrl = process.env.ZOCOIA_API_URL || process.env.LOCAL_LLM_BASE_URL || "";
  if (!apiKey || !baseUrl) {
    throw new Error(
      "El motor local no está configurado. Define ZOCOIA_API_URL y ZOCOIA_API_KEY para usar Ollama a través de Zoco IA.",
    );
  }
  return { apiKey, baseUrl: baseUrl.replace(/\/+$/, "") };
}

async function requestLocalModel(params: LocalMessageParams, signal?: AbortSignal): Promise<LocalMessageResponse> {
  const { baseUrl, apiKey } = getConfig();
  const response = await fetch(`${baseUrl}/v1/messages`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(normalizeParams(params)),
    signal,
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = (body as any)?.error?.message || `El gateway local respondió HTTP ${response.status}`;
    const error = new Error(message) as Error & { status?: number };
    error.status = response.status;
    throw error;
  }
  return body as LocalMessageResponse;
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

  once(event: string, listener: (...args: any[]) => void): this {
    return this.on(event, listener);
  }

  finalMessage(): Promise<LocalMessageResponse> {
    return this.promise;
  }

  async *[Symbol.asyncIterator](): AsyncGenerator<Record<string, unknown>> {
    const message = await this.promise;
    const text = message.content?.filter((block) => block.type === "text").map((block) => block.text || "").join("") || "";
    yield {
      type: "message_start",
      message: {
        id: message.id,
        role: "assistant",
        model: message.model,
        usage: { input_tokens: message.usage?.input_tokens || 0, output_tokens: 0 },
      },
    };
    yield { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } };
    if (text) {
      yield {
        type: "content_block_delta",
        index: 0,
        delta: { type: "text_delta", text },
      };
    }
    yield { type: "content_block_stop", index: 0 };
    yield {
      type: "message_delta",
      delta: { stop_reason: message.stop_reason || "end_turn" },
      usage: { output_tokens: message.usage?.output_tokens || 0 },
    };
    yield { type: "message_stop" };
  }
}

export const anthropic = {
  messages: {
    create: (params: LocalMessageParams, options?: { signal?: AbortSignal }) =>
      requestLocalModel(params, options?.signal),
    stream: (params: LocalMessageParams, options?: { signal?: AbortSignal }) =>
      new LocalMessageStream(params, options?.signal),
  },
} as any;
