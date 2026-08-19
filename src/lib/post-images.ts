import { prisma } from "./prisma";
import { syncProfileMediaToLibrary } from "./google-media";

// Don't hammer the GBP media API from the generation pipeline — an
// on-demand sync only fires when the library is empty and the last sync is
// at least this old. The Images page button syncs unconditionally.
const AUTO_SYNC_MIN_INTERVAL_MS = 24 * 60 * 60 * 1000;

/**
 * Pick one library image id per post, rotating through the approved pool
 * least-recently-used first (never-used images come before everything
 * else). When the batch is larger than the pool, images repeat in order.
 *
 * Never throws and pads with nulls when the profile has no usable images —
 * an image problem must never fail post generation; posts just go out
 * text-only, exactly as before this feature existed.
 */
export async function pickImagesForPosts(
  profileId: string,
  count: number
): Promise<(string | null)[]> {
  if (count <= 0) return [];
  const none: (string | null)[] = new Array(count).fill(null);

  try {
    let pool = await approvedImageIds(profileId);

    // Empty library: try filling it from the profile's existing GBP photos.
    if (pool.length === 0 && (await shouldAutoSync(profileId))) {
      try {
        await syncProfileMediaToLibrary(profileId);
        pool = await approvedImageIds(profileId);
      } catch (err) {
        console.warn(
          `[post-images] GBP media auto-sync failed for profile ${profileId}:`,
          err
        );
      }
    }

    if (pool.length === 0) return none;

    return Array.from({ length: count }, (_, i) => pool[i % pool.length]);
  } catch (err) {
    console.warn(
      `[post-images] Image selection failed for profile ${profileId}:`,
      err
    );
    return none;
  }
}

/** Record that images were attached to posts so the rotation moves on. */
export async function markImagesUsed(imageIds: string[]): Promise<void> {
  if (imageIds.length === 0) return;

  const counts = new Map<string, number>();
  for (const id of imageIds) {
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }

  const now = new Date();
  await prisma.$transaction(
    [...counts.entries()].map(([id, uses]) =>
      prisma.profileImage.update({
        where: { id },
        data: { timesUsed: { increment: uses }, lastUsedAt: now },
        // Never return the row's multi-MB image bytes just to discard them.
        select: { id: true },
      })
    )
  );
}

/**
 * True when an insert/update failed because a referenced ProfileImage row
 * vanished mid-flight (deleted from the Images page or by a concurrent GBP
 * sync). Callers retry the batch without images instead of losing it.
 */
export function isImageFkViolation(err: unknown): boolean {
  const e = err as {
    code?: string;
    meta?: {
      constraint?: unknown;
      driverAdapterError?: {
        cause?: { constraint?: { index?: unknown; fields?: unknown[] } };
      };
    };
  };
  if (e?.code !== "P2003") return false;
  // With the pg driver adapter the constraint lands nested under
  // meta.driverAdapterError (as a constraint name or column list); Prisma's
  // classic engines put it flat at meta.constraint.
  const adapterConstraint = e.meta?.driverAdapterError?.cause?.constraint;
  const candidates = [
    e.meta?.constraint,
    adapterConstraint?.index,
    ...(adapterConstraint?.fields ?? []),
  ];
  return candidates.some((c) => String(c ?? "").includes("imageId"));
}

async function approvedImageIds(profileId: string): Promise<string[]> {
  const rows = await prisma.profileImage.findMany({
    where: { profileId, status: "APPROVED" },
    orderBy: [
      { lastUsedAt: { sort: "asc", nulls: "first" } },
      { timesUsed: "asc" },
      { createdAt: "asc" },
    ],
    select: { id: true },
  });
  return rows.map((r) => r.id);
}

async function shouldAutoSync(profileId: string): Promise<boolean> {
  const profile = await prisma.profile.findUnique({
    where: { id: profileId },
    select: { mediaSyncedAt: true, accountResourceName: true },
  });
  if (!profile?.accountResourceName) return false;
  if (!profile.mediaSyncedAt) return true;
  return Date.now() - profile.mediaSyncedAt.getTime() > AUTO_SYNC_MIN_INTERVAL_MS;
}
