import { describe, it, expect, vi, beforeEach } from 'vitest';

// Re-match for blind-assigned posts: the matcher reviews each unpublished,
// not-yet-due post together with its current photo and only rewrites
// pairings that would look nonsensical (KEEP is the default — this protects
// manual picks and avoids churn). Writes are guarded updateMany calls that
// re-check status AND that the image is still exactly the one we read, so
// concurrent publishes and manual edits always win. Dry run never writes
// to the DB but does call the matcher (a preview is meaningless otherwise).

const mocks = vi.hoisted(() => ({
  generate: vi.fn(),
  prisma: {
    profile: { findMany: vi.fn() },
    profileImage: { findMany: vi.fn() },
    post: { findMany: vi.fn(), updateMany: vi.fn() },
  },
  markImagesUsed: vi.fn(),
  isImageFkViolation: vi.fn(),
}));

vi.mock('@/lib/claude', () => ({ generate: mocks.generate }));
vi.mock('@/lib/prisma', () => ({ prisma: mocks.prisma }));
vi.mock('@/lib/post-images', () => ({
  markImagesUsed: mocks.markImagesUsed,
  isImageFkViolation: mocks.isImageFkViolation,
}));

const { rematchPostImages } = await import('@/lib/rematch-post-images');

function specific(id: string, description: string) {
  return {
    id,
    aiDescription: description,
    aiTags: [],
    aiGeneric: false,
    captionedAt: new Date('2026-08-19'),
  };
}

function generic(id: string) {
  return {
    id,
    aiDescription: 'storefront',
    aiTags: ['storefront'],
    aiGeneric: true,
    captionedAt: new Date('2026-08-19'),
  };
}

function post(
  id: string,
  imageId: string | null,
  image: Record<string, unknown> | null,
  content = `content of ${id}`
) {
  return { id, content, type: 'WHATS_NEW', status: 'SCHEDULED', imageId, image };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.prisma.profile.findMany.mockResolvedValue([
    { id: 'p1', name: 'Acme', category: 'Remodeler' },
  ]);
  mocks.prisma.profileImage.findMany.mockResolvedValue([
    specific('s1', 'a remodeled kitchen'),
    generic('g1'),
  ]);
  mocks.prisma.post.findMany.mockResolvedValue([]);
  mocks.prisma.post.updateMany.mockResolvedValue({ count: 1 });
  mocks.markImagesUsed.mockResolvedValue(undefined);
  mocks.isImageFkViolation.mockReturnValue(false);
});

describe('rematch decisions', () => {
  it('rewrites a clashing pairing with a guarded updateMany', async () => {
    mocks.prisma.post.findMany.mockResolvedValue([
      post('post1', 'bathroomImg', {
        aiDescription: 'a bathroom',
        aiTags: ['bathroom'],
        aiGeneric: false,
        captionedAt: new Date(),
      }, 'Kitchen remodel season!'),
    ]);
    mocks.generate.mockResolvedValue({
      decisions: [{ action: 'ASSIGN', imageId: 's1', reason: 'kitchen photo fits' }],
    });

    const summary = await rematchPostImages({ log: () => {} });

    expect(summary.postsChanged).toBe(1);
    const arg = mocks.prisma.post.updateMany.mock.calls[0][0];
    expect(arg.data).toEqual({ imageId: 's1' });
    // Guard: the exact image we read, still unpublished and not due.
    expect(arg.where.id).toBe('post1');
    expect(arg.where.imageId).toBe('bathroomImg');
    expect(arg.where.OR).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ status: 'SCHEDULED' }),
        { status: 'DRAFT' },
        { status: 'APPROVED' },
      ])
    );
    expect(mocks.markImagesUsed).toHaveBeenCalledWith(['s1']);
  });

  it('KEEP leaves the post untouched (protects manual picks)', async () => {
    mocks.prisma.post.findMany.mockResolvedValue([
      post('post1', 'g1', {
        aiDescription: 'storefront',
        aiTags: [],
        aiGeneric: true,
        captionedAt: new Date(),
      }),
    ]);
    mocks.generate.mockResolvedValue({
      decisions: [{ action: 'KEEP', reason: 'photo fits' }],
    });

    const summary = await rematchPostImages({ log: () => {} });

    expect(summary.postsKept).toBe(1);
    expect(summary.postsChanged).toBe(0);
    expect(mocks.prisma.post.updateMany).not.toHaveBeenCalled();
    expect(mocks.markImagesUsed).not.toHaveBeenCalled();
  });

  it('a post with no photo can gain a generic via LRU', async () => {
    mocks.prisma.post.findMany.mockResolvedValue([post('post1', null, null)]);
    mocks.generate.mockResolvedValue({
      decisions: [{ action: 'ASSIGN_GENERIC', reason: 'no fitting specific' }],
    });

    const summary = await rematchPostImages({ log: () => {} });

    expect(summary.postsChanged).toBe(1);
    const arg = mocks.prisma.post.updateMany.mock.calls[0][0];
    expect(arg.where.imageId).toBe(null);
    expect(arg.data).toEqual({ imageId: 'g1' });
  });

  it('DETACH clears a photo that fits nothing', async () => {
    mocks.prisma.post.findMany.mockResolvedValue([
      post('post1', 'bathroomImg', {
        aiDescription: 'a bathroom',
        aiTags: [],
        aiGeneric: false,
        captionedAt: new Date(),
      }),
    ]);
    mocks.generate.mockResolvedValue({
      decisions: [{ action: 'DETACH', reason: 'nothing fits this post' }],
    });

    const summary = await rematchPostImages({ log: () => {} });

    expect(summary.postsChanged).toBe(1);
    const arg = mocks.prisma.post.updateMany.mock.calls[0][0];
    expect(arg.data).toEqual({ imageId: null });
    expect(mocks.markImagesUsed).not.toHaveBeenCalled();
  });

  it('skips posts whose current photo is uncaptioned (cannot judge coherence)', async () => {
    mocks.prisma.post.findMany.mockResolvedValue([
      post('post1', 'u1', {
        aiDescription: null,
        aiTags: [],
        aiGeneric: null,
        captionedAt: null,
      }),
    ]);

    const summary = await rematchPostImages({ log: () => {} });

    expect(summary.postsUnknownImage).toBe(1);
    expect(mocks.generate).not.toHaveBeenCalled();
    expect(mocks.prisma.post.updateMany).not.toHaveBeenCalled();
  });
});

describe('rematch safety', () => {
  it('a lost race (post changed concurrently) is skipped, not forced', async () => {
    mocks.prisma.post.findMany.mockResolvedValue([post('post1', null, null)]);
    mocks.generate.mockResolvedValue({
      decisions: [{ action: 'ASSIGN', imageId: 's1', reason: 'fits' }],
    });
    mocks.prisma.post.updateMany.mockResolvedValue({ count: 0 });

    const summary = await rematchPostImages({ log: () => {} });

    expect(summary.postsChanged).toBe(0);
    expect(summary.postsSkipped).toBe(1);
    expect(mocks.markImagesUsed).not.toHaveBeenCalled();
  });

  it('an invented replacement id demotes to a generic instead of guessing or keeping a judged clash', async () => {
    mocks.prisma.post.findMany.mockResolvedValue([post('post1', null, null)]);
    mocks.generate.mockResolvedValue({
      decisions: [{ action: 'ASSIGN', imageId: 'made-up', reason: 'fits' }],
    });

    const summary = await rematchPostImages({ log: () => {} });

    expect(summary.postsChanged).toBe(1);
    const arg = mocks.prisma.post.updateMany.mock.calls[0][0];
    expect(arg.data).toEqual({ imageId: 'g1' });
  });

  it('an invented replacement id with no generics available skips the post', async () => {
    mocks.prisma.profileImage.findMany.mockResolvedValue([
      specific('s1', 'a remodeled kitchen'),
    ]);
    mocks.prisma.post.findMany.mockResolvedValue([post('post1', null, null)]);
    mocks.generate.mockResolvedValue({
      decisions: [{ action: 'ASSIGN', imageId: 'made-up', reason: 'fits' }],
    });

    const summary = await rematchPostImages({ log: () => {} });

    expect(summary.postsSkipped).toBe(1);
    expect(mocks.prisma.post.updateMany).not.toHaveBeenCalled();
  });

  it('one specific image is assigned at most once per profile run; repeats demote to a generic', async () => {
    mocks.prisma.post.findMany.mockResolvedValue([
      post('post1', null, null),
      post('post2', null, null),
    ]);
    mocks.generate.mockResolvedValue({
      decisions: [
        { action: 'ASSIGN', imageId: 's1', reason: 'fits' },
        { action: 'ASSIGN', imageId: 's1', reason: 'fits' },
      ],
    });

    const summary = await rematchPostImages({ log: () => {} });

    expect(summary.postsChanged).toBe(2);
    const writes = mocks.prisma.post.updateMany.mock.calls.map(
      (call) => (call[0] as { data: { imageId: string | null } }).data.imageId
    );
    expect(writes).toEqual(['s1', 'g1']);
  });

  it('later chunks are not offered specifics already used by earlier chunks', async () => {
    // 13 eligible posts -> two matcher calls (chunk size 12). Chunk 1 uses
    // s1; chunk 2's prompt must no longer offer it, or the model could
    // re-pick a photo that another post already carries.
    mocks.prisma.post.findMany.mockResolvedValue(
      Array.from({ length: 13 }, (_, i) => post(`post${i + 1}`, null, null))
    );
    mocks.generate
      .mockResolvedValueOnce({
        decisions: [
          { action: 'ASSIGN', imageId: 's1', reason: 'fits' },
          ...Array.from({ length: 11 }, () => ({
            action: 'KEEP',
            reason: 'fine',
          })),
        ],
      })
      .mockResolvedValueOnce({
        decisions: [{ action: 'KEEP', reason: 'fine' }],
      });

    await rematchPostImages({ log: () => {} });

    expect(mocks.generate).toHaveBeenCalledTimes(2);
    const secondPrompt = mocks.generate.mock.calls[1][0].prompt as string;
    expect(secondPrompt).not.toContain('- s1:');
  });

  it('keeps the wire schema permissive — a chatty reason must not fail the chunk', async () => {
    mocks.prisma.post.findMany.mockResolvedValue([post('post1', null, null)]);
    mocks.generate.mockResolvedValue({
      decisions: [{ action: 'KEEP', reason: 'fits' }],
    });

    await rematchPostImages({ log: () => {} });

    const schema = mocks.generate.mock.calls[0][0].schema;
    expect(
      schema.safeParse({
        decisions: [
          { action: 'ASSIGN', imageId: 'not-in-enum', reason: 'R'.repeat(300) },
        ],
      }).success
    ).toBe(true);
  });

  it('skips profiles with no captioned images (caption backfill first)', async () => {
    mocks.prisma.profileImage.findMany.mockResolvedValue([
      {
        id: 'u1',
        aiDescription: null,
        aiTags: [],
        aiGeneric: null,
        captionedAt: null,
      },
    ]);
    mocks.prisma.post.findMany.mockResolvedValue([post('post1', null, null)]);

    const summary = await rematchPostImages({ log: () => {} });

    expect(summary.profilesZeroCaptioned).toEqual(['Acme']);
    expect(mocks.generate).not.toHaveBeenCalled();
  });

  it('is idempotent: an all-KEEP second run writes nothing', async () => {
    mocks.prisma.post.findMany.mockResolvedValue([
      post('post1', 's1', {
        aiDescription: 'a remodeled kitchen',
        aiTags: [],
        aiGeneric: false,
        captionedAt: new Date(),
      }),
    ]);
    mocks.generate.mockResolvedValue({
      decisions: [{ action: 'KEEP', reason: 'fits' }],
    });

    const summary = await rematchPostImages({ log: () => {} });

    expect(summary.postsChanged).toBe(0);
    expect(mocks.prisma.post.updateMany).not.toHaveBeenCalled();
  });
});

describe('rematch dry run', () => {
  it('calls the matcher but writes nothing, recording proposals', async () => {
    mocks.prisma.post.findMany.mockResolvedValue([
      post('post1', 'bathroomImg', {
        aiDescription: 'a bathroom',
        aiTags: [],
        aiGeneric: false,
        captionedAt: new Date(),
      }),
    ]);
    mocks.generate.mockResolvedValue({
      decisions: [{ action: 'ASSIGN', imageId: 's1', reason: 'kitchen fits' }],
    });

    const summary = await rematchPostImages({ dryRun: true, log: () => {} });

    expect(summary.dryRun).toBe(true);
    expect(mocks.generate).toHaveBeenCalled();
    expect(mocks.prisma.post.updateMany).not.toHaveBeenCalled();
    expect(mocks.markImagesUsed).not.toHaveBeenCalled();
    expect(summary.postsChanged).toBe(1);
    expect(summary.results[0].proposals).toEqual([
      {
        postId: 'post1',
        from: 'bathroomImg',
        to: 's1',
        reason: 'kitchen fits',
      },
    ]);
  });
});
