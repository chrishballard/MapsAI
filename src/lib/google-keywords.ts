import { google } from "googleapis";
import { createGoogleClient } from "./google";

interface KeywordResult {
  keyword: string;
  impressions: number;
}

export async function fetchSearchKeywords(
  googleAccountId: string,
  locationId: string,
  startMonth: Date,
  endMonth: Date
): Promise<KeywordResult[]> {
  const auth = await createGoogleClient(googleAccountId);
  const bpp = google.businessprofileperformance({ version: "v1", auth });

  const keywords: KeywordResult[] = [];
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

    const results = response.data.searchKeywordsCounts ?? [];

    for (const entry of results) {
      const keyword = entry.searchKeyword ?? "";
      // insightsValue carries either `value` (the exact count) or only
      // `threshold` (Google's "fewer than N" for low-volume keywords). A
      // threshold is an upper bound, not a count, and
      // MonthlyKeyword.impressions has no way to say "below N": storing N
      // ranked every long-tail keyword at the threshold, and storing 0 would
      // print a false "0 impressions" in reports. So only exact values are
      // kept; a keyword too small for Google to count is left out.
      const value = entry.insightsValue?.value;
      if (!keyword || value == null) continue;

      const impressions = parseInt(value, 10);
      if (Number.isNaN(impressions)) continue;

      keywords.push({ keyword, impressions });
    }

    pageToken = response.data.nextPageToken ?? undefined;
  } while (pageToken);

  return keywords;
}
