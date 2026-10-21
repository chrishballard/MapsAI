import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Job } from 'bullmq';

// The publish worker serves the same profiles the review sync does: connected
// ones that are onboarded or marked reviewsOnly. A reply approved just before
// the profile was offboarded (or its Google connection dropped) must not
// publish from a job already in the queue. It drops back to DRAFTED, like the
// reviews-off guard, so it simply waits for approval if the profile returns.

const mocks = vi.hoisted(() => ({
  prisma: {
    reviewResponse: { findUniqueOrThrow: vi.fn(), update: vi.fn() },
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

function job(): Job<{ reviewResponseId: string }> {
  return { data: { reviewResponseId: 'resp1' } } as Job<{
    reviewResponseId: string;
  }>;
}

function approvedResponse(profile: {
  isConnected: boolean;
  isOnboarded: boolean;
  reviewsOnly: boolean;
}) {
  return {
    id: 'resp1',
    status: 'APPROVED',
    content: 'Thanks Dana!',
    autoApproved: false,
    review: {
      id: 'rev1',
      rating: 5,
      googleReviewId: 'accounts/1/locations/1/reviews/r1',
      googleReviewKey: 'locations/1/reviews/r1',
      profile: {
        name: 'Ben Plumbing',
        category: 'Plumber',
        googleAccountId: 'ga1',
        accountResourceName: 'accounts/1',
        reviewsEnabled: true,
        ...profile,
        googleAccount: { id: 'ga1' },
      },
    },
  };
}

const REVERTED = {
  where: { id: 'resp1' },
  data: { status: 'DRAFTED', errorMessage: null, autoApproved: false },
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'log').mockImplementation(() => {});
  mocks.fetchSingleReview.mockResolvedValue({ reviewReply: null });
});

describe('review publish worker on a profile the review sync no longer serves', () => {
  it('reverts to DRAFTED instead of publishing once the profile is offboarded', async () => {
    mocks.prisma.reviewResponse.findUniqueOrThrow.mockResolvedValue(
      approvedResponse({ isConnected: true, isOnboarded: false, reviewsOnly: false })
    );

    await mocks.processor!(job());

    expect(mocks.fetchSingleReview).not.toHaveBeenCalled();
    expect(mocks.publishReviewReply).not.toHaveBeenCalled();
    expect(mocks.prisma.reviewResponse.update).toHaveBeenCalledWith(REVERTED);
  });

  it('reverts to DRAFTED instead of publishing once the profile is disconnected', async () => {
    mocks.prisma.reviewResponse.findUniqueOrThrow.mockResolvedValue(
      approvedResponse({ isConnected: false, isOnboarded: true, reviewsOnly: false })
    );

    await mocks.processor!(job());

    expect(mocks.fetchSingleReview).not.toHaveBeenCalled();
    expect(mocks.publishReviewReply).not.toHaveBeenCalled();
    expect(mocks.prisma.reviewResponse.update).toHaveBeenCalledWith(REVERTED);
  });

  it('still publishes for an offboarded profile marked reviewsOnly', async () => {
    mocks.prisma.reviewResponse.findUniqueOrThrow.mockResolvedValue(
      approvedResponse({ isConnected: true, isOnboarded: false, reviewsOnly: true })
    );

    await mocks.processor!(job());

    expect(mocks.publishReviewReply).toHaveBeenCalledWith(
      'ga1',
      'accounts/1/locations/1/reviews/r1',
      'Thanks Dana!'
    );
  });
});
