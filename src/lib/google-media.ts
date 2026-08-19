import { createGoogleClient } from "./google";
import { prisma } from "./prisma";
import { newImageToken } from "./image-tokens";
import { IMAGE_MIN_WIDTH, IMAGE_MIN_HEIGHT } from "./image-validation";
import { enqueueCaptionsForProfile } from "./queue/image-caption-queue";

export interface GBPMediaItem {
  name: string; // "accounts/{a}/locations/{l}/media/{id}"
  mediaFormat?: string; // PHOTO | VIDEO
  googleUrl?: string;
  thumbnailUrl?: string;
  dimensions?: { widthPixels?: number; heightPixels?: number };
  locationAssociation?: { category?: string; priceListItemId?: string };
  [key: string]: unknown;
}

interface ListGBPMediaParams {
  googleAccountId: string;
  accountResourceName: string; // e.g. "accounts/123"
  locationName: string; // e.g. "locations/456"
}

/** List every media item on a location (paginated). */
export async function listGBPMedia(
  params: ListGBPMediaParams
): Promise<GBPMediaItem[]> {
  const { googleAccountId, accountResourceName, locationName } = params;

  const oauth2Client = await createGoogleClient(googleAccountId);
  const parent = `${accountResourceName}/${locationName}`;

  const items: GBPMediaItem[] = [];
  let pageToken: string | undefined;

  do {
    const url =
      `https://mybusiness.googleapis.com/v4/${parent}/media?pageSize=100` +
      (pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : "");

    const response = await oauth2Client.request<{
      mediaItems?: GBPMediaItem[];
      nextPageToken?: string;
    }>({ url, method: "GET" });

    items.push(...(response.data.mediaItems ?? []));
    pageToken = response.data.nextPageToken;
  } while (pageToken);

  return items;
}

export interface MediaSyncResult {
  added: number;
  updated: number;
  removed: number;
  total: number;
}

/**
 * Pull the profile's existing GBP photos into the image library as
 * metadata-only rows (Google keeps hosting the bytes). Re-running updates
 * URLs/dimensions in place, keeps any team-set status, and removes rows for
 * photos that were deleted from GBP (posts that used them keep their
 * recorded mediaUrl; the FK nulls out via onDelete: SetNull).
 */
export async function syncProfileMediaToLibrary(
  profileId: string,
  options: {
    /** Set when the caller captions inline right after the sync (onboarding
     *  pre-pass) — the enqueue hook would double-bill the same images. */
    skipCaptionEnqueue?: boolean;
  } = {}
): Promise<MediaSyncResult> {
  const profile = await prisma.profile.findUniqueOrThrow({
    where: { id: profileId },
    select: {
      id: true,
      googleAccountId: true,
      accountResourceName: true,
      locationName: true,
    },
  });

  if (!profile.accountResourceName) {
    throw new Error(`Profile ${profileId} is missing accountResourceName`);
  }

  const items = await listGBPMedia({
    googleAccountId: profile.googleAccountId,
    accountResourceName: profile.accountResourceName,
    locationName: profile.locationName,
  });

  // Photos only, with a fetchable URL, big enough for post media. Items
  // without reported dimensions are kept — Google validates at publish and
  // the worker degrades to a text-only post if it rejects the image.
  const photos = items.filter((item) => {
    if (item.mediaFormat !== "PHOTO" || !item.googleUrl) return false;
    const w = item.dimensions?.widthPixels;
    const h = item.dimensions?.heightPixels;
    if (w && h && (w < IMAGE_MIN_WIDTH || h < IMAGE_MIN_HEIGHT)) return false;
    return true;
  });

  const existing = await prisma.profileImage.findMany({
    where: { profileId, source: "GBP" },
    select: {
      id: true,
      googleMediaName: true,
      googleUrl: true,
      thumbnailUrl: true,
      width: true,
      height: true,
      category: true,
    },
  });
  const existingByName = new Map(
    existing.map((row) => [row.googleMediaName, row])
  );

  // Batch the whole reconciliation into one transaction: update only rows
  // Google actually changed (never clobbering a team-set status), create
  // the new ones, drop the ones deleted from GBP. A 500-photo profile is a
  // handful of round-trips instead of one per photo.
  const updates: { id: string; data: Record<string, string | number | null> }[] = [];
  const creates: {
    profileId: string;
    source: "GBP";
    status: "APPROVED";
    publicToken: string;
    googleMediaName: string;
    googleUrl: string | null;
    thumbnailUrl: string | null;
    width: number | null;
    height: number | null;
    category: string | null;
  }[] = [];

  for (const item of photos) {
    const shared = {
      googleUrl: item.googleUrl ?? null,
      thumbnailUrl: item.thumbnailUrl ?? null,
      width: item.dimensions?.widthPixels ?? null,
      height: item.dimensions?.heightPixels ?? null,
      category: item.locationAssociation?.category ?? null,
    };

    const row = existingByName.get(item.name);
    if (row) {
      const changed =
        row.googleUrl !== shared.googleUrl ||
        row.thumbnailUrl !== shared.thumbnailUrl ||
        row.width !== shared.width ||
        row.height !== shared.height ||
        row.category !== shared.category;
      if (changed) {
        // A refreshed googleUrl gives a permanently fetch-skipped image a
        // new chance — clear the skip so captioning retries with it.
        const data =
          row.googleUrl !== shared.googleUrl
            ? { ...shared, captionSkipReason: null }
            : shared;
        updates.push({ id: row.id, data });
      }
    } else {
      creates.push({
        profileId,
        source: "GBP",
        status: "APPROVED",
        publicToken: newImageToken(),
        googleMediaName: item.name,
        ...shared,
      });
    }
  }

  const liveNames = new Set(photos.map((p) => p.name));
  const staleIds = existing
    .filter((row) => row.googleMediaName && !liveNames.has(row.googleMediaName))
    .map((row) => row.id);

  await prisma.$transaction([
    ...updates.map((u) =>
      prisma.profileImage.update({
        where: { id: u.id },
        data: u.data,
        select: { id: true },
      })
    ),
    ...(creates.length > 0
      ? [prisma.profileImage.createMany({ data: creates })]
      : []),
    ...(staleIds.length > 0
      ? [prisma.profileImage.deleteMany({ where: { id: { in: staleIds } } })]
      : []),
    prisma.profile.update({
      where: { id: profileId },
      data: { mediaSyncedAt: new Date() },
      select: { id: true },
    }),
  ]);

  // Queue vision captions for anything approved and uncaptioned — new rows
  // from this sync included (createMany returns no ids, so the queue helper
  // re-queries). Also re-captions photos that were deleted from GBP and came
  // back as brand-new rows. Never lets a queue problem fail the sync.
  if (!options.skipCaptionEnqueue) {
    await enqueueCaptionsForProfile(profileId).catch((err) =>
      console.warn(
        `[google-media] Failed to enqueue captions for profile ${profileId}:`,
        err
      )
    );
  }

  return {
    added: creates.length,
    updated: updates.length,
    removed: staleIds.length,
    total: photos.length,
  };
}
