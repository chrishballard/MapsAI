import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Job } from 'bullmq';

// The publish worker is the last gate before Google. For a healthcare
// profile it never publishes an auto-approved reply, and never publishes a
// reply that fails the privacy check, even one a person approved (e.g.
// before the approve route checked, or re-queued by the sync). Both go back
// to DRAFTED without a single Google call.

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

const SAFE =
  "Dana, we're sorry to read this. Please call the office at (555) 010-4477.";

function approved(options: {
  content: string;
  autoApproved: boolean;
  category: string;
}) {
  return {
    id: 'resp1',
    status: 'APPROVED',
    content: options.content,
    autoApproved: options.autoApproved,
    review: {
      id: 'rev1',
      rating: 1,
      reviewerName: 'Dana',
      removedAt: null,
      googleReviewId: 'accounts/1/locations/1/reviews/r1',
      googleReviewKey: 'locations/1/reviews/r1',
      profile: {
        name: 'Lee Family Dental',
        category: options.category,
        phone: '(555) 010-4477',
        googleAccountId: 'ga1',
        accountResourceName: 'accounts/1',
        reviewsEnabled: true,
        reviewReplyMode1: 'AUTO',
        reviewReplyMode2: 'AUTO',
        reviewReplyMode3: 'AUTO',
        reviewReplyMode4: 'AUTO',
        reviewReplyMode5: 'AUTO',
        googleAccount: { id: 'ga1' },
      },
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('review publish worker healthcare gate', () => {
  it('reverts an auto-approved healthcare reply to DRAFTED', async () => {
    mocks.prisma.reviewResponse.findUniqueOrThrow.mockResolvedValue(
      approved({ content: SAFE, autoApproved: true, category: 'Dentist' })
    );

    await mocks.processor!(job());

    expect(mocks.fetchSingleReview).not.toHaveBeenCalled();
    expect(mocks.publishReviewReply).not.toHaveBeenCalled();
    expect(mocks.prisma.reviewResponse.update).toHaveBeenCalledWith({
      where: { id: 'resp1' },
      data: { status: 'DRAFTED', errorMessage: null, autoApproved: false },
    });
  });

  it('holds a person-approved healthcare reply that fails the privacy check', async () => {
    mocks.prisma.reviewResponse.findUniqueOrThrow.mockResolvedValue(
      approved({
        content: 'Dana, I take full responsibility. See you at your next visit.',
        autoApproved: false,
        category: 'Medical spa',
      })
    );

    await mocks.processor!(job());

    expect(mocks.fetchSingleReview).not.toHaveBeenCalled();
    expect(mocks.publishReviewReply).not.toHaveBeenCalled();
    expect(mocks.prisma.reviewResponse.update).toHaveBeenCalledWith({
      where: { id: 'resp1' },
      data: {
        status: 'DRAFTED',
        errorMessage: expect.stringMatching(/^Held before publishing: .*Admits fault/),
        autoApproved: false,
      },
    });
  });

  it('publishes a person-approved healthcare reply that passes', async () => {
    mocks.prisma.reviewResponse.findUniqueOrThrow.mockResolvedValue(
      approved({ content: SAFE, autoApproved: false, category: 'Dentist' })
    );
    mocks.fetchSingleReview.mockResolvedValue({ reviewReply: null });

    await mocks.processor!(job());

    expect(mocks.publishReviewReply).toHaveBeenCalledWith(
      'ga1',
      'accounts/1/locations/1/reviews/r1',
      SAFE
    );
  });

  it('leaves other businesses alone', async () => {
    mocks.prisma.reviewResponse.findUniqueOrThrow.mockResolvedValue(
      approved({
        content: 'Thanks Dana! See you at your next visit.',
        autoApproved: true,
        category: 'Plumber',
      })
    );
    mocks.fetchSingleReview.mockResolvedValue({ reviewReply: null });

    await mocks.processor!(job());

    expect(mocks.publishReviewReply).toHaveBeenCalledOnce();
  });
});
