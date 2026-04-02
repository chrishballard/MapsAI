/**
 * Unified worker entry point
 * Imports all worker files which auto-start their BullMQ Workers on import.
 * Initializes recurring job schedulers.
 * Handles graceful shutdown on SIGTERM/SIGINT.
 */

console.log("[workers] Starting unified worker process...");

// Each worker file creates a BullMQ Worker instance on import
import "./publish-worker";
console.log("[workers] Post publish worker started");

import "./review-sync-worker";
console.log("[workers] Review sync worker started");

import "./review-publish-worker";
console.log("[workers] Review publish worker started");

import "./metrics-sync-worker";
console.log("[workers] Metrics sync worker started");

// Initialize recurring schedulers on startup (idempotent)
import { initReviewSyncScheduler } from "../src/lib/queue/review-sync-queue";
import { initMetricsSyncScheduler } from "../src/lib/queue/metrics-sync-queue";

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
}

initSchedulers();

console.log("[workers] All workers running. Waiting for jobs...");

// Graceful shutdown
function shutdown(signal: string) {
  console.log(`[workers] Received ${signal}, shutting down gracefully...`);
  // BullMQ workers will close their connections
  // Give them a moment to finish current jobs
  setTimeout(() => {
    console.log("[workers] Shutdown complete");
    process.exit(0);
  }, 5000);
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
