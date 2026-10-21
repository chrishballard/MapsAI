import { prisma } from "@/lib/prisma";

/**
 * Save a profile's GBP description: update its latest ProfileDescription
 * row, or create the first one. Shared by the onboarding save route and
 * both push routes, because every writer has to take the same lock.
 *
 * The read-then-create runs under a per-profile advisory lock (the pattern
 * src/lib/image-upload.ts uses; it releases with the transaction). Without
 * it, two first saves landing together, a double click on Push or a Save
 * racing a Push, both found no row and both created one. The key is
 * namespaced so a description save never waits on a photo upload for the
 * same profile, which locks on the bare profile id.
 *
 * A changed description is unpushed until the caller pushes it again.
 */
export async function saveProfileDescription(
  profileId: string,
  content: string,
  isApproved: boolean
) {
  const lockKey = `profile-description:${profileId}`;
  return prisma.$transaction(async (tx) => {
    // $executeRaw, not $queryRaw: the lock function returns void, which
    // Prisma cannot deserialize as a result column.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`;

    const existing = await tx.profileDescription.findFirst({
      where: { profileId },
      orderBy: { updatedAt: "desc" },
    });

    if (existing) {
      return tx.profileDescription.update({
        where: { id: existing.id },
        data: {
          content,
          isApproved,
          isPushed: false,
          pushedAt: null,
        },
      });
    }

    return tx.profileDescription.create({
      data: { profileId, content, isApproved },
    });
  });
}
