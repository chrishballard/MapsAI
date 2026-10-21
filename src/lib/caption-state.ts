import type { Prisma } from "../generated/prisma/client";

// Caption bookkeeping shared by the captioner, the caption queue and its
// worker, the backfill and the post matcher. It lives apart from
// image-captioner.ts because that module loads the Claude client and the
// queue module opens a Redis connection on import; this one loads nothing.

/**
 * The claim captionImage puts in captionSkipReason while it captions a row,
 * so a second run that reaches the same image (the worker, the onboarding
 * pre-pass, a backfill) leaves it alone instead of paying for it again.
 * Unlike the real skip reasons it is not permanent: a claim left by a run
 * that died mid-caption lapses and is taken over.
 */
export const CAPTION_IN_PROGRESS = "IN_PROGRESS";

/**
 * Caption attempts one image gets across every queue job, before the worker
 * records it as RETRIES_EXHAUSTED. Each job retries 3 times, and each attempt
 * can be a billed Claude call, so this is two jobs' worth.
 */
export const MAX_CAPTION_ATTEMPTS = 6;

/**
 * Rows still waiting on a caption: not captioned and not permanently
 * skipped. Claimed rows stay in on purpose. A claim whose run died would
 * otherwise hide the image from every re-enqueue for good; captionImage
 * itself decides whether a claim is still live.
 */
export const AWAITING_CAPTION = {
  captionedAt: null,
  OR: [{ captionSkipReason: null }, { captionSkipReason: CAPTION_IN_PROGRESS }],
} satisfies Prisma.ProfileImageWhereInput;

/** AWAITING_CAPTION for a row already in memory. */
export function isAwaitingCaption(row: {
  captionedAt: Date | null;
  captionSkipReason: string | null;
}): boolean {
  return (
    !row.captionedAt &&
    (row.captionSkipReason === null ||
      row.captionSkipReason === CAPTION_IN_PROGRESS)
  );
}
