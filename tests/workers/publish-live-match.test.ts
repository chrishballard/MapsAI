import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Job } from 'bullmq';

// Before writing, the publish worker looks for our post already live on
// Google (an earlier attempt may have created it and died before recording
// it). Google can hand the summary back with different line endings or
// trailing whitespace, so the match must not depend on those.

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

const LIVE_NAME = 'accounts/1/locations/2/localPosts/live1';

function makePost(content: string) {
  return {
    id: 'post1',
    profileId: 'p1',
    type: 'WHATS_NEW',
    content,
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
  };
}

function run() {
  return mocks.processor!({ data: { postId: 'post1' } } as Job<{
    postId: string;
  }>);
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.prisma.post.updateMany.mockResolvedValue({ count: 1 });
  mocks.prisma.post.update.mockResolvedValue({});
  mocks.createGBPPost.mockResolvedValue({ name: 'accounts/1/locations/2/localPosts/new' });
});

describe('publish worker live-post match', () => {
  it('treats a live post that differs only in line endings and trailing whitespace as ours', async () => {
    mocks.prisma.post.findUniqueOrThrow.mockResolvedValue(
      makePost('Fresh look for fall.\r\n\r\nCall us today!  \r\n')
    );
    mocks.listGBPPosts.mockResolvedValue([
      { name: 'accounts/1/locations/2/localPosts/other', summary: 'Something else entirely.' },
      { name: LIVE_NAME, summary: 'Fresh look for fall.\n\nCall us today!' },
    ]);

    await run();

    // No second copy on Google: the live one is recorded instead.
    expect(mocks.createGBPPost).not.toHaveBeenCalled();
    expect(mocks.prisma.post.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'post1' },
        data: expect.objectContaining({ status: 'PUBLISHED', googlePostId: LIVE_NAME }),
      })
    );
  });

  it('still publishes when the live post has different words', async () => {
    mocks.prisma.post.findUniqueOrThrow.mockResolvedValue(
      makePost('Fresh look for fall. Call us today!')
    );
    mocks.listGBPPosts.mockResolvedValue([
      { name: LIVE_NAME, summary: 'Fresh look for fall. Call us tomorrow!' },
    ]);

    await run();

    expect(mocks.createGBPPost).toHaveBeenCalledTimes(1);
  });
});
