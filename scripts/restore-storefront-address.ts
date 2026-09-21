#!/usr/bin/env tsx
/**
 * Put a client's storefront address back on their Google Business Profile.
 *
 * This is the undo for the one unrecoverable mistake in this codebase. Losing
 * a storefront address takes the location off the map pin, turns the business
 * into a service-area listing, and getting it back the slow way means
 * re-verification by postcard. storefrontRemovalRisk in
 * src/lib/google-business-info.ts stops the writes that are known to cause it;
 * this is what to run if one ever gets through anyway, or if someone clears
 * the address by hand in the GBP dashboard.
 *
 * Usage:
 *   tsx scripts/restore-storefront-address.ts <profileId>
 *   tsx scripts/restore-storefront-address.ts <profileId> --snapshot <path>
 *   tsx scripts/restore-storefront-address.ts <profileId> --write --yes
 *   tsx scripts/restore-storefront-address.ts <profileId> --write --yes --overwrite-existing
 *
 * REHEARSAL BY DEFAULT. With no flags this validates the address against
 * Google and stops; nothing on the listing changes. A real write needs BOTH
 * --write and --yes, the same convention gbp-set-service-area.ts uses for
 * anything that edits a live Google listing, and one of the two on its own is
 * refused rather than read as intent. --validate-only is still accepted, as
 * an explicit spelling of what the default already does, and it wins if it is
 * passed alongside --write --yes: the safe reading of a contradictory command
 * line is the one that changes nothing.
 *
 * ONE PROFILE PER RUN, AND THE SNAPSHOT HAS TO NAME IT. Two profile ids on the
 * command line, a --snapshot with no path after it, and a snapshot whose
 * `profile_id` is some other profile are all refused before anything is sent.
 * A restore that writes the wrong client's address is the same unrecoverable
 * loss this script exists to undo, one street further along.
 *
 * IT RESTORES AN ADDRESS; IT DOES NOT REPLACE ONE. In write mode, if the live
 * listing still has a storefrontAddress, there is nothing to restore and the
 * run refuses. --overwrite-existing is how to say that replacing it is the
 * intent, and it is only accepted alongside --write --yes. Both addresses are
 * printed together first either way.
 *
 * THE FIRST REAL RUN MUST BE ONE PROFILE, watched. Rehearse it first, then
 * run it with --write --yes, read the storefrontAddress and serviceArea it
 * prints back, then open the listing in Maps and look at it. Never loop this
 * over a roster: Google renormalizes addresses on write (["4108 Park Rd",
 * "Suite 106"] came back as ["4108 Park Road Suite 106"] under validateOnly),
 * so the result needs a person's eyes, not a pass/fail tally. Section 4 of
 * ~/VineyardGrowth/productization/skills/gbp-audit/mapsai-address-safety-prompt.md.
 *
 * Where the address comes from: the `before-<date>.json` that gbp-audit froze
 * for this profile, at `fields.address.value`, exactly as Google returned it.
 * Nothing is reconstructed here. See scripts/storefront-snapshot.ts.
 *
 * On the PATCH being inline rather than through patchLocation: patchLocation
 * is module-private and there is no exported push that writes
 * storefrontAddress on its own (pushServiceAreaToGBP names it, but only
 * alongside a service area, which is not what a restore should touch). So the
 * request is built here the way scripts/gbp-probe-service-area.ts builds its
 * own, and the guard is called explicitly: storefrontRemovalRisk runs on this
 * mask and body before anything leaves the process, exactly as it does inside
 * patchLocation. If a `pushStorefrontAddressToGBP` is ever added to
 * src/lib/google-business-info.ts, this should call that instead.
 *
 * Exit codes: 0 restored or validated, 1 Google refused or the read-back
 * failed, 2 refused here before anything was sent.
 */
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { readFileSync } from "node:fs";
import { config } from "dotenv";

// Same two-file load as gbp-probe-service-area.ts: the profiles live in the
// Railway production DB whose URL sits in the env file the `rankmaps` wrapper
// sources, and the repo .env supplies the Google OAuth client. dotenv keeps
// the FIRST value it sees for a key, so a DATABASE_URL already exported in the
// shell wins over both.
config({
  path: [
    join(homedir(), ".config/vineyardgrowth/rankmaps-prod.env"),
    join(homedir(), "Projects/MapsAI/.env"),
  ],
  quiet: true,
});

// Imported inside main(), not here: prisma.ts reads DATABASE_URL at module
// scope, and a static import is hoisted above the config() call above it.
type Prisma = (typeof import("../src/lib/prisma"))["prisma"];

const BASE = "https://mybusinessbusinessinformation.googleapis.com/v1";
const UPDATE_MASK = "storefrontAddress";
const READ_MASK = "storefrontAddress,serviceArea";

interface LocationState {
  storefrontAddress?: Record<string, unknown>;
  serviceArea?: { businessType?: string };
}

export const USAGE =
  "usage: tsx scripts/restore-storefront-address.ts <profileId> " +
  "[--snapshot <path>] [--write --yes [--overwrite-existing]]";

/** rehearse validates against Google and stops; write edits the listing. */
export type RunMode = "rehearse" | "write";

export type ParsedArgs =
  | {
      ok: true;
      profileId: string;
      snapshot?: string;
      mode: RunMode;
      overwriteExisting: boolean;
    }
  | { ok: false; exitCode: 1 | 2; message: string };

const refuse = (message: string): ParsedArgs => ({
  ok: false,
  exitCode: 2,
  message: `REFUSED: nothing sent. ${message}`,
});

/**
 * The whole command line, decided in one pure function.
 *
 * `argv` is process.argv.slice(2). The profile id is positional, so flags and
 * the value that follows --snapshot are stepped over while looking for it.
 *
 * Nothing on this command line is ignored. That is the rule the refusals
 * below come from, and it is worth stating because the opposite is the usual
 * convention: most tools take the first of a repeated argument and drop the
 * rest. Here every extra token is somebody part-way through editing the
 * command, and the outcome that must never follow from a half-edited command
 * is a write to the wrong client's listing. So a second profile id, a second
 * --snapshot, a --snapshot with no path after it, a lone --write, a lone
 * --yes, and an --overwrite-existing that is not backing a real write are all
 * refused here, before a database handle or a Google client exists in the
 * process.
 */
export function parseArgs(argv: string[]): ParsedArgs {
  const positionals: string[] = [];
  const snapshots: string[] = [];
  let danglingSnapshot = false;

  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];

    if (token === "--snapshot") {
      const value = argv[i + 1];
      // A flag is not a path. Swallowing the next token whatever it is turns
      // `--snapshot --write --yes` into a rehearsal of a file called
      // "--write", which then fails for a reason that says nothing about the
      // missing path.
      if (value === undefined || value.startsWith("--")) {
        danglingSnapshot = true;
        continue;
      }
      snapshots.push(value);
      i++;
      continue;
    }

    if (token.startsWith("--")) continue;
    positionals.push(token);
  }

  if (danglingSnapshot) {
    return refuse(
      "--snapshot was given with no path after it. Name the before-<date>.json " +
        "to restore from, or drop --snapshot and let the profile's vault folder " +
        "choose the newest one."
    );
  }

  if (snapshots.length > 1) {
    return refuse(
      `--snapshot was given more than once (${snapshots.join(", ")}). Two frozen ` +
        "addresses are two different restores, and which one this would have used " +
        "is not something to leave to argument order. Name the one you mean."
    );
  }

  if (positionals.length === 0) return { ok: false, exitCode: 1, message: USAGE };

  if (positionals.length > 1) {
    return refuse(
      `more than one profile id on the command line (${positionals.join(", ")}). ` +
        "This restores one listing at a time and never loops a roster: Google " +
        "renormalizes an address on write, so every result needs a person's eyes. " +
        "Run it once per profile."
    );
  }

  const write = argv.includes("--write");
  const yes = argv.includes("--yes");
  if (write !== yes) {
    const given = write ? "--write" : "--yes";
    const missing = write ? "--yes" : "--write";
    return refuse(
      `${given} on its own does not restore anything. A real write needs both ` +
        `--write and --yes; add ${missing} to write, or drop ${given} to rehearse.`
    );
  }

  const overwriteExisting = argv.includes("--overwrite-existing");
  if (overwriteExisting && !write) {
    return refuse(
      "--overwrite-existing only means something alongside --write --yes. On its " +
        "own it asks to replace an address on a listing this run was never going " +
        "to touch. Drop it to rehearse, or add --write --yes."
    );
  }

  const validateOnly = argv.includes("--validate-only");
  return {
    ok: true,
    profileId: positionals[0],
    snapshot: snapshots[0],
    mode: write && !validateOnly ? "write" : "rehearse",
    overwriteExisting,
  };
}

/**
 * The URL of the PATCH, built in one place so the rehearsal cannot lose its
 * validateOnly by accident.
 *
 * Nothing else in this script decides whether a request is real. Inlined in
 * main() the difference between a rehearsal and a write was a `&validateOnly=true`
 * concatenated onto a template string, which no test could see and which would
 * have gone on passing every test in the suite if it were deleted.
 */
export function patchUrl(
  locationName: string,
  updateMask: string,
  mode: RunMode
): string {
  return (
    `${BASE}/${locationName}?updateMask=${encodeURIComponent(updateMask)}` +
    (mode === "rehearse" ? "&validateOnly=true" : "")
  );
}

/**
 * Whether a listing is carrying a storefrontAddress at all.
 *
 * Deliberately looser than the read-back check at the end of main(), which
 * asks whether a real street address LANDED and so insists on addressLines.
 * This one asks whether there is anything here to lose, and answers yes to a
 * remnant that Google would not render, because the two mistakes are not the
 * same size: a needless refusal costs one flag, and overwriting an address
 * that was really there costs re-verification by postcard.
 */
export function carriesStorefrontAddress(value: unknown): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.keys(value).length > 0
  );
}

export type OverwriteDecision =
  | { action: "proceed" }
  | { action: "refuse"; message: string };

/**
 * Whether to send the PATCH, given what the live GET came back with.
 *
 * Pure, and separate from main(), because the branch it decides is the one
 * that cannot be reached in a test without calling Google.
 *
 * A rehearsal proceeds whatever the listing holds: validateOnly changes
 * nothing, and seeing Google accept the frozen address is the point of
 * rehearsing. A write proceeds only onto a listing with no address on it,
 * which is the situation this script was written for. An address already
 * there means the premise is wrong, and the run stops rather than quietly
 * replacing it.
 */
export function decideOverwrite(
  liveAddress: unknown,
  flags: { mode: RunMode; overwriteExisting: boolean }
): OverwriteDecision {
  if (flags.mode === "rehearse") return { action: "proceed" };
  if (!carriesStorefrontAddress(liveAddress)) return { action: "proceed" };
  if (flags.overwriteExisting) return { action: "proceed" };

  return {
    action: "refuse",
    message:
      "the listing already has an address; nothing to restore. Compare the two " +
      "blocks above. If the address on the listing is wrong and the snapshot is " +
      "right, say so with --overwrite-existing. If they are the same address, " +
      "the restore has already happened.",
  };
}

/** Host and database only, never the credentials. */
function dbTarget(): string {
  try {
    const u = new URL(process.env.DATABASE_URL ?? "");
    return `${u.hostname}${u.port ? `:${u.port}` : ""}${u.pathname}`;
  } catch {
    return "<unset or unparseable>";
  }
}

function show(label: string, value: unknown): void {
  console.log(`${label}: ${JSON.stringify(value ?? null, null, 2)}`);
}

async function main(): Promise<number> {
  let prisma: Prisma | undefined;

  try {
    const parsed = parseArgs(process.argv.slice(2));
    if (!parsed.ok) {
      console.error(parsed.message);
      return parsed.exitCode;
    }
    const { profileId, snapshot: snapshotArg, mode } = parsed;
    const validateOnly = mode === "rehearse";

    const { storefrontRemovalRisk } = await import("../src/lib/google-business-info");
    const { describeGoogleError, looksRateLimited } = await import(
      "../src/lib/google-errors"
    );
    const {
      checkSnapshotIdentity,
      defaultVaultRoot,
      findSlugForProfileId,
      findSnapshotPath,
      loadSnapshotJson,
      readSnapshotAddress,
    } = await import("./storefront-snapshot");

    prisma = (await import("../src/lib/prisma")).prisma;
    const { createGoogleClient } = await import("../src/lib/google");

    console.log(`DB: ${dbTarget()}`);

    const profile = await prisma.profile.findUniqueOrThrow({
      where: { id: profileId },
      select: { id: true, name: true, googleAccountId: true, locationName: true },
    });
    console.log(`Profile:  ${profile.name} (${profile.id})`);
    console.log(`Location: ${profile.locationName}`);

    // --- the address to put back -------------------------------------------

    const vaultRoot = defaultVaultRoot();
    let snapshotPath: string;

    if (snapshotArg) {
      snapshotPath = resolve(snapshotArg);
    } else {
      const registryPath = join(vaultRoot, "_clients.yaml");
      let registry: string;
      try {
        registry = readFileSync(registryPath, "utf8");
      } catch (error) {
        console.error(
          `\nREFUSED: could not read the client registry ${registryPath}: ` +
            `${error instanceof Error ? error.message : String(error)}`
        );
        return 2;
      }

      const slug = findSlugForProfileId(registry, profile.id);
      if (!slug) {
        console.error(
          `\nREFUSED: no client in ${registryPath} lists profile ${profile.id} ` +
            `under rankmapsProfileIds, so there is no vault folder to look in. ` +
            `Pass --snapshot <path> to the frozen before-<date>.json instead.`
        );
        return 2;
      }
      console.log(`Client:   ${slug}`);

      const found = findSnapshotPath({ vaultRoot, slug, profileId: profile.id });
      if (!found.ok) {
        console.error(`\nREFUSED: ${found.error}`);
        return 2;
      }
      snapshotPath = found.value;
    }

    console.log(`Snapshot: ${snapshotPath}`);

    const snapshot = loadSnapshotJson(snapshotPath);
    if (!snapshot.ok) {
      console.error(`\nREFUSED: ${snapshot.error}`);
      return 2;
    }

    // Does this file even belong to this profile? Asked before the address is
    // read and long before Google is called, because every other check below
    // assumes the answer is yes.
    const identity = checkSnapshotIdentity({
      snapshot: snapshot.value,
      profileId: profile.id,
      mode,
    });
    if (identity.verdict === "refuse") {
      console.error(`\nREFUSED: nothing sent. ${identity.message}`);
      return 2;
    }
    if (identity.verdict === "warn") {
      console.warn(`\n${identity.message}`);
    }

    const loaded = readSnapshotAddress(snapshot.value);
    if (!loaded.ok) {
      console.error(`\nREFUSED: ${loaded.error} (${snapshotPath})`);
      return 2;
    }
    const address = loaded.value;

    // --- what the listing holds right now ----------------------------------

    const client = await createGoogleClient(profile.googleAccountId);

    async function readLocation(): Promise<LocationState> {
      const res = await client.request<LocationState>({
        url: `${BASE}/${profile.locationName}?readMask=${encodeURIComponent(READ_MASK)}`,
        method: "GET",
      });
      return res.data;
    }

    let live: LocationState;
    try {
      live = await readLocation();
    } catch (error: unknown) {
      const described = describeGoogleError(error, "could not read the location");
      console.error(`\nREFUSED: could not read the live listing first: ${described}`);
      if (looksRateLimited(described)) {
        console.error("Google is rate-limiting this account. Wait and re-run; do not loop.");
      }
      return 1;
    }

    // The two addresses together, before any decision about them, so that a
    // refusal and a write are read off the same block.
    console.log("");
    show("On the listing now", live.storefrontAddress);
    show("In the snapshot   ", address);
    show("Live now: serviceArea", live.serviceArea);

    const decision = decideOverwrite(live.storefrontAddress, {
      mode,
      overwriteExisting: parsed.overwriteExisting,
    });
    if (decision.action === "refuse") {
      console.error(`\nREFUSED: nothing sent: ${decision.message}`);
      return 2;
    }

    // --- the write ----------------------------------------------------------

    const body: Record<string, unknown> = { storefrontAddress: address };

    // The same guard patchLocation runs, called explicitly because this
    // request is built here. Never skip it, and never widen the mask: a mask
    // naming serviceArea without storefrontAddress is the shape that hides an
    // address while answering HTTP 200.
    const risk = storefrontRemovalRisk(UPDATE_MASK, body);
    if (risk) {
      console.error(`\nREFUSED: nothing sent: ${risk}`);
      return 2;
    }

    console.log(
      validateOnly
        ? "\nRehearsal (validateOnly=true). Nothing on this profile will change."
        : "\nWRITING FOR REAL. This changes the live Google listing."
    );
    console.log(`updateMask=${UPDATE_MASK}`);

    try {
      const res = await client.request({
        url: patchUrl(profile.locationName, UPDATE_MASK, mode),
        method: "PATCH",
        data: body,
      });
      console.log(`\n${validateOnly ? "VALIDATED" : "ACCEPTED"} (HTTP ${res.status})`);
      // Read what came back, not just the status: Google has answered 200 to a
      // payload while silently overriding the businessType in it.
      show("Google returned", res.data);
    } catch (error: unknown) {
      const described = describeGoogleError(error, "unknown error restoring the address");
      console.error(`\nREJECTED: ${described}`);
      const raw = (error as { response?: { data?: unknown } }).response?.data;
      if (raw) show("Google returned", raw);
      if (looksRateLimited(described)) {
        console.error("Google is rate-limiting this account. Wait and re-run; do not loop.");
      }
      return 1;
    }

    if (validateOnly) {
      console.log("\nValidated only. Nothing changed. Re-run with --write --yes to restore.");
      return 0;
    }

    // --- read back ----------------------------------------------------------

    let after: LocationState;
    try {
      after = await readLocation();
    } catch (error: unknown) {
      console.error(
        "\nWRITTEN BUT UNVERIFIED. The address was sent and accepted, but reading " +
          "the profile back FAILED, so nobody has confirmed what landed. Check the " +
          `listing by hand now. Read error: ${describeGoogleError(error, "unknown error")}`
      );
      return 1;
    }

    console.log("");
    show("After: storefrontAddress", after.storefrontAddress);
    show("After: serviceArea", after.serviceArea);

    const lines = after.storefrontAddress?.addressLines;
    const hasAddress =
      Array.isArray(lines) &&
      lines.some((line) => typeof line === "string" && line.trim() !== "");

    if (!hasAddress) {
      console.error(
        "\nFAILED. The write was accepted and the profile still has no storefront " +
          "address with addressLines. The map pin has no location. Restore it in the " +
          "Google Business Profile UI now."
      );
      return 1;
    }

    if (after.serviceArea?.businessType === "CUSTOMER_LOCATION_ONLY") {
      console.error(
        "\nFAILED. The address is on the record but the profile came back as " +
          "CUSTOMER_LOCATION_ONLY (pure service area), which is the type at which " +
          "Google hides it. Fix it in the Google Business Profile UI now."
      );
      return 1;
    }

    console.log("\nOK. The address is back and the business type is not service-area-only.");
    console.log(
      "Google renormalizes addresses on write, so compare the two blocks above, " +
        "then open the listing in Maps and look at it. One profile at a time."
    );
    return 0;
  } finally {
    await prisma?.$disconnect().catch(() => {});
  }
}

// parseArgs is exported so the flag rules can be tested, which means
// importing this file must not start a restore. The check is phrased as a
// negative on purpose: every real invocation runs, and only a test runner is
// held back, so a wrapper or a renamed copy can never turn this into a silent
// no-op at the moment someone is trying to put an address back.
if (!process.env.VITEST) {
  main()
    .then((code) => process.exit(code))
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}
