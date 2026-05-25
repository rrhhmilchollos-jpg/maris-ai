import Anthropic from "@anthropic-ai/sdk";

// Lazy initialization: do NOT throw at import time.
// The error is deferred until the client is actually used, so the server
// can start without ANTHROPIC_API_KEY set (e.g. when only using OpenAI/Gemini).
let _client: Anthropic | null = null;

function getClient(): Anthropic {
  if (_client) return _client;

  const apiKey =
    process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY ||
    process.env.ANTHROPIC_API_KEY;

  if (!apiKey) {
    throw new Error(
      "Anthropic API key not found. Please set AI_INTEGRATIONS_ANTHROPIC_API_KEY or ANTHROPIC_API_KEY environment variable.",
    );
  }

  const clientOptions: ConstructorParameters<typeof Anthropic>[0] = { apiKey };

  // AI_INTEGRATIONS_ANTHROPIC_BASE_URL is optional.
  // When not set, the SDK defaults to the official Anthropic API endpoint.
  if (process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL) {
    clientOptions.baseURL = process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL;
  }

  _client = new Anthropic(clientOptions);
  return _client;
}

// Export a Proxy so existing callers can use `anthropic.messages.create(…)`
// without any changes — the real client is only instantiated on first access.
export const anthropic = new Proxy({} as Anthropic, {
  get(_target, prop) {
    return (getClient() as any)[prop];
  },
});
