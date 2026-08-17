import { describe, it, expect, vi, beforeEach } from 'vitest';

// With review management off for a profile, no review action may run: the
// generate, single-approve, and bulk-approve routes must all refuse before
// touching Claude or the publish queue.

const mocks = vi.hoisted(() => ({
  prisma: {
    profile: { findUnique: vi.fn() },
    review: { findUnique: vi.fn(), findMany: vi.fn() },
    reviewResponse: { update: vi.fn(), upsert: vi.fn() },
  },
  generateReviewResponse: vi.fn(),
  scheduleReviewPublish: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({ prisma: mocks.prisma }));
vi.mock('@/lib/auth/require-session', () => ({
  requireSession: vi.fn(async () => null),
  requireProfile: vi.fn(),
}));
vi.mock('@/lib/review-responder', async () => {
  const actual = await vi.importActual<typeof import('@/lib/review-responder')>(
    '@/lib/review-responder'
  );
  return { ...actual, generateReviewResponse: mocks.generateReviewResponse };
});
vi.mock('@/lib/queue/review-publish-queue', () => ({
  scheduleReviewPublish: mocks.scheduleReviewPublish,
}));

const { POST: generatePOST } = await import(
  '@/app/api/reviews/[id]/generate/route'
);
const { POST: approvePOST } = await import(
  '@/app/api/reviews/[id]/approve/route'
);
const { POST: bulkApprovePOST } = await import('@/app/api/reviews/approve/route');

const params = Promise.resolve({ id: 'rev1' });

function bulkRequest(body: unknown): Request {
  return new Request('http://localhost:3000/api/reviews/approve', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('review routes with review management off', () => {
  it('refuses to generate a response', async () => {
    mocks.prisma.review.findUnique.mockResolvedValue({
      id: 'rev1',
      rating: 5,
      comment: 'Great',
      reviewerName: 'Dana',
      repliedExternally: false,
      profile: {
        name: 'Ben Plumbing',
        category: 'Plumber',
        reviewsEnabled: false,
        reviewInstructions: null,
      },
      response: null,
    });

    const res = await generatePOST(
      new Request('http://localhost:3000/api/reviews/rev1/generate', {
        method: 'POST',
      }),
      { params }
    );

    expect(res.status).toBe(409);
    expect(mocks.generateReviewResponse).not.toHaveBeenCalled();
    expect(mocks.prisma.reviewResponse.upsert).not.toHaveBeenCalled();
  });

  it('refuses to approve a single response', async () => {
    mocks.prisma.review.findUnique.mockResolvedValue({
      id: 'rev1',
      repliedExternally: false,
      response: { id: 'resp1', status: 'DRAFTED' },
      profile: { reviewsEnabled: false },
    });

    const res = await approvePOST(
      new Request('http://localhost:3000/api/reviews/rev1/approve', {
        method: 'POST',
      }),
      { params }
    );

    expect(res.status).toBe(409);
    expect(mocks.prisma.reviewResponse.update).not.toHaveBeenCalled();
    expect(mocks.scheduleReviewPublish).not.toHaveBeenCalled();
  });

  it('refuses to bulk-approve a profile', async () => {
    mocks.prisma.profile.findUnique.mockResolvedValue({ reviewsEnabled: false });

    const res = await bulkApprovePOST(bulkRequest({ profileId: 'p1' }));

    expect(res.status).toBe(409);
    expect(mocks.prisma.review.findMany).not.toHaveBeenCalled();
    expect(mocks.scheduleReviewPublish).not.toHaveBeenCalled();
  });
});

describe('review routes with review management on', () => {
  it('bulk-approve proceeds and queues publishes', async () => {
    mocks.prisma.profile.findUnique.mockResolvedValue({ reviewsEnabled: true });
    mocks.prisma.review.findMany.mockResolvedValue([
      { id: 'rev1', response: { id: 'resp1', status: 'DRAFTED' } },
    ]);
    mocks.prisma.reviewResponse.update.mockResolvedValue({ id: 'resp1' });

    const res = await bulkApprovePOST(bulkRequest({ profileId: 'p1' }));

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ approved: 1 });
    expect(mocks.scheduleReviewPublish).toHaveBeenCalledWith('resp1', {
      delayMs: 0,
    });
  });
});
