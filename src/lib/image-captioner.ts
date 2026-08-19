import { z } from "zod";
import { prisma } from "./prisma";
import { generate } from "./claude";

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

/**
 * Why a caption was permanently skipped (captionedAt stays null; the image
 * is treated as "unknown" by the matcher and never blind-attached):
 * - NO_INPUT: no stored bytes and no Google URL to fetch.
 * - TOO_LARGE: stored bytes exceed the vision size cap.
 * - UNSUPPORTED_TYPE: bytes/response aren't a vision-supported image type.
 * - FETCH_DENIED: the image host returned a 4xx — a stale Google CDN URL;
 *   the next media sync refreshes the URL and re-enqueues the caption.
 * - GONE: the row was deleted (before or during captioning).
 */
export type CaptionSkipReason =
  | "NO_INPUT"
  | "TOO_LARGE"
  | "UNSUPPORTED_TYPE"
  | "FETCH_DENIED"
  | "GONE";

export interface CaptionResult {
  imageId: string;
  ok: boolean;
  skipped?: CaptionSkipReason;
  error?: string;
}

const CaptionSchema = z.object({
  description: z.string().max(MAX_DESCRIPTION_CHARS),
  tags: z.array(z.string().max(40)).max(MAX_TAGS),
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

class PermanentCaptionSkip extends Error {
  constructor(public reason: Exclude<CaptionSkipReason, "GONE">) {
    super(`caption skipped: ${reason}`);
  }
}

/**
 * Caption one library image with Claude vision and persist the result.
 *
 * Throws on transient failures (network, Claude, DB) so the BullMQ worker
 * retries; returns ok:false with a reason for permanent no-input cases; a
 * row that vanished mid-flight is GONE, not an error. Already-captioned
 * rows are an ok noop, so re-enqueueing is always safe.
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
      profile: { select: { name: true, category: true } },
    },
  });

  if (!image) return { imageId, ok: false, skipped: "GONE" };
  if (image.captionedAt) return { imageId, ok: true };

  let input: { mediaType: string; base64: string };
  try {
    input = await resolveVisionInput(image);
  } catch (err) {
    if (err instanceof PermanentCaptionSkip) {
      return { imageId, ok: false, skipped: err.reason };
    }
    throw err;
  }

  const caption = await generate({
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
    maxTokens: 500,
    errorMessage: "Failed to parse image caption from Claude",
  });

  try {
    await prisma.profileImage.update({
      where: { id: imageId },
      data: {
        aiDescription: caption.description.slice(0, MAX_DESCRIPTION_CHARS),
        aiTags: caption.tags.slice(0, MAX_TAGS).map((t) => t.toLowerCase()),
        aiGeneric: caption.generic,
        captionedAt: new Date(),
      },
      // Never return the row's multi-MB image bytes just to discard them.
      select: { id: true },
    });
  } catch (err) {
    // Deleted between caption and persist (Images page delete, GBP sync
    // cleanup) — the caption has nowhere to live; that's fine.
    if ((err as { code?: string })?.code === "P2025") {
      return { imageId, ok: false, skipped: "GONE" };
    }
    throw err;
  }

  return { imageId, ok: true };
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
      where: { profileId, status: "APPROVED", captionedAt: null },
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
  // failure modes (4xx = stale URL, 5xx/network = retry).
  if (image.googleUrl) {
    const response = await fetch(image.googleUrl, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!response.ok) {
      if (response.status >= 400 && response.status < 500) {
        throw new PermanentCaptionSkip("FETCH_DENIED");
      }
      throw new Error(
        `Image fetch failed with HTTP ${response.status} for ${image.googleUrl}`
      );
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

  throw new PermanentCaptionSkip("NO_INPUT");
}
