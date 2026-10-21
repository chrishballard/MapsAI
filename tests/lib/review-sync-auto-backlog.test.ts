import { describe, it, expect, vi, beforeEach } from 'vitest';

// AUTO mode publishes replies nobody reads, so it only applies to reviews
// that just came in. A profile's first review sync stores its whole backlog
// as "new" reviews, and Google can surface an old review late: both get a
// draft for a person to approve instead, exactly as DRAFT mode does. IGNORE
// still stores the review and drafts nothing.

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

const { syncProfileReviews, AUTO_REPLY_MAX_REVIEW_AGE_DAYS } = await import(
  '@/lib/sync/reviews'
);

const DAY_MS = 24 * 60 * 60 * 1000;

const autoProfile = {
  id: 'p1',
  name: 'Ben Plumbing',
  category: 'Plumber',
  googleAccountId: 'ga1',
  accountResourceName: 'accounts/1',
  locationName: 'locations/123',
  reviewsEnabled: true,
  reviewInstructions: null as string | null,
  reviewReplyMode1: 'AUTO',
  reviewReplyMode2: 'AUTO',
  reviewReplyMode3: 'AUTO',
  reviewReplyMode4: 'AUTO',
  reviewReplyMode5: 'AUTO',
} as const;

function gbpReview(daysOld: number, id = 'r1') {
  return {
    name: `accounts/1/locations/123/reviews/${id}`,
    reviewer: { displayName: 'Dana', isAnonymous: false },
    starRating: 'FIVE',
    comment: 'Great work',
    createTime: new Date(Date.now() - daysOld * DAY_MS).toISOString(),
  };
}

function storedReviewCount(count: number) {
  mocks.prisma.review.count.mockResolvedValue(count);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'log').mockImplementation(() => {});
  mocks.prisma.review.findUnique.mockResolvedValue(null);
  mocks.prisma.review.updateMany.mockResolvedValue({ count: 0 });
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

describe('syncProfileReviews AUTO mode on backlog reviews', () => {
  it('drafts instead of auto-publishing on the first sync, even for a review from yesterday', async () => {
    storedReviewCount(0);
    mocks.fetchReviews.mockResolvedValue({
      reviews: [gbpReview(1)],
      nextPageToken: undefined,
    });

    const synced = await syncProfileReviews({ ...autoProfile });

    expect(synced).toBe(1);
    expect(mocks.prisma.reviewResponse.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ status: 'DRAFTED', autoApproved: false }),
    });
    expect(mocks.scheduleReviewPublish).not.toHaveBeenCalled();
  });

  it('decides first sync from what was stored before the pass, not after the first page', async () => {
    // Two pages on a first sync: the reviews stored from page one must not
    // turn page two into a "later" sync that auto-publishes.
    storedReviewCount(0);
    mocks.fetchReviews
      .mockResolvedValueOnce({ reviews: [gbpReview(1, 'r1')], nextPageToken: 'page2' })
      .mockResolvedValueOnce({ reviews: [gbpReview(2, 'r2')], nextPageToken: undefined });

    await syncProfileReviews({ ...autoProfile });

    expect(mocks.prisma.review.count).toHaveBeenCalledTimes(1);
    expect(mocks.prisma.reviewResponse.create).toHaveBeenCalledTimes(2);
    for (const [arg] of mocks.prisma.reviewResponse.create.mock.calls) {
      expect(arg.data).toMatchObject({ status: 'DRAFTED', autoApproved: false });
    }
    expect(mocks.scheduleReviewPublish).not.toHaveBeenCalled();
  });

  it(`drafts instead of auto-publishing a review older than ${AUTO_REPLY_MAX_REVIEW_AGE_DAYS} days on a later sync`, async () => {
    storedReviewCount(40);
    mocks.fetchReviews.mockResolvedValue({
      reviews: [gbpReview(AUTO_REPLY_MAX_REVIEW_AGE_DAYS + 1)],
      nextPageToken: undefined,
    });

    const synced = await syncProfileReviews({ ...autoProfile });

    expect(synced).toBe(1);
    expect(mocks.prisma.reviewResponse.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ status: 'DRAFTED', autoApproved: false }),
    });
    expect(mocks.scheduleReviewPublish).not.toHaveBeenCalled();
  });

  it('still auto-publishes a recent review once the profile has synced before', async () => {
    storedReviewCount(40);
    mocks.fetchReviews.mockResolvedValue({
      reviews: [gbpReview(AUTO_REPLY_MAX_REVIEW_AGE_DAYS - 1)],
      nextPageToken: undefined,
    });

    await syncProfileReviews({ ...autoProfile });

    expect(mocks.prisma.reviewResponse.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ status: 'APPROVED', autoApproved: true }),
    });
    expect(mocks.scheduleReviewPublish).toHaveBeenCalledWith('resp1');
  });

  it('keeps Ignore as is on the first sync: stored, nothing drafted', async () => {
    storedReviewCount(0);
    mocks.fetchReviews.mockResolvedValue({
      reviews: [gbpReview(400)],
      nextPageToken: undefined,
    });

    const synced = await syncProfileReviews({
      ...autoProfile,
      reviewReplyMode5: 'IGNORE',
    });

    expect(synced).toBe(0);
    expect(mocks.prisma.review.create).toHaveBeenCalledOnce();
    expect(mocks.generateReviewResponse).not.toHaveBeenCalled();
    expect(mocks.prisma.reviewResponse.create).not.toHaveBeenCalled();
  });
});
