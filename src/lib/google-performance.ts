import { google } from "googleapis";
import { createGoogleClient } from "./google";

const DAILY_METRICS = [
  "BUSINESS_IMPRESSIONS_DESKTOP_SEARCH",
  "BUSINESS_IMPRESSIONS_MOBILE_SEARCH",
  "BUSINESS_IMPRESSIONS_DESKTOP_MAPS",
  "BUSINESS_IMPRESSIONS_MOBILE_MAPS",
  "WEBSITE_CLICKS",
  "CALL_CLICKS",
  "BUSINESS_DIRECTION_REQUESTS",
  "BUSINESS_CONVERSATIONS",
] as const;

const METRIC_TO_FIELD: Record<string, string> = {
  BUSINESS_IMPRESSIONS_DESKTOP_SEARCH: "impressionsSearchDesktop",
  BUSINESS_IMPRESSIONS_MOBILE_SEARCH: "impressionsSearchMobile",
  BUSINESS_IMPRESSIONS_DESKTOP_MAPS: "impressionsMapsDesktop",
  BUSINESS_IMPRESSIONS_MOBILE_MAPS: "impressionsMapsMobile",
  WEBSITE_CLICKS: "websiteClicks",
  CALL_CLICKS: "callClicks",
  BUSINESS_DIRECTION_REQUESTS: "directionRequests",
  BUSINESS_CONVERSATIONS: "conversations",
};

interface DateValue {
  year: number;
  month: number;
  day: number;
}

function toDateValue(date: Date): DateValue {
  return {
    year: date.getFullYear(),
    month: date.getMonth() + 1,
    day: date.getDate(),
  };
}

function dateValueToString(dv: { year?: number | null; month?: number | null; day?: number | null }): string {
  const y = dv.year ?? 2000;
  const m = String(dv.month ?? 1).padStart(2, "0");
  const d = String(dv.day ?? 1).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export async function fetchDailyMetrics(
  googleAccountId: string,
  locationId: string,
  startDate: Date,
  endDate: Date
) {
  const auth = await createGoogleClient(googleAccountId);
  const bpp = google.businessprofileperformance({ version: "v1", auth });

  const response = await bpp.locations.fetchMultiDailyMetricsTimeSeries({
    location: `locations/${locationId}`,
    dailyMetrics: [...DAILY_METRICS],
    "dailyRange.startDate.year": startDate.getFullYear(),
    "dailyRange.startDate.month": startDate.getMonth() + 1,
    "dailyRange.startDate.day": startDate.getDate(),
    "dailyRange.endDate.year": endDate.getFullYear(),
    "dailyRange.endDate.month": endDate.getMonth() + 1,
    "dailyRange.endDate.day": endDate.getDate(),
  });

  return response.data;
}

export interface ParsedDailyMetric {
  profileId: string;
  date: Date;
  impressionsSearchDesktop: number;
  impressionsSearchMobile: number;
  impressionsMapsDesktop: number;
  impressionsMapsMobile: number;
  websiteClicks: number;
  callClicks: number;
  directionRequests: number;
  conversations: number;
}

interface InnerDailyMetricSeries {
  dailyMetric?: string | null;
  timeSeries?: {
    datedValues?: Array<{
      date?: { year?: number | null; month?: number | null; day?: number | null } | null;
      value?: string | null;
    }> | null;
  } | null;
}

interface MultiDailyMetricSeriesGroup {
  dailyMetricTimeSeries?: InnerDailyMetricSeries[] | null;
}

export function parseMetricsResponse(
  response: { multiDailyMetricTimeSeries?: MultiDailyMetricSeriesGroup[] | null } | null | undefined,
  profileId: string
): ParsedDailyMetric[] {
  const byDate = new Map<string, ParsedDailyMetric>();

  const groups = response?.multiDailyMetricTimeSeries ?? [];

  for (const group of groups) {
    // `dailyMetricTimeSeries` is an ARRAY in the v1 REST schema —
    // one entry per requested dailyMetric. Iterate the array.
    const innerSeries = group.dailyMetricTimeSeries ?? [];

    for (const metric of innerSeries) {
      const metricName = metric.dailyMetric ?? "";
      const fieldName = METRIC_TO_FIELD[metricName];
      if (!fieldName) continue;

      const dataPoints = metric.timeSeries?.datedValues ?? [];

      for (const dp of dataPoints) {
        const dateStr = dateValueToString(dp.date ?? {});

        if (!byDate.has(dateStr)) {
          byDate.set(dateStr, {
            profileId,
            date: new Date(dateStr + "T00:00:00Z"),
            impressionsSearchDesktop: 0,
            impressionsSearchMobile: 0,
            impressionsMapsDesktop: 0,
            impressionsMapsMobile: 0,
            websiteClicks: 0,
            callClicks: 0,
            directionRequests: 0,
            conversations: 0,
          });
        }

        const record = byDate.get(dateStr)!;
        (record as unknown as Record<string, unknown>)[fieldName] = parseInt(
          dp.value ?? "0",
          10
        );
      }
    }
  }

  return Array.from(byDate.values());
}
