import { describe, it, expect, vi, beforeEach } from 'vitest';

// Review identity and Google-truth counts in the sync:
//  - a review is matched on its normalized key (locations/.../reviews/...),
//    so the same review coming back under a different account segment is
//    never stored twice;
//  - Google's own totalReviewCount / averageRating for the location are
//    persisted on the profile every sync;
//  - after a complete pass, stored reviews Google no longer returns are
//    stamped removedAt, and a review that reappears is un-removed.

const mocks = vi.hoisted(() => ({
  prisma: {
    review: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    reviewResponse: { create: vi.fn(), update: vi.fn() },
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
const { REVIEW_REMOVED_SKIP_MESSAGE } = await import('@/lib/review-removal');

const profile = {
  id: 'p1',
  name: 'Rice Dentistry',
  category: 'Dentist',
  googleAccountId: 'ga1',
  accountResourceName: 'accounts/103088058873659208402',
  locationName: 'locations/123',
  reviewsEnabled: true,
  reviewInstructions: null as string | null,
  reviewReplyMode1: 'IGNORE',
  reviewReplyMode2: 'IGNORE',
  reviewReplyMode3: 'IGNORE',
  reviewReplyMode4: 'IGNORE',
  reviewReplyMode5: 'IGNORE',
} as const;

function gbpReview(name: string) {
  return {
    name,
    reviewer: { displayName: 'Dana', isAnonymous: false },
    starRating: 'FIVE',
    comment: 'Great',
    createTime: '2026-08-01T00:00:00Z',
    updateTime: '2026-08-01T00:00:00Z',
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  mocks.prisma.review.findUnique.mockResolvedValue(null);
  mocks.prisma.review.create.mockResolvedValue({ id: 'rev1' });
  mocks.prisma.review.update.mockResolvedValue({});
  mocks.prisma.review.updateMany.mockResolvedValue({ count: 0 });
  mocks.prisma.profile.update.mockResolvedValue({});
  mocks.prisma.reviewResponse.update.mockResolvedValue({});
});

describe('review identity', () => {
  it('matches an existing review by profile + normalized key, whatever account form the API used', async () => {
    mocks.fetchReviews.mockResolvedValue({
      reviews: [gbpReview('accounts/-/locations/123/reviews/AbC')],
      totalReviewCount: 1,
      averageRating: 5,
    });
    mocks.prisma.review.findUnique.mockResolvedValue({ id: 'existing', removedAt: null });

    await syncProfileReviews(profile);

    expect(mocks.prisma.review.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          profileId_googleReviewKey: {
            profileId: 'p1',
            googleReviewKey: 'locations/123/reviews/AbC',
          },
        },
      })
    );
    expect(mocks.prisma.review.create).not.toHaveBeenCalled();
  });

  it('stores the normalized key alongside the raw resource name on create', async () => {
    mocks.fetchReviews.mockResolvedValue({
      reviews: [gbpReview('accounts/103088058873659208402/locations/123/reviews/AbC')],
      totalReviewCount: 1,
      averageRating: 5,
    });

    await syncProfileReviews(profile);

    expect(mocks.prisma.review.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          googleReviewId: 'accounts/103088058873659208402/locations/123/reviews/AbC',
          googleReviewKey: 'locations/123/reviews/AbC',
        }),
      })
    );
  });

  it('un-removes a review that Google returns again', async () => {
    mocks.fetchReviews.mockResolvedValue({
      reviews: [gbpReview('accounts/-/locations/123/reviews/AbC')],
      totalReviewCount: 1,
      averageRating: 5,
    });
    mocks.prisma.review.findUnique.mockResolvedValue({
      id: 'existing',
      removedAt: new Date('2026-08-20T00:00:00Z'),
    });

    await syncProfileReviews(profile);

    expect(mocks.prisma.review.update).toHaveBeenCalledWith({
      where: { id: 'existing' },
      data: { removedAt: null },
    });
    expect(mocks.prisma.review.create).not.toHaveBeenCalled();
  });
});

describe("Google's review totals", () => {
  it('persists totalReviewCount and averageRating on the profile', async () => {
    mocks.fetchReviews.mockResolvedValue({
      reviews: [gbpReview('accounts/-/locations/123/reviews/AbC')],
      totalReviewCount: 581,
      averageRating: 4.96,
    });

    await syncProfileReviews(profile);

    expect(mocks.prisma.profile.update).toHaveBeenCalledWith({
      where: { id: 'p1' },
      data: {
        googleReviewCount: 581,
        googleAverageRating: 4.96,
        reviewStatsSyncedAt: expect.any(Date),
      },
    });
  });

  it('records a zero count when a complete pass returns no reviews and Google omits the totals', async () => {
    // proto3 JSON drops zero-valued fields, so a location with no reviews
    // comes back as an empty object. That is a real zero, not a hiccup.
    mocks.fetchReviews.mockResolvedValue({ reviews: [] });

    await syncProfileReviews(profile);

    expect(mocks.prisma.profile.update).toHaveBeenCalledWith({
      where: { id: 'p1' },
      data: {
        googleReviewCount: 0,
        googleAverageRating: null,
        reviewStatsSyncedAt: expect.any(Date),
      },
    });
  });

  it('leaves the stored totals alone when the API omits them', async () => {
    mocks.fetchReviews.mockResolvedValue({
      reviews: [gbpReview('accounts/-/locations/123/reviews/AbC')],
    });

    await syncProfileReviews(profile);

    expect(mocks.prisma.profile.update).not.toHaveBeenCalled();
  });
});

describe('removed reviews', () => {
  it('stamps reviews Google no longer returns after a complete multi-page pass', async () => {
    mocks.fetchReviews
      .mockResolvedValueOnce({
        reviews: [gbpReview('accounts/-/locations/123/reviews/A')],
        nextPageToken: 'page2',
        totalReviewCount: 2,
        averageRating: 5,
      })
      .mockResolvedValueOnce({
        reviews: [gbpReview('accounts/-/locations/123/reviews/B')],
        totalReviewCount: 2,
        averageRating: 5,
      });

    await syncProfileReviews(profile);

    expect(mocks.prisma.review.updateMany).toHaveBeenCalledTimes(1);
    expect(mocks.prisma.review.updateMany).toHaveBeenCalledWith({
      where: {
        profileId: 'p1',
        removedAt: null,
        googleReviewKey: {
          notIn: ['locations/123/reviews/A', 'locations/123/reviews/B'],
        },
      },
      data: { removedAt: expect.any(Date) },
    });
  });

  it('skips the removal pass when a later page fails to load', async () => {
    mocks.fetchReviews
      .mockResolvedValueOnce({
        reviews: [gbpReview('accounts/-/locations/123/reviews/A')],
        nextPageToken: 'page2',
        totalReviewCount: 2,
      })
      .mockRejectedValueOnce(new Error('503'));

    await expect(syncProfileReviews(profile)).rejects.toThrow('503');

    expect(mocks.prisma.review.updateMany).not.toHaveBeenCalled();
  });

  it('skips the removal pass when fewer distinct reviews came back than Google says exist', async () => {
    // The list is ordered by updateTime desc and paginated. A review whose
    // updateTime changes mid-pass (a reply lands, an edit) jumps ahead of
    // the cursor and is never returned, so a short pass proves nothing.
    mocks.fetchReviews.mockResolvedValue({
      reviews: [
        gbpReview('accounts/-/locations/123/reviews/A'),
        gbpReview('accounts/-/locations/123/reviews/B'),
      ],
      totalReviewCount: 3,
      averageRating: 5,
    });

    await syncProfileReviews(profile);

    expect(mocks.prisma.review.updateMany).not.toHaveBeenCalled();
  });

  it('skips the removal pass when pagination stopped on a repeated page token', async () => {
    mocks.fetchReviews
      .mockResolvedValueOnce({
        reviews: [gbpReview('accounts/-/locations/123/reviews/A')],
        nextPageToken: 'p2',
        totalReviewCount: 2,
      })
      .mockResolvedValueOnce({
        reviews: [gbpReview('accounts/-/locations/123/reviews/B')],
        nextPageToken: 'p2',
        totalReviewCount: 2,
      });

    await syncProfileReviews(profile);

    expect(mocks.prisma.review.updateMany).not.toHaveBeenCalled();
  });

  it('re-approves and re-queues a reply that was skipped because the review looked removed, once it reappears', async () => {
    mocks.fetchReviews.mockResolvedValue({
      reviews: [gbpReview('accounts/-/locations/123/reviews/AbC')],
      totalReviewCount: 1,
      averageRating: 5,
    });
    mocks.prisma.review.findUnique.mockResolvedValue({
      id: 'existing',
      removedAt: new Date('2026-08-20T00:00:00Z'),
      response: {
        id: 'resp9',
        status: 'SKIPPED',
        errorMessage: REVIEW_REMOVED_SKIP_MESSAGE,
      },
    });

    await syncProfileReviews(profile);

    expect(mocks.prisma.review.update).toHaveBeenCalledWith({
      where: { id: 'existing' },
      data: { removedAt: null },
    });
    expect(mocks.prisma.reviewResponse.update).toHaveBeenCalledWith({
      where: { id: 'resp9' },
      data: { status: 'APPROVED', errorMessage: null },
    });
    expect(mocks.scheduleReviewPublish).toHaveBeenCalledWith('resp9');
  });

  it('leaves a reply skipped for any other reason alone when its review reappears', async () => {
    mocks.fetchReviews.mockResolvedValue({
      reviews: [gbpReview('accounts/-/locations/123/reviews/AbC')],
      totalReviewCount: 1,
      averageRating: 5,
    });
    mocks.prisma.review.findUnique.mockResolvedValue({
      id: 'existing',
      removedAt: new Date('2026-08-20T00:00:00Z'),
      response: {
        id: 'resp9',
        status: 'SKIPPED',
        errorMessage: 'Review already has a reply on Google — skipped to avoid overwriting',
      },
    });

    await syncProfileReviews(profile);

    expect(mocks.prisma.reviewResponse.update).not.toHaveBeenCalled();
    expect(mocks.scheduleReviewPublish).not.toHaveBeenCalled();
  });

  it('skips the removal pass when Google returns no reviews at all', async () => {
    // An empty list is indistinguishable from a transient API hiccup;
    // never wipe a whole profile's reviews on that signal.
    mocks.fetchReviews.mockResolvedValue({ reviews: [], totalReviewCount: 0 });

    await syncProfileReviews(profile);

    expect(mocks.prisma.review.updateMany).not.toHaveBeenCalled();
  });
});
