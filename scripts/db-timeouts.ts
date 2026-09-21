/**
 * pg pool limits for command-line scripts that reach the production database
 * from a laptop.
 *
 * The app's shared client in src/lib/prisma.ts sets no timeouts, and with the
 * pg driver adapter that means none at all: a query waits for its reply for as
 * long as the socket exists. On 2026-09-21 the network dropped underneath
 * scripts/export-profile.ts and left it holding a half-open connection to the
 * Railway proxy. Nothing arrives on a socket like that, not even an error, so
 * six exports sat for up to four and a half hours and the vault's nightly sync
 * waited behind one of them.
 *
 * The limits are for scripts only, on purpose. The app has waits that are
 * legitimate: src/lib/image-upload.ts takes pg_advisory_xact_lock inside a
 * transaction, so a second upload for the same profile blocks on that
 * statement for as long as the first one runs. A query timeout on the shared
 * client would turn that wait into a failed request. A script that reads one
 * profile and exits has no such case.
 *
 * In a module of its own for the same reason as scripts/metrics-window.ts: the
 * script calls main() at import time, so a test cannot reach a helper defined
 * next to it.
 */
import type { PoolConfig } from "pg";

/** DNS, TCP, TLS and the Postgres handshake together. Normally under a second. */
export const DEFAULT_CONNECT_TIMEOUT_MS = 10_000;

/** One query. The whole export, eight of them, runs in under 40 seconds. */
export const DEFAULT_QUERY_TIMEOUT_MS = 30_000;

/** How long a connection sits idle before the first TCP keepalive probe. */
export const KEEPALIVE_INITIAL_DELAY_MS = 10_000;

type Env = Record<string, string | undefined>;

/**
 * A typo must not read as "no limit": pg treats anything falsy as that, and a
 * safety net that a stray character switches off is the failure this file
 * exists to end. So a value that is not a whole number throws.
 */
function readMs(env: Env, name: string, fallback: number): number {
  const raw = env[name]?.trim();
  if (raw === undefined || raw === "") return fallback;
  if (!/^\d+$/.test(raw)) {
    throw new Error(
      `${name} must be a whole number of milliseconds, or 0 to switch that limit off (got: ${env[name]})`
    );
  }
  return Number(raw);
}

/**
 * Spread into the PrismaPg config next to connectionString.
 *
 * SCRIPT_DB_CONNECT_TIMEOUT_MS bounds getting a usable connection.
 *
 * SCRIPT_DB_QUERY_TIMEOUT_MS sets two limits to the same value. query_timeout
 * is a timer in this process, and it is the one that catches a half-open
 * socket, because it needs nothing from the far end. statement_timeout goes to
 * Postgres as a session setting, so the server also stops working on a
 * statement this side has given up on.
 *
 * Keepalive is always on. It is what eventually gets a dead peer noticed on a
 * connection nobody is waiting on, which the two timers above do not cover.
 */
export function scriptPoolConfig(env: Env = process.env): PoolConfig {
  const queryMs = readMs(env, "SCRIPT_DB_QUERY_TIMEOUT_MS", DEFAULT_QUERY_TIMEOUT_MS);
  return {
    connectionTimeoutMillis: readMs(
      env,
      "SCRIPT_DB_CONNECT_TIMEOUT_MS",
      DEFAULT_CONNECT_TIMEOUT_MS
    ),
    query_timeout: queryMs,
    statement_timeout: queryMs,
    keepAlive: true,
    keepAliveInitialDelayMillis: KEEPALIVE_INITIAL_DELAY_MS,
  };
}
