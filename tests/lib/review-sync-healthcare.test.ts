import { describe, it, expect, vi, beforeEach } from 'vitest';

// A healthcare profile never auto-publishes a review reply: a rating set to
// AUTO is drafted for approval, like DRAFT. The office phone reaches the
// reply generator. Other profiles keep AUTO.

const mocks = vi.hoisted(() => ({
  prisma: {
    review: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
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

const autoProfile = {
  id: 'p1',
  name: 'Lee Family Dental',
  category: 'Dentist',
  phone: '(555) 010-4477',
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

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'log').mockImplementation(() => {});
  mocks.prisma.review.findUnique.mockResolvedValue(null);
  mocks.prisma.review.updateMany.mockResolvedValue({ count: 0 });
  mocks.prisma.review.create.mockResolvedValue({
    id: 'rev1',
    reviewerName: 'Dana',
    comment: 'Lovely team',
  });
  mocks.prisma.reviewResponse.create.mockResolvedValue({ id: 'resp1' });
  mocks.generateReviewResponse.mockResolvedValue({
    response: 'Thank you for the kind words, Dana.',
    sentiment: 'positive',
    tone: 'warm',
  });
  mocks.fetchReviews.mockResolvedValue({
    reviews: [
      {
        name: 'accounts/1/locations/123/reviews/r1',
        reviewer: { displayName: 'Dana', isAnonymous: false },
        starRating: 'FIVE',
        comment: 'Lovely team',
        createTime: '2026-09-01T00:00:00Z',
      },
    ],
    nextPageToken: undefined,
  });
});

describe('syncProfileReviews on a healthcare profile', () => {
  it('drafts instead of auto-publishing when the rating is set to AUTO', async () => {
    const synced = await syncProfileReviews({ ...autoProfile });

    expect(synced).toBe(1);
    expect(mocks.prisma.reviewResponse.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ status: 'DRAFTED', autoApproved: false }),
    });
    expect(mocks.scheduleReviewPublish).not.toHaveBeenCalled();
  });

  it('passes the office phone to the reply generator', async () => {
    await syncProfileReviews({ ...autoProfile });

    expect(mocks.generateReviewResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        businessCategory: 'Dentist',
        businessPhone: '(555) 010-4477',
      })
    );
  });

  it('still auto-publishes for a business that is not healthcare', async () => {
    await syncProfileReviews({ ...autoProfile, category: 'Plumber' });

    expect(mocks.prisma.reviewResponse.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ status: 'APPROVED', autoApproved: true }),
    });
    expect(mocks.scheduleReviewPublish).toHaveBeenCalledWith('resp1');
  });
});
