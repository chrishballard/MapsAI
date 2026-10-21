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

// The revert says why, so a person who approved it isn't left wondering
// where their approval went.
const REVERTED = {
  where: { id: 'resp1' },
  data: {
    status: 'DRAFTED',
    errorMessage: expect.stringMatching(/^Held before publishing: .*(offboarded|disconnected)/),
    autoApproved: false,
  },
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

describe('review publish worker and AUTO replies to old reviews', () => {
  // The sync never AUTO-approves a reply to a review older than 30 days, but
  // a job queued before that rule (in retry backoff, or re-queued when a
  // removed review reappears) still reaches the worker.
  function autoApproved(daysOld: number) {
    const response = approvedResponse({ isConnected: true, isOnboarded: true, reviewsOnly: false });
    return {
      ...response,
      autoApproved: true,
      review: {
        ...response.review,
        reviewDate: new Date(Date.now() - daysOld * 86_400_000),
        profile: { ...response.review.profile, reviewReplyMode5: 'AUTO' },
      },
    };
  }

  it('reverts an AUTO-approved reply to a review older than 30 days', async () => {
    mocks.prisma.reviewResponse.findUniqueOrThrow.mockResolvedValue(autoApproved(31));

    await mocks.processor!(job());

    expect(mocks.publishReviewReply).not.toHaveBeenCalled();
    expect(mocks.prisma.reviewResponse.update).toHaveBeenCalledWith({
      where: { id: 'resp1' },
      data: {
        status: 'DRAFTED',
        errorMessage: expect.stringMatching(/older than 30 days/),
        autoApproved: false,
      },
    });
  });

  it('publishes an AUTO-approved reply to a recent review', async () => {
    mocks.prisma.reviewResponse.findUniqueOrThrow.mockResolvedValue(autoApproved(2));

    await mocks.processor!(job());

    expect(mocks.publishReviewReply).toHaveBeenCalled();
  });

  it('publishes a reply a person approved, however old the review', async () => {
    const response = autoApproved(400);
    mocks.prisma.reviewResponse.findUniqueOrThrow.mockResolvedValue({
      ...response,
      autoApproved: false,
    });

    await mocks.processor!(job());

    expect(mocks.publishReviewReply).toHaveBeenCalled();
  });
});
