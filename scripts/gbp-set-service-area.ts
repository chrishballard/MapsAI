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
 * On place ids: Google wants the id of the city itself, which is what the
 * GBP dashboard stores when someone types a city into the service area box.
 * `localdom places` will not give you one, it only resolves businesses. The
 * ids already on a profile are city ids and can be copied between profiles.
 */
import { homedir } from "node:os";
import { join } from "node:path";
import { config } from "dotenv";

// Same two-file load as gbp-probe-service-area.ts: the profiles live in the
// Railway production DB, the repo .env carries the Google OAuth client, and
// dotenv keeps the first value it sees for a key.
config({
  path: [
    join(homedir(), ".config/vineyardgrowth/rankmaps-prod.env"),
    join(homedir(), "Projects/MapsAI/.env"),
  ],
  quiet: true,
});

type Prisma = (typeof import("../src/lib/prisma"))["prisma"];
let prisma: Prisma;

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const has = (name: string) => process.argv.includes(`--${name}`);

/** Every --add value, in order. */
function addedPlaces(): Array<{ placeId: string; placeName?: string }> {
  const out: Array<{ placeId: string; placeName?: string }> = [];
  process.argv.forEach((token, i) => {
    if (token !== "--add") return;
    const value = process.argv[i + 1];
    if (!value) throw new Error("--add needs a value");
    const eq = value.indexOf("=");
    if (eq === -1) {
      out.push({ placeId: value });
    } else {
      out.push({
        placeId: value.slice(0, eq).trim(),
        placeName: value.slice(eq + 1).trim() || undefined,
      });
    }
  });
  return out;
}

async function main() {
  const profileId = arg("profile");
  if (!profileId) {
    console.error(
      "usage: tsx scripts/gbp-set-service-area.ts --profile <id> [--add 'ChIJ...=City, ST, USA'] [--replace] [--write --yes]"
    );
    process.exit(1);
  }

  prisma = (await import("../src/lib/prisma")).prisma;
  const { fetchCurrentServiceArea, pushServiceAreaToGBP } = await import(
    "../src/lib/google-business-info"
  );

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

  const added = addedPlaces();
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
