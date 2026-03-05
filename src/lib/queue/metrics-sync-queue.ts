import { Queue } from "bullmq";
import { redisConnection } from "./connection";

export const metricsSyncQueue = new Queue("metrics-sync", {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: "exponential",
      delay: 60_000, // 60 seconds
    },
  },
});

/**
 * Initialize the repeatable metrics sync scheduler.
 * Runs every 24 hours to sync daily metrics from GBP Performance API.
 */
export async function initMetricsSyncScheduler(): Promise<void> {
  await metricsSyncQueue.upsertJobScheduler(
    "metrics-sync-scheduler",
    { every: 24 * 60 * 60 * 1000 }, // 24 hours
    { name: "sync-metrics", data: {} }
  );
}
