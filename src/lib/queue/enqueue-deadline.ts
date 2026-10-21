/**
 * The queues' Redis connection waits out an outage rather than failing:
 * maxRetriesPerRequest is null and ioredis's offline queue is on, so with
 * Redis down a queue.add() parks until it reconnects. Workers want that. A
 * request handler has to answer, so it races the enqueue against this
 * deadline and treats a timeout as a failed enqueue.
 *
 * The parked call can still land after the deadline. Callers must be safe
 * with that: a late sync job just runs a sync, and a late review publish job
 * finds the reply back in DRAFTED and refuses to publish it.
 *
 * Dependency-free on purpose (no Redis connection on import), so route tests
 * that mock the queue modules don't have to mock this too.
 */
export const ENQUEUE_DEADLINE_MS = 5_000;

export class EnqueueTimeoutError extends Error {
  constructor(ms: number) {
    super(`The queue did not answer within ${ms} ms (Redis may be unavailable)`);
    this.name = "EnqueueTimeoutError";
  }
}

export async function enqueueWithin<T>(
  work: Promise<T>,
  ms: number = ENQUEUE_DEADLINE_MS
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new EnqueueTimeoutError(ms)), ms);
  });
  try {
    return await Promise.race([work, deadline]);
  } finally {
    clearTimeout(timer);
  }
}
