import { Worker, Job } from "bullmq";
import { redisConnection } from "../src/lib/queue/connection";
import {
  fetchDailyMetrics,
  parseMetricsResponse,
} from "../src/lib/google-performance";
import { fetchSearchKeywords } from "../src/lib/google-keywords";
import { prisma } from "../src/lib/prisma";

export const worker = new Worker(
  "metrics-sync",
  async (job: Job) => {
    console.log(`Starting metrics sync job ${job.id}`);

    const profiles = await prisma.profile.findMany({
      where: {
        isConnected: true,
        googleAccount: { isNot: undefined },
      },
      include: {
        googleAccount: true,
      },
    });

    console.log(`Found ${profiles.length} profiles to sync metrics for`);

    for (const profile of profiles) {
      try {
        console.log(`Syncing metrics for profile: ${profile.name}`);

        // Extract numeric location ID from locationName (e.g., "locations/12345" -> "12345")
        const locationId = profile.locationName.split("/").pop()!;

        // Fetch daily metrics — use job data for backfill window, default 90 days
        const syncDays = (job.data as { days?: number })?.days || 90;
        const endDate = new Date();
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - syncDays);

        const metricsResponse = await fetchDailyMetrics(
          profile.googleAccountId,
          locationId,
          startDate,
          endDate
        );

        const parsedMetrics = parseMetricsResponse(metricsResponse, profile.id);

        // Upsert each day into DailyMetric
        for (const metric of parsedMetrics) {
          await prisma.dailyMetric.upsert({
            where: {
              profileId_date: {
                profileId: metric.profileId,
                date: metric.date,
              },
            },
            create: metric,
            update: {
              impressionsSearchDesktop: metric.impressionsSearchDesktop,
              impressionsSearchMobile: metric.impressionsSearchMobile,
              impressionsMapsDesktop: metric.impressionsMapsDesktop,
              impressionsMapsMobile: metric.impressionsMapsMobile,
              websiteClicks: metric.websiteClicks,
              callClicks: metric.callClicks,
              directionRequests: metric.directionRequests,
              conversations: metric.conversations,
            },
          });
        }

        console.log(
          `Synced ${parsedMetrics.length} daily metric records for ${profile.name}`
        );

        // Fetch search keywords for recent COMPLETED months. The GBP API
        // returns no data for the current in-progress month, so requesting it
        // always yields 0 keywords. Sync the last few completed months each
        // run — recent months can still receive late updates from Google.
        const keywordMonths =
          (job.data as { keywordMonths?: number })?.keywordMonths || 3;
        const now = new Date();

        for (let back = 1; back <= keywordMonths; back++) {
          const month = new Date(
            Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - back, 1)
          );

          const keywords = await fetchSearchKeywords(
            profile.googleAccountId,
            locationId,
            month,
            month
          );

          // Upsert keywords into MonthlyKeyword
          for (const kw of keywords) {
            await prisma.monthlyKeyword.upsert({
              where: {
                profileId_month_keyword: {
                  profileId: profile.id,
                  month,
                  keyword: kw.keyword,
                },
              },
              create: {
                profileId: profile.id,
                month,
                keyword: kw.keyword,
                impressions: kw.impressions,
              },
              update: {
                impressions: kw.impressions,
              },
            });
          }

          console.log(
            `Synced ${keywords.length} keywords for ${profile.name} (${month.toISOString().slice(0, 7)})`
          );
        }
      } catch (profileErr) {
        console.error(
          `Failed to sync metrics for profile ${profile.name}:`,
          profileErr
        );
        // Continue with next profile
      }
    }

    console.log("Metrics sync job complete");
  },
  {
    connection: redisConnection,
    concurrency: 1,
  }
);

worker.on("completed", (job) => {
  console.log(`Metrics sync job ${job.id} completed`);
});

worker.on("failed", (job, err) => {
  console.error(`Metrics sync job ${job?.id} failed: ${err.message}`);
});

console.log("Metrics sync worker started, waiting for jobs...");
