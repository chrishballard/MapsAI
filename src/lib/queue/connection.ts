import { ConnectionOptions } from "bullmq";

function parseRedisUrl(url: string): ConnectionOptions {
  const parsed = new URL(url);
  return {
    host: parsed.hostname,
    port: parseInt(parsed.port || "6379", 10),
    password: parsed.password || undefined,
    username: parsed.username || undefined,
    // rediss:// means TLS. Ignoring the scheme would silently attempt a
    // plaintext connection to a TLS-only server.
    ...(parsed.protocol === "rediss:"
      ? { tls: { servername: parsed.hostname } }
      : {}),
    maxRetriesPerRequest: null,
  };
}

// A missing REDIS_URL in production silently falls back to localhost: the
// deploy looks healthy while every queue is dead. Fail loudly instead.
// Skipped during `next build`, where route modules are imported before
// runtime env vars are necessarily available.
if (
  !process.env.REDIS_URL &&
  process.env.NODE_ENV === "production" &&
  process.env.NEXT_PHASE !== "phase-production-build"
) {
  throw new Error(
    "REDIS_URL is not set. Refusing to fall back to localhost:6379 in production — queues would be silently dead. Set REDIS_URL on this service."
  );
}

export const redisConnection: ConnectionOptions = process.env.REDIS_URL
  ? parseRedisUrl(process.env.REDIS_URL)
  : {
      host: "localhost",
      port: 6379,
      maxRetriesPerRequest: null,
    };

// Shared retention for every queue. Completed jobs only need to stick around
// briefly (dedup + inspection); failed jobs are kept longer for debugging.
// Without retention, job records accumulate forever — Redis grows unbounded
// and, once it hits maxmemory, eviction can destroy delayed publish jobs.
export const defaultJobRetention = {
  removeOnComplete: { age: 86_400, count: 1_000 }, // 1 day
  removeOnFail: { age: 7 * 86_400, count: 5_000 }, // 7 days
} as const;
