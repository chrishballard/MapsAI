import { describe, it, expect, vi, beforeEach } from 'vitest';

// L16: publish jobs get a stable per-response jobId, so a double enqueue (a
// retry, the stranded-approval sweep) dedupes instead of queueing twice. A
// retained completed/failed record would dedupe a legitimate re-queue for the
// whole retention window, so it's cleared first, as schedulePostPublish does.
//
// M8: the sweep re-queues APPROVED replies whose job never made it into Redis
// (an enqueue the review sync swallowed, or a Redis eviction).

const mocks = vi.hoisted(() => ({
  queueAdd: vi.fn(),
  queueGetJob: vi.fn(),
  prisma: { reviewResponse: { findMany: vi.fn() } },
}));

vi.mock('bullmq', () => ({
  Queue: class {
    add = mocks.queueAdd;
    getJob = mocks.queueGetJob;
    on = vi.fn();
  },
}));
vi.mock('@/lib/queue/connection', () => ({
  redisConnection: {},
  defaultJobRetention: {},
}));
vi.mock('@/lib/prisma', () => ({ prisma: mocks.prisma }));

const { scheduleReviewPublish, requeueStrandedReviewReplies } = await import(
  '@/lib/queue/review-publish-queue'
);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.queueGetJob.mockResolvedValue(null);
  mocks.queueAdd.mockResolvedValue({});
});

describe('scheduleReviewPublish (L16)', () => {
  it('uses a stable per-response jobId', async () => {
    await scheduleReviewPublish('resp1', { delayMs: 7_500 });

    expect(mocks.queueAdd).toHaveBeenCalledWith(
      'publish-review-resp1',
      { reviewResponseId: 'resp1' },
      { delay: 7_500, jobId: 'publish-review-resp1' }
    );
  });

  it.each(['completed', 'failed'])('clears a retained %s record before adding', async (state) => {
    const remove = vi.fn(async () => {});
    mocks.queueGetJob.mockResolvedValue({ getState: async () => state, remove });

    await scheduleReviewPublish('resp1');

    expect(remove).toHaveBeenCalled();
    expect(mocks.queueAdd).toHaveBeenCalled();
  });

  it('leaves a pending job alone so the add dedupes', async () => {
    const remove = vi.fn(async () => {});
    mocks.queueGetJob.mockResolvedValue({ getState: async () => 'delayed', remove });

    await scheduleReviewPublish('resp1');

    expect(remove).not.toHaveBeenCalled();
  });
});

describe('requeueStrandedReviewReplies (M8)', () => {
  it('re-queues APPROVED replies untouched for a while, staggered', async () => {
    const now = new Date('2026-10-21T12:00:00Z');
    mocks.prisma.reviewResponse.findMany.mockResolvedValue([{ id: 'r1' }, { id: 'r2' }]);

    const count = await requeueStrandedReviewReplies(now);

    expect(count).toBe(2);
    const { where } = mocks.prisma.reviewResponse.findMany.mock.calls[0][0];
    expect(where.status).toBe('APPROVED');
    expect(where.updatedAt.lt.getTime()).toBeLessThan(now.getTime());
    // Never reaches back to old approvals, or to profiles the sync skips.
    expect(now.getTime() - where.updatedAt.gte.getTime()).toBeLessThanOrEqual(7 * 86_400_000);
    expect(where.review).toEqual({
      removedAt: null,
      repliedExternally: false,
      profile: {
        isConnected: true,
        reviewsEnabled: true,
        OR: [{ isOnboarded: true }, { reviewsOnly: true }],
      },
    });
    expect(mocks.queueAdd.mock.calls.map((c) => c[2].delay)).toEqual([0, 7_500]);
  });

  it('keeps going past one failed enqueue', async () => {
    mocks.prisma.reviewResponse.findMany.mockResolvedValue([{ id: 'r1' }, { id: 'r2' }]);
    mocks.queueAdd.mockRejectedValueOnce(new Error('blip')).mockResolvedValueOnce({});

    const count = await requeueStrandedReviewReplies(new Date());

    expect(count).toBe(1);
    expect(mocks.queueAdd).toHaveBeenCalledTimes(2);
  });
});
