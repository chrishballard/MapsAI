import { google } from "googleapis";
import { createGoogleClient } from "./google";

interface KeywordResult {
  keyword: string;
  impressions: number;
}

/**
 * One keyword's monthly impressions as Google reports them: an exact
 * `value`, or for low-volume keywords only a `threshold` ("fewer than N").
 * Exactly one of the two is set.
 */
export interface KeywordCount {
  keyword: string;
  value: number | null;
  threshold: number | null;
}

function parseCount(raw: string | null | undefined): number | null {
  if (raw == null) return null;
  const n = parseInt(raw, 10);
  return Number.isNaN(n) ? null : n;
}

/** Every keyword Google lists for the range, exact and threshold-only. */
export async function fetchSearchKeywordCounts(
  googleAccountId: string,
  locationId: string,
  startMonth: Date,
  endMonth: Date
): Promise<KeywordCount[]> {
  const auth = await createGoogleClient(googleAccountId);
  const bpp = google.businessprofileperformance({ version: "v1", auth });

  const counts: KeywordCount[] = [];
  let pageToken: string | undefined;

  do {
    const response =
      await bpp.locations.searchkeywords.impressions.monthly.list({
        parent: `locations/${locationId}`,
        "monthlyRange.startMonth.year": startMonth.getUTCFullYear(),
        "monthlyRange.startMonth.month": startMonth.getUTCMonth() + 1,
        "monthlyRange.endMonth.year": endMonth.getUTCFullYear(),
        "monthlyRange.endMonth.month": endMonth.getUTCMonth() + 1,
        pageSize: 100,
        pageToken,
      });

    for (const entry of response.data.searchKeywordsCounts ?? []) {
      const keyword = entry.searchKeyword ?? "";
      if (!keyword) continue;
      const value = parseCount(entry.insightsValue?.value);
      const threshold = value === null ? parseCount(entry.insightsValue?.threshold) : null;
      if (value === null && threshold === null) continue;
      counts.push({ keyword, value, threshold });
    }

    pageToken = response.data.nextPageToken ?? undefined;
  } while (pageToken);

  return counts;
}

/**
 * The keywords with an exact count. insightsValue carries either `value`
 * (the exact count) or only `threshold` (Google's "fewer than N" for
 * low-volume keywords). A threshold is an upper bound, not a count, and
 * MonthlyKeyword.impressions has no way to say "below N": storing N ranked
 * every long-tail keyword at the threshold, and storing 0 would print a false
 * "0 impressions" in reports. So only exact values are kept; a keyword too
 * small for Google to count is left out.
 */
export async function fetchSearchKeywords(
  googleAccountId: string,
  locationId: string,
  startMonth: Date,
  endMonth: Date
): Promise<KeywordResult[]> {
  const counts = await fetchSearchKeywordCounts(
    googleAccountId,
    locationId,
    startMonth,
    endMonth
  );
  return counts.flatMap((c) =>
    c.value === null ? [] : [{ keyword: c.keyword, impressions: c.value }]
  );
}
