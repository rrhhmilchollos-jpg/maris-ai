import Anthropic from "@anthropic-ai/sdk";

if (!process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY) {
  throw new Error(
    "AI_INTEGRATIONS_ANTHROPIC_API_KEY must be set. Did you forget to add the Anthropic API key?",
  );
}

// AI_INTEGRATIONS_ANTHROPIC_BASE_URL is optional.
// When not set, the SDK defaults to the official Anthropic API endpoint (https://api.anthropic.com).
// Only set this variable if you are using a custom proxy or gateway.
const clientOptions: ConstructorParameters<typeof Anthropic>[0] = {
  apiKey: process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY,
};
if (process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL) {
  clientOptions.baseURL = process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL;
}

export const anthropic = new Anthropic(clientOptions);
