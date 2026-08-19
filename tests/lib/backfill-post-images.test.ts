import { describe, it, expect, vi, beforeEach } from 'vitest';

// One-time backfill: posts generated before the image library existed sit in
// the queue text-only. The backfill walks every connected profile and attaches
// library images to unpublished text-only posts using the same rotation the
// generation pipeline uses — without ever touching published posts, posts that
// are already due, or posts someone assigned an image to concurrently.

const mocks = vi.hoisted(() => ({
  prisma: {
    profile: { findMany: vi.fn() },
    post: { findMany: vi.fn(), updateMany: vi.fn() },
    profileImage: { count: vi.fn() },
  },
  pickImagesForPosts: vi.fn(),
  markImagesUsed: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({ prisma: mocks.prisma }));
vi.mock('@/lib/post-images', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/post-images')>();
  return {
    ...actual,
    pickImagesForPosts: mocks.pickImagesForPosts,
    markImagesUsed: mocks.markImagesUsed,
  };
});

const { backfillPostImages } = await import('@/lib/backfill-post-images');

const silentLog = () => {};

// The write guard must re-evaluate, atomically at write time, the same
// criteria the candidate query used — a post that became due (or got
// published, or got an image) since the run started must be left alone.
const writeGuardOr = [
  { status: 'SCHEDULED', scheduledAt: { gt: expect.any(Date) } },
  { status: 'DRAFT' },
  { status: 'APPROVED' },
];

beforeEach(() => {
  vi.clearAllMocks();
  mocks.markImagesUsed.mockResolvedValue(undefined);
});

function profileRow(id: string, name: string) {
  return { id, name };
}

describe('backfillPostImages', () => {
  it('assigns rotated images to text-only posts and records usage', async () => {
    mocks.prisma.profile.findMany.mockResolvedValue([profileRow('p1', 'Bolder Apps')]);
    mocks.prisma.post.findMany.mockResolvedValue([
      { id: 's1', status: 'SCHEDULED', scheduledAt: new Date('2026-08-20') },
      { id: 's2', status: 'SCHEDULED', scheduledAt: new Date('2026-08-27') },
      { id: 'a1', status: 'APPROVED', scheduledAt: null },
      { id: 'd1', status: 'DRAFT', scheduledAt: null },
    ]);
    mocks.pickImagesForPosts.mockResolvedValue(['img1', 'img2', 'img1', 'img2']);
    mocks.prisma.post.updateMany.mockResolvedValue({ count: 1 });

    const summary = await backfillPostImages({ log: silentLog });

    expect(mocks.pickImagesForPosts).toHaveBeenCalledWith('p1', 4);
    expect(mocks.prisma.post.updateMany).toHaveBeenCalledTimes(4);
    for (const [call, postId, imageId] of [
      [0, 's1', 'img1'],
      [1, 's2', 'img2'],
      [2, 'a1', 'img1'],
      [3, 'd1', 'img2'],
    ] as const) {
      expect(mocks.prisma.post.updateMany.mock.calls[call][0]).toEqual({
        where: { id: postId, imageId: null, OR: writeGuardOr },
        data: { imageId },
      });
    }
    expect(mocks.markImagesUsed).toHaveBeenCalledWith([
      'img1',
      'img2',
      'img1',
      'img2',
    ]);
    expect(summary.postsAssigned).toBe(4);
    expect(summary.postsSkipped).toBe(0);
    expect(summary.profilesChecked).toBe(1);
    expect(summary.profilesErrored).toEqual([]);
    expect(summary.results).toEqual([
      expect.objectContaining({
        profileId: 'p1',
        name: 'Bolder Apps',
        candidates: 4,
        scheduled: 2,
        drafts: 1,
        approvedLegacy: 1,
        assigned: 4,
        skipped: 0,
        libraryEmpty: false,
      }),
    ]);
  });

  it('only targets unpublished text-only posts of connected onboarded profiles', async () => {
    mocks.prisma.profile.findMany.mockResolvedValue([profileRow('p1', 'A')]);
    mocks.prisma.post.findMany.mockResolvedValue([]);

    await backfillPostImages({ log: silentLog });

    expect(mocks.prisma.profile.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          isConnected: true,
          isOnboarded: true,
          accountResourceName: { not: null },
        },
      })
    );
    const postQuery = mocks.prisma.post.findMany.mock.calls[0][0];
    expect(postQuery.where).toEqual({
      profileId: 'p1',
      imageId: null,
      OR: [
        { status: 'SCHEDULED', scheduledAt: { gt: expect.any(Date) } },
        { status: 'DRAFT' },
        { status: 'APPROVED' },
      ],
    });
    // Scheduled posts get images in publish order; undated drafts come last.
    expect(postQuery.orderBy).toEqual([
      { scheduledAt: { sort: 'asc', nulls: 'last' } },
      { createdAt: 'asc' },
    ]);
  });

  it('skips profiles with nothing to backfill without touching the image pool', async () => {
    mocks.prisma.profile.findMany.mockResolvedValue([profileRow('p1', 'A')]);
    mocks.prisma.post.findMany.mockResolvedValue([]);

    const summary = await backfillPostImages({ log: silentLog });

    expect(mocks.pickImagesForPosts).not.toHaveBeenCalled();
    expect(mocks.prisma.post.updateMany).not.toHaveBeenCalled();
    expect(summary.profilesChecked).toBe(1);
    expect(summary.postsAssigned).toBe(0);
    expect(summary.results).toEqual([]);
  });

  it('dry run reports counts without writing or triggering a Google sync', async () => {
    mocks.prisma.profile.findMany.mockResolvedValue([profileRow('p1', 'A')]);
    mocks.prisma.post.findMany.mockResolvedValue([
      { id: 's1', status: 'SCHEDULED', scheduledAt: new Date('2026-08-20') },
      { id: 'd1', status: 'DRAFT', scheduledAt: null },
    ]);
    mocks.prisma.profileImage.count.mockResolvedValue(5);

    const summary = await backfillPostImages({ dryRun: true, log: silentLog });

    // pickImagesForPosts auto-syncs from GBP on an empty library — a dry run
    // must stay read-only, so it may never be called.
    expect(mocks.pickImagesForPosts).not.toHaveBeenCalled();
    expect(mocks.prisma.post.updateMany).not.toHaveBeenCalled();
    expect(mocks.markImagesUsed).not.toHaveBeenCalled();
    expect(mocks.prisma.profileImage.count).toHaveBeenCalledWith({
      where: { profileId: 'p1', status: 'APPROVED' },
    });
    expect(summary.dryRun).toBe(true);
    expect(summary.postsAssigned).toBe(2);
    expect(summary.results[0]).toEqual(
      expect.objectContaining({ candidates: 2, assigned: 2, libraryEmpty: false })
    );
  });

  it('dry run flags an empty library instead of counting assignments', async () => {
    mocks.prisma.profile.findMany.mockResolvedValue([profileRow('p1', 'A')]);
    mocks.prisma.post.findMany.mockResolvedValue([
      { id: 's1', status: 'SCHEDULED', scheduledAt: new Date('2026-08-20') },
    ]);
    mocks.prisma.profileImage.count.mockResolvedValue(0);

    const summary = await backfillPostImages({ dryRun: true, log: silentLog });

    expect(summary.postsAssigned).toBe(0);
    expect(summary.profilesWithoutImages).toEqual(['A']);
    expect(summary.results[0]).toEqual(
      expect.objectContaining({
        assigned: 0,
        libraryEmpty: true,
        emptyReason: 'NO_IMAGES',
      })
    );
  });

  it('counts a post as skipped when the guarded update matches nothing', async () => {
    mocks.prisma.profile.findMany.mockResolvedValue([profileRow('p1', 'A')]);
    mocks.prisma.post.findMany.mockResolvedValue([
      { id: 's1', status: 'SCHEDULED', scheduledAt: new Date('2026-08-20') },
      { id: 's2', status: 'SCHEDULED', scheduledAt: new Date('2026-08-27') },
    ]);
    mocks.pickImagesForPosts.mockResolvedValue(['img1', 'img2']);
    mocks.prisma.post.updateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 }); // became due / published / got an image

    const summary = await backfillPostImages({ log: silentLog });

    expect(summary.postsAssigned).toBe(1);
    expect(summary.postsSkipped).toBe(1);
    // Only the image that actually landed advances the rotation.
    expect(mocks.markImagesUsed).toHaveBeenCalledWith(['img1']);
  });

  it('skips a post whose picked image vanished mid-run and keeps going', async () => {
    mocks.prisma.profile.findMany.mockResolvedValue([profileRow('p1', 'A')]);
    mocks.prisma.post.findMany.mockResolvedValue([
      { id: 's1', status: 'SCHEDULED', scheduledAt: new Date('2026-08-20') },
      { id: 's2', status: 'SCHEDULED', scheduledAt: new Date('2026-08-27') },
    ]);
    mocks.pickImagesForPosts.mockResolvedValue(['img1', 'img2']);
    // The FK violation exactly as Prisma's pg driver adapter raises it in
    // production — the constraint name is nested, not at meta.constraint.
    mocks.prisma.post.updateMany
      .mockRejectedValueOnce({
        code: 'P2003',
        meta: {
          modelName: 'Post',
          driverAdapterError: {
            cause: {
              kind: 'ForeignKeyConstraintViolation',
              constraint: { index: 'Post_imageId_fkey' },
            },
          },
        },
      })
      .mockResolvedValueOnce({ count: 1 });

    const summary = await backfillPostImages({ log: silentLog });

    expect(summary.postsAssigned).toBe(1);
    expect(summary.postsSkipped).toBe(1);
    expect(summary.profilesErrored).toEqual([]);
    expect(mocks.markImagesUsed).toHaveBeenCalledWith(['img2']);
  });

  it('stops a profile on an unexpected write error but keeps what already landed', async () => {
    mocks.prisma.profile.findMany.mockResolvedValue([profileRow('p1', 'A')]);
    mocks.prisma.post.findMany.mockResolvedValue([
      { id: 's1', status: 'SCHEDULED', scheduledAt: new Date('2026-08-20') },
      { id: 's2', status: 'SCHEDULED', scheduledAt: new Date('2026-08-27') },
      { id: 's3', status: 'SCHEDULED', scheduledAt: new Date('2026-09-03') },
    ]);
    mocks.pickImagesForPosts.mockResolvedValue(['img1', 'img2', 'img3']);
    mocks.prisma.post.updateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockRejectedValueOnce(new Error('connection reset'));

    const summary = await backfillPostImages({ log: silentLog });

    // The third write is never attempted, but the first one's bookkeeping
    // (usage marking + summary counts) must survive the failure.
    expect(mocks.prisma.post.updateMany).toHaveBeenCalledTimes(2);
    expect(mocks.markImagesUsed).toHaveBeenCalledWith(['img1']);
    expect(summary.postsAssigned).toBe(1);
    expect(summary.profilesErrored).toEqual(['A']);
    expect(summary.results[0]).toEqual(
      expect.objectContaining({ assigned: 1 })
    );
  });

  it('classifies an unapproved-only library instead of claiming Google had no photos', async () => {
    mocks.prisma.profile.findMany.mockResolvedValue([profileRow('p1', 'A')]);
    mocks.prisma.post.findMany.mockResolvedValue([
      { id: 's1', status: 'SCHEDULED', scheduledAt: new Date('2026-08-20') },
    ]);
    mocks.pickImagesForPosts.mockResolvedValue([null]);
    // 0 approved images, but 3 images total (pending client uploads).
    mocks.prisma.profileImage.count.mockImplementation(
      async (args: { where: { status?: string } }) =>
        args.where.status === 'APPROVED' ? 0 : 3
    );

    const summary = await backfillPostImages({ log: silentLog });

    expect(mocks.prisma.post.updateMany).not.toHaveBeenCalled();
    expect(mocks.markImagesUsed).not.toHaveBeenCalled();
    expect(summary.postsAssigned).toBe(0);
    expect(summary.profilesWithoutImages).toEqual(['A']);
    expect(summary.results[0]).toEqual(
      expect.objectContaining({
        libraryEmpty: true,
        emptyReason: 'NONE_APPROVED',
        assigned: 0,
      })
    );
  });

  it('treats an empty pick despite approved images as transient, not as an empty library', async () => {
    mocks.prisma.profile.findMany.mockResolvedValue([profileRow('p1', 'A')]);
    mocks.prisma.post.findMany.mockResolvedValue([
      { id: 's1', status: 'SCHEDULED', scheduledAt: new Date('2026-08-20') },
      { id: 's2', status: 'SCHEDULED', scheduledAt: new Date('2026-08-27') },
    ]);
    // pickImagesForPosts swallows internal errors and returns all-nulls; with
    // approved images present that means a transient failure, not "no photos".
    mocks.pickImagesForPosts.mockResolvedValue([null, null]);
    mocks.prisma.profileImage.count.mockResolvedValue(5);

    const summary = await backfillPostImages({ log: silentLog });

    expect(mocks.prisma.post.updateMany).not.toHaveBeenCalled();
    expect(summary.postsAssigned).toBe(0);
    expect(summary.postsSkipped).toBe(2);
    expect(summary.profilesWithoutImages).toEqual([]);
    expect(summary.results[0]).toEqual(
      expect.objectContaining({ libraryEmpty: false, skipped: 2 })
    );
  });

  it('continues with the remaining profiles when one fails', async () => {
    mocks.prisma.profile.findMany.mockResolvedValue([
      profileRow('p1', 'Broken'),
      profileRow('p2', 'Fine'),
    ]);
    mocks.prisma.post.findMany
      .mockRejectedValueOnce(new Error('db exploded'))
      .mockResolvedValueOnce([
        { id: 's1', status: 'SCHEDULED', scheduledAt: new Date('2026-08-20') },
      ]);
    mocks.pickImagesForPosts.mockResolvedValue(['img1']);
    mocks.prisma.post.updateMany.mockResolvedValue({ count: 1 });

    const summary = await backfillPostImages({ log: silentLog });

    expect(summary.profilesErrored).toEqual(['Broken']);
    expect(summary.postsAssigned).toBe(1);
    expect(summary.profilesChecked).toBe(2);
  });
});
