#!/usr/bin/env tsx
/**
 * One-off: remove the MonthlyKeyword rows the metrics sync stored before #15
 * with Google's "fewer than N" threshold as the impression count. The rule is
 * in src/lib/keyword-threshold-cleanup.ts: a row goes only when Google, read
 * again now, reports that keyword for that month as threshold-only and the
 * stored count is exactly that threshold.
 *
 * Plan (read-only: reads the database and Google, writes neither):
 *   tsx scripts/keyword-threshold-cleanup.ts --out <dir>
 * prints the counts per profile and writes <dir>/keyword-threshold-plan.json
 * and <dir>/keyword-threshold-plan.sql, the exact statement a person reads
 * before anything is deleted.
 *
 * Apply that plan, exactly:
 *   tsx scripts/keyword-threshold-cleanup.ts --apply --plan <dir>/keyword-threshold-plan.json --yes
 * deletes those ids in one transaction, and rolls back if the number deleted
 * isn't the number planned.
 */
import { homedir } from "node:os";
import { join } from "node:path";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { config } from "dotenv";
import { assertKnownArgs, CliArgError, flagValue, hasFlag } from "./cli-args";
import type { KeywordCount } from "../src/lib/google-keywords";

const argv = process.argv.slice(2);
const USAGE =
  "usage: tsx scripts/keyword-threshold-cleanup.ts --out <dir> | --apply --plan <plan.json> --yes";

/** Gap between Google reads; the Performance API is shared with the syncs. */
const READ_GAP_MS = 250;

interface ProfilePlan {
  profileId: string;
  name: string;
  monthsChecked: number;
  monthsUnreadable: string[];
  rowsStored: number;
  unverified: number;
  deleteIds: string[];
}

interface PlanFile {
  generatedAt: string;
  totals: { profiles: number; rowsStored: number; toDelete: number; unverified: number };
  profiles: ProfilePlan[];
  deleteIds: string[];
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
    where: { monthlyKeywords: { some: {} } },
    select: { id: true, name: true, googleAccountId: true, locationName: true, isConnected: true },
    orderBy: { name: "asc" },
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
      deleteIds: [],
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
      result.deleteIds.push(...monthPlan.deleteIds);
      await sleep(READ_GAP_MS);
    }

    console.log(
      `${profile.name}: ${result.deleteIds.length} of ${result.rowsStored} rows to delete` +
        ` (${result.monthsChecked} months checked, ${result.monthsUnreadable.length} unreadable, ${result.unverified} unverified)`
    );
    results.push(result);
  }

  const deleteIds = results.flatMap((r) => r.deleteIds);
  const file: PlanFile = {
    generatedAt: new Date().toISOString(),
    totals: {
      profiles: results.length,
      rowsStored: results.reduce((a, r) => a + r.rowsStored, 0),
      toDelete: deleteIds.length,
      unverified: results.reduce((a, r) => a + r.unverified, 0),
    },
    profiles: results,
    deleteIds,
  };

  mkdirSync(outDir, { recursive: true });
  const planPath = join(outDir, "keyword-threshold-plan.json");
  writeFileSync(planPath, JSON.stringify(file, null, 2));
  writeFileSync(join(outDir, "keyword-threshold-plan.sql"), `${renderDeleteSql(deleteIds)}\n`);

  console.log("");
  console.log(
    `Plan: delete ${file.totals.toDelete} of ${file.totals.rowsStored} MonthlyKeyword rows across ${file.totals.profiles} profiles (${file.totals.unverified} rows unverified, left alone). Nothing was changed.`
  );
  console.log(`Read: ${planPath} and keyword-threshold-plan.sql beside it.`);
  await prisma.$disconnect();
}

async function apply(planPath: string) {
  const { prisma } = await import("../src/lib/prisma");
  const file = JSON.parse(readFileSync(planPath, "utf8")) as PlanFile;
  const ids = file.deleteIds ?? [];
  if (ids.length === 0) {
    console.log("Plan deletes nothing.");
    await prisma.$disconnect();
    return;
  }
  const deleted = await prisma.$transaction(async (tx) => {
    const result = await tx.monthlyKeyword.deleteMany({ where: { id: { in: ids } } });
    if (result.count !== ids.length) {
      throw new Error(
        `Would delete ${result.count} rows, the plan says ${ids.length}; rolled back. Re-run the plan.`
      );
    }
    return result.count;
  });
  console.log(`Deleted ${deleted} MonthlyKeyword rows, as planned.`);
  await prisma.$disconnect();
}

async function main() {
  let outDir: string | undefined;
  let planPath: string | undefined;
  try {
    assertKnownArgs(argv, { valueFlags: ["out", "plan"], booleanFlags: ["apply", "yes"] });
    outDir = flagValue(argv, "out");
    planPath = flagValue(argv, "plan");
  } catch (error) {
    if (!(error instanceof CliArgError)) throw error;
    console.error(error.message);
    console.error(USAGE);
    process.exit(1);
  }

  const applying = hasFlag(argv, "apply");
  if (applying ? !planPath || !hasFlag(argv, "yes") : !outDir) {
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

  if (applying) await apply(planPath!);
  else await plan(outDir!);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
