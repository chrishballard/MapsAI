import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Job } from 'bullmq';

// H2 follow-up: a post taken off the schedule and re-approved for a later
// date can still have its OLD delayed job in Redis (the removal failed, or
// the job was locked mid-retry and Queue.remove returned 0). That job must
// not publish the post early. The worker only publishes a post whose
// scheduledAt has arrived; for one dated in the future it does nothing, and
// the post sweep enqueues it when it falls due.

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
    constructor(_name: string, processor: (job: Job<{ postId: string }>) => Promise<void>) {
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

function post(scheduledAt: Date | null) {
  return {
    id: 'post1',
    profileId: 'p1',
    type: 'WHATS_NEW',
    content: 'Fall gutter cleaning is booking now.',
    callToAction: null,
    mediaUrl: null,
    errorMessage: null,
    image: null,
    status: 'SCHEDULED',
    scheduledAt,
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

const run = () => mocks.processor!({ data: { postId: 'post1' } } as Job<{ postId: string }>);

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'log').mockImplementation(() => {});
  mocks.prisma.post.updateMany.mockResolvedValue({ count: 1 });
  mocks.listGBPPosts.mockResolvedValue([]);
  mocks.createGBPPost.mockResolvedValue({ name: 'accounts/1/locations/2/localPosts/9' });
});

describe('publish worker and a post re-dated into the future', () => {
  it('does not claim or publish a post whose date has not come yet', async () => {
    mocks.prisma.post.findUniqueOrThrow.mockResolvedValue(
      post(new Date(Date.now() + 6 * 86_400_000))
    );

    await run();

    expect(mocks.prisma.post.updateMany).not.toHaveBeenCalled();
    expect(mocks.createGBPPost).not.toHaveBeenCalled();
  });

  it('publishes a post whose date has arrived', async () => {
    mocks.prisma.post.findUniqueOrThrow.mockResolvedValue(post(new Date(Date.now() - 1_000)));

    await run();

    expect(mocks.createGBPPost).toHaveBeenCalledTimes(1);
  });
});
