import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { z } from "zod";
import { throwIfRefused } from "./claude-refusal";

/**
 * Single source of truth for the Claude model used across all generators.
 *
 * Claude Opus 5.5 always thinks (thinking can't be disabled) and its default
 * effort is `medium`, so every call names its effort, and every `maxTokens`
 * leaves room for thinking as well as the reply: thinking counts against it
 * even though its text isn't returned. Keep non-streaming calls at or under
 * 16_384; the SDK refuses a non-streaming request much above ~21k.
 */
export const CLAUDE_MODEL = "claude-opus-5-5";

/** `low` for classification-like or latency-sensitive calls, `medium` otherwise. */
export type ClaudeEffort = "low" | "medium" | "high";

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

export { ClaudeRefusalError, throwIfRefused } from "./claude-refusal";

interface GenerateOptions<Schema extends z.ZodType> {
  system: string;
  /**
   * A single user message, or a full messages array for multi-turn calls.
   * Message content may include non-text blocks (e.g. images for vision).
   */
  prompt: string | Anthropic.MessageParam[];
  schema: Schema;
  /** Thinking plus the reply; see CLAUDE_MODEL. */
  maxTokens: number;
  /** Required so no call inherits a default that can move between models. */
  effort: ClaudeEffort;
  /** Error message thrown when Claude returns no parseable output. */
  errorMessage?: string;
}

/**
 * Shared structured-output call: send a prompt, get back an object validated
 * against the given Zod schema.
 *
 * `messages.parse` reads only `text` blocks, so the `thinking` blocks Opus 5.5
 * puts first in every response are skipped. A refusal throws
 * ClaudeRefusalError, whether it came before any output or mid-output: the
 * format's parse is made tolerant below, because the SDK runs it before this
 * function sees the response, and a throw there (on the partial JSON a
 * mid-output refusal or a `max_tokens` stop leaves) would hide stop_reason.
 * Either way nothing is returned.
 */
export async function generate<Schema extends z.ZodType>(
  options: GenerateOptions<Schema>
): Promise<z.infer<Schema>> {
  const messages =
    typeof options.prompt === "string"
      ? [{ role: "user" as const, content: options.prompt }]
      : options.prompt;

  const format = zodOutputFormat(options.schema);
  let parseError: unknown = null;

  const message = await anthropic.messages.parse({
    model: CLAUDE_MODEL,
    max_tokens: options.maxTokens,
    system: options.system,
    messages,
    output_config: {
      effort: options.effort,
      format: {
        ...format,
        parse: (content: string) => {
          try {
            return format.parse(content);
          } catch (err) {
            parseError = err;
            return null as unknown as z.infer<Schema>;
          }
        },
      },
    },
  });

  throwIfRefused(message, options.errorMessage ?? "Structured output from Claude");

  const parsed = message.parsed_output;
  if (!parsed) {
    throw new Error(
      options.errorMessage ?? "Failed to parse structured output from Claude",
      { cause: parseError ?? `stop_reason: ${message.stop_reason}` }
    );
  }

  return parsed;
}
