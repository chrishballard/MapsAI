import type { Prisma } from "../generated/prisma/client";
import { prisma } from "./prisma";

/**
 * A Google location stored twice, under two logins (see storedRowFor in
 * google-locations.ts). The location sync no longer makes new pairs, but the
 * ones made before it stay until they are merged by hand, and onboarding the
 * second copy would have both copies posting and replying on one listing.
 *
 * A copy counts as active when it is onboarded or reviews-only: a
 * reviews-only profile still syncs and auto-publishes replies.
 */
const ACTIVE: Prisma.ProfileWhereInput = {
  OR: [{ isOnboarded: true }, { reviewsOnly: true }],
};

/**
 * A where-clause that hides inactive rows whose location is active under
 * another row, for the "onboard a business" pickers.
 */
export async function hideCopiesOfActiveLocations(): Promise<Prisma.ProfileWhereInput> {
  const active = await prisma.profile.findMany({
    where: ACTIVE,
    select: { locationName: true },
  });
  if (active.length === 0) return {};
  return {
    NOT: {
      isOnboarded: false,
      reviewsOnly: false,
      locationName: { in: active.map((p) => p.locationName) },
    },
  };
}

export interface ActiveCopy {
  id: string;
  name: string;
  googleEmail: string;
  isConnected: boolean;
}

/** The other row that already has this profile's location active, if any. */
export async function activeCopyOf(profileId: string): Promise<ActiveCopy | null> {
  const profile = await prisma.profile.findUnique({
    where: { id: profileId },
    select: { locationName: true },
  });
  if (!profile) return null;
  const copy = await prisma.profile.findFirst({
    where: {
      ...ACTIVE,
      locationName: profile.locationName,
      id: { not: profileId },
    },
    select: {
      id: true,
      name: true,
      isConnected: true,
      googleAccount: { select: { googleEmail: true } },
    },
  });
  return copy
    ? {
        id: copy.id,
        name: copy.name,
        googleEmail: copy.googleAccount.googleEmail,
        isConnected: copy.isConnected,
      }
    : null;
}

/** What to tell someone about to onboard a copy of an active location. */
export function activeCopyMessage(copy: ActiveCopy): string {
  return copy.isConnected
    ? `This business is already managed through ${copy.googleEmail}. Manage it from that profile instead.`
    : `This business is already onboarded through ${copy.googleEmail}, but that copy is disconnected. Merge or offboard that copy first, or both would post and reply once it reconnects.`;
}
