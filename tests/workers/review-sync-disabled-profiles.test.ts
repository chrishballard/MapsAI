import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Job } from 'bullmq';

// The recurring sync worker is the primary "no review monitoring" gate:
// disabled profiles must never even be selected for syncing.

const mocks = vi.hoisted(() => ({
  prisma: { profile: { findMany: vi.fn() } },
  syncProfileReviews: vi.fn(),
  requeueStrandedReviewReplies: vi.fn(async () => 0),
  processor: undefined as ((job: Job) => Promise<void>) | undefined,
}));

vi.mock('bullmq', () => ({
  Worker: class {
    constructor(_name: string, processor: (job: Job) => Promise<void>) {
      mocks.processor = processor;
    }
    on() {
      return this;
    }
  },
}));
vi.mock('../../src/lib/queue/connection', () => ({ redisConnection: {} }));
vi.mock('../../src/lib/prisma', () => ({ prisma: mocks.prisma }));
vi.mock('../../src/lib/sync/reviews', () => ({
  syncProfileReviews: mocks.syncProfileReviews,
}));
vi.mock('../../src/lib/queue/review-publish-queue', () => ({
  requeueStrandedReviewReplies: mocks.requeueStrandedReviewReplies,
}));

await import('../../workers/review-sync-worker');

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'log').mockImplementation(() => {});
  mocks.prisma.profile.findMany.mockResolvedValue([]);
});

describe('review sync worker', () => {
  it('only selects profiles with review management on', async () => {
    await mocks.processor!({ id: 'job1' } as Job);

    expect(mocks.prisma.profile.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          isConnected: true,
          reviewsEnabled: true,
        }),
      })
    );
  });

  it('selects onboarded profiles and offboarded ones marked reviewsOnly, nothing else', async () => {
    await mocks.processor!({ id: 'job1' } as Job);

    const { where } = mocks.prisma.profile.findMany.mock.calls[0][0];
    expect(where).not.toHaveProperty('isOnboarded');
    expect(where.OR).toEqual([{ isOnboarded: true }, { reviewsOnly: true }]);
  });

  it('re-queues stranded approved replies on every run (M8)', async () => {
    await mocks.processor!({ id: 'job1' } as Job);

    expect(mocks.requeueStrandedReviewReplies).toHaveBeenCalledTimes(1);
  });
});
