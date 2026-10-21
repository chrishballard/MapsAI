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

export interface ThresholdCleanupPlan {
  deleteIds: string[];
  /** Stored rows Google didn't list for the month, so left as they are. */
  unverified: number;
}

export function planThresholdCleanup(
  stored: StoredKeywordRow[],
  google: KeywordCount[]
): ThresholdCleanupPlan {
  const byKeyword = new Map(google.map((c) => [c.keyword, c]));
  const deleteIds: string[] = [];
  let unverified = 0;
  for (const row of stored) {
    const count = byKeyword.get(row.keyword);
    if (!count) {
      unverified++;
      continue;
    }
    if (count.value === null && count.threshold === row.impressions) {
      deleteIds.push(row.id);
    }
  }
  return { deleteIds, unverified };
}

/** The exact statement the cleanup runs, for a person to read first. */
export function renderDeleteSql(ids: string[]): string {
  if (ids.length === 0) return "-- nothing to delete";
  const list = ids.map((id) => `'${id.replace(/'/g, "''")}'`).join(", ");
  return `DELETE FROM "MonthlyKeyword" WHERE "id" IN (${list});`;
}
