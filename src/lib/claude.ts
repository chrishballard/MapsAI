import Anthropic from "@anthropic-ai/sdk";

const globalForAnthropic = globalThis as unknown as {
  anthropic: Anthropic | undefined;
};

function createAnthropicClient() {
  return new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY!,
  });
}

export const anthropic =
  globalForAnthropic.anthropic ?? createAnthropicClient();

if (process.env.NODE_ENV !== "production")
  globalForAnthropic.anthropic = anthropic;
