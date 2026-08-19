import { describe, it, expect, vi, beforeEach } from 'vitest';

// Star-mode plumbing through the review action routes:
// - bulk approve only picks up drafts whose star rating isn't set to Ignore
//   (they're hidden from the pending queue, so "approve all" mustn't publish
//   them behind the operator's back)
// - approving (single or bulk) marks the response as human-approved, and
//   regenerating resets the flag, so the publish worker can tell operator
//   decisions apart from AUTO-mode ones

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
vi.mock('@/lib/review-responder', () => ({
  generateReviewResponse: mocks.generateReviewResponse,
}));
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

const IGNORED_RATINGS_NOT_FILTER = {
  NOT: {
    OR: [
      { rating: 1, profile: { reviewReplyMode1: 'IGNORE' } },
      { rating: 2, profile: { reviewReplyMode2: 'IGNORE' } },
      { rating: 3, profile: { reviewReplyMode3: 'IGNORE' } },
      { rating: 4, profile: { reviewReplyMode4: 'IGNORE' } },
      { rating: 5, profile: { reviewReplyMode5: 'IGNORE' } },
    ],
  },
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('bulk approve with star modes', () => {
  it('skips drafts whose star rating is set to Ignore', async () => {
    mocks.prisma.profile.findUnique.mockResolvedValue({ reviewsEnabled: true });
    mocks.prisma.review.findMany.mockResolvedValue([
      { id: 'rev1', response: { id: 'resp1', status: 'DRAFTED' } },
    ]);
    mocks.prisma.reviewResponse.update.mockResolvedValue({ id: 'resp1' });

    const res = await bulkApprovePOST(bulkRequest({ profileId: 'p1' }));

    expect(res.status).toBe(200);
    expect(mocks.prisma.review.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          profileId: 'p1',
          repliedExternally: false,
          response: { status: 'DRAFTED' },
          ...IGNORED_RATINGS_NOT_FILTER,
        }),
      })
    );
  });

  it('marks bulk-approved responses as human-approved', async () => {
    mocks.prisma.profile.findUnique.mockResolvedValue({ reviewsEnabled: true });
    mocks.prisma.review.findMany.mockResolvedValue([
      { id: 'rev1', response: { id: 'resp1', status: 'DRAFTED' } },
    ]);
    mocks.prisma.reviewResponse.update.mockResolvedValue({ id: 'resp1' });

    await bulkApprovePOST(bulkRequest({ profileId: 'p1' }));

    expect(mocks.prisma.reviewResponse.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { status: 'APPROVED', autoApproved: false },
      })
    );
  });
});

describe('single approve with star modes', () => {
  it('marks the response as human-approved', async () => {
    mocks.prisma.review.findUnique.mockResolvedValue({
      id: 'rev1',
      repliedExternally: false,
      response: { id: 'resp1', status: 'DRAFTED' },
      profile: { reviewsEnabled: true },
    });
    mocks.prisma.reviewResponse.update.mockResolvedValue({ id: 'resp1' });

    const res = await approvePOST(
      new Request('http://localhost:3000/api/reviews/rev1/approve', {
        method: 'POST',
      }),
      { params }
    );

    expect(res.status).toBe(200);
    expect(mocks.prisma.reviewResponse.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { status: 'APPROVED', autoApproved: false },
      })
    );
  });
});

describe('regenerate with star modes', () => {
  it('resets autoApproved when a draft is (re)generated', async () => {
    mocks.prisma.review.findUnique.mockResolvedValue({
      id: 'rev1',
      rating: 5,
      comment: 'Great',
      reviewerName: 'Dana',
      repliedExternally: false,
      profile: {
        name: 'Ben Plumbing',
        category: 'Plumber',
        reviewsEnabled: true,
        reviewInstructions: null,
      },
      response: { status: 'DRAFTED' },
    });
    mocks.generateReviewResponse.mockResolvedValue({ response: 'Thanks!' });
    mocks.prisma.reviewResponse.upsert.mockResolvedValue({ id: 'resp1' });

    await generatePOST(
      new Request('http://localhost:3000/api/reviews/rev1/generate', {
        method: 'POST',
      }),
      { params }
    );

    expect(mocks.prisma.reviewResponse.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ autoApproved: false }),
        update: expect.objectContaining({ autoApproved: false }),
      })
    );
  });
});
