#!/usr/bin/env tsx
/**
 * One-off: remove the MonthlyKeyword rows the metrics sync stored before #15
 * with Google's "fewer than N" threshold as the impression count. The rule is
 * in src/lib/keyword-threshold-cleanup.ts: a row goes only when Google, read
 * again now, reports that keyword for that month as threshold-only and the
 * stored count is exactly that threshold.
 *
 * Plan:
 *   tsx scripts/keyword-threshold-cleanup.ts --out <dir>
 * prints the counts per profile and writes <dir>/keyword-threshold-plan.json
 * and <dir>/keyword-threshold-plan.sql, the exact statements a person reads
 * before anything is deleted. It changes no keyword rows and only reads from
 * Google; reading does refresh a Google login's OAuth token on its
 * GoogleAccount row when it has expired, as the syncs do (and an
 * invalid_grant marks that account needsReauth). Disconnected profiles are
 * skipped and their rows left as they are.
 *
 * Apply that plan, exactly:
 *   tsx scripts/keyword-threshold-cleanup.ts --apply --plan <dir>/keyword-threshold-plan.json --expect <n> --yes
 * where <n> is the row count the person approved. Each row is deleted only
 * while it still holds the count it was planned at (the daily sync rewrites
 * the last three months with Google's late data), all in one transaction,
 * which rolls back if the number deleted isn't <n>.
 */
import { homedir } from "node:os";
import { join } from "node:path";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { config } from "dotenv";
import { assertKnownArgs, CliArgError, flagValue, hasFlag } from "./cli-args";
import type { KeywordCount } from "../src/lib/google-keywords";
import type { PlannedDelete } from "../src/lib/keyword-threshold-cleanup";

const argv = process.argv.slice(2);
const USAGE =
  "usage: tsx scripts/keyword-threshold-cleanup.ts --out <dir> | --apply --plan <plan.json> --expect <rows> --yes";

/** Gap between Google reads; the Performance API is shared with the syncs. */
const READ_GAP_MS = 250;

interface ProfilePlan {
  profileId: string;
  name: string;
  monthsChecked: number;
  monthsUnreadable: string[];
  rowsStored: number;
  unverified: number;
  rows: PlannedDelete[];
}

interface PlanFile {
  generatedAt: string;
  totals: {
    profiles: number;
    skippedDisconnected: number;
    rowsStored: number;
    toDelete: number;
    unverified: number;
  };
  profiles: ProfilePlan[];
  rows: PlannedDelete[];
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function withRetry<T>(work: () => Promise<T>, attempts = 5): Promise<T> {
  for (let i = 1; ; i++) {
    try {
      return await work();
    } catch (err) {
      const e = err as { response?: { status?: number }; code?: unknown } | null;
      const status = e?.response?.status ?? (typeof e?.code === "number" ? e.code : undefined);
      const retryable = status === 429 || (typeof status === "number" && status >= 500);
      if (!retryable || i >= attempts) throw err;
      await sleep(3000 * 2 ** (i - 1));
    }
  }
}

async function plan(outDir: string) {
  const { prisma } = await import("../src/lib/prisma");
  const { fetchSearchKeywordCounts } = await import("../src/lib/google-keywords");
  const { planThresholdCleanup, renderDeleteSql } = await import(
    "../src/lib/keyword-threshold-cleanup"
  );

  const profiles = await prisma.profile.findMany({
    where: { isConnected: true, monthlyKeywords: { some: {} } },
    select: { id: true, name: true, googleAccountId: true, locationName: true },
    orderBy: { name: "asc" },
  });
  const skippedDisconnected = await prisma.profile.count({
    where: { isConnected: false, monthlyKeywords: { some: {} } },
  });

  const results: ProfilePlan[] = [];
  for (const profile of profiles) {
    const rows = await prisma.monthlyKeyword.findMany({
      where: { profileId: profile.id },
      select: { id: true, keyword: true, impressions: true, month: true },
    });
    const byMonth = new Map<string, typeof rows>();
    for (const row of rows) {
      const key = row.month.toISOString().slice(0, 10);
      byMonth.set(key, [...(byMonth.get(key) ?? []), row]);
    }

    const result: ProfilePlan = {
      profileId: profile.id,
      name: profile.name,
      monthsChecked: 0,
      monthsUnreadable: [],
      rowsStored: rows.length,
      unverified: 0,
      rows: [],
    };
    const locationId = profile.locationName.split("/").pop()!;

    for (const [monthKey, monthRows] of byMonth) {
      const month = new Date(`${monthKey}T00:00:00Z`);
      let counts: KeywordCount[];
      try {
        counts = await withRetry(() =>
          fetchSearchKeywordCounts(profile.googleAccountId, locationId, month, month)
        );
      } catch (err) {
        // Disconnected, past Google's retention, or no access: nothing to
        // compare against, so this month's rows stay as they are.
        result.monthsUnreadable.push(monthKey);
        result.unverified += monthRows.length;
        console.warn(
          `  ${profile.name} ${monthKey}: could not read from Google (${err instanceof Error ? err.message : err})`
        );
        await sleep(READ_GAP_MS);
        continue;
      }
      const monthPlan = planThresholdCleanup(monthRows, counts);
      result.monthsChecked++;
      result.unverified += monthPlan.unverified;
      result.rows.push(...monthPlan.rows);
      await sleep(READ_GAP_MS);
    }

    console.log(
      `${profile.name}: ${result.rows.length} of ${result.rowsStored} rows to delete` +
        ` (${result.monthsChecked} months checked, ${result.monthsUnreadable.length} unreadable, ${result.unverified} unverified)`
    );
    results.push(result);
  }

  const rows = results.flatMap((r) => r.rows);
  const file: PlanFile = {
    generatedAt: new Date().toISOString(),
    totals: {
      profiles: results.length,
      skippedDisconnected,
      rowsStored: results.reduce((a, r) => a + r.rowsStored, 0),
      toDelete: rows.length,
      unverified: results.reduce((a, r) => a + r.unverified, 0),
    },
    profiles: results,
    rows,
  };

  mkdirSync(outDir, { recursive: true });
  const planPath = join(outDir, "keyword-threshold-plan.json");
  writeFileSync(planPath, JSON.stringify(file, null, 2));
  writeFileSync(
    join(outDir, "keyword-threshold-plan.sql"),
    `-- For reading only. Apply with --apply --plan ... --expect ${rows.length} --yes, which\n` +
      `-- runs these in one transaction and rolls back on a count mismatch; pasted\n` +
      `-- into psql they would not be.\n${renderDeleteSql(rows)}\n`
  );

  console.log("");
  console.log(
    `Plan: delete ${file.totals.toDelete} of ${file.totals.rowsStored} MonthlyKeyword rows across ${file.totals.profiles} profiles (${file.totals.unverified} rows unverified and ${file.totals.skippedDisconnected} disconnected profiles, left alone). No keyword rows were changed.`
  );
  console.log(`Read: ${planPath} and keyword-threshold-plan.sql beside it.`);
  await prisma.$disconnect();
}

async function apply(planPath: string, expected: number) {
  const { prisma } = await import("../src/lib/prisma");
  const { deleteGroups } = await import("../src/lib/keyword-threshold-cleanup");
  const file = JSON.parse(readFileSync(planPath, "utf8")) as PlanFile;
  const rows = file.rows ?? [];
  if (rows.length !== expected || file.totals?.toDelete !== expected) {
    console.error(
      `The plan holds ${rows.length} rows (totals say ${file.totals?.toDelete}), not the ${expected} approved. Nothing was deleted.`
    );
    process.exit(1);
  }
  if (rows.length === 0) {
    console.log("Plan deletes nothing.");
    await prisma.$disconnect();
    return;
  }
  const deleted = await prisma.$transaction(
    async (tx) => {
      let count = 0;
      // A row is deleted only while it still holds the count it was planned
      // at; one the sync has since rewritten is left, and the check below
      // rolls everything back.
      for (const group of deleteGroups(rows)) {
        const result = await tx.monthlyKeyword.deleteMany({
          where: { id: { in: group.ids }, impressions: group.impressions },
        });
        count += result.count;
      }
      if (count !== expected) {
        throw new Error(
          `Would delete ${count} rows, the plan says ${expected}; rolled back. Re-run the plan.`
        );
      }
      return count;
    },
    // A large plan over the Railway proxy can outlast the 5-second default.
    { timeout: 120_000 }
  );
  console.log(`Deleted ${deleted} MonthlyKeyword rows, as planned.`);
  await prisma.$disconnect();
}

async function main() {
  let outDir: string | undefined;
  let planPath: string | undefined;
  let expected: number | undefined;
  try {
    assertKnownArgs(argv, {
      valueFlags: ["out", "plan", "expect"],
      booleanFlags: ["apply", "yes"],
    });
    outDir = flagValue(argv, "out");
    planPath = flagValue(argv, "plan");
    const rawExpect = flagValue(argv, "expect");
    if (rawExpect !== undefined) {
      if (!/^\d+$/.test(rawExpect)) {
        throw new CliArgError(`--expect needs a whole number, not "${rawExpect}"`);
      }
      expected = Number(rawExpect);
    }
  } catch (error) {
    if (!(error instanceof CliArgError)) throw error;
    console.error(error.message);
    console.error(USAGE);
    process.exit(1);
  }

  const applying = hasFlag(argv, "apply");
  if (applying ? !planPath || expected === undefined || !hasFlag(argv, "yes") : !outDir) {
    console.error(USAGE);
    process.exit(1);
  }

  // Same two-file load as gbp-set-service-area.ts: the rows live in the
  // Railway production DB, the repo .env carries the Google OAuth client.
  config({
    path: [
      join(homedir(), ".config/vineyardgrowth/rankmaps-prod.env"),
      join(homedir(), "Projects/MapsAI/.env"),
    ],
    quiet: true,
  });

  if (applying) await apply(planPath!, expected!);
  else await plan(outDir!);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
