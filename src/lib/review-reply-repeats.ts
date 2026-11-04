/**
 * Two reviewers on one profile never get the same reply. A business's replies
 * sit stacked under its reviews, so a repeat reads as a template to anyone
 * scrolling them.
 *
 * "The same" ignores the reviewer's name, case and punctuation. It is scoped to
 * one profile: nobody reads two businesses' reviews side by side.
 *
 * Kept free of server-only imports so review-responder can use it without a
 * database; the lookup lives in review-reply-history.ts.
 */

export interface EarlierReply {
  content: string;
  reviewerName: string | null;
  /** The review had no comment. Those replies are short, so most repeats are here. */
  ratingOnly: boolean;
}

/** Refusal for approving a reply that repeats an earlier one. */
export const REPEATED_REPLY_ERROR =
  "This reply says the same thing as one already on this business's reviews. Regenerate or edit it before approving.";

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function blankReviewerName(reply: string, reviewerName: string | null): string {
  const name = reviewerName?.trim();
  if (!name) return reply;
  // The whole name first so "A T" goes too. Its parts only count from two
  // letters up: a lone "a" would eat a real word.
  const parts = [name, ...name.split(/\s+/).filter((part) => part.length >= 2)];
  return parts.reduce(
    (text, part) =>
      text.replace(
        new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(part)}(?![\\p{L}\\p{N}])`, "giu"),
        " "
      ),
    reply
  );
}

/** A reply with its reviewer's name taken out, still readable. */
export function withoutReviewerName(reply: string, reviewerName: string | null): string {
  return blankReviewerName(reply, reviewerName)
    .replace(/\s+([,.!?])/g, "$1")
    .replace(/,\s*(?=[,.!?])/g, "")
    .replace(/^[\s,.!?]+/, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function replyFingerprint(reply: string, reviewerName: string | null): string {
  return blankReviewerName(reply, reviewerName)
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/** The earlier reply this one repeats, or null if it says something new. */
export function findRepeatedReply(
  reply: string,
  reviewerName: string | null,
  earlier: readonly EarlierReply[]
): EarlierReply | null {
  const fingerprint = replyFingerprint(reply, reviewerName);
  if (!fingerprint) return null;
  return (
    earlier.find(
      (other) => replyFingerprint(other.content, other.reviewerName) === fingerprint
    ) ?? null
  );
}
