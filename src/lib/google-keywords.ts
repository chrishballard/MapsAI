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
        "monthlyRange.startMonth.year": startMonth.getFullYear(),
        "monthlyRange.startMonth.month": startMonth.getMonth() + 1,
        "monthlyRange.endMonth.year": endMonth.getFullYear(),
        "monthlyRange.endMonth.month": endMonth.getMonth() + 1,
        pageSize: 100,
        pageToken,
      });

    const results = response.data.searchKeywordsCounts ?? [];

    for (const entry of results) {
      const keyword = entry.searchKeyword ?? "";
      // insightsValue can have `value` (exact) or `threshold` (capped)
      const impressions =
        parseInt(entry.insightsValue?.value ?? "0", 10) ||
        parseInt(entry.insightsValue?.threshold ?? "0", 10);

      if (keyword) {
        keywords.push({ keyword, impressions });
      }
    }

    pageToken = response.data.nextPageToken ?? undefined;
  } while (pageToken);

  return keywords;
}
