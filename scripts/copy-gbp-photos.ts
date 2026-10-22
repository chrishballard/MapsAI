/**
 * One-off: copy all merchant photos from one connected GBP location to another.
 *
 * Usage:
 *   pnpm tsx scripts/copy-gbp-photos.ts <sourceProfileId> <targetProfileId>          # dry run
 *   pnpm tsx scripts/copy-gbp-photos.ts <sourceProfileId> <targetProfileId> --apply  # actually upload
 *   ... --journal <path>   # where progress is kept (default: one file per pair under ~/.mapsai)
 *   ... --allow-existing-target   # see below
 *
 * A target that already has photos but no journal for the pair is refused:
 * the copy may have run before with its journal somewhere else (the
 * 2026-08-20 Zubowicz Atlanta to Milton run kept it in a session scratchpad
 * that is gone), and running again would put every photo on the listing
 * twice. Check the target listing, then pass --allow-existing-target.
 *
 * Dry run lists both locations' current media and the planned uploads.
 * Apply POSTs each source photo's public googleUrl as a sourceUrl media
 * create on the target, throttled to stay under the 10 edits/min/profile
 * GBP limit. Progress is journaled so a re-run skips already-copied photos.
 *
 * Re-running is the dangerous part: a photo uploaded twice is a duplicate on
 * a client's public listing. So the journal is written outside the upload's
 * own error handling (a failed journal write stops the run instead of
 * calling a good upload FAILED and leaving it unrecorded), it lives at a
 * stable path, and an upload whose outcome is unclear (timeout, 5xx) is
 * checked against the target's live media and never blindly retried.
 */
import "dotenv/config";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { prisma } from "../src/lib/prisma";
import { createGoogleClient } from "../src/lib/google";
import { listGBPMedia, mediaKey, type GBPMediaItem } from "../src/lib/google-media";
import { assertKnownArgs, CliArgError, flagValue, hasFlag } from "./cli-args";

const DELAY_MS = 7000; // ~8.5 edits/min, under the 10/min/profile limit

/**
 * Source media name -> what happened on the target. "uncertain" means the
 * create errored in a way that might have landed anyway and the target's
 * listing didn't show a new photo; it is reported and skipped on re-runs
 * until a person checks the listing and deletes the entry.
 */
type JournalEntry = { target: string } | { uncertain: string };
type Journal = Record<string, JournalEntry>;

function defaultJournalPath(sourceId: string, targetId: string): string {
  return path.join(os.homedir(), ".mapsai", "copy-gbp-photos", `${sourceId}-to-${targetId}.json`);
}

/**
 * Keyed on mediaKey (the media name without its account segment): the
 * account is whichever one the request went through and can change between
 * runs, which made every journaled photo look new.
 */
function readJournal(file: string): Journal {
  if (!fs.existsSync(file)) return {};
  const raw = JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, string | JournalEntry>;
  // Older journals mapped source name -> created target name.
  const journal: Journal = {};
  for (const [k, v] of Object.entries(raw)) {
    journal[mediaKey(k) ?? k] = typeof v === "string" ? { target: v } : v;
  }
  return journal;
}

/** Throws on failure: the caller must stop uploading if progress can't be kept. */
function writeJournal(file: string, journal: Journal) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(journal, null, 2));
}

/** HTTP status off a gaxios error, if there is one. */
function httpStatus(err: unknown): number | undefined {
  const e = err as { response?: { status?: number }; status?: number; code?: unknown };
  return e?.response?.status ?? e?.status ?? (typeof e?.code === "number" ? e.code : undefined);
}

/**
 * Google refused the request outright, so nothing was created and trying
 * again differently is safe. Timeouts, 429 and 5xx are not proof of that.
 */
function isDefiniteRejection(err: unknown): boolean {
  const status = httpStatus(err);
  return status !== undefined && status >= 400 && status < 500 && status !== 408 && status !== 429;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function summarize(items: GBPMediaItem[]) {
  const byFormat: Record<string, number> = {};
  const byCategory: Record<string, number> = {};
  for (const it of items) {
    const f = it.mediaFormat ?? "UNKNOWN";
    byFormat[f] = (byFormat[f] ?? 0) + 1;
    const c = it.locationAssociation?.category ?? (it.locationAssociation?.priceListItemId ? "PRICE_LIST_ITEM" : "NONE");
    byCategory[c] = (byCategory[c] ?? 0) + 1;
  }
  return { total: items.length, byFormat, byCategory };
}

async function loadProfile(id: string) {
  const p = await prisma.profile.findUniqueOrThrow({
    where: { id },
    select: {
      id: true,
      name: true,
      address: true,
      googleAccountId: true,
      accountResourceName: true,
      locationName: true,
      isConnected: true,
    },
  });
  if (!p.accountResourceName) throw new Error(`Profile ${id} missing accountResourceName`);
  return p;
}

const USAGE =
  "Usage: pnpm tsx scripts/copy-gbp-photos.ts <sourceProfileId> <targetProfileId> [--apply] [--journal <path>] [--allow-existing-target]";

async function main() {
  // The two profile ids come first; after them only known flags. An unknown
  // one (--journal=path, a typo) used to be ignored silently.
  const [sourceId, targetId, ...rest] = process.argv.slice(2);
  let apply: boolean;
  let allowExistingTarget: boolean;
  let journalArg: string | undefined;
  try {
    if (!sourceId || !targetId || sourceId.startsWith("--") || targetId.startsWith("--")) {
      throw new CliArgError("Pass the source and target profile ids first");
    }
    assertKnownArgs(rest, {
      valueFlags: ["journal"],
      booleanFlags: ["apply", "allow-existing-target"],
    });
    apply = hasFlag(rest, "apply");
    allowExistingTarget = hasFlag(rest, "allow-existing-target");
    journalArg = flagValue(rest, "journal");
  } catch (error) {
    if (!(error instanceof CliArgError)) throw error;
    console.error(error.message);
    console.error(USAGE);
    process.exit(1);
  }
  if (sourceId === targetId) {
    console.error("Source and target are the same profile; refusing to copy a listing onto itself.");
    process.exit(1);
  }

  const source = await loadProfile(sourceId);
  const target = await loadProfile(targetId);
  if (source.locationName === target.locationName) {
    console.error(`Source and target are the same Google location (${source.locationName}); refusing.`);
    process.exit(1);
  }
  const journalFile = journalArg ?? defaultJournalPath(sourceId, targetId);

  console.log(`SOURCE: ${source.name} — ${source.address} (${source.id}) connected=${source.isConnected}`);
  console.log(`TARGET: ${target.name} — ${target.address} (${target.id}) connected=${target.isConnected}`);

  const sourceItems = await listGBPMedia({
    googleAccountId: source.googleAccountId,
    accountResourceName: source.accountResourceName!,
    locationName: source.locationName,
  });
  const targetItems = await listGBPMedia({
    googleAccountId: target.googleAccountId,
    accountResourceName: target.accountResourceName!,
    locationName: target.locationName,
  });

  console.log("\nSOURCE media:", JSON.stringify(summarize(sourceItems)));
  console.log("TARGET media:", JSON.stringify(summarize(targetItems)));

  // Copyable: merchant photos with a public URL. Oldest first so relative
  // recency order is preserved on the target.
  const copyable = sourceItems
    .filter((it) => it.mediaFormat === "PHOTO" && typeof it.googleUrl === "string" && it.googleUrl)
    .sort((a, b) => String(a.createTime ?? "").localeCompare(String(b.createTime ?? "")));
  const skipped = sourceItems.filter((it) => !copyable.includes(it));

  // What a run would do, journal included: the dry run used to show every
  // photo as planned even when the journal said they were all done.
  const done = readJournal(journalFile);
  const alreadyDone = copyable.filter((it) => done[mediaKey(it.name) ?? it.name]);
  console.log(`\nJournal: ${journalFile} (${Object.keys(done).length} entries)`);
  console.log(
    `Planned uploads: ${copyable.length - alreadyDone.length} photos` +
      (alreadyDone.length ? ` (${alreadyDone.length} more already handled per the journal)` : "")
  );
  if (skipped.length) {
    console.log(`Skipped (not PHOTO or no URL): ${skipped.length}`);
    for (const s of skipped) console.log(`  - ${s.name} format=${s.mediaFormat} url=${s.googleUrl ? "yes" : "no"}`);
  }
  const catCounts: Record<string, number> = {};
  for (const it of copyable) {
    const c = it.locationAssociation?.category ?? "ADDITIONAL";
    catCounts[c] = (catCounts[c] ?? 0) + 1;
  }
  console.log("Upload categories:", JSON.stringify(catCounts));

  const targetPhotos = targetItems.filter((it) => it.mediaFormat === "PHOTO").length;
  const unjournaledTarget = Object.keys(done).length === 0 && targetPhotos > 0;
  if (unjournaledTarget) {
    console.log(
      `\nThe target already has ${targetPhotos} photos and there is no journal for this pair. ` +
        "If this copy ran before, its journal is elsewhere and --apply would upload every photo again."
    );
  }

  if (!apply) {
    console.log("\nDRY RUN — nothing uploaded. Re-run with --apply to copy.");
    return;
  }
  if (unjournaledTarget && !allowExistingTarget) {
    console.error("Refusing: check the target listing, then pass --allow-existing-target to copy anyway.");
    process.exit(1);
  }

  // Resume journal: source media key -> what was created on the target.
  // Written once up front so a path that can't be written fails before any
  // upload, not after the first one.
  writeJournal(journalFile, done);

  // Diff the journal against what the target actually holds now, so a
  // resume reports anything that no longer matches instead of trusting it.
  const targetNames = new Set(targetItems.map((it) => mediaKey(it.name) ?? it.name));
  const journaled = Object.entries(done);
  if (journaled.length) {
    const missing = journaled.filter(
      ([, e]) => "target" in e && !targetNames.has(mediaKey(e.target) ?? e.target)
    );
    const uncertain = journaled.filter(([, e]) => "uncertain" in e);
    console.log(`Resuming: ${journaled.length} source photos already handled per journal.`);
    if (missing.length) {
      console.log(`  ${missing.length} journaled copies are no longer on the target (deleted there?). Not re-uploading them:`);
      for (const [src, e] of missing) console.log(`    - ${src} -> ${"target" in e ? e.target : ""}`);
    }
    if (uncertain.length) {
      console.log(`  ${uncertain.length} uploads have an unknown outcome. Check the target listing, then delete their journal lines to retry:`);
      for (const [src, e] of uncertain) console.log(`    - ${src}: ${"uncertain" in e ? e.uncertain : ""}`);
    }
  }

  const client = await createGoogleClient(target.googleAccountId);
  const parent = `${target.accountResourceName}/${target.locationName}`;
  let ok = 0;
  let failed = 0;
  let unclear = 0;

  const listTargetNames = async () =>
    new Set(
      (
        await listGBPMedia({
          googleAccountId: target.googleAccountId,
          accountResourceName: target.accountResourceName!,
          locationName: target.locationName,
        })
      ).map((it) => mediaKey(it.name) ?? it.name)
    );

  for (let i = 0; i < copyable.length; i++) {
    const item = copyable[i];
    const key = mediaKey(item.name) ?? item.name;
    if (done[key]) continue;

    // Per Chris 2026-08-20: keep the target's own cover/profile photo —
    // upload the source's cover/profile shots as regular photos instead.
    const rawCategory = item.locationAssociation?.category ?? "ADDITIONAL";
    const category = ["COVER", "PROFILE", "LOGO"].includes(rawCategory)
      ? "ADDITIONAL"
      : rawCategory;
    const attempt = async (cat: string) =>
      client.request<{ name?: string }>({
        url: `https://mybusiness.googleapis.com/v4/${parent}/media`,
        method: "POST",
        data: {
          mediaFormat: "PHOTO",
          locationAssociation: { category: cat },
          sourceUrl: item.googleUrl,
        },
      });

    let entry: JournalEntry | null = null;
    let usedCategory = category;
    try {
      let res;
      try {
        res = await attempt(category);
      } catch (err) {
        // Only a definite rejection proves nothing was created, so only then
        // is it safe to try again as ADDITIONAL.
        if (category === "ADDITIONAL" || !isDefiniteRejection(err)) throw err;
        console.warn(`  [${i + 1}/${copyable.length}] ${category} rejected, retrying as ADDITIONAL: ${(err as Error).message}`);
        usedCategory = "ADDITIONAL";
        res = await attempt("ADDITIONAL");
      }
      entry = { target: res.data.name ?? "created" };
      ok++;
      console.log(`  [${i + 1}/${copyable.length}] OK ${usedCategory} -> ${res.data.name}`);
    } catch (err) {
      const message = (err as Error).message;
      if (isDefiniteRejection(err)) {
        // Nothing was created; a re-run may try it again.
        failed++;
        console.error(`  [${i + 1}/${copyable.length}] FAILED ${item.name}: ${message}`);
      } else {
        // The create may have landed. Look before deciding anything.
        let created: string[] = [];
        try {
          const now = await listTargetNames();
          const known = new Set([
            ...targetNames,
            ...Object.values(done).flatMap((e) =>
              "target" in e ? [mediaKey(e.target) ?? e.target] : []
            ),
          ]);
          created = [...now].filter((n) => !known.has(n));
        } catch (listErr) {
          console.error(`  could not re-list the target: ${(listErr as Error).message}`);
        }
        if (created.length === 1) {
          entry = { target: created[0] };
          ok++;
          console.log(`  [${i + 1}/${copyable.length}] OK (despite "${message}") -> ${created[0]}`);
        } else {
          entry = { uncertain: `${message}${created.length > 1 ? ` (${created.length} new photos appeared on the target)` : ""}` };
          unclear++;
          console.error(`  [${i + 1}/${copyable.length}] UNKNOWN ${item.name}: ${message}. Not retried; check the target listing.`);
          if (created.length > 1) {
            // Something else is adding photos to this listing; stop.
            writeJournal(journalFile, { ...done, [key]: entry });
            throw new Error("More than one new photo appeared on the target during one upload; stopping.");
          }
        }
      }
    }

    // Outside the upload's try: a journal that can't be written must stop the
    // run, or the next run would upload this photo again.
    if (entry) {
      done[key] = entry;
      if ("target" in entry) targetNames.add(mediaKey(entry.target) ?? entry.target);
      try {
        writeJournal(journalFile, done);
      } catch (err) {
        console.error(`Could not write the journal (${(err as Error).message}). Stopping.`);
        console.error(`Record this by hand before re-running: ${item.name} -> ${JSON.stringify(entry)}`);
        throw err;
      }
    }

    if (i < copyable.length - 1) await sleep(DELAY_MS);
  }

  console.log(`\nDone. created=${ok} failed=${failed} unknown=${unclear} previouslyDone=${Object.keys(done).length - ok - unclear}`);

  const after = await listGBPMedia({
    googleAccountId: target.googleAccountId,
    accountResourceName: target.accountResourceName!,
    locationName: target.locationName,
  });
  console.log("TARGET media after:", JSON.stringify(summarize(after)));
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
