/**
 * Unified worker entry point
 * Imports all worker files which auto-start their BullMQ Workers on import.
 * Initializes recurring job schedulers.
 * Handles graceful shutdown on SIGTERM/SIGINT.
 */

import type { Worker } from "bullmq";

console.log("[workers] Starting unified worker process...");

// Each worker file creates a BullMQ Worker instance on import
import { worker as publishWorker } from "./publish-worker";
console.log("[workers] Post publish worker started");

import { worker as reviewSyncWorker } from "./review-sync-worker";
console.log("[workers] Review sync worker started");

import { worker as reviewPublishWorker } from "./review-publish-worker";
console.log("[workers] Review publish worker started");

import { worker as metricsSyncWorker } from "./metrics-sync-worker";
console.log("[workers] Metrics sync worker started");

import { worker as postSweepWorker } from "./post-sweep-worker";
console.log("[workers] Post sweep worker started");

import { worker as postGenerationWorker } from "./post-generation-worker";
console.log("[workers] Post generation worker started");

const workers: Worker[] = [
  publishWorker,
  reviewSyncWorker,
  reviewPublishWorker,
  metricsSyncWorker,
  postSweepWorker,
  postGenerationWorker,
];

// Initialize recurring schedulers on startup (idempotent)
import { initReviewSyncScheduler } from "../src/lib/queue/review-sync-queue";
import { initMetricsSyncScheduler } from "../src/lib/queue/metrics-sync-queue";
import { initPostSweepScheduler } from "../src/lib/queue/post-sweep-queue";
import { initPostGenerationScheduler } from "../src/lib/queue/post-generation-queue";

async function initSchedulers() {
  try {
    await initReviewSyncScheduler();
    console.log("[workers] Review sync scheduler initialized (every 30 min)");
  } catch (err) {
    console.error("[workers] Failed to init review sync scheduler:", err);
  }
  try {
    await initMetricsSyncScheduler();
    console.log("[workers] Metrics sync scheduler initialized (every 24h)");
  } catch (err) {
    console.error("[workers] Failed to init metrics sync scheduler:", err);
  }
  try {
    await initPostSweepScheduler();
    console.log("[workers] Post sweep scheduler initialized (every 15 min)");
  } catch (err) {
    console.error("[workers] Failed to init post sweep scheduler:", err);
  }
  try {
    await initPostGenerationScheduler();
    console.log("[workers] Post generation scheduler initialized (daily at 06:00 UTC)");
  } catch (err) {
    console.error("[workers] Failed to init post generation scheduler:", err);
  }
}

initSchedulers();

console.log("[workers] All workers running. Waiting for jobs...");

// Graceful shutdown: close all workers (waits for in-flight jobs to finish),
// with a hard-kill fallback in case a job hangs.
let shuttingDown = false;

async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;

  console.log(`[workers] Received ${signal}, shutting down gracefully...`);

  // Hard-kill fallback: don't hang forever if a worker can't close
  const killTimer = setTimeout(() => {
    console.error("[workers] Shutdown timed out after 30s, forcing exit");
    process.exit(1);
  }, 30_000);
  killTimer.unref();

  const results = await Promise.allSettled(workers.map((w) => w.close()));
  for (const result of results) {
    if (result.status === "rejected") {
      console.error("[workers] Worker failed to close:", result.reason);
    }
  }

  console.log("[workers] Shutdown complete");
  process.exit(0);
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
