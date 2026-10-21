#!/usr/bin/env tsx
/**
 * Set the service-area places on one profile, through pushServiceAreaToGBP.
 *
 * Rehearsal by default. A real write needs BOTH --write and --yes, the same
 * convention the localdom CLI uses for anything irreversible, because this
 * edits a live Google listing that clients and the public see.
 *
 * Usage:
 *   tsx scripts/gbp-set-service-area.ts --profile <id>
 *   tsx scripts/gbp-set-service-area.ts --profile <id> --add 'ChIJ...=Lehi, UT, USA'
 *   tsx scripts/gbp-set-service-area.ts --profile <id> --add '...' --replace
 *   tsx scripts/gbp-set-service-area.ts --profile <id> --add '...' --write --yes
 *
 * --add appends to what is already there (repeatable). --replace makes the
 * --add list the whole new set instead, which DROPS every place not named.
 *
 * --add-city 'American Fork, UT' looks the city up through the Geocoding API
 * and needs GOOGLE_GEOCODING_API_KEY. --add takes a raw id instead, for ids
 * copied off another profile, which is how this worked before there was a key.
 *
 * On place ids: Google wants the id of the city itself, which is what the
 * GBP dashboard stores when someone types a city into the service area box.
 * `localdom places` will not give you one, it only resolves businesses.
 */
import { homedir } from "node:os";
import { join } from "node:path";
import { config } from "dotenv";
import {
  assertKnownArgs,
  CliArgError,
  flagValue,
  flagValues,
  hasFlag,
} from "./cli-args";

// Same two-file load as gbp-probe-service-area.ts: the profiles live in the
// Railway production DB, the repo .env carries the Google OAuth client, and
// dotenv keeps the first value it sees for a key.
config({
  path: [
    join(homedir(), ".config/vineyardgrowth/google-geocoding.env"),
    join(homedir(), ".config/vineyardgrowth/rankmaps-prod.env"),
    join(homedir(), "Projects/MapsAI/.env"),
  ],
  quiet: true,
});

type Prisma = (typeof import("../src/lib/prisma"))["prisma"];
let prisma: Prisma;

const argv = process.argv.slice(2);
const has = (name: string) => hasFlag(argv, name);

const USAGE =
  "usage: tsx scripts/gbp-set-service-area.ts --profile <id> [--add-city 'American Fork, UT'] [--add 'ChIJ...=City, ST, USA'] [--replace] [--write --yes]";

/** Every --add value, in order. */
function addedPlaces(): Array<{ placeId: string; placeName?: string }> {
  return flagValues(argv, "add").map((value) => {
    const eq = value.indexOf("=");
    if (eq === -1) return { placeId: value };
    return {
      placeId: value.slice(0, eq).trim(),
      placeName: value.slice(eq + 1).trim() || undefined,
    };
  });
}

async function main() {
  // Every flag is read before anything is looked up or sent, so a bad
  // command line stops here. A value flag never takes another flag as its
  // value: `--add --write --yes` used to send the place id "--write". And
  // nothing unknown is ignored: `--add=ChIJb` used to vanish from a replace.
  let profileId: string | undefined;
  let added: Array<{ placeId: string; placeName?: string }>;
  let cityQueries: string[];
  try {
    assertKnownArgs(argv, {
      valueFlags: ["profile", "add", "add-city"],
      booleanFlags: ["replace", "write", "yes"],
    });
    profileId = flagValue(argv, "profile");
    added = addedPlaces();
    cityQueries = flagValues(argv, "add-city");
  } catch (error) {
    if (!(error instanceof CliArgError)) throw error;
    console.error(error.message);
    console.error(USAGE);
    process.exit(1);
  }
  if (!profileId) {
    console.error(USAGE);
    process.exit(1);
  }

  prisma = (await import("../src/lib/prisma")).prisma;
  const { fetchCurrentServiceArea, pushServiceAreaToGBP } = await import(
    "../src/lib/google-business-info"
  );
  const { resolveAreaPlaceId } = await import("../src/lib/google-geocode");

  const profile = await prisma.profile.findUniqueOrThrow({
    where: { id: profileId },
    select: { id: true, name: true, googleAccountId: true, locationName: true },
  });
  const target = {
    googleAccountId: profile.googleAccountId,
    locationName: profile.locationName,
  };

  const current = await fetchCurrentServiceArea(target);
  const existing = (current?.places?.placeInfos ?? []).filter((p) => p.placeId);

  console.log(`Profile:  ${profile.name} (${profile.id})`);
  console.log(`Location: ${profile.locationName}`);
  console.log(`Type:     ${current?.businessType ?? "(no service area yet)"}`);
  console.log(`\nNow (${existing.length}):`);
  for (const p of existing) console.log(`  - ${p.placeName ?? p.placeId}`);

  // Cities are resolved before anything is sent, and one bad lookup stops
  // the run: half a service area is worse than none, and a --replace with a
  // city missing would silently drop the rest.
  for (const query of cityQueries) {
    const outcome = await resolveAreaPlaceId(query);
    if (!outcome.ok) {
      console.error(`\nCould not resolve "${query}": ${outcome.error}`);
      await prisma.$disconnect();
      process.exit(1);
    }
    console.log(`Resolved "${query}" to ${outcome.place.placeName}`);
    added.push({
      placeId: outcome.place.placeId,
      placeName: outcome.place.placeName,
    });
  }

  const replace = has("replace");
  if (added.length === 0 && !replace) {
    console.log("\nNo --add given, so this would send the current list back unchanged.");
  }

  // De-duplicate on placeId: Google counts a repeat against the cap of 20,
  // and an accidental double --add should not silently cost a slot.
  const merged = replace ? added : [...existing, ...added];
  const places: Array<{ placeId: string; placeName?: string }> = [];
  const seen = new Set<string>();
  for (const p of merged) {
    if (seen.has(p.placeId)) continue;
    seen.add(p.placeId);
    places.push({ placeId: p.placeId, placeName: p.placeName });
  }

  const dropped = existing.filter((p) => !seen.has(p.placeId));
  console.log(`\nAfter (${places.length}):`);
  for (const p of places) {
    const isNew = !existing.some((e) => e.placeId === p.placeId);
    console.log(`  ${isNew ? "+" : " "} ${p.placeName ?? p.placeId}`);
  }
  if (dropped.length > 0) {
    console.log(`\nWOULD DROP ${dropped.length}:`);
    for (const p of dropped) console.log(`  - ${p.placeName ?? p.placeId}`);
  }

  const real = has("write") && has("yes");
  if (has("write") && !has("yes")) {
    console.log("\n--write needs --yes as well. Nothing sent.");
    await prisma.$disconnect();
    process.exit(1);
  }

  console.log(
    real
      ? "\nWRITING FOR REAL — this changes the live Google listing.\n"
      : "\nRehearsal (validateOnly=true). Nothing on this profile will change.\n"
  );

  const result = await pushServiceAreaToGBP({
    ...target,
    places,
    validateOnly: !real,
  });

  if (result.success) {
    console.log(real ? "OK — written and verified." : "OK — validated.");
  } else if (result.wrote) {
    // The edit landed and the read-back found a problem. Not a retry case.
    console.log("WRITTEN BUT WRONG — a person needs to look at the listing:");
    console.log(`  ${result.error}`);
  } else {
    console.log("REFUSED — nothing was sent:");
    console.log(`  ${result.error}`);
  }

  await prisma.$disconnect();
  process.exit(result.success ? 0 : 1);
}

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect().catch(() => {});
  process.exit(1);
});
