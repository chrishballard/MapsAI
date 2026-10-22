/**
 * Logging for Redis errors that can't leak the Redis password.
 *
 * ioredis tags a failed command's error with `command: { name, args }`, and
 * when AUTH fails it rejects every queued command with that same error
 * object, so the AUTH args (the password) ride along. BullMQ re-emits client
 * errors on the Queue or Worker, and with no 'error' listener it falls back to
 * console.error(err), which prints them. That is how the old Redis password
 * reached Railway's logs during the 2026-10-22 rotation; a caller logging a
 * failed queue.add() whole printed the same thing.
 *
 * So: every Queue, Worker and QueueEvents gets logRedisErrors(), and code
 * that logs a failed queue call logs redisErrorMessage(err), never err.
 *
 * Dependency-free on purpose (no Redis connection on import), so tests that
 * mock the queue modules don't have to mock this too.
 */

const REDACTED = "[redacted]";

/** The configured Redis URL and its password, longest first. */
function configuredSecrets(): string[] {
  const url = process.env.REDIS_URL;
  if (!url) return [];
  const secrets = [url];
  try {
    const { password } = new URL(url);
    if (password) secrets.push(password, decodeURIComponent(password));
  } catch {
    // Unparseable: the URL is still redacted whole.
  }
  return [...new Set(secrets)]
    .filter(Boolean)
    .sort((a, b) => b.length - a.length);
}

// Credentials inside any redis:// or rediss:// URL, configured or not.
const URL_CREDENTIALS = /(rediss?:\/\/)[^@\s/]*@/gi;

function scrub(text: string): string {
  let out = text;
  for (const secret of configuredSecrets()) out = out.split(secret).join(REDACTED);
  return out.replace(URL_CREDENTIALS, `$1${REDACTED}@`);
}

/**
 * One line for a log: the error's name and message, with any Redis URL or
 * password removed. Never the error object, so never its command args,
 * connection options or stack.
 */
export function redisErrorMessage(err: unknown): string {
  if (!(err instanceof Error)) return scrub(String(err));
  // A refused connection tried over IPv4 and IPv6 is an AggregateError with
  // an empty message; the reasons are in its inner errors.
  const inner =
    err instanceof AggregateError
      ? err.errors.filter((e) => e instanceof Error).map((e) => e.message)
      : [];
  const detail =
    err.message ||
    inner.join("; ") ||
    String((err as { code?: unknown }).code ?? "");
  return scrub(`${err.name}: ${detail}`);
}

/**
 * Replace the command args ioredis attached to an error, in place. ioredis
 * rejects the queued commands first and emits 'error' right after, in the
 * same tick, so by the time a caller's catch runs this has already happened:
 * a caller that logs the rejected error whole no longer prints the password.
 */
function redactCommandArgs(err: unknown): void {
  if (!err || typeof err !== "object") return;
  const command = (err as { command?: unknown }).command;
  if (command && typeof command === "object" && "args" in command) {
    (err as { command: unknown }).command = {
      name: (command as { name?: unknown }).name,
      args: [REDACTED],
    };
  }
}

interface ErrorEmitter {
  on(event: "error", listener: (err: Error) => void): unknown;
}

/**
 * Give a BullMQ Queue, Worker or QueueEvents (or an ioredis client) an
 * 'error' listener that logs one sanitized line. Without a listener BullMQ
 * prints the raw error, password included.
 */
export function logRedisErrors<T extends ErrorEmitter>(
  emitter: T,
  label: string
): T {
  emitter.on("error", (err: Error) => {
    redactCommandArgs(err);
    console.error(`[redis:${label}] ${redisErrorMessage(err)}`);
  });
  return emitter;
}
