import { Worker, Job } from "bullmq";
import { redisConnection } from "../src/lib/queue/connection";
import {
  fetchDailyMetrics,
  parseMetricsResponse,
} from "../src/lib/google-performance";
import { fetchSearchKeywords } from "../src/lib/google-keywords";
import { prisma } from "../src/lib/prisma";

const worker = new Worker(
  "metrics-sync",
  async (job: Job) => {
    console.log(`Starting metrics sync job ${job.id}`);

    const profiles = await prisma.profile.findMany({
      where: {
        isConnected: true,
        isOnboarded: true,
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

        // Fetch current month's search keywords
        const now = new Date();
        const currentMonth = new Date(now.getFullYear(), now.getMonth(), 1);

        const keywords = await fetchSearchKeywords(
          profile.googleAccountId,
          locationId,
          currentMonth,
          currentMonth
        );

        // Upsert keywords into MonthlyKeyword
        for (const kw of keywords) {
          await prisma.monthlyKeyword.upsert({
            where: {
              profileId_month_keyword: {
                profileId: profile.id,
                month: currentMonth,
                keyword: kw.keyword,
              },
            },
            create: {
              profileId: profile.id,
              month: currentMonth,
              keyword: kw.keyword,
              impressions: kw.impressions,
            },
            update: {
              impressions: kw.impressions,
            },
          });
        }

        console.log(
          `Synced ${keywords.length} keywords for ${profile.name}`
        );
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
