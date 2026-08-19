import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Job } from 'bullmq';

// Publishing with images: the worker resolves the attached library image to
// a public sourceUrl and sends it as post media. On an image rejection
// (HTTP 400 with a photo attached) it detaches the image with a persisted
// note and rethrows, so the normal BullMQ retry publishes text-only — never
// a second GBP write inside the same job.

const mocks = vi.hoisted(() => ({
  prisma: {
    post: {
      findUniqueOrThrow: vi.fn(),
      findUnique: vi.fn(),
      updateMany: vi.fn(),
      update: vi.fn(),
    },
  },
  createGBPPost: vi.fn(),
  listGBPPosts: vi.fn(),
  processor: undefined as
    | ((job: Job<{ postId: string }>) => Promise<void>)
    | undefined,
}));

vi.mock('bullmq', () => ({
  Worker: class {
    constructor(
      _name: string,
      processor: (job: Job<{ postId: string }>) => Promise<void>
    ) {
      mocks.processor = processor;
    }
    on() {
      return this;
    }
  },
}));
vi.mock('../../src/lib/queue/connection', () => ({ redisConnection: {} }));
vi.mock('../../src/lib/prisma', () => ({ prisma: mocks.prisma }));
vi.mock('../../src/lib/google-posts', () => ({
  createGBPPost: mocks.createGBPPost,
  listGBPPosts: mocks.listGBPPosts,
}));

await import('../../workers/publish-worker');

const GBP_IMAGE = {
  publicToken: 'aa'.repeat(16),
  googleUrl: 'https://lh3.googleusercontent.com/p/photo1',
  thumbnailUrl: null,
  status: 'APPROVED',
};

function badRequest(message: string) {
  const err = new Error(message) as Error & {
    response: { status: number };
  };
  err.response = { status: 400 };
  return err;
}

function makePost(overrides: Record<string, unknown> = {}) {
  return {
    id: 'post1',
    profileId: 'p1',
    type: 'WHATS_NEW',
    content: 'Fresh look for fall — call us today!',
    callToAction: null,
    mediaUrl: null,
    errorMessage: null,
    image: null,
    status: 'SCHEDULED',
    profile: {
      googleAccountId: 'ga1',
      accountResourceName: 'accounts/1',
      locationName: 'locations/2',
      isOnboarded: true,
      isConnected: true,
      googleAccount: {},
    },
    ...overrides,
  };
}

function run() {
  return mocks.processor!({ data: { postId: 'post1' } } as Job<{
    postId: string;
  }>);
}

/** The post.update call that marked the post PUBLISHED. */
function publishedUpdate() {
  const call = mocks.prisma.post.update.mock.calls.find(
    ([arg]) =>
      (arg as { data: { status?: string } }).data.status === 'PUBLISHED'
  );
  return (call?.[0] as { data: Record<string, unknown> } | undefined)?.data;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.prisma.post.updateMany.mockResolvedValue({ count: 1 });
  mocks.prisma.post.update.mockResolvedValue({});
  mocks.listGBPPosts.mockResolvedValue([]);
  mocks.createGBPPost.mockResolvedValue({ name: 'accounts/1/locations/2/localPosts/9' });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('publish worker with images', () => {
  it('attaches a GBP-synced image via its Google-hosted URL', async () => {
    mocks.prisma.post.findUniqueOrThrow.mockResolvedValue(
      makePost({ image: GBP_IMAGE })
    );

    await run();

    expect(mocks.createGBPPost).toHaveBeenCalledTimes(1);
    expect(mocks.createGBPPost.mock.calls[0][0].media).toEqual([
      { mediaFormat: 'PHOTO', sourceUrl: GBP_IMAGE.googleUrl },
    ]);
    expect(publishedUpdate()).toMatchObject({
      status: 'PUBLISHED',
      mediaUrl: GBP_IMAGE.googleUrl,
      errorMessage: null,
    });
  });

  it('serves uploaded images through the public route on the app URL', async () => {
    vi.stubEnv('NEXTAUTH_URL', 'https://rankmaps.example.com');
    const token = 'bb'.repeat(16);
    mocks.prisma.post.findUniqueOrThrow.mockResolvedValue(
      makePost({
        image: {
          publicToken: token,
          googleUrl: null,
          thumbnailUrl: null,
          status: 'APPROVED',
        },
      })
    );

    await run();

    expect(mocks.createGBPPost.mock.calls[0][0].media).toEqual([
      {
        mediaFormat: 'PHOTO',
        sourceUrl: `https://rankmaps.example.com/api/public/images/${token}`,
      },
    ]);
  });

  it('publishes without media and records why when the image was hidden after scheduling', async () => {
    mocks.prisma.post.findUniqueOrThrow.mockResolvedValue(
      makePost({ image: { ...GBP_IMAGE, status: 'HIDDEN' } })
    );

    await run();

    expect(mocks.createGBPPost).toHaveBeenCalledTimes(1);
    expect(mocks.createGBPPost.mock.calls[0][0].media).toBeUndefined();
    expect(publishedUpdate()?.errorMessage).toMatch(/no longer approved/);
  });

  it('detaches the image and rethrows on an HTTP 400 so the retry goes text-only', async () => {
    mocks.prisma.post.findUniqueOrThrow.mockResolvedValue(
      makePost({ image: GBP_IMAGE })
    );
    mocks.createGBPPost.mockRejectedValue(
      badRequest('Request contains an invalid argument.')
    );

    await expect(run()).rejects.toThrow('invalid argument');

    // One GBP write only — no in-job second create.
    expect(mocks.createGBPPost).toHaveBeenCalledTimes(1);

    // The image was detached with a persisted note.
    const detach = mocks.prisma.post.update.mock.calls.find(
      ([arg]) => (arg as { data: { imageId?: null } }).data.imageId === null
    );
    expect(detach).toBeTruthy();
    expect(
      (detach![0] as { data: { errorMessage: string } }).data.errorMessage
    ).toMatch(/^Image skipped:/);

    // Claim released so BullMQ can retry.
    const release = mocks.prisma.post.updateMany.mock.calls.at(-1)![0];
    expect(release.data.status).toBe('SCHEDULED');
  });

  it('keeps the image on transient (non-400) failures so the retry can still publish it', async () => {
    mocks.prisma.post.findUniqueOrThrow.mockResolvedValue(
      makePost({ image: GBP_IMAGE })
    );
    const err = new Error('backend error fetching media') as Error & {
      response: { status: number };
    };
    err.response = { status: 503 };
    mocks.createGBPPost.mockRejectedValue(err);

    await expect(run()).rejects.toThrow('backend error');

    expect(mocks.createGBPPost).toHaveBeenCalledTimes(1);
    const detach = mocks.prisma.post.update.mock.calls.find(
      ([arg]) => (arg as { data: { imageId?: null } }).data.imageId === null
    );
    expect(detach).toBeUndefined();
  });

  it('preserves the skip note when the detached retry publishes text-only', async () => {
    mocks.prisma.post.findUniqueOrThrow.mockResolvedValue(
      makePost({ errorMessage: 'Image skipped: Google rejected the photo' })
    );

    await run();

    expect(mocks.createGBPPost.mock.calls[0][0].media).toBeUndefined();
    expect(publishedUpdate()).toMatchObject({
      status: 'PUBLISHED',
      errorMessage: 'Image skipped: Google rejected the photo',
    });
  });

  it('ignores a stored mediaUrl — the image relation is the only publish input', async () => {
    mocks.prisma.post.findUniqueOrThrow.mockResolvedValue(
      makePost({ mediaUrl: 'https://clientsite.com/gallery' })
    );

    await run();

    expect(mocks.createGBPPost.mock.calls[0][0].media).toBeUndefined();
    expect(publishedUpdate()).toMatchObject({
      status: 'PUBLISHED',
      mediaUrl: null,
      errorMessage: null,
    });
  });
});
