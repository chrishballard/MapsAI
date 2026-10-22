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
    if (password) {
      secrets.push(password);
      // A stray "%" makes decoding throw; the raw form is still redacted.
      try {
        secrets.push(decodeURIComponent(password));
      } catch {}
    }
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
      ? err.errors
          .filter((e) => e instanceof Error)
          .map((e) => e.message)
          .filter(Boolean)
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

interface Connection {
  emit(event: string | symbol, ...args: unknown[]): boolean;
  listenerCount(event: string | symbol): number;
}

function isConnection(value: unknown): value is Connection {
  return (
    !!value &&
    typeof value === "object" &&
    typeof (value as Connection).emit === "function" &&
    typeof (value as Connection).listenerCount === "function"
  );
}

/**
 * BullMQ wraps each ioredis client in a RedisConnection (a Worker has two:
 * `connection` and `blockingConnection`) that passes the client's errors on
 * to the Queue or Worker. Its close() removes every listener, yet one that
 * never got through to Redis fails once more after that: when its socket
 * closes, it rejects with its last error and emits that as 'error' to
 * nobody. emit('error') with no listener throws, here inside a promise
 * callback, so it becomes an unhandled rejection and Node ends the process.
 * In production that is workers/index.ts closing its Workers on SIGTERM
 * while Redis is refusing the password or can't be reached.
 *
 * So an error the connection would throw comes to `onError` instead. It is
 * the error already logged when it happened, so the WeakSet drops it.
 */
function keepClosedConnectionsQuiet(
  owner: object,
  onError: (err: Error) => void
): void {
  for (const key of ["connection", "blockingConnection"]) {
    const connection = (owner as Record<string, unknown>)[key];
    if (!isConnection(connection)) continue;
    const emit = connection.emit;
    connection.emit = function (this: Connection, event, ...args) {
      if (event === "error" && this.listenerCount("error") === 0) {
        onError(args[0] as Error);
        return false;
      }
      return emit.call(this, event, ...args);
    };
  }
}

/**
 * Give a BullMQ Queue, Worker or QueueEvents (or an ioredis client) an
 * 'error' listener that logs one sanitized line. Without a listener BullMQ
 * prints the raw error, password included. Not every error is Redis's (a
 * worker also reports lock and listener failures here), hence "queue".
 */
export function logRedisErrors<T extends ErrorEmitter>(
  emitter: T,
  label: string
): T {
  // A queue with a job scheduler shares its client with the scheduler and
  // re-emits the scheduler's errors, so the same error arrives twice.
  const seen = new WeakSet<object>();
  const onError = (err: Error) => {
    if (err && typeof err === "object") {
      if (seen.has(err)) return;
      seen.add(err);
    }
    redactCommandArgs(err);
    console.error(`[queue:${label}] ${redisErrorMessage(err)}`);
  };
  emitter.on("error", onError);
  keepClosedConnectionsQuiet(emitter, onError);
  return emitter;
}
