import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Job } from 'bullmq';

// A response that was approved automatically (star mode AUTO) may only
// publish while that star rating is still set to AUTO. If the operator
// switches the rating to Draft or Ignore after the job was queued, the
// response drops back to DRAFTED. Responses a person approved are not
// affected — human approval is authoritative regardless of mode.

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

function approvedResponse(options: {
  autoApproved: boolean;
  rating: number;
  mode5: string;
}) {
  return {
    id: 'resp1',
    status: 'APPROVED',
    content: 'Thanks Dana!',
    autoApproved: options.autoApproved,
    review: {
      id: 'rev1',
      rating: options.rating,
      googleReviewId: 'accounts/1/locations/1/reviews/r1',
      profile: {
        name: 'Ben Plumbing',
        googleAccountId: 'ga1',
        reviewsEnabled: true,
        reviewReplyMode1: 'DRAFT',
        reviewReplyMode2: 'DRAFT',
        reviewReplyMode3: 'DRAFT',
        reviewReplyMode4: 'DRAFT',
        reviewReplyMode5: options.mode5,
        googleAccount: { id: 'ga1' },
      },
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'log').mockImplementation(() => {});
});

describe('review publish worker star-mode guard', () => {
  it('reverts an auto-approved response when its rating is no longer AUTO', async () => {
    mocks.prisma.reviewResponse.findUniqueOrThrow.mockResolvedValue(
      approvedResponse({ autoApproved: true, rating: 5, mode5: 'DRAFT' })
    );

    await mocks.processor!(job());

    expect(mocks.fetchSingleReview).not.toHaveBeenCalled();
    expect(mocks.publishReviewReply).not.toHaveBeenCalled();
    expect(mocks.prisma.reviewResponse.update).toHaveBeenCalledWith({
      where: { id: 'resp1' },
      data: { status: 'DRAFTED', errorMessage: null },
    });
  });

  it('reverts an auto-approved response when its rating was switched to Ignore', async () => {
    mocks.prisma.reviewResponse.findUniqueOrThrow.mockResolvedValue(
      approvedResponse({ autoApproved: true, rating: 5, mode5: 'IGNORE' })
    );

    await mocks.processor!(job());

    expect(mocks.publishReviewReply).not.toHaveBeenCalled();
    expect(mocks.prisma.reviewResponse.update).toHaveBeenCalledWith({
      where: { id: 'resp1' },
      data: { status: 'DRAFTED', errorMessage: null },
    });
  });

  it('publishes an auto-approved response while its rating is still AUTO', async () => {
    mocks.prisma.reviewResponse.findUniqueOrThrow.mockResolvedValue(
      approvedResponse({ autoApproved: true, rating: 5, mode5: 'AUTO' })
    );
    mocks.fetchSingleReview.mockResolvedValue({ reviewReply: null });

    await mocks.processor!(job());

    expect(mocks.publishReviewReply).toHaveBeenCalledWith(
      'ga1',
      'accounts/1/locations/1/reviews/r1',
      'Thanks Dana!'
    );
  });

  it('publishes a human-approved response regardless of the star mode', async () => {
    mocks.prisma.reviewResponse.findUniqueOrThrow.mockResolvedValue(
      approvedResponse({ autoApproved: false, rating: 5, mode5: 'IGNORE' })
    );
    mocks.fetchSingleReview.mockResolvedValue({ reviewReply: null });

    await mocks.processor!(job());

    expect(mocks.publishReviewReply).toHaveBeenCalledWith(
      'ga1',
      'accounts/1/locations/1/reviews/r1',
      'Thanks Dana!'
    );
  });
});
