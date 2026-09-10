#!/usr/bin/env tsx
/**
 * Refresh Google's own description + service items for one or more profiles.
 *
 * The full location sync (syncLocationsForAccount) does this for every
 * location on an account. This is the narrow version: refresh named profiles,
 * or every connected profile that has never been read, without touching the
 * location list or the isConnected sweep.
 *
 * Usage:
 *   pnpm tsx scripts/sync-google-profile-state.ts <profileId> [<profileId>...]
 *   pnpm tsx scripts/sync-google-profile-state.ts --stale   # never-synced profiles
 *   pnpm tsx scripts/sync-google-profile-state.ts --all     # every connected profile
 *
 * Read-only against Google (locations.get); the only writes are the three
 * google* columns on Profile.
 */
import "dotenv/config";
import { prisma } from "../src/lib/prisma";
import { fetchGoogleProfileState } from "../src/lib/google-business-info";

async function main() {
  const args = process.argv.slice(2);
  const wantStale = args.includes("--stale");
  const wantAll = args.includes("--all");
  const ids = args.filter((a) => !a.startsWith("--"));

  if (!ids.length && !wantStale && !wantAll) {
    console.error(
      "usage: sync-google-profile-state.ts <profileId>... | --stale | --all"
    );
    process.exit(1);
  }

  const profiles = await prisma.profile.findMany({
    where: ids.length
      ? { id: { in: ids } }
      : wantAll
        ? { isConnected: true }
        : { isConnected: true, googleProfileSyncedAt: null },
    select: { id: true, name: true, googleAccountId: true, locationName: true },
    orderBy: { name: "asc" },
  });

  if (!profiles.length) {
    console.error("no matching profiles");
    process.exit(2);
  }

  let ok = 0;
  for (const profile of profiles) {
    try {
      const state = await fetchGoogleProfileState({
        googleAccountId: profile.googleAccountId,
        locationName: profile.locationName,
      });
      await prisma.profile.update({
        where: { id: profile.id },
        data: {
          googleDescription: state.description,
          googleServiceItems: state.serviceItems as never,
          googleProfileSyncedAt: new Date(),
        },
      });
      ok++;
      console.log(
        `${profile.id}  ${profile.name}  description ${state.description.length} chars  ` +
          `serviceItems ${state.serviceItems.length}`
      );
    } catch (err) {
      // Leave the stored values alone: a blank we wrote on a failed read
      // would be indistinguishable from Google saying the field is empty.
      console.error(
        `${profile.id}  ${profile.name}  FAILED: ${err instanceof Error ? err.message : err}`
      );
    }
  }

  console.error(`${ok}/${profiles.length} profiles refreshed`);
  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
