import { describe, it, expect, vi, beforeEach } from 'vitest';

// H2 follow-up: schedulePostPublish dedupes on a stable jobId. A delayed job
// left over from an earlier schedule (never attempted, set for a different
// time) used to swallow the new enqueue, so a re-approved post went out on
// its old date. Such a job is now replaced. A job waiting out a retry
// backoff (attemptsMade > 0) is left alone so retries keep their pacing.

const mocks = vi.hoisted(() => ({ queueAdd: vi.fn(), queueGetJob: vi.fn() }));

vi.mock('bullmq', () => ({
  Queue: class {
    add = mocks.queueAdd;
    getJob = mocks.queueGetJob;
  },
}));
vi.mock('@/lib/queue/connection', () => ({ redisConnection: {}, defaultJobRetention: {} }));

const { schedulePostPublish } = await import('@/lib/queue/publish-queue');

const NOV_3 = new Date('2026-11-03T17:00:00Z');
const NOV_10 = new Date('2026-11-10T17:00:00Z');

function delayedJob(runAt: Date, attemptsMade = 0) {
  return {
    getState: async () => 'delayed',
    timestamp: runAt.getTime() - 60_000,
    delay: 60_000,
    attemptsMade,
    remove: vi.fn(async () => {}),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.queueAdd.mockResolvedValue({});
});

describe('schedulePostPublish with an existing delayed job', () => {
  it('replaces a never-attempted job set for a different time', async () => {
    const job = delayedJob(NOV_3);
    mocks.queueGetJob.mockResolvedValue(job);

    await schedulePostPublish('post1', NOV_10);

    expect(job.remove).toHaveBeenCalled();
    expect(mocks.queueAdd).toHaveBeenCalledWith(
      'publish-post1',
      { postId: 'post1' },
      expect.objectContaining({ jobId: 'publish-post1' })
    );
  });

  it('keeps a job already set for the same time', async () => {
    const job = delayedJob(NOV_10);
    mocks.queueGetJob.mockResolvedValue(job);

    await schedulePostPublish('post1', NOV_10);

    expect(job.remove).not.toHaveBeenCalled();
  });

  it('keeps a job waiting out a retry backoff', async () => {
    const job = delayedJob(NOV_3, 1);
    mocks.queueGetJob.mockResolvedValue(job);

    await schedulePostPublish('post1', NOV_10);

    expect(job.remove).not.toHaveBeenCalled();
  });
});
