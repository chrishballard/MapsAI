import type { Prisma } from "../generated/prisma/client";
import { prisma } from "./prisma";

/**
 * A Google location stored twice, under two logins (see storedRowFor in
 * google-locations.ts). The location sync no longer makes new pairs, but the
 * ones made before it stay until they are merged by hand, and onboarding the
 * second copy would have both copies posting and replying on one listing.
 */

/**
 * A where-clause that hides not-yet-onboarded rows whose location is already
 * onboarded under another row, for the "onboard a business" pickers.
 */
export async function hideCopiesOfOnboardedLocations(): Promise<Prisma.ProfileWhereInput> {
  const onboarded = await prisma.profile.findMany({
    where: { isOnboarded: true },
    select: { locationName: true },
  });
  if (onboarded.length === 0) return {};
  return {
    NOT: {
      isOnboarded: false,
      locationName: { in: onboarded.map((p) => p.locationName) },
    },
  };
}

/** The other row that already has this profile's location onboarded, if any. */
export async function onboardedCopyOf(
  profileId: string
): Promise<{ id: string; googleEmail: string } | null> {
  const profile = await prisma.profile.findUnique({
    where: { id: profileId },
    select: { locationName: true },
  });
  if (!profile) return null;
  const copy = await prisma.profile.findFirst({
    where: {
      locationName: profile.locationName,
      isOnboarded: true,
      id: { not: profileId },
    },
    select: { id: true, googleAccount: { select: { googleEmail: true } } },
  });
  return copy ? { id: copy.id, googleEmail: copy.googleAccount.googleEmail } : null;
}
