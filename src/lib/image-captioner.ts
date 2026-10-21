import { z } from "zod";
import { prisma } from "./prisma";
import { generate } from "./claude";
import { ClaudeRefusalError } from "./claude-refusal";
import {
  awaitingCaption,
  CAPTION_IN_PROGRESS,
  CAPTION_RETRIES_EXHAUSTED,
  RETRIES_EXHAUSTED_COOLDOWN_MS,
} from "./caption-state";

// The Vision API rejects oversized images; stay under its 5MB decoded cap
// with margin. Uploads are usually captioned from the ~480px thumbnail, so
// this only bites originals that skipped thumbnailing.
const MAX_VISION_BYTES = 4.5 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 10_000;
const SUPPORTED_MEDIA_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
]);

const MAX_DESCRIPTION_CHARS = 300;
const MAX_TAGS = 5;

// How long a caption claim holds before another run may take it over. One
// caption is a CDN fetch and a Claude call, normally seconds; a claim this
// old belongs to a run that died (a deploy restarting the worker).
const CAPTION_CLAIM_LEASE_MS = 15 * 60 * 1000;

/**
 * Why a caption was permanently skipped (captionedAt stays null; the image
 * is treated as "unknown" by the matcher and never blind-attached):
 * - NO_INPUT: no stored bytes and no Google URL to fetch.
 * - TOO_LARGE: stored bytes exceed the vision size cap.
 * - UNSUPPORTED_TYPE: bytes/response aren't a vision-supported image type.
 * - FETCH_DENIED: the image host returned a 4xx — a stale Google CDN URL;
 *   the next media sync refreshes the URL and re-enqueues the caption.
 * - GONE: the row was deleted (before or during captioning).
 * - REFUSED: Claude declined to caption the photo (stop_reason "refusal", a
 *   safety classifier). The same bytes would be declined again, so retrying
 *   only spends rate limit, and a mid-output refusal bills the image each time.
 * - RETRIES_EXHAUSTED: the caption worker spent MAX_CAPTION_ATTEMPTS on the
 *   image across its queue jobs and every one failed. A GBP sync that
 *   refreshes the URL clears it, like the other skips.
 * - IN_PROGRESS: not a skip on the row's merits. Another run holds the
 *   caption claim, so this one left the image to it (see caption-state.ts).
 */
export type CaptionSkipReason =
  | "NO_INPUT"
  | "TOO_LARGE"
  | "UNSUPPORTED_TYPE"
  | "FETCH_DENIED"
  | "GONE"
  | "REFUSED"
  | "RETRIES_EXHAUSTED"
  | typeof CAPTION_IN_PROGRESS;

export interface CaptionResult {
  imageId: string;
  ok: boolean;
  skipped?: CaptionSkipReason;
  error?: string;
}

// No length caps on the wire: zodOutputFormat sends max/maxItems only as
// description hints, so strict caps here would make generate() throw on a
// benign over-limit response (a billed retry loop) instead of reaching the
// tolerate-and-trim slices below.
const CaptionSchema = z.object({
  description: z.string(),
  tags: z.array(z.string()),
  generic: z.boolean(),
});

const CAPTION_SYSTEM_PROMPT = `You classify a local business's photo for use on Google Business Profile posts.

Return:
- description: one factual sentence describing what is pictured.
- tags: up to ${MAX_TAGS} lowercase subject nouns (e.g. "kitchen", "roof", "pizza").
- generic: whether this photo could safely accompany ANY post by this business.

generic = true for photos with no specific subject a reader would expect the
post to be about: storefront/exterior, team or staff, logo or branding,
tools/equipment/vehicles, or generic in-progress work.
generic = false for an identifiable specific subject (a particular room type,
dish, product, or project type) that would look wrong attached to a post
about something else.`;

/** The skips captionImage finds on the row's own merits and persists. */
type FoundSkipReason = Exclude<
  CaptionSkipReason,
  "GONE" | "RETRIES_EXHAUSTED" | typeof CAPTION_IN_PROGRESS
>;

class PermanentCaptionSkip extends Error {
  constructor(public reason: FoundSkipReason) {
    super(`caption skipped: ${reason}`);
  }
}

/**
 * Caption one library image with Claude vision and persist the result.
 *
 * Throws on transient failures (network, Claude, DB) so the BullMQ worker
 * retries; returns ok:false with a reason for permanent no-input cases; a
 * row that vanished mid-flight is GONE, not an error. Already-captioned
 * rows are an ok noop, so re-enqueueing is always safe, and an image another
 * run is captioning right now comes back IN_PROGRESS without being paid for
 * twice.
 */
export async function captionImage(imageId: string): Promise<CaptionResult> {
  const image = await prisma.profileImage.findUnique({
    where: { id: imageId },
    select: {
      id: true,
      status: true,
      data: true,
      thumbData: true,
      contentType: true,
      googleUrl: true,
      category: true,
      captionedAt: true,
      captionSkipReason: true,
      updatedAt: true,
      profile: { select: { name: true, category: true } },
    },
  });

  if (!image) return { imageId, ok: false, skipped: "GONE" };
  if (image.captionedAt) return { imageId, ok: true };
  const exhaustedCutoff = new Date(Date.now() - RETRIES_EXHAUSTED_COOLDOWN_MS);
  const exhaustedCooledDown =
    image.captionSkipReason === CAPTION_RETRIES_EXHAUSTED &&
    image.updatedAt < exhaustedCutoff;
  if (
    image.captionSkipReason &&
    image.captionSkipReason !== CAPTION_IN_PROGRESS &&
    !exhaustedCooledDown
  ) {
    // Already found unusable — don't re-pull bytes or re-hit the CDN.
    return {
      imageId,
      ok: false,
      skipped: image.captionSkipReason as CaptionSkipReason,
    };
  }

  // Claim the row before spending anything on it. Reading captionedAt
  // and writing later let two runs (the worker, the onboarding pre-pass, a
  // backfill) both pay for the same image; only the run whose claim lands
  // fetches and calls Claude. A claim older than the lease is taken over.
  const claim = await prisma.profileImage.updateMany({
    where: {
      id: imageId,
      captionedAt: null,
      OR: [
        { captionSkipReason: null },
        {
          captionSkipReason: CAPTION_IN_PROGRESS,
          updatedAt: { lt: new Date(Date.now() - CAPTION_CLAIM_LEASE_MS) },
        },
        // Given up on, but long enough ago to try again (an outage, say)
        {
          captionSkipReason: CAPTION_RETRIES_EXHAUSTED,
          updatedAt: { lt: exhaustedCutoff },
        },
      ],
    },
    // updatedAt is the claim's timestamp, so set it here rather than rely
    // on the implicit stamp.
    data: { captionSkipReason: CAPTION_IN_PROGRESS, updatedAt: new Date() },
  });
  if (claim.count === 0) {
    return { imageId, ok: false, skipped: CAPTION_IN_PROGRESS };
  }

  try {
    return await captionClaimedImage(imageId, image);
  } catch (err) {
    // A transient failure hands the image back, so the BullMQ retry or the
    // next sync can claim it now rather than after the lease. A failed
    // hand-back only means waiting out the lease; the original error is the
    // one worth surfacing.
    await prisma.profileImage
      .updateMany({
        where: { id: imageId, captionSkipReason: CAPTION_IN_PROGRESS },
        data: { captionSkipReason: null },
      })
      .catch(() => {});
    throw err;
  }
}

type ClaimedImage = VisionSource & {
  category: string | null;
  profile: { name: string; category: string | null };
};

/** captionImage's paid part: runs only under a claim this run holds. */
async function captionClaimedImage(
  imageId: string,
  image: ClaimedImage
): Promise<CaptionResult> {
  let input: { mediaType: string; base64: string };
  try {
    input = await resolveVisionInput(image);
  } catch (err) {
    if (err instanceof PermanentCaptionSkip) {
      return persistSkip(imageId, err.reason);
    }
    throw err;
  }

  let caption: z.infer<typeof CaptionSchema>;
  try {
    caption = await generate({
      system: CAPTION_SYSTEM_PROMPT,
      prompt: [
      {
        role: "user",
        content: [
          {
            type: "image",
            source: {
              type: "base64",
              media_type: input.mediaType as
                | "image/jpeg"
                | "image/png"
                | "image/webp"
                | "image/gif",
              data: input.base64,
            },
          },
          {
            type: "text",
            text: [
              `Business: ${image.profile.name}`,
              image.profile.category
                ? `Business category: ${image.profile.category}`
                : null,
              image.category && image.category !== "CATEGORY_UNSPECIFIED"
                ? `Google photo placement hint: ${image.category}`
                : null,
            ]
              .filter(Boolean)
              .join("\n"),
          },
        ],
      },
    ],
      schema: CaptionSchema,
      // Classification of one photo: `low` effort. Was 500 before thinking
      // was always on; thinking now comes out of this budget first.
      maxTokens: 4_096,
      effort: "low",
      errorMessage: "Failed to parse image caption from Claude",
      // Captions run in bursts (syncs, backfills). The prefix is ~514
      // tokens, just over the 512 minimum: lengthen the prompt freely, but
      // shortening it can silently switch caching off.
      cacheSystem: true,
      label: "image-caption",
      // Every attempt must finish well inside CAPTION_CLAIM_LEASE_MS, or a
      // second run takes the claim over and pays for the image again.
      timeoutMs: 2 * 60 * 1000,
      maxRetries: 1,
    });
  } catch (err) {
    // The API rejects images over 8,000px on a side with a 400 even when
    // the bytes fit the size guard — retrying can never help, so record it
    // as the permanent skip it is instead of burning billed retries.
    if (isDimensionRejection(err)) {
      return persistSkip(imageId, "TOO_LARGE");
    }
    // Same logic for a decline: permanent for these bytes, so record it rather
    // than leave the row for every sync and generation batch to pick up again.
    if (err instanceof ClaudeRefusalError) {
      console.warn(`image-captioner: ${imageId}: ${err.message}`);
      return persistSkip(imageId, "REFUSED");
    }
    throw err;
  }

  // Conditional on the row still being uncaptioned, so a run that took over
  // a lapsed claim and finished first keeps its caption. Writing it drops
  // the claim. updateMany returns a count, never the row's image bytes.
  const written = await prisma.profileImage.updateMany({
    where: { id: imageId, captionedAt: null },
    data: {
      aiDescription: caption.description.slice(0, MAX_DESCRIPTION_CHARS),
      aiTags: caption.tags
        .slice(0, MAX_TAGS)
        .map((t) => t.toLowerCase().slice(0, 80)),
      aiGeneric: caption.generic,
      captionedAt: new Date(),
      captionSkipReason: null,
    },
  });
  if (written.count === 0) {
    // Either captioned by that other run, or deleted between caption and
    // persist (Images page delete, GBP sync cleanup), in which case the
    // caption has nowhere to live; that's fine.
    const row = await prisma.profileImage.findUnique({
      where: { id: imageId },
      select: { id: true },
    });
    return row
      ? { imageId, ok: true }
      : { imageId, ok: false, skipped: "GONE" };
  }

  return { imageId, ok: true };
}

/**
 * Record that the caption worker gave up on an image: every attempt it was
 * allowed (MAX_CAPTION_ATTEMPTS, across queue jobs) failed. The marker keeps
 * syncs, uploads and generation batches from re-enqueueing it, each of which
 * would otherwise buy it a fresh set of billed attempts. A row that got
 * captioned or skipped meanwhile is left as it is.
 */
export async function recordCaptionRetriesExhausted(
  imageId: string
): Promise<void> {
  await prisma.profileImage.updateMany({
    where: { id: imageId, ...awaitingCaption() },
    data: { captionSkipReason: CAPTION_RETRIES_EXHAUSTED },
  });
}

/** A 400 from the vision API because the image exceeds its pixel-dimension cap. */
function isDimensionRejection(err: unknown): boolean {
  const e = err as { status?: number; message?: string };
  return (
    e?.status === 400 &&
    typeof e.message === "string" &&
    /image dimensions exceed max allowed size/i.test(e.message)
  );
}

/**
 * Record a permanent skip on the row so re-enqueue queries exclude it —
 * without this, every sync and generation batch would reprocess the image
 * forever. A GBP sync that refreshes the image's URL clears the marker
 * (a stale-URL skip may recover with the new URL). The reason replaces
 * this run's caption claim. Throws on transient persist failure so the job
 * retries; P2025 means the row is gone.
 */
async function persistSkip(
  imageId: string,
  reason: FoundSkipReason
): Promise<CaptionResult> {
  try {
    await prisma.profileImage.update({
      where: { id: imageId },
      data: { captionSkipReason: reason },
      select: { id: true },
    });
  } catch (err) {
    if ((err as { code?: string })?.code === "P2025") {
      return { imageId, ok: false, skipped: "GONE" };
    }
    throw err;
  }
  return { imageId, ok: false, skipped: reason };
}

/**
 * Caption a batch of images with bounded concurrency. Never throws —
 * per-image failures come back as error results so callers (backfill,
 * onboarding pre-pass) can report and move on.
 */
export async function captionImages(
  imageIds: string[],
  options: { concurrency?: number; log?: (message: string) => void } = {}
): Promise<CaptionResult[]> {
  if (imageIds.length === 0) return [];
  const concurrency = Math.max(1, options.concurrency ?? 3);
  const log = options.log ?? console.warn;

  const results: CaptionResult[] = new Array(imageIds.length);
  let next = 0;

  async function drain(): Promise<void> {
    while (next < imageIds.length) {
      const i = next++;
      const imageId = imageIds[i];
      try {
        results[i] = await captionImage(imageId);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        log(`[image-captioner] Failed to caption ${imageId}: ${message}`);
        results[i] = { imageId, ok: false, error: message };
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, imageIds.length) }, drain)
  );
  return results;
}

/**
 * Bounded caption pre-pass over a profile's uncaptioned APPROVED images,
 * for callers that are about to match posts (onboarding). Never throws and
 * never blocks its caller on failure — worst case the batch matches with
 * fewer captions, exactly as if the pre-pass hadn't run.
 */
export async function captionUncaptionedApproved(
  profileId: string,
  options: { limit?: number; concurrency?: number } = {}
): Promise<number> {
  try {
    const rows = await prisma.profileImage.findMany({
      where: { profileId, status: "APPROVED", ...awaitingCaption() },
      orderBy: { createdAt: "asc" },
      take: options.limit ?? 50,
      select: { id: true },
    });
    if (rows.length === 0) return 0;
    const results = await captionImages(
      rows.map((r) => r.id),
      { concurrency: options.concurrency ?? 3 }
    );
    return results.filter((r) => r.ok).length;
  } catch (err) {
    console.warn(
      `[image-captioner] Caption pre-pass failed for profile ${profileId}:`,
      err
    );
    return 0;
  }
}

type VisionSource = {
  data: Uint8Array | null;
  thumbData: Uint8Array | null;
  contentType: string | null;
  googleUrl: string | null;
};

async function resolveVisionInput(
  image: VisionSource
): Promise<{ mediaType: string; base64: string }> {
  // Uploads: the ~480px thumbnail is the cheap vision input; fall back to
  // the original bytes for the rare images that skipped thumbnailing.
  if (image.thumbData?.length) {
    return {
      mediaType: "image/jpeg", // thumbnails are always JPEG
      base64: Buffer.from(image.thumbData).toString("base64"),
    };
  }

  if (image.data?.length) {
    if (image.data.length > MAX_VISION_BYTES) {
      throw new PermanentCaptionSkip("TOO_LARGE");
    }
    const mediaType = image.contentType?.toLowerCase() ?? "";
    if (!SUPPORTED_MEDIA_TYPES.has(mediaType)) {
      throw new PermanentCaptionSkip("UNSUPPORTED_TYPE");
    }
    return { mediaType, base64: Buffer.from(image.data).toString("base64") };
  }

  // GBP-synced rows: fetch Google's CDN copy ourselves rather than passing
  // the URL to the API — our own fetch has deterministic, classifiable
  // failure modes (4xx = stale URL, 5xx/network = retry). Prefer the CDN's
  // downscaled variant: full-res originals routinely exceed the vision byte
  // cap (450 TOO_LARGE skips in the first prod backfill) and cost ~5x the
  // tokens. Fall back to the raw URL when the variant isn't available —
  // only the raw URL's failures classify.
  if (image.googleUrl) {
    const sized = sizedGoogleUrl(image.googleUrl);
    if (sized) {
      try {
        return await fetchVisionBytes(sized);
      } catch {
        // Variant unavailable (some URLs don't accept the suffix) — the
        // raw fetch below is the authoritative attempt.
      }
    }
    return fetchVisionBytes(image.googleUrl);
  }

  throw new PermanentCaptionSkip("NO_INPUT");
}

// The CDN's max-dimension suffix. 512px is plenty for subject recognition
// (uploads caption fine from 480px thumbs) at ~350 image tokens.
const GBP_VISION_SIZE = 512;

/**
 * CDN size-variant URL. GBP googleUrls carry a trailing size parameter —
 * in prod it's always `=s0`, i.e. "serve the original" (verified
 * 2026-08-20; the originals are what blew the vision byte cap) — which
 * gets tail-replaced with our size. Bare URLs get the suffix appended.
 * Returns null only for shapes we don't recognize (variant skipped, raw
 * fetch decides).
 */
function sizedGoogleUrl(url: string): string | null {
  const suffix = `=s${GBP_VISION_SIZE}`;
  if (!url.includes("=")) return `${url}${suffix}`;
  if (/=[^/=]*$/.test(url)) return url.replace(/=[^/=]*$/, suffix);
  return null;
}

async function fetchVisionBytes(
  url: string
): Promise<{ mediaType: string; base64: string }> {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!response.ok) {
    // 429 is a rate-limit burst and 408 a request the host timed out on,
    // not verdicts on the URL — they must stay transient, or a busy backfill
    // would permanently poison rows (a persisted FETCH_DENIED only recovers
    // if the URL changes). Other 4xx = stale/denied URL: skip until a sync
    // refreshes it.
    if (
      response.status !== 408 &&
      response.status !== 429 &&
      response.status >= 400 &&
      response.status < 500
    ) {
      throw new PermanentCaptionSkip("FETCH_DENIED");
    }
    throw new Error(`Image fetch failed with HTTP ${response.status} for ${url}`);
  }
  const mediaType = (response.headers.get("content-type") ?? "")
    .split(";")[0]
    .trim()
    .toLowerCase();
  if (!SUPPORTED_MEDIA_TYPES.has(mediaType)) {
    throw new PermanentCaptionSkip("UNSUPPORTED_TYPE");
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.length > MAX_VISION_BYTES) {
    throw new PermanentCaptionSkip("TOO_LARGE");
  }
  return { mediaType, base64: Buffer.from(bytes).toString("base64") };
}
