import { describe, it, expect, vi, beforeEach } from 'vitest';

// The "Sync Reviews" and reports "Sync" buttons. When Redis was down the
// enqueue threw, the route logged a warning and still answered 200 "sync
// triggered", so the button told the operator a sync was on its way when
// nothing had been queued.

const mocks = vi.hoisted(() => ({
  reviewSyncQueue: { add: vi.fn() },
  initReviewSyncScheduler: vi.fn(),
  metricsSyncQueue: { add: vi.fn() },
  initMetricsSyncScheduler: vi.fn(),
}));

vi.mock('@/lib/auth/require-session', () => ({
  requireSession: vi.fn(async () => null),
}));
vi.mock('@/lib/queue/review-sync-queue', () => ({
  reviewSyncQueue: mocks.reviewSyncQueue,
  initReviewSyncScheduler: mocks.initReviewSyncScheduler,
}));
vi.mock('@/lib/queue/metrics-sync-queue', () => ({
  metricsSyncQueue: mocks.metricsSyncQueue,
  initMetricsSyncScheduler: mocks.initMetricsSyncScheduler,
}));

const reviewSync = await import('@/app/api/reviews/sync/route');
const metricsSync = await import('@/app/api/metrics/sync/route');

const redisDown = new Error('connect ECONNREFUSED 127.0.0.1:6379');

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  mocks.reviewSyncQueue.add.mockResolvedValue({ id: 'j1' });
  mocks.initReviewSyncScheduler.mockResolvedValue(undefined);
  mocks.metricsSyncQueue.add.mockResolvedValue({ id: 'j2' });
  mocks.initMetricsSyncScheduler.mockResolvedValue(undefined);
});

describe('POST /api/reviews/sync', () => {
  it('says the sync was triggered when the job is queued', async () => {
    const res = await reviewSync.POST();
    expect(res.status).toBe(200);
    expect(mocks.reviewSyncQueue.add).toHaveBeenCalledTimes(1);
  });

  it('503s with an error when the job could not be queued', async () => {
    mocks.reviewSyncQueue.add.mockRejectedValue(redisDown);
    const res = await reviewSync.POST();
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error).toMatch(/could not be started/i);
    expect(body.message).toBeUndefined();
  });

  it('still reports the queued sync when only the scheduler refresh fails', async () => {
    mocks.initReviewSyncScheduler.mockRejectedValue(redisDown);
    const res = await reviewSync.POST();
    expect(res.status).toBe(200);
  });
});

describe('POST /api/metrics/sync', () => {
  const req = (days?: string) =>
    new Request(
      `http://localhost:3000/api/metrics/sync${days ? `?days=${days}` : ''}`,
      { method: 'POST' }
    );

  it('says the sync was triggered when the job is queued', async () => {
    const res = await metricsSync.POST(req('365'));
    expect(res.status).toBe(200);
    expect(mocks.metricsSyncQueue.add).toHaveBeenCalledWith(
      'manual-sync',
      { days: 365 },
      { delay: 0 }
    );
  });

  it('503s with an error when the job could not be queued', async () => {
    mocks.metricsSyncQueue.add.mockRejectedValue(redisDown);
    const res = await metricsSync.POST(req());
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error).toMatch(/could not be started/i);
    expect(body.message).toBeUndefined();
  });

  it('still reports the queued sync when only the scheduler refresh fails', async () => {
    mocks.initMetricsSyncScheduler.mockRejectedValue(redisDown);
    const res = await metricsSync.POST(req());
    expect(res.status).toBe(200);
  });
});

describe('sync triggers while Redis is unreachable', () => {
  // The queues' connection waits out an outage (maxRetriesPerRequest: null,
  // ioredis's offline queue on), so with Redis down add() never settles. The
  // routes must still answer, not hang until the proxy gives up.
  const never = () => new Promise<never>(() => {});

  it.each([
    ['reviews', () => reviewSync.POST(), () => mocks.reviewSyncQueue.add.mockImplementation(never)],
    [
      'metrics',
      () => metricsSync.POST(new Request('http://localhost/api/metrics/sync')),
      () => mocks.metricsSyncQueue.add.mockImplementation(never),
    ],
  ])('%s: 503s once the enqueue has hung past its deadline', async (_name, call, hang) => {
    vi.useFakeTimers();
    try {
      hang();
      const pending = call();
      await vi.advanceTimersByTimeAsync(6_000);
      const res = await pending;
      expect(res.status).toBe(503);
    } finally {
      vi.useRealTimers();
    }
  });
});
