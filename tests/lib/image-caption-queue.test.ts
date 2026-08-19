import { describe, it, expect, vi, beforeEach } from 'vitest';

// Caption enqueueing: jobs are idempotent per image (jobId caption-<id>),
// but a retained completed/failed job record would silently dedupe a
// re-enqueue for the whole retention window — stale records must be cleared
// first (same trap schedulePostPublish guards against). The per-profile
// helper backs ingestion hooks, so it must never throw.

const mocks = vi.hoisted(() => ({
  queueAdd: vi.fn(),
  queueGetJob: vi.fn(),
  prisma: { profileImage: { findMany: vi.fn() } },
}));

vi.mock('bullmq', () => ({
  Queue: class {
    add = mocks.queueAdd;
    getJob = mocks.queueGetJob;
    constructor(
      public name: string,
      public opts: unknown
    ) {}
  },
}));
vi.mock('@/lib/queue/connection', () => ({
  redisConnection: {},
  defaultJobRetention: {},
}));
vi.mock('@/lib/prisma', () => ({ prisma: mocks.prisma }));

const { enqueueImageCaption, enqueueCaptionsForProfile } = await import(
  '@/lib/queue/image-caption-queue'
);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.queueGetJob.mockResolvedValue(null);
  mocks.queueAdd.mockResolvedValue({});
});

describe('enqueueImageCaption', () => {
  it('enqueues with an idempotent per-image jobId', async () => {
    await enqueueImageCaption('img1');

    expect(mocks.queueAdd).toHaveBeenCalledWith(
      'caption-img1',
      { imageId: 'img1' },
      { jobId: 'caption-img1' }
    );
  });

  it('removes a stale completed job record so re-captioning is possible', async () => {
    const remove = vi.fn().mockResolvedValue(undefined);
    mocks.queueGetJob.mockResolvedValue({
      getState: async () => 'completed',
      remove,
    });

    await enqueueImageCaption('img1');

    expect(remove).toHaveBeenCalled();
    expect(mocks.queueAdd).toHaveBeenCalled();
  });

  it('removes a stale failed job record (a transient failure must not block for the retention window)', async () => {
    const remove = vi.fn().mockResolvedValue(undefined);
    mocks.queueGetJob.mockResolvedValue({
      getState: async () => 'failed',
      remove,
    });

    await enqueueImageCaption('img1');

    expect(remove).toHaveBeenCalled();
  });

  it('leaves pending jobs alone so they still dedupe', async () => {
    const remove = vi.fn();
    mocks.queueGetJob.mockResolvedValue({
      getState: async () => 'delayed',
      remove,
    });

    await enqueueImageCaption('img1');

    expect(remove).not.toHaveBeenCalled();
    expect(mocks.queueAdd).toHaveBeenCalled();
  });

  it('survives losing the remove race with retention cleanup', async () => {
    mocks.queueGetJob.mockResolvedValue({
      getState: async () => 'completed',
      remove: vi.fn().mockRejectedValue(new Error('gone')),
    });

    await expect(enqueueImageCaption('img1')).resolves.toBeUndefined();
    expect(mocks.queueAdd).toHaveBeenCalled();
  });
});

describe('enqueueCaptionsForProfile', () => {
  it('enqueues every APPROVED uncaptioned image for the profile', async () => {
    mocks.prisma.profileImage.findMany.mockResolvedValue([
      { id: 'a' },
      { id: 'b' },
    ]);

    const enqueued = await enqueueCaptionsForProfile('p1');

    expect(enqueued).toBe(2);
    expect(mocks.prisma.profileImage.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          profileId: 'p1',
          status: 'APPROVED',
          captionedAt: null,
          // Permanently skipped images must never be re-enqueued.
          captionSkipReason: null,
        },
      })
    );
    expect(mocks.queueAdd).toHaveBeenCalledTimes(2);
  });

  it('never throws when the image query fails (hooks must not break their caller)', async () => {
    mocks.prisma.profileImage.findMany.mockRejectedValue(new Error('db down'));

    await expect(enqueueCaptionsForProfile('p1')).resolves.toBe(0);
  });

  it('never throws when redis is down, and keeps going past a failing enqueue', async () => {
    mocks.prisma.profileImage.findMany.mockResolvedValue([
      { id: 'a' },
      { id: 'b' },
    ]);
    mocks.queueAdd
      .mockRejectedValueOnce(new Error('redis down'))
      .mockResolvedValueOnce({});

    const enqueued = await enqueueCaptionsForProfile('p1');

    expect(enqueued).toBe(1);
    expect(mocks.queueAdd).toHaveBeenCalledTimes(2);
  });
});
