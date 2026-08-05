import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { z } from "zod";

/** Single source of truth for the Claude model used across all generators. */
export const CLAUDE_MODEL = "claude-sonnet-4-5-20250929";

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

interface GenerateOptions<Schema extends z.ZodType> {
  system: string;
  /** A single user message, or a full messages array for multi-turn calls. */
  prompt: string | { role: "user" | "assistant"; content: string }[];
  schema: Schema;
  maxTokens: number;
  /** Error message thrown when Claude returns no parseable output. */
  errorMessage?: string;
}

/**
 * Shared structured-output call: send a prompt, get back an object validated
 * against the given Zod schema.
 */
export async function generate<Schema extends z.ZodType>(
  options: GenerateOptions<Schema>
): Promise<z.infer<Schema>> {
  const messages =
    typeof options.prompt === "string"
      ? [{ role: "user" as const, content: options.prompt }]
      : options.prompt;

  const message = await anthropic.messages.parse({
    model: CLAUDE_MODEL,
    max_tokens: options.maxTokens,
    system: options.system,
    messages,
    output_config: {
      format: zodOutputFormat(options.schema),
    },
  });

  const parsed = message.parsed_output;
  if (!parsed) {
    throw new Error(
      options.errorMessage ?? "Failed to parse structured output from Claude"
    );
  }

  return parsed;
}
