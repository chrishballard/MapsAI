/**
 * Unified worker entry point
 * Imports all worker files which auto-start their BullMQ Workers on import.
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
