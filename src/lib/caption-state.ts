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

/** The marker the caption worker leaves when it gives up on an image. */
export const CAPTION_RETRIES_EXHAUSTED = "RETRIES_EXHAUSTED";

/**
 * How long RETRIES_EXHAUSTED holds before the image gets another round of
 * attempts. Every failure counts toward MAX_CAPTION_ATTEMPTS, an outage
 * included (Claude down, credits out), and nothing else ever clears the
 * marker on an upload, so without a cooldown a brief outage took a fine
 * photo out of post rotation for good. A week bounds a genuinely bad image
 * to one round of billed attempts a week.
 */
export const RETRIES_EXHAUSTED_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Rows still waiting on a caption: not captioned and not permanently
 * skipped. Claimed rows stay in on purpose. A claim whose run died would
 * otherwise hide the image from every re-enqueue for good; captionImage
 * itself decides whether a claim is still live. So does an image the worker
 * gave up on, once its RETRIES_EXHAUSTED_COOLDOWN_MS has passed.
 */
export function awaitingCaption(now: Date = new Date()) {
  return {
    captionedAt: null,
    OR: [
      { captionSkipReason: null },
      { captionSkipReason: CAPTION_IN_PROGRESS },
      {
        captionSkipReason: CAPTION_RETRIES_EXHAUSTED,
        updatedAt: { lt: new Date(now.getTime() - RETRIES_EXHAUSTED_COOLDOWN_MS) },
      },
    ],
  } satisfies Prisma.ProfileImageWhereInput;
}

/**
 * awaitingCaption for a row already in memory, minus the exhausted-and-cooled
 * case (which needs updatedAt): the post matcher only asks whether captions
 * are still coming soon.
 */
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
