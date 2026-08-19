import { describe, it, expect, vi, beforeEach } from 'vitest';

// Caption backfill: one-time vision pass over every APPROVED uncaptioned
// library image. Dry run is fully inert — no DB writes AND no Claude calls,
// just counts and a cost estimate — so Chris can approve the spend before a
// live run. Live runs are idempotent (captionedAt-null filter) and tolerate
// per-image failures.

const mocks = vi.hoisted(() => ({
  prisma: {
    profile: { findMany: vi.fn() },
    profileImage: { findMany: vi.fn() },
  },
  captionImages: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({ prisma: mocks.prisma }));
vi.mock('@/lib/image-captioner', () => ({
  captionImages: mocks.captionImages,
}));

const { backfillImageCaptions } = await import('@/lib/backfill-image-captions');

beforeEach(() => {
  vi.clearAllMocks();
  mocks.prisma.profile.findMany.mockResolvedValue([
    { id: 'p1', name: 'Acme' },
    { id: 'p2', name: 'Badger' },
  ]);
  mocks.prisma.profileImage.findMany.mockResolvedValue([]);
  mocks.captionImages.mockResolvedValue([]);
});

describe('dry run', () => {
  it('counts uncaptioned images and estimates cost without calling Claude or writing', async () => {
    mocks.prisma.profileImage.findMany
      .mockResolvedValueOnce([
        { id: 'a', source: 'GBP' },
        { id: 'b', source: 'TEAM' },
      ])
      .mockResolvedValueOnce([]);

    const summary = await backfillImageCaptions({ dryRun: true, log: () => {} });

    expect(summary.dryRun).toBe(true);
    expect(summary.imagesUncaptioned).toBe(2);
    expect(summary.imagesCaptioned).toBe(0);
    expect(summary.estimatedCostUsd).toBeGreaterThan(0);
    expect(mocks.captionImages).not.toHaveBeenCalled();
    // Read-only: the only prisma access is findMany.
    expect(mocks.prisma.profileImage.findMany).toHaveBeenCalledTimes(2);
  });

  it('scans only APPROVED images without captions (idempotence)', async () => {
    await backfillImageCaptions({ dryRun: true, log: () => {} });

    const query = mocks.prisma.profileImage.findMany.mock.calls[0][0];
    expect(query.where).toMatchObject({
      profileId: 'p1',
      status: 'APPROVED',
      captionedAt: null,
      // Permanent skips are recorded on the row and never retried.
      captionSkipReason: null,
    });
    // Never pull image bytes just to count rows.
    expect(query.select).toEqual({ id: true, source: true });
  });
});

describe('live run', () => {
  it('captions per profile and tallies outcomes', async () => {
    mocks.prisma.profileImage.findMany
      .mockResolvedValueOnce([
        { id: 'a', source: 'GBP' },
        { id: 'b', source: 'TEAM' },
        { id: 'c', source: 'GBP' },
      ])
      .mockResolvedValueOnce([]);
    mocks.captionImages.mockResolvedValue([
      { imageId: 'a', ok: true },
      { imageId: 'b', ok: false, skipped: 'NO_INPUT' },
      { imageId: 'c', ok: false, error: 'rate limited' },
    ]);

    const summary = await backfillImageCaptions({ log: () => {} });

    expect(mocks.captionImages).toHaveBeenCalledWith(
      ['a', 'b', 'c'],
      expect.objectContaining({ concurrency: expect.any(Number) })
    );
    expect(summary.imagesCaptioned).toBe(1);
    expect(summary.imagesSkipped).toBe(1);
    expect(summary.imagesFailed).toBe(1);
    expect(summary.results[0].skipReasons).toEqual({ NO_INPUT: 1 });
  });

  it('only reports profiles that had uncaptioned images', async () => {
    mocks.prisma.profileImage.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 'x', source: 'CLIENT' }]);
    mocks.captionImages.mockResolvedValue([{ imageId: 'x', ok: true }]);

    const summary = await backfillImageCaptions({ log: () => {} });

    expect(summary.profilesChecked).toBe(2);
    expect(summary.results).toHaveLength(1);
    expect(summary.results[0].name).toBe('Badger');
  });

  it('records a profile-level failure and keeps going', async () => {
    mocks.prisma.profileImage.findMany
      .mockRejectedValueOnce(new Error('db down'))
      .mockResolvedValueOnce([{ id: 'x', source: 'TEAM' }]);
    mocks.captionImages.mockResolvedValue([{ imageId: 'x', ok: true }]);

    const summary = await backfillImageCaptions({ log: () => {} });

    expect(summary.profilesErrored).toEqual(['Acme']);
    expect(summary.imagesCaptioned).toBe(1);
  });
});
