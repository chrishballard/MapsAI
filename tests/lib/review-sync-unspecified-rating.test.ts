import { describe, it, expect, vi, beforeEach } from 'vitest';

// A review Google returns with no star rating (STAR_RATING_UNSPECIFIED, or
// the field missing) used to be stored as 3 stars, which skewed the stored
// average and ran the 3-star reply mode on a rating nobody gave. Review.rating
// can't be null, so the review is left out (with a warning) until Google
// reports a real rating; reviews with a rating carry on as before.

const mocks = vi.hoisted(() => ({
  prisma: {
    review: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      count: vi.fn(),
    },
    reviewResponse: { create: vi.fn() },
    profile: { update: vi.fn() },
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

const profile = {
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

function gbpReview(id: string, starRating: string | undefined) {
  return {
    name: `accounts/1/locations/123/reviews/${id}`,
    reviewer: { displayName: 'Dana', isAnonymous: false },
    starRating,
    comment: 'Some feedback',
    createTime: new Date().toISOString(),
  };
}

let warn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'log').mockImplementation(() => {});
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  mocks.prisma.review.findUnique.mockResolvedValue(null);
  mocks.prisma.review.updateMany.mockResolvedValue({ count: 0 });
  mocks.prisma.review.count.mockResolvedValue(10);
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

describe('syncProfileReviews with a review that has no star rating', () => {
  it.each([
    ['STAR_RATING_UNSPECIFIED', 'STAR_RATING_UNSPECIFIED'],
    ['a missing rating', undefined],
  ])('does not store %s as 3 stars or draft a reply for it', async (_label, starRating) => {
    mocks.fetchReviews.mockResolvedValue({
      reviews: [gbpReview('r1', starRating)],
      nextPageToken: undefined,
    });

    const synced = await syncProfileReviews({ ...profile });

    expect(synced).toBe(0);
    expect(mocks.prisma.review.create).not.toHaveBeenCalled();
    expect(mocks.generateReviewResponse).not.toHaveBeenCalled();
    expect(mocks.prisma.reviewResponse.create).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('no star rating')
    );
  });

  it('still stores and drafts the rated reviews in the same pass', async () => {
    mocks.fetchReviews.mockResolvedValue({
      reviews: [
        gbpReview('r1', 'STAR_RATING_UNSPECIFIED'),
        gbpReview('r2', 'FOUR'),
      ],
      nextPageToken: undefined,
    });

    const synced = await syncProfileReviews({ ...profile });

    expect(synced).toBe(1);
    expect(mocks.prisma.review.create).toHaveBeenCalledOnce();
    expect(mocks.prisma.review.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        googleReviewKey: 'locations/123/reviews/r2',
        rating: 4,
      }),
    });
  });
});
