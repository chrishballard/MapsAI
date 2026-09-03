import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Job } from 'bullmq';

// A review Google has removed (spam filter, reviewer deleted it) must never
// be replied to. The removedAt flag from the sync is a hint, not the
// authority: Google's own answer for that one review decides. And the
// resource name used for Google calls is rebuilt from the profile's
// *current* account plus the review's normalized key, so a review stored
// under a stale or wildcard account segment still resolves.

const mocks = vi.hoisted(() => ({
  prisma: {
    reviewResponse: { findUniqueOrThrow: vi.fn(), update: vi.fn() },
    review: { update: vi.fn() },
  },
  fetchSingleReview: vi.fn(),
  publishReviewReply: vi.fn(),
  processor: undefined as
    | ((job: Job<{ reviewResponseId: string }>) => Promise<void>)
    | undefined,
}));

vi.mock('bullmq', () => ({
  Worker: class {
    constructor(
      _name: string,
      processor: (job: Job<{ reviewResponseId: string }>) => Promise<void>
    ) {
      mocks.processor = processor;
    }
    on() {
      return this;
    }
  },
}));
vi.mock('../../src/lib/queue/connection', () => ({ redisConnection: {} }));
vi.mock('../../src/lib/prisma', () => ({ prisma: mocks.prisma }));
vi.mock('../../src/lib/google-reviews', () => ({
  fetchSingleReview: mocks.fetchSingleReview,
  publishReviewReply: mocks.publishReviewReply,
}));

await import('../../workers/review-publish-worker');
const { REVIEW_REMOVED_SKIP_MESSAGE } = await import('../../src/lib/review-removal');

function job(): Job<{ reviewResponseId: string }> {
  return { data: { reviewResponseId: 'resp1' } } as Job<{
    reviewResponseId: string;
  }>;
}

function approvedResponse(review: { removedAt: Date | null }) {
  return {
    id: 'resp1',
    status: 'APPROVED',
    content: 'Thanks Dana!',
    autoApproved: false,
    review: {
      id: 'rev1',
      rating: 5,
      googleReviewId: 'accounts/-/locations/1/reviews/r1',
      googleReviewKey: 'locations/1/reviews/r1',
      removedAt: review.removedAt,
      profile: {
        name: 'Rice Dentistry',
        googleAccountId: 'ga1',
        accountResourceName: 'accounts/103088058873659208402',
        reviewsEnabled: true,
        reviewReplyMode1: 'DRAFT',
        reviewReplyMode2: 'DRAFT',
        reviewReplyMode3: 'DRAFT',
        reviewReplyMode4: 'DRAFT',
        reviewReplyMode5: 'DRAFT',
        googleAccount: { id: 'ga1' },
      },
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  mocks.prisma.reviewResponse.update.mockResolvedValue({});
  mocks.prisma.review.update.mockResolvedValue({});
  mocks.fetchSingleReview.mockResolvedValue({ reviewReply: undefined });
  mocks.publishReviewReply.mockResolvedValue(undefined);
});

describe('review publish worker and removed reviews', () => {
  it('skips a response whose review is flagged removed and Google confirms is gone', async () => {
    mocks.prisma.reviewResponse.findUniqueOrThrow.mockResolvedValue(
      approvedResponse({ removedAt: new Date('2026-08-20T00:00:00Z') })
    );
    mocks.fetchSingleReview.mockRejectedValue({ response: { status: 404 } });

    await mocks.processor!(job());

    expect(mocks.publishReviewReply).not.toHaveBeenCalled();
    expect(mocks.prisma.reviewResponse.update).toHaveBeenCalledWith({
      where: { id: 'resp1' },
      data: { status: 'SKIPPED', errorMessage: REVIEW_REMOVED_SKIP_MESSAGE },
    });
  });

  it('un-removes and publishes when a review flagged removed still exists on Google', async () => {
    mocks.prisma.reviewResponse.findUniqueOrThrow.mockResolvedValue(
      approvedResponse({ removedAt: new Date('2026-08-20T00:00:00Z') })
    );
    mocks.fetchSingleReview.mockResolvedValue({ reviewReply: undefined });

    await mocks.processor!(job());

    expect(mocks.prisma.review.update).toHaveBeenCalledWith({
      where: { id: 'rev1' },
      data: { removedAt: null },
    });
    expect(mocks.publishReviewReply).toHaveBeenCalledOnce();
    expect(mocks.prisma.reviewResponse.update).toHaveBeenCalledWith({
      where: { id: 'resp1' },
      data: expect.objectContaining({ status: 'PUBLISHED' }),
    });
  });

  it('retries (throws) when Google cannot be reached for a review flagged removed', async () => {
    mocks.prisma.reviewResponse.findUniqueOrThrow.mockResolvedValue(
      approvedResponse({ removedAt: new Date('2026-08-20T00:00:00Z') })
    );
    mocks.fetchSingleReview.mockRejectedValue({ response: { status: 503 } });

    await expect(mocks.processor!(job())).rejects.toBeTruthy();

    expect(mocks.publishReviewReply).not.toHaveBeenCalled();
    expect(mocks.prisma.reviewResponse.update).not.toHaveBeenCalled();
  });

  it("addresses Google with the profile's current account and the normalized key", async () => {
    mocks.prisma.reviewResponse.findUniqueOrThrow.mockResolvedValue(
      approvedResponse({ removedAt: null })
    );

    await mocks.processor!(job());

    const expected = 'accounts/103088058873659208402/locations/1/reviews/r1';
    expect(mocks.fetchSingleReview).toHaveBeenCalledWith('ga1', expected);
    expect(mocks.publishReviewReply).toHaveBeenCalledWith('ga1', expected, 'Thanks Dana!');
    expect(mocks.prisma.reviewResponse.update).toHaveBeenCalledWith({
      where: { id: 'resp1' },
      data: expect.objectContaining({ status: 'PUBLISHED' }),
    });
  });
});
