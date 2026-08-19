import { describe, it, expect, vi, beforeEach } from 'vitest';

// Star-based reply handling: each new review follows the profile's mode for
// its star rating — IGNORE stores the review and stops, DRAFT waits for
// human approval, AUTO approves and queues publishing. The legacy
// autoApproveReviews flag has no effect anymore.

const mocks = vi.hoisted(() => ({
  prisma: {
    review: { findUnique: vi.fn(), create: vi.fn() },
    reviewResponse: { create: vi.fn() },
  },
  fetchReviews: vi.fn(),
  generateReviewResponse: vi.fn(),
  scheduleReviewPublish: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({ prisma: mocks.prisma }));
vi.mock('@/lib/google-reviews', () => ({
  fetchReviews: mocks.fetchReviews,
  STAR_RATING_MAP: { ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5 },
}));
vi.mock('@/lib/review-responder', () => ({
  generateReviewResponse: mocks.generateReviewResponse,
}));
vi.mock('@/lib/queue/review-publish-queue', () => ({
  scheduleReviewPublish: mocks.scheduleReviewPublish,
}));

const { syncProfileReviews } = await import('@/lib/sync/reviews');

const baseProfile = {
  id: 'p1',
  name: 'Ben Plumbing',
  category: 'Plumber',
  googleAccountId: 'ga1',
  accountResourceName: 'accounts/1',
  locationName: 'locations/123',
  reviewsEnabled: true,
  reviewInstructions: null as string | null,
  reviewReplyMode1: 'DRAFT',
  reviewReplyMode2: 'DRAFT',
  reviewReplyMode3: 'DRAFT',
  reviewReplyMode4: 'DRAFT',
  reviewReplyMode5: 'DRAFT',
} as const;

function gbpReview(starRating: string) {
  return {
    name: `accounts/1/locations/123/reviews/r-${starRating}`,
    reviewer: { displayName: 'Dana', isAnonymous: false },
    starRating,
    comment: 'Some feedback',
    createTime: '2026-08-01T00:00:00Z',
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'log').mockImplementation(() => {});
  mocks.prisma.review.findUnique.mockResolvedValue(null);
  mocks.prisma.review.create.mockResolvedValue({
    id: 'rev1',
    reviewerName: 'Dana',
    comment: 'Some feedback',
  });
  mocks.prisma.reviewResponse.create.mockResolvedValue({ id: 'resp1' });
  mocks.generateReviewResponse.mockResolvedValue({
    response: 'Thanks Dana!',
    sentiment: 'positive',
    tone: 'warm',
  });
});

describe('syncProfileReviews star reply modes', () => {
  it('stores the review but drafts nothing when the rating is set to Ignore', async () => {
    mocks.fetchReviews.mockResolvedValue({
      reviews: [gbpReview('FIVE')],
      nextPageToken: undefined,
    });

    const synced = await syncProfileReviews({
      ...baseProfile,
      reviewReplyMode5: 'IGNORE',
    });

    expect(mocks.prisma.review.create).toHaveBeenCalledOnce();
    expect(mocks.generateReviewResponse).not.toHaveBeenCalled();
    expect(mocks.prisma.reviewResponse.create).not.toHaveBeenCalled();
    expect(mocks.scheduleReviewPublish).not.toHaveBeenCalled();
    expect(synced).toBe(0);
  });

  it('drafts without publishing when the rating is set to Draft', async () => {
    mocks.fetchReviews.mockResolvedValue({
      reviews: [gbpReview('FIVE')],
      nextPageToken: undefined,
    });

    const synced = await syncProfileReviews({ ...baseProfile });

    expect(mocks.prisma.reviewResponse.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'DRAFTED',
          autoApproved: false,
        }),
      })
    );
    expect(mocks.scheduleReviewPublish).not.toHaveBeenCalled();
    expect(synced).toBe(1);
  });

  it('auto-approves and queues publishing when the rating is set to Auto', async () => {
    mocks.fetchReviews.mockResolvedValue({
      reviews: [gbpReview('FOUR')],
      nextPageToken: undefined,
    });

    await syncProfileReviews({
      ...baseProfile,
      reviewReplyMode4: 'AUTO',
    });

    expect(mocks.prisma.reviewResponse.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'APPROVED',
          autoApproved: true,
        }),
      })
    );
    expect(mocks.scheduleReviewPublish).toHaveBeenCalledWith('resp1');
  });

  it('honors an explicit Auto choice even for 1-star reviews', async () => {
    mocks.fetchReviews.mockResolvedValue({
      reviews: [gbpReview('ONE')],
      nextPageToken: undefined,
    });

    await syncProfileReviews({
      ...baseProfile,
      reviewReplyMode1: 'AUTO',
    });

    expect(mocks.prisma.reviewResponse.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'APPROVED',
          autoApproved: true,
        }),
      })
    );
    expect(mocks.scheduleReviewPublish).toHaveBeenCalledWith('resp1');
  });

  it('ignores the legacy autoApproveReviews flag entirely', async () => {
    mocks.fetchReviews.mockResolvedValue({
      reviews: [gbpReview('FIVE')],
      nextPageToken: undefined,
    });

    // Old behavior would auto-approve this 5-star review. The star mode
    // (DRAFT) is now the only authority.
    await syncProfileReviews({
      ...baseProfile,
      autoApproveReviews: true,
    } as typeof baseProfile);

    expect(mocks.prisma.reviewResponse.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'DRAFTED' }),
      })
    );
    expect(mocks.scheduleReviewPublish).not.toHaveBeenCalled();
  });
});
