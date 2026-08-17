import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Job } from 'bullmq';

// The recurring sync worker is the primary "no review monitoring" gate:
// disabled profiles must never even be selected for syncing.

const mocks = vi.hoisted(() => ({
  prisma: { profile: { findMany: vi.fn() } },
  syncProfileReviews: vi.fn(),
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
          isOnboarded: true,
          reviewsEnabled: true,
        }),
      })
    );
  });
});
