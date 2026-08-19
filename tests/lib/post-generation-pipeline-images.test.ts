import { describe, it, expect, vi, beforeEach } from 'vitest';

// Pipeline wiring for image-aware posts: generation hands the generated
// post texts to the content-aware picker (not a bare count), keeps the
// FK-violation text-only retry, and marks only landed images as used.

const mocks = vi.hoisted(() => ({
  prisma: {
    profileKeyword: { findMany: vi.fn() },
    profileCity: { findMany: vi.fn() },
    post: { aggregate: vi.fn(), create: vi.fn() },
    $transaction: vi.fn(async (ops: unknown[]) => ops),
  },
  generateMonthlyPosts: vi.fn(),
  calculateRollingScheduleDates: vi.fn(),
  schedulePostPublish: vi.fn(),
  pickImagesForPostContents: vi.fn(),
  markImagesUsed: vi.fn(),
  isImageFkViolation: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({ prisma: mocks.prisma }));
vi.mock('@/lib/post-generator', () => ({
  generateMonthlyPosts: mocks.generateMonthlyPosts,
}));
vi.mock('@/lib/scheduling', () => ({
  calculateRollingScheduleDates: mocks.calculateRollingScheduleDates,
}));
vi.mock('@/lib/queue/publish-queue', () => ({
  schedulePostPublish: mocks.schedulePostPublish,
}));
vi.mock('@/lib/post-image-matcher', () => ({
  pickImagesForPostContents: mocks.pickImagesForPostContents,
}));
vi.mock('@/lib/post-images', () => ({
  markImagesUsed: mocks.markImagesUsed,
  isImageFkViolation: mocks.isImageFkViolation,
}));

const { generateAndSchedulePosts } = await import(
  '@/lib/post-generation-pipeline'
);

const PROFILE = {
  id: 'p1',
  name: 'Acme Remodeling',
  category: 'Remodeler',
  address: '1 Main St',
  postFrequency: 2,
  promptTemplate: null,
};

const FUTURE = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.prisma.profileKeyword.findMany.mockResolvedValue([]);
  mocks.prisma.profileCity.findMany.mockResolvedValue([]);
  mocks.prisma.post.aggregate.mockResolvedValue({
    _max: { scheduledAt: null, publishedAt: null },
  });
  mocks.generateMonthlyPosts.mockResolvedValue({
    posts: [
      { content: 'Kitchen post', suggestedType: 'WHATS_NEW' },
      { content: 'Hiring post', suggestedType: 'EVENT' },
    ],
  });
  mocks.calculateRollingScheduleDates.mockReturnValue([FUTURE, null]);
  mocks.pickImagesForPostContents.mockResolvedValue(['img1', null]);
  mocks.prisma.post.create.mockImplementation(
    (args: { data: Record<string, unknown> }) => ({
      id: `post-${Math.random().toString(36).slice(2, 8)}`,
      imageId: args.data.imageId,
      status: args.data.status,
      scheduledAt: args.data.scheduledAt,
    })
  );
  mocks.markImagesUsed.mockResolvedValue(undefined);
  mocks.schedulePostPublish.mockResolvedValue(undefined);
  mocks.isImageFkViolation.mockReturnValue(false);
});

describe('generateAndSchedulePosts image wiring', () => {
  it('hands the generated post texts to the content-aware picker', async () => {
    await generateAndSchedulePosts(PROFILE);

    expect(mocks.pickImagesForPostContents).toHaveBeenCalledWith('p1', [
      { content: 'Kitchen post', type: 'WHATS_NEW' },
      { content: 'Hiring post', type: 'EVENT' },
    ]);
  });

  it('attaches picked images index-aligned and marks only landed ones used', async () => {
    const result = await generateAndSchedulePosts(PROFILE);

    expect(result).toEqual({ created: 2, scheduled: 1 });
    const created = mocks.prisma.post.create.mock.calls.map(
      (call) => (call[0] as { data: { imageId: string | null } }).data.imageId
    );
    expect(created).toEqual(['img1', null]);
    expect(mocks.markImagesUsed).toHaveBeenCalledWith(['img1']);
  });

  it('retries the batch text-only when a picked image vanished (FK violation)', async () => {
    const fkErr = new Error('fk');
    mocks.isImageFkViolation.mockReturnValue(true);
    mocks.prisma.$transaction
      .mockRejectedValueOnce(fkErr)
      .mockImplementationOnce(async (ops: unknown[]) => ops);

    const result = await generateAndSchedulePosts(PROFILE);

    expect(result.created).toBe(2);
    // Second batch of creates is text-only.
    const imageIds = mocks.prisma.post.create.mock.calls
      .slice(2)
      .map(
        (call) => (call[0] as { data: { imageId: string | null } }).data.imageId
      );
    expect(imageIds).toEqual([null, null]);
    expect(mocks.markImagesUsed).toHaveBeenCalledWith([]);
  });

  it('rethrows non-FK transaction failures', async () => {
    mocks.prisma.$transaction.mockRejectedValueOnce(new Error('db down'));

    await expect(generateAndSchedulePosts(PROFILE)).rejects.toThrow('db down');
  });
});
