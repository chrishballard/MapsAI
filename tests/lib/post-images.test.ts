import { describe, it, expect, vi, beforeEach } from 'vitest';

// Image rotation: every generated post gets the least-recently-used
// approved photo, cycling when the batch is bigger than the pool. Image
// problems must never fail post generation — the picker never throws.

const mocks = vi.hoisted(() => ({
  prisma: {
    profileImage: { findMany: vi.fn(), update: vi.fn() },
    profile: { findUnique: vi.fn() },
    $transaction: vi.fn(async (ops: unknown[]) => ops),
  },
  syncProfileMediaToLibrary: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({ prisma: mocks.prisma }));
vi.mock('@/lib/google-media', () => ({
  syncProfileMediaToLibrary: mocks.syncProfileMediaToLibrary,
}));

const { pickImagesForPosts, markImagesUsed, isImageFkViolation } =
  await import('@/lib/post-images');

beforeEach(() => {
  vi.clearAllMocks();
});

describe('pickImagesForPosts', () => {
  it('assigns pool images in order, cycling when the batch is larger', async () => {
    mocks.prisma.profileImage.findMany.mockResolvedValue([
      { id: 'img1' },
      { id: 'img2' },
    ]);

    const picked = await pickImagesForPosts('p1', 5);

    expect(picked).toEqual(['img1', 'img2', 'img1', 'img2', 'img1']);
  });

  it('returns nulls (text-only posts) when the library is empty and sync finds nothing', async () => {
    mocks.prisma.profileImage.findMany.mockResolvedValue([]);
    mocks.prisma.profile.findUnique.mockResolvedValue({
      accountResourceName: 'accounts/1',
      mediaSyncedAt: null,
    });
    mocks.syncProfileMediaToLibrary.mockResolvedValue({
      added: 0,
      updated: 0,
      removed: 0,
      total: 0,
    });

    const picked = await pickImagesForPosts('p1', 3);

    expect(picked).toEqual([null, null, null]);
    expect(mocks.syncProfileMediaToLibrary).toHaveBeenCalledWith('p1');
  });

  it('auto-syncs from GBP when the library is empty, then uses the result', async () => {
    mocks.prisma.profileImage.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 'synced1' }]);
    mocks.prisma.profile.findUnique.mockResolvedValue({
      accountResourceName: 'accounts/1',
      mediaSyncedAt: null,
    });
    mocks.syncProfileMediaToLibrary.mockResolvedValue({
      added: 1,
      updated: 0,
      removed: 0,
      total: 1,
    });

    const picked = await pickImagesForPosts('p1', 2);

    expect(picked).toEqual(['synced1', 'synced1']);
  });

  it('skips the auto-sync when one ran recently', async () => {
    mocks.prisma.profileImage.findMany.mockResolvedValue([]);
    mocks.prisma.profile.findUnique.mockResolvedValue({
      accountResourceName: 'accounts/1',
      mediaSyncedAt: new Date(), // just synced
    });

    const picked = await pickImagesForPosts('p1', 2);

    expect(picked).toEqual([null, null]);
    expect(mocks.syncProfileMediaToLibrary).not.toHaveBeenCalled();
  });

  it('survives a failing GBP sync (posts still generate text-only)', async () => {
    mocks.prisma.profileImage.findMany.mockResolvedValue([]);
    mocks.prisma.profile.findUnique.mockResolvedValue({
      accountResourceName: 'accounts/1',
      mediaSyncedAt: null,
    });
    mocks.syncProfileMediaToLibrary.mockRejectedValue(new Error('GBP down'));

    const picked = await pickImagesForPosts('p1', 2);

    expect(picked).toEqual([null, null]);
  });

  it('never throws — even a failing image query degrades to text-only', async () => {
    mocks.prisma.profileImage.findMany.mockRejectedValue(
      new Error('db exploded')
    );

    const picked = await pickImagesForPosts('p1', 2);

    expect(picked).toEqual([null, null]);
  });
});

describe('markImagesUsed', () => {
  it('increments per-image use counts, deduping repeats, without returning image bytes', async () => {
    await markImagesUsed(['img1', 'img2', 'img1']);

    expect(mocks.prisma.profileImage.update).toHaveBeenCalledTimes(2);
    const calls = mocks.prisma.profileImage.update.mock.calls.map((call) => {
      const arg = call[0] as {
        where: { id: string };
        data: { timesUsed: { increment: number } };
        select: unknown;
      };
      return {
        id: arg.where.id,
        inc: arg.data.timesUsed.increment,
        select: arg.select,
      };
    });
    expect(calls).toContainEqual({ id: 'img1', inc: 2, select: { id: true } });
    expect(calls).toContainEqual({ id: 'img2', inc: 1, select: { id: true } });
  });

  it('does nothing for an empty list', async () => {
    await markImagesUsed([]);
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled();
  });
});

describe('isImageFkViolation', () => {
  it('matches only imageId foreign-key violations', () => {
    expect(
      isImageFkViolation({
        code: 'P2003',
        meta: { constraint: 'Post_imageId_fkey' },
      })
    ).toBe(true);
    expect(
      isImageFkViolation({
        code: 'P2003',
        meta: { constraint: 'Post_profileId_fkey' },
      })
    ).toBe(false);
    expect(isImageFkViolation(new Error('nope'))).toBe(false);
  });
});
