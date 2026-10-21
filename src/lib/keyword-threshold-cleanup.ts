import type { KeywordCount } from "./google-keywords";

/**
 * The one-off repair of MonthlyKeyword rows that the metrics sync stored
 * before #15 with Google's "fewer than N" threshold as the impression count
 * (scripts/keyword-threshold-cleanup.ts runs it).
 *
 * Such a row can't be told apart from a real count in the database alone, so
 * each stored month is re-read from Google, and a row goes only when Google
 * reports that keyword for that month as threshold-only AND the stored count
 * is exactly that threshold. A keyword Google now counts exactly is left for
 * the sync to correct, and one Google no longer lists at all is left alone
 * (reported as unverified): there is nothing to check it against.
 *
 * Pure, so the rule is tested without Google or a database.
 */
export interface StoredKeywordRow {
  id: string;
  keyword: string;
  impressions: number;
}

/** A row to delete, with the count it must still hold when it's deleted. */
export interface PlannedDelete {
  id: string;
  impressions: number;
}

export interface ThresholdCleanupPlan {
  deleteIds: string[];
  rows: PlannedDelete[];
  /**
   * Stored rows left as they are because there was nothing reliable to
   * check them against: Google didn't list the keyword for the month, or
   * listed it more than once.
   */
  unverified: number;
}

export function planThresholdCleanup(
  stored: StoredKeywordRow[],
  google: KeywordCount[]
): ThresholdCleanupPlan {
  const byKeyword = new Map<string, KeywordCount>();
  const listedTwice = new Set<string>();
  for (const c of google) {
    if (byKeyword.has(c.keyword)) listedTwice.add(c.keyword);
    byKeyword.set(c.keyword, c);
  }

  const rows: PlannedDelete[] = [];
  let unverified = 0;
  for (const row of stored) {
    const count = byKeyword.get(row.keyword);
    if (!count || listedTwice.has(row.keyword)) {
      unverified++;
      continue;
    }
    if (count.value === null && count.threshold === row.impressions) {
      rows.push({ id: row.id, impressions: row.impressions });
    }
  }
  return { deleteIds: rows.map((r) => r.id), rows, unverified };
}

/**
 * Planned rows grouped by the count each must still hold. Apply deletes a
 * group with `impressions = <that count>` in the where, so a row the daily
 * sync rewrote with a real count after the plan (Google's late data for the
 * last three months) is not deleted, and the count check rolls back.
 */
export function deleteGroups(
  rows: PlannedDelete[]
): Array<{ impressions: number; ids: string[] }> {
  const groups = new Map<number, string[]>();
  for (const row of rows) {
    groups.set(row.impressions, [...(groups.get(row.impressions) ?? []), row.id]);
  }
  return [...groups].map(([impressions, ids]) => ({ impressions, ids }));
}

/**
 * The statements the cleanup runs, for a person to read first. Display
 * only: apply runs them through Prisma in one transaction with a count
 * check, which pasting these into psql would not.
 */
export function renderDeleteSql(rows: PlannedDelete[]): string {
  if (rows.length === 0) return "-- nothing to delete";
  return deleteGroups(rows)
    .map(({ impressions, ids }) => {
      const list = ids.map((id) => `'${id.replace(/'/g, "''")}'`).join(", ");
      return `DELETE FROM "MonthlyKeyword" WHERE "impressions" = ${impressions} AND "id" IN (${list});`;
    })
    .join("\n");
}
