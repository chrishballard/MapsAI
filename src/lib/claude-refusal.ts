/**
 * The refusal type and check for Claude calls, kept out of src/lib/claude.ts
 * for the same reason src/lib/pasted-content.ts is: the tests mock
 * `@/lib/claude` wholesale, and a caller that needs `instanceof` on the error
 * (the image captioner) would find it missing under the mock. claude.ts
 * re-exports both, so existing imports keep working.
 */

/**
 * Claude declined the request: `stop_reason: "refusal"` (an HTTP 200 with no
 * usable output). Opus 5.5 runs safety classifiers (cyber, bio, and
 * `reasoning_extraction`), and a classifier can fire on ordinary input as a
 * false positive. Thrown before any output is read, so nothing is saved; the
 * same input will usually be declined again on a retry.
 */
export class ClaudeRefusalError extends Error {
  readonly category: string | null;

  constructor(context: string, category: string | null) {
    super(`${context}: declined by Claude (stop_reason: refusal, category: ${category ?? "none"})`);
    this.name = "ClaudeRefusalError";
    this.category = category;
  }
}

/**
 * Throw ClaudeRefusalError when the response is a refusal. Branch on
 * `stop_reason`, never on `stop_details` (informational, and can be null even
 * on a refusal). `stop_details` is read loosely because the pinned SDK
 * (0.78) predates its type.
 */
export function throwIfRefused(
  message: { stop_reason: string | null },
  context: string
): void {
  if (message.stop_reason !== "refusal") return;
  const details = (message as { stop_details?: { category?: string | null } | null })
    .stop_details;
  throw new ClaudeRefusalError(context, details?.category ?? null);
}
