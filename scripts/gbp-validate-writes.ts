#!/usr/bin/env tsx
/**
 * Dry-run every GBP write path against a real profile.
 *
 * Each push is called with validateOnly=true and the profile's CURRENT value,
 * so Google runs its full validation and returns without changing anything. A
 * failure here is a payload-shape problem in our code, not a bad edit. Run
 * this before the first real push to a client profile, and again whenever a
 * push function changes.
 *
 * Usage:
 *   tsx scripts/gbp-validate-writes.ts --profile <profileId>
 *   tsx scripts/gbp-validate-writes.ts --profile <profileId> --delay 15000
 *
 * Google rate-limits this account hard — a 429 came back after roughly a
 * dozen validate calls in a row — so the checks are spaced out (default 8s)
 * and the run stops on the first 429 rather than retrying into the limit.
 *
 * Two paths cannot be dry-run and are reported as skipped, not passed:
 *   - locations.updateAttributes takes only `name` and `attributeMask`; the
 *     discovery document has no validateOnly.
 *   - v4 media:create has no validateOnly either, so the first logo, cover or
 *     photo upload is necessarily a real one.
 */
import "dotenv/config";
import { prisma } from "../src/lib/prisma";
import {
  fetchCurrentHours,
  fetchCurrentSpecialHours,
  fetchCurrentWebsiteUri,
  fetchCurrentCategories,
  fetchCurrentTitle,
  fetchCurrentPhoneNumbers,
  fetchCurrentServiceArea,
  fetchCurrentDescription,
  fetchCurrentServices,
  pushHoursToGBP,
  pushSpecialHoursToGBP,
  pushWebsiteToGBP,
  pushCategoriesToGBP,
  pushTitleToGBP,
  pushPhoneNumbersToGBP,
  pushServiceAreaToGBP,
  pushDescriptionToGBP,
  pushServicesToGBP,
  type GBPWriteResult,
} from "../src/lib/google-business-info";

type Outcome =
  | { kind: "pass"; label: string }
  | { kind: "fail"; label: string; error: string }
  | { kind: "skip"; label: string; why: string };

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

class RateLimited extends Error {}

async function check(
  label: string,
  run: () => Promise<GBPWriteResult>
): Promise<Outcome> {
  const result = await run();
  if (result.success) return { kind: "pass", label };
  if (/RESOURCE_EXHAUSTED|rate limit|Quota exceeded|429/i.test(result.error ?? "")) {
    throw new RateLimited(`${label}: ${result.error}`);
  }
  return { kind: "fail", label, error: result.error ?? "unknown error" };
}

async function main() {
  const profileId = arg("profile");
  if (!profileId) {
    console.error("usage: tsx scripts/gbp-validate-writes.ts --profile <profileId>");
    process.exit(1);
  }
  const delay = Number(arg("delay") ?? 8000);

  const profile = await prisma.profile.findUniqueOrThrow({
    where: { id: profileId },
    select: {
      id: true,
      name: true,
      googleAccountId: true,
      locationName: true,
      accountResourceName: true,
    },
  });
  const target = {
    googleAccountId: profile.googleAccountId,
    locationName: profile.locationName,
    validateOnly: true as const,
  };

  console.log(`Profile: ${profile.name} (${profile.id})`);
  console.log(`Location: ${profile.locationName}`);
  console.log(`validateOnly=true — nothing on this profile will change.\n`);

  const outcomes: Outcome[] = [];
  const queue: Array<() => Promise<Outcome>> = [];

  const [
    hours,
    specialHours,
    websiteUri,
    categories,
    title,
    phoneNumbers,
    serviceArea,
    description,
    services,
  ] = await Promise.all([
    fetchCurrentHours(profile),
    fetchCurrentSpecialHours(profile),
    fetchCurrentWebsiteUri(profile),
    fetchCurrentCategories(profile),
    fetchCurrentTitle(profile),
    fetchCurrentPhoneNumbers(profile),
    fetchCurrentServiceArea(profile),
    fetchCurrentDescription(profile),
    fetchCurrentServices(profile),
  ]);

  if (hours) {
    queue.push(() => check("regularHours", () => pushHoursToGBP({ ...target, regularHours: hours })));
  } else outcomes.push({ kind: "skip", label: "regularHours", why: "not set on this profile" });

  if (specialHours) {
    queue.push(() =>
      check("specialHours", () => pushSpecialHoursToGBP({ ...target, specialHours }))
    );
  } else outcomes.push({ kind: "skip", label: "specialHours", why: "not set on this profile" });

  if (websiteUri) {
    queue.push(() => check("websiteUri", () => pushWebsiteToGBP({ ...target, websiteUri })));
  } else outcomes.push({ kind: "skip", label: "websiteUri", why: "not set on this profile" });

  if (categories?.primaryCategory?.name) {
    queue.push(() =>
      check("categories", () =>
        pushCategoriesToGBP({
          ...target,
          primaryCategoryId: categories.primaryCategory!.name,
          additionalCategoryIds: (categories.additionalCategories ?? []).map((c) => c.name),
        })
      )
    );
  } else outcomes.push({ kind: "skip", label: "categories", why: "no primary category" });

  if (title) {
    queue.push(() => check("title", () => pushTitleToGBP({ ...target, title })));
  } else outcomes.push({ kind: "skip", label: "title", why: "not set on this profile" });

  if (phoneNumbers?.primaryPhone) {
    queue.push(() =>
      check("phoneNumbers", () =>
        pushPhoneNumbersToGBP({
          ...target,
          primaryPhone: phoneNumbers.primaryPhone,
          additionalPhones: phoneNumbers.additionalPhones,
        })
      )
    );
  } else outcomes.push({ kind: "skip", label: "phoneNumbers", why: "no primary phone" });

  const placeIds = (serviceArea?.places?.placeInfos ?? [])
    .map((p) => p.placeId)
    .filter((id): id is string => Boolean(id));
  if (placeIds.length > 0) {
    queue.push(() =>
      check("serviceArea.places", () => pushServiceAreaToGBP({ ...target, placeIds }))
    );
  } else {
    outcomes.push({
      kind: "skip",
      label: "serviceArea.places",
      why: "no service-area places on this profile",
    });
  }

  if (description) {
    queue.push(() =>
      check("profile.description", () => pushDescriptionToGBP({ ...target, description }))
    );
  } else {
    outcomes.push({ kind: "skip", label: "profile.description", why: "not set on this profile" });
  }

  if (services.serviceItems.length > 0) {
    queue.push(() =>
      check("serviceItems", () =>
        pushServicesToGBP({ ...target, serviceItems: services.serviceItems })
      )
    );
  } else {
    outcomes.push({ kind: "skip", label: "serviceItems", why: "no services on this profile" });
  }

  outcomes.push({
    kind: "skip",
    label: "attributes",
    why: "locations.updateAttributes has no validateOnly parameter",
  });
  outcomes.push({
    kind: "skip",
    label: "media (logo / cover / photo)",
    why: "v4 media:create has no validateOnly parameter",
  });

  let rateLimited: string | null = null;
  for (const [index, run] of queue.entries()) {
    try {
      outcomes.push(await run());
    } catch (error) {
      if (error instanceof RateLimited) {
        rateLimited = error.message;
        break;
      }
      throw error;
    }
    if (index < queue.length - 1) await sleep(delay);
  }

  const pass = outcomes.filter((o) => o.kind === "pass").length;
  const fail = outcomes.filter((o) => o.kind === "fail").length;

  console.log("Results");
  for (const o of outcomes) {
    if (o.kind === "pass") console.log(`  PASS  ${o.label}`);
    else if (o.kind === "fail") console.log(`  FAIL  ${o.label} — ${o.error}`);
    else console.log(`  SKIP  ${o.label} — ${o.why}`);
  }
  console.log(`\n${pass} validated, ${fail} failed.`);
  if (rateLimited) {
    console.log(`\nStopped early: Google rate-limited the account (${rateLimited}).`);
    console.log("Wait a few minutes and re-run with a larger --delay.");
  }

  await prisma.$disconnect();
  process.exit(fail > 0 ? 1 : 0);
}

main();
