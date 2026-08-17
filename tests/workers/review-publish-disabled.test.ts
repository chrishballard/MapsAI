import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Job } from 'bullmq';

// A publish job queued before reviews were turned off must not publish. It
// drops back to DRAFTED so the reply simply waits for approval again when
// review management is turned back on.

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

function approvedResponse(reviewsEnabled: boolean) {
  return {
    id: 'resp1',
    status: 'APPROVED',
    content: 'Thanks Dana!',
    review: {
      id: 'rev1',
      googleReviewId: 'accounts/1/locations/1/reviews/r1',
      profile: {
        name: 'Ben Plumbing',
        googleAccountId: 'ga1',
        reviewsEnabled,
        googleAccount: { id: 'ga1' },
      },
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'log').mockImplementation(() => {});
});

describe('review publish worker with review management off', () => {
  it('reverts the response to DRAFTED instead of publishing', async () => {
    mocks.prisma.reviewResponse.findUniqueOrThrow.mockResolvedValue(
      approvedResponse(false)
    );

    await mocks.processor!(job());

    expect(mocks.fetchSingleReview).not.toHaveBeenCalled();
    expect(mocks.publishReviewReply).not.toHaveBeenCalled();
    expect(mocks.prisma.reviewResponse.update).toHaveBeenCalledWith({
      where: { id: 'resp1' },
      data: { status: 'DRAFTED', errorMessage: null },
    });
  });

  it('publishes normally when review management is on', async () => {
    mocks.prisma.reviewResponse.findUniqueOrThrow.mockResolvedValue(
      approvedResponse(true)
    );
    mocks.fetchSingleReview.mockResolvedValue({ reviewReply: null });

    await mocks.processor!(job());

    expect(mocks.publishReviewReply).toHaveBeenCalledWith(
      'ga1',
      'accounts/1/locations/1/reviews/r1',
      'Thanks Dana!'
    );
    expect(mocks.prisma.reviewResponse.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'PUBLISHED' }) })
    );
  });
});
