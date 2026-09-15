#!/usr/bin/env tsx
/**
 * Probe: can a profile with NO service area be given one through the API?
 *
 * This is the run behind the four numbered shapes in the pushServiceAreaToGBP
 * comment (google-business-info.ts). Every request is validateOnly=true, and
 * the raw error.details are dumped rather than run through
 * describeGoogleError, so the field violations can be quoted verbatim. Re-run
 * it if Google's answers ever look stale.
 *
 * Shapes:
 *   1  updateMask=serviceArea.places                 narrow mask from zero
 *   2  updateMask=serviceArea                        whole object, hybrid type
 *   3  updateMask=serviceArea,storefrontAddress      + the address echoed back
 *   4  updateMask=serviceArea.businessType           type alone, as a 1st step
 *
 * One shape per invocation on purpose: Google 429s this account after roughly
 * a dozen validate calls, so the spacing is the operator's to control
 * (--delay sleeps before the PATCH).
 *
 * Read what comes BACK, not just the status. Shape 2 answers HTTP 200 while
 * silently coercing businessType to CUSTOMER_LOCATION_ONLY, which on a real
 * write would take the client's address off the listing.
 *
 * Usage:
 *   tsx scripts/gbp-probe-service-area.ts --profile <id> --read
 *   tsx scripts/gbp-probe-service-area.ts --profile <id> --case <n> \
 *     --place-id <ChIJ...> [--place-name "Monroe, NC, USA"] [--delay 25000]
 */
import { homedir } from "node:os";
import { join } from "node:path";
import { config } from "dotenv";

// The local dev DB was wiped in June 2026, so the profiles live in the Railway
// production DB whose URL sits in the env file the `rankmaps` wrapper sources;
// the repo .env supplies the Google OAuth client. dotenv keeps the FIRST value
// it sees for a key, so the prod DATABASE_URL wins over the local one.
config({
  path: [
    join(homedir(), ".config/vineyardgrowth/rankmaps-prod.env"),
    join(homedir(), "Projects/MapsAI/.env"),
  ],
  quiet: true,
});

// Imported inside main(), not here: prisma.ts reads DATABASE_URL at module
// scope, and a static import is hoisted above the config() call above it.
type Prisma = typeof import("../src/lib/prisma")["prisma"];
let prisma: Prisma;

const BASE = "https://mybusinessbusinessinformation.googleapis.com/v1";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const has = (name: string) => process.argv.includes(`--${name}`);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Host and database only — never the credentials. */
function dbTarget(): string {
  try {
    const u = new URL(process.env.DATABASE_URL ?? "");
    return `${u.hostname}${u.port ? `:${u.port}` : ""}${u.pathname}`;
  } catch {
    return "<unset or unparseable>";
  }
}

async function main() {
  const profileId = arg("profile");
  if (!profileId) throw new Error("--profile <id> required");
  console.log(`DB: ${dbTarget()}`);

  prisma = (await import("../src/lib/prisma")).prisma;
  const { createGoogleClient } = await import("../src/lib/google");

  const profile = await prisma.profile.findUniqueOrThrow({
    where: { id: profileId },
    select: { id: true, name: true, googleAccountId: true, locationName: true },
  });
  const client = await createGoogleClient(profile.googleAccountId);

  console.log(`Profile: ${profile.name} (${profile.id})`);
  console.log(`Location: ${profile.locationName}\n`);

  async function read(mask: string) {
    const res = await client.request<Record<string, unknown>>({
      url: `${BASE}/${profile.locationName}?readMask=${encodeURIComponent(mask)}`,
      method: "GET",
    });
    return res.data;
  }

  if (has("read")) {
    const data = await read("title,storefrontAddress,serviceArea,categories,latlng");
    console.log(JSON.stringify(data, null, 2));
    await prisma.$disconnect();
    return;
  }

  // Cases are run one at a time from the command line so the operator
  // controls the spacing; Google 429s this account after ~a dozen validates.
  const caseArg = arg("case");
  if (!caseArg) throw new Error("--case <n> or --read required");
  if (!["1", "2", "3", "4"].includes(caseArg)) {
    throw new Error(`unknown case ${caseArg} (expected 1-4)`);
  }

  // Shape 4 is the one that deliberately sends no places. Everywhere else an
  // empty list would make the probe answer a different question than the one
  // asked, so it is an error rather than a silent []. Checked before the read
  // below, so a typo costs no quota.
  const placeId = arg("place-id");
  const placeName = arg("place-name");
  if (!placeId && caseArg !== "4") {
    throw new Error(`--place-id <ChIJ...> required for case ${caseArg}`);
  }
  const placeInfos = placeId
    ? [placeName ? { placeId, placeName } : { placeId }]
    : [];

  const current = await read("storefrontAddress,serviceArea");
  const storefrontAddress = current.storefrontAddress;
  const serviceArea = current.serviceArea;
  console.log("current serviceArea:", JSON.stringify(serviceArea ?? null));
  console.log("current storefrontAddress present:", Boolean(storefrontAddress));

  const cases: Record<string, { mask: string; body: Record<string, unknown> }> = {
    // 1. narrow mask, from zero
    "1": {
      mask: "serviceArea.places",
      body: { serviceArea: { places: { placeInfos } } },
    },
    // 2. whole object, naming the hybrid type explicitly
    "2": {
      mask: "serviceArea",
      body: {
        serviceArea: {
          businessType: "CUSTOMER_AND_BUSINESS_LOCATION",
          places: { placeInfos },
        },
      },
    },
    // 3. service area + the existing address echoed back unchanged
    "3": {
      mask: "serviceArea,storefrontAddress",
      body: {
        serviceArea: {
          businessType: "CUSTOMER_AND_BUSINESS_LOCATION",
          places: { placeInfos },
        },
        storefrontAddress,
      },
    },
    // 4. business type alone, as a first step
    "4": {
      mask: "serviceArea.businessType",
      body: {
        serviceArea: { businessType: "CUSTOMER_AND_BUSINESS_LOCATION" },
      },
    },
  };

  const chosen = cases[caseArg];

  const delay = Number(arg("delay") ?? 0);
  if (delay) await sleep(delay);

  console.log(`\n--- case ${caseArg} ---`);
  console.log(`updateMask=${chosen.mask}`);
  console.log(`body=${JSON.stringify(chosen.body, null, 2)}`);

  try {
    const res = await client.request({
      url: `${BASE}/${profile.locationName}?updateMask=${encodeURIComponent(chosen.mask)}&validateOnly=true`,
      method: "PATCH",
      data: chosen.body,
    });
    console.log(`\nVALIDATED (HTTP ${res.status})`);
    console.log(JSON.stringify(res.data, null, 2));
  } catch (error: unknown) {
    const e = error as { response?: { status?: number; data?: unknown }; message?: string };
    console.log(`\nREJECTED (HTTP ${e.response?.status ?? "?"})`);
    console.log(JSON.stringify(e.response?.data ?? e.message, null, 2));
  }

  await prisma.$disconnect();
}

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect().catch(() => {});
  process.exit(1);
});
