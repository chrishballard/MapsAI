import { describe, it, expect, vi, beforeEach } from 'vitest';

// M8: both approve routes wrote APPROVED before enqueueing the publish job and
// swallowed an enqueue failure. The reply then never published, and since
// only DRAFTED/FAILED replies are editable, nobody could fix it either. A
// failed enqueue now puts the reply back to DRAFTED and says so.
//
// M6: bulk approve did a bare update per row, so a reply edited or approved
// by someone else after the list was read was approved anyway. It now uses
// the same conditional write as single approve (status + content).

const mocks = vi.hoisted(() => ({
  prisma: {
    profile: { findUnique: vi.fn() },
    review: { findUnique: vi.fn(), findMany: vi.fn() },
    reviewResponse: { update: vi.fn(), updateMany: vi.fn() },
  },
  scheduleReviewPublish: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({ prisma: mocks.prisma }));
vi.mock('@/lib/auth/require-session', () => ({
  requireSession: vi.fn(async () => null),
  requireProfile: vi.fn(),
}));
vi.mock('@/lib/queue/review-publish-queue', () => ({
  scheduleReviewPublish: mocks.scheduleReviewPublish,
}));

const { POST: approveOne } = await import('@/app/api/reviews/[id]/approve/route');
const { POST: approveAll } = await import('@/app/api/reviews/approve/route');

const params = Promise.resolve({ id: 'rev1' });

function post(url: string, body?: unknown): Request {
  return new Request(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.prisma.reviewResponse.updateMany.mockResolvedValue({ count: 1 });
  mocks.scheduleReviewPublish.mockResolvedValue(undefined);
});

describe('single approve (M8)', () => {
  beforeEach(() => {
    mocks.prisma.review.findUnique.mockResolvedValue({
      id: 'rev1',
      repliedExternally: false,
      removedAt: null,
      reviewerName: 'Dana',
      response: { id: 'resp1', status: 'DRAFTED', content: 'Thanks Dana!' },
      profile: { reviewsEnabled: true, category: 'Plumber', phone: null },
    });
  });

  it('puts the reply back to DRAFTED and answers 503 when the enqueue fails', async () => {
    mocks.scheduleReviewPublish.mockRejectedValue(new Error('Redis down'));

    const res = await approveOne(
      post('http://localhost/api/reviews/rev1/approve', { content: 'Thanks Dana!' }),
      { params }
    );

    expect(res.status).toBe(503);
    expect(mocks.prisma.reviewResponse.updateMany).toHaveBeenLastCalledWith({
      where: { id: 'resp1', status: 'APPROVED' },
      data: { status: 'DRAFTED', autoApproved: false },
    });
  });

  it('keeps the approval when the enqueue works', async () => {
    const res = await approveOne(
      post('http://localhost/api/reviews/rev1/approve', { content: 'Thanks Dana!' }),
      { params }
    );

    expect(res.status).toBe(200);
    expect(mocks.prisma.reviewResponse.updateMany).toHaveBeenCalledTimes(1);
    expect(mocks.scheduleReviewPublish).toHaveBeenCalledWith('resp1');
  });
});

describe('bulk approve (M6, M8)', () => {
  const reviews = [
    { id: 'rev1', response: { id: 'resp1', status: 'DRAFTED', content: 'One' } },
    { id: 'rev2', response: { id: 'resp2', status: 'DRAFTED', content: 'Two' } },
    { id: 'rev3', response: { id: 'resp3', status: 'DRAFTED', content: 'Three' } },
  ];

  beforeEach(() => {
    mocks.prisma.profile.findUnique.mockResolvedValue({ reviewsEnabled: true, category: 'Plumber' });
    mocks.prisma.review.findMany.mockResolvedValue(reviews);
  });

  it('approves each reply only if it is still the draft that was read', async () => {
    await approveAll(post('http://localhost/api/reviews/approve', { profileId: 'p1', confirmCount: 3 }));

    expect(mocks.prisma.reviewResponse.update).not.toHaveBeenCalled();
    expect(mocks.prisma.reviewResponse.updateMany).toHaveBeenCalledWith({
      where: { id: 'resp2', status: 'DRAFTED', content: 'Two' },
      data: { status: 'APPROVED', autoApproved: false },
    });
  });

  it('skips a reply that changed since the list was read, and does not queue it', async () => {
    mocks.prisma.reviewResponse.updateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 })
      .mockResolvedValueOnce({ count: 1 });

    const res = await approveAll(
      post('http://localhost/api/reviews/approve', { profileId: 'p1', confirmCount: 3 })
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.approved).toBe(2);
    expect(body.skipped).toBe(1);
    expect(mocks.scheduleReviewPublish.mock.calls.map((c) => c[0])).toEqual(['resp1', 'resp3']);
  });

  it('puts a reply back to DRAFTED when its enqueue fails, stops, and answers 503', async () => {
    mocks.scheduleReviewPublish
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('Redis down'));

    const res = await approveAll(
      post('http://localhost/api/reviews/approve', { profileId: 'p1', confirmCount: 3 })
    );

    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.approved).toBe(1);
    expect(mocks.prisma.reviewResponse.updateMany).toHaveBeenCalledWith({
      where: { id: 'resp2', status: 'APPROVED' },
      data: { status: 'DRAFTED', autoApproved: false },
    });
    // resp3 was never touched: still a draft.
    expect(
      mocks.prisma.reviewResponse.updateMany.mock.calls.some(
        ([arg]) => arg.where.id === 'resp3'
      )
    ).toBe(false);
  });
});
