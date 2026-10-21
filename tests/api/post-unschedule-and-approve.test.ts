import { describe, it, expect, vi, beforeEach } from 'vitest';

// H2: moving a SCHEDULED post back to DRAFT used to leave its delayed publish
// job in Redis. Re-approving it then deduped against that job (same stable
// jobId), so the edited post went out on its OLD date.
//
// M1: bulk approve ran short of schedule dates and still flipped the tail
// drafts to SCHEDULED with no scheduledAt. Their enqueue threw (and was
// swallowed), and the post sweep only looks at scheduledAt <= now, so those
// posts sat SCHEDULED forever and never published.

const mocks = vi.hoisted(() => ({
  prisma: {
    post: { findUnique: vi.fn(), findMany: vi.fn(), update: vi.fn() },
    profileImage: { findUnique: vi.fn() },
  },
  markImagesUsed: vi.fn(async () => {}),
  publishQueue: { remove: vi.fn(async () => 1) },
  schedulePostPublish: vi.fn(async () => {}),
  calculateScheduleDates: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({ prisma: mocks.prisma }));
vi.mock('@/lib/auth/require-session', () => ({
  requireSession: vi.fn(async () => null),
  requireProfile: vi.fn(),
}));
vi.mock('@/lib/post-images', () => ({ markImagesUsed: mocks.markImagesUsed }));
vi.mock('@/lib/queue/publish-queue', () => ({
  publishQueue: mocks.publishQueue,
  schedulePostPublish: mocks.schedulePostPublish,
}));
vi.mock('@/lib/scheduling', () => ({
  calculateScheduleDates: mocks.calculateScheduleDates,
}));

const { PATCH } = await import('@/app/api/posts/[id]/route');
const { POST: approveAll } = await import('@/app/api/posts/approve/route');

function json(url: string, method: string, body: unknown): Request {
  return new Request(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.prisma.post.update.mockImplementation(async ({ where, data }) => ({
    id: where.id,
    ...data,
  }));
});

describe('PATCH /api/posts/[id] back to DRAFT (H2)', () => {
  const scheduledAt = new Date('2026-11-03T17:00:00Z');

  beforeEach(() => {
    mocks.prisma.post.findUnique.mockResolvedValue({
      id: 'post1',
      profileId: 'p1',
      status: 'SCHEDULED',
      scheduledAt,
      imageId: null,
    });
  });

  it('removes the pending publish job and clears scheduledAt', async () => {
    const res = await PATCH(
      json('http://localhost/api/posts/post1', 'PATCH', { status: 'DRAFT', content: 'Edited text' }),
      { params: Promise.resolve({ id: 'post1' }) }
    );

    expect(res.status).toBe(200);
    expect(mocks.prisma.post.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'DRAFT', scheduledAt: null, content: 'Edited text' }),
      })
    );
    expect(mocks.publishQueue.remove).toHaveBeenCalledWith('publish-post1');
  });

  it('only writes if the post is still in the status it was read in', async () => {
    await PATCH(
      json('http://localhost/api/posts/post1', 'PATCH', { status: 'DRAFT' }),
      { params: Promise.resolve({ id: 'post1' }) }
    );
    expect(mocks.prisma.post.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'post1', status: 'SCHEDULED' } })
    );
  });

  it('answers 409 when the worker claimed the post in the meantime', async () => {
    mocks.prisma.post.update.mockRejectedValueOnce(
      Object.assign(new Error('Record to update not found.'), { code: 'P2025' })
    );

    const res = await PATCH(
      json('http://localhost/api/posts/post1', 'PATCH', { status: 'DRAFT' }),
      { params: Promise.resolve({ id: 'post1' }) }
    );

    expect(res.status).toBe(409);
    expect(mocks.publishQueue.remove).not.toHaveBeenCalled();
  });

  it('leaves the job alone for an edit that keeps the post scheduled', async () => {
    const res = await PATCH(
      json('http://localhost/api/posts/post1', 'PATCH', { content: 'Typo fix' }),
      { params: Promise.resolve({ id: 'post1' }) }
    );

    expect(res.status).toBe(200);
    expect(mocks.publishQueue.remove).not.toHaveBeenCalled();
    const { data } = mocks.prisma.post.update.mock.calls[0][0];
    expect(data).not.toHaveProperty('scheduledAt');
  });
});

describe('POST /api/posts/approve with too few dates (M1)', () => {
  const drafts = [
    { id: 'd1', status: 'DRAFT' },
    { id: 'd2', status: 'DRAFT' },
    { id: 'd3', status: 'DRAFT' },
  ];
  const dates = [new Date('2026-11-03T17:00:00Z'), new Date('2026-11-10T17:00:00Z')];

  beforeEach(() => {
    mocks.prisma.post.findMany.mockImplementation(async ({ where }) =>
      where.status === 'DRAFT' ? drafts : []
    );
    // This month and next month together only have two dates left.
    mocks.calculateScheduleDates.mockReturnValueOnce(dates).mockReturnValueOnce([]);
  });

  it('schedules only the drafts that got a date and leaves the rest as drafts', async () => {
    const res = await approveAll(
      json('http://localhost/api/posts/approve', 'POST', { profileId: 'p1' })
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.approved).toBe(2);
    expect(body.leftAsDraft).toBe(1);

    for (const [{ data }] of mocks.prisma.post.update.mock.calls) {
      expect(data.scheduledAt).toBeInstanceOf(Date);
    }
    expect(mocks.prisma.post.update).toHaveBeenCalledTimes(2);
    for (const [, publishAt] of mocks.schedulePostPublish.mock.calls as unknown as [string, Date][]) {
      expect(publishAt).toBeInstanceOf(Date);
    }
    expect(mocks.schedulePostPublish).toHaveBeenCalledTimes(2);
  });
});
