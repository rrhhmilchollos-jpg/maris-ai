import Anthropic from "@anthropic-ai/sdk";

const apiKey = process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY;

if (!apiKey) {
  throw new Error(
    "Anthropic API key not found. Please set AI_INTEGRATIONS_ANTHROPIC_API_KEY or ANTHROPIC_API_KEY environment variable.",
  );
}

// AI_INTEGRATIONS_ANTHROPIC_BASE_URL is optional.
// When not set, the SDK defaults to the official Anthropic API endpoint (https://api.anthropic.com).
// Only set this variable if you are using a custom proxy or gateway.
const clientOptions: ConstructorParameters<typeof Anthropic>[0] = {
  apiKey: apiKey,
};
if (process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL) {
  clientOptions.baseURL = process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL;
}

export const anthropic = new Anthropic(clientOptions);
