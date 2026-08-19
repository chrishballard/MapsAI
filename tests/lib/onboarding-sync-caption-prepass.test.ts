import { describe, it, expect, vi, beforeEach } from 'vitest';

// Onboarding generates the very first post batch seconds after the first
// GBP media sync — without a caption pre-pass that batch would always match
// blind. The pre-pass (sync media, caption a bounded number) runs in the
// worker before generation, and must never block generation when it fails.

const mocks = vi.hoisted(() => ({
  prisma: {
    profile: { findUnique: vi.fn() },
    post: { count: vi.fn() },
  },
  generateAndSchedulePosts: vi.fn(),
  syncProfileReviews: vi.fn(),
  syncProfileMetrics: vi.fn(),
  initReviewSyncScheduler: vi.fn(),
  initMetricsSyncScheduler: vi.fn(),
  syncProfileMediaToLibrary: vi.fn(),
  captionUncaptionedApproved: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({ prisma: mocks.prisma }));
vi.mock('@/lib/post-generation-pipeline', () => ({
  generateAndSchedulePosts: mocks.generateAndSchedulePosts,
}));
vi.mock('@/lib/sync/reviews', () => ({
  syncProfileReviews: mocks.syncProfileReviews,
}));
vi.mock('@/lib/sync/metrics', () => ({
  syncProfileMetrics: mocks.syncProfileMetrics,
}));
vi.mock('@/lib/queue/review-sync-queue', () => ({
  initReviewSyncScheduler: mocks.initReviewSyncScheduler,
}));
vi.mock('@/lib/queue/metrics-sync-queue', () => ({
  initMetricsSyncScheduler: mocks.initMetricsSyncScheduler,
}));
vi.mock('@/lib/google-media', () => ({
  syncProfileMediaToLibrary: mocks.syncProfileMediaToLibrary,
}));
vi.mock('@/lib/image-captioner', () => ({
  captionUncaptionedApproved: mocks.captionUncaptionedApproved,
}));

const { runInitialSync } = await import('@/lib/onboarding-sync');

beforeEach(() => {
  vi.clearAllMocks();
  mocks.prisma.profile.findUnique.mockResolvedValue({
    id: 'p1',
    name: 'Acme',
    isOnboarded: true,
    isConnected: true,
    googleAccount: {},
    promptTemplate: null,
  });
  mocks.prisma.post.count.mockResolvedValue(0);
  mocks.generateAndSchedulePosts.mockResolvedValue({ created: 4, scheduled: 4 });
  mocks.syncProfileReviews.mockResolvedValue(undefined);
  mocks.syncProfileMetrics.mockResolvedValue(undefined);
  mocks.initReviewSyncScheduler.mockResolvedValue(undefined);
  mocks.initMetricsSyncScheduler.mockResolvedValue(undefined);
  mocks.syncProfileMediaToLibrary.mockResolvedValue({
    added: 3,
    updated: 0,
    removed: 0,
    total: 3,
  });
  mocks.captionUncaptionedApproved.mockResolvedValue(3);
});

describe('onboarding caption pre-pass', () => {
  it('syncs media and captions before generating the first batch', async () => {
    await runInitialSync('p1');

    // skipCaptionEnqueue: the pre-pass captions inline; letting the sync
    // hook enqueue worker jobs too would double-bill the same images.
    expect(mocks.syncProfileMediaToLibrary).toHaveBeenCalledWith(
      'p1',
      expect.objectContaining({ skipCaptionEnqueue: true })
    );
    expect(mocks.captionUncaptionedApproved).toHaveBeenCalledWith(
      'p1',
      expect.objectContaining({ limit: expect.any(Number) })
    );
    expect(mocks.generateAndSchedulePosts).toHaveBeenCalled();
    // Order: sync -> captions -> generation.
    expect(
      mocks.syncProfileMediaToLibrary.mock.invocationCallOrder[0]
    ).toBeLessThan(mocks.captionUncaptionedApproved.mock.invocationCallOrder[0]);
    expect(
      mocks.captionUncaptionedApproved.mock.invocationCallOrder[0]
    ).toBeLessThan(mocks.generateAndSchedulePosts.mock.invocationCallOrder[0]);
  });

  it('still generates when the media pre-sync fails', async () => {
    mocks.syncProfileMediaToLibrary.mockRejectedValue(new Error('GBP down'));

    await runInitialSync('p1');

    expect(mocks.generateAndSchedulePosts).toHaveBeenCalled();
  });

  it('skips the pre-pass when generation is skipped (future posts exist)', async () => {
    mocks.prisma.post.count.mockResolvedValue(4);

    await runInitialSync('p1');

    expect(mocks.syncProfileMediaToLibrary).not.toHaveBeenCalled();
    expect(mocks.captionUncaptionedApproved).not.toHaveBeenCalled();
    expect(mocks.generateAndSchedulePosts).not.toHaveBeenCalled();
  });
});
