import { describe, it, expect, vi, beforeEach } from 'vitest';

// Reviews toggle: a profile with review management off must not be monitored
// at all — no GBP fetch, no stored reviews, no AI drafts. When it's on, the
// profile's "Train RankMaps" instructions must reach the responder.

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
  autoApproveReviews: false,
  reviewsEnabled: true,
  reviewInstructions: null as string | null,
};

const gbpReview = {
  name: 'accounts/1/locations/123/reviews/r1',
  reviewer: { displayName: 'Dana', isAnonymous: false },
  starRating: 'FIVE',
  comment: 'Great work',
  createTime: '2026-08-01T00:00:00Z',
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'log').mockImplementation(() => {});
  mocks.fetchReviews.mockResolvedValue({ reviews: [gbpReview], nextPageToken: undefined });
  mocks.prisma.review.findUnique.mockResolvedValue(null);
  mocks.prisma.review.create.mockResolvedValue({
    id: 'rev1',
    reviewerName: 'Dana',
    comment: 'Great work',
  });
  mocks.prisma.reviewResponse.create.mockResolvedValue({ id: 'resp1' });
  mocks.generateReviewResponse.mockResolvedValue({
    response: 'Thanks Dana!',
    sentiment: 'positive',
    tone: 'warm',
  });
});

describe('syncProfileReviews with review management off', () => {
  it('does not fetch, store, or draft anything', async () => {
    const synced = await syncProfileReviews({
      ...baseProfile,
      reviewsEnabled: false,
    });

    expect(synced).toBe(0);
    expect(mocks.fetchReviews).not.toHaveBeenCalled();
    expect(mocks.prisma.review.create).not.toHaveBeenCalled();
    expect(mocks.generateReviewResponse).not.toHaveBeenCalled();
    expect(mocks.scheduleReviewPublish).not.toHaveBeenCalled();
  });

  it('still syncs normally when reviews are enabled', async () => {
    const synced = await syncProfileReviews(baseProfile);

    expect(synced).toBe(1);
    expect(mocks.fetchReviews).toHaveBeenCalledOnce();
    expect(mocks.prisma.reviewResponse.create).toHaveBeenCalledOnce();
  });
});

describe('syncProfileReviews training instructions', () => {
  it('passes the profile instructions to the responder', async () => {
    await syncProfileReviews({
      ...baseProfile,
      reviewInstructions: 'Respond in the first person as Ben.',
    });

    expect(mocks.generateReviewResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        customInstructions: 'Respond in the first person as Ben.',
      })
    );
  });
});
