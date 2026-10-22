import { describe, it, expect, vi, beforeEach } from 'vitest';

// One-off rewrite of replies already published to Google, for a client who
// asked that every reply read as the owner speaking in the first person and
// carry his signature.
//
// The dangerous part is that these replies are already public, so the rules
// under test are mostly refusals: never touch a reply whose live text isn't
// the one we stored (someone edited it by hand), never answer the same review
// twice through its duplicate row, and never publish a reply that still talks
// about the owner in the third person.

const mocks = vi.hoisted(() => ({
  prisma: {
    profile: { findUnique: vi.fn() },
    reviewResponse: { findMany: vi.fn(), updateMany: vi.fn() },
  },
  generateReviewResponse: vi.fn(),
  fetchSingleReview: vi.fn(),
  publishReviewReply: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({ prisma: mocks.prisma }));
vi.mock('@/lib/review-responder', () => ({
  generateReviewResponse: mocks.generateReviewResponse,
}));
vi.mock('@/lib/google-reviews', () => ({
  fetchSingleReview: mocks.fetchSingleReview,
  publishReviewReply: mocks.publishReviewReply,
}));

const {
  planReplyRewrite,
  applyReplyRewrite,
  normalizeReviewKey,
  applySignature,
  mentionsOwnerInThirdPerson,
  OWNER_SIGNATURE,
} = await import('@/lib/rewrite-review-replies');

const { ReviewNotFoundError } = await import('@/lib/review-removal');

const silentLog = () => {};

const PROFILE = {
  id: 'p1',
  name: 'Badger Gutters',
  category: 'Gutter cleaning service',
  googleAccountId: 'ga1',
  reviewsEnabled: true,
  reviewInstructions: null,
};

function responseRow(
  overrides: Partial<{
    id: string;
    content: string;
    publishedAt: Date;
    reviewId: string;
    googleReviewId: string;
    rating: number;
    reviewerName: string | null;
    comment: string | null;
    repliedExternally: boolean;
  }> = {}
) {
  const {
    id = 'resp1',
    content = 'Thanks so much! We are glad your experience with Ben was great.',
    publishedAt = new Date('2026-07-01T12:00:00Z'),
    reviewId = 'rev1',
    googleReviewId = 'accounts/117/locations/171/reviews/AbC1',
    rating = 5,
    reviewerName = 'Dana',
    comment = 'Ben did a great job on our gutters.',
    repliedExternally = false,
  } = overrides;
  return {
    id,
    content,
    publishedAt,
    review: {
      id: reviewId,
      googleReviewId,
      rating,
      reviewerName,
      comment,
      repliedExternally,
      profile: PROFILE,
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.prisma.profile.findUnique.mockResolvedValue(PROFILE);
  mocks.prisma.reviewResponse.updateMany.mockResolvedValue({ count: 1 });
  mocks.publishReviewReply.mockResolvedValue(undefined);
});

describe('normalizeReviewKey', () => {
  // Prod stores the same review twice when the account segment of
  // googleReviewId changes form (real ids vs the `accounts/-` wildcard).
  // Rewriting both would answer one review twice.
  it('collapses the mutable account segment so duplicate rows share a key', () => {
    expect(normalizeReviewKey('accounts/117021863248044506375/locations/171/reviews/AbC1')).toBe(
      'locations/171/reviews/AbC1'
    );
    expect(normalizeReviewKey('accounts/-/locations/171/reviews/AbC1')).toBe(
      'locations/171/reviews/AbC1'
    );
  });

  it('leaves an id that has no account prefix alone', () => {
    expect(normalizeReviewKey('locations/171/reviews/AbC1')).toBe('locations/171/reviews/AbC1');
  });
});

describe('applySignature', () => {
  it('appends the signature on its own final line', () => {
    expect(applySignature('Thanks Dana, glad I could help.')).toBe(
      `Thanks Dana, glad I could help.\n\n${OWNER_SIGNATURE}`
    );
  });

  it('does not double up when the model already signed off', () => {
    const signed = `Thanks Dana.\n\n${OWNER_SIGNATURE}`;
    expect(applySignature(signed)).toBe(signed);
  });

  it('normalizes a signature written with a plain hyphen or extra whitespace', () => {
    expect(applySignature('Thanks Dana.\n\n- Ben  ')).toBe(`Thanks Dana.\n\n${OWNER_SIGNATURE}`);
    expect(applySignature('Thanks Dana.\n\nBen')).toBe(`Thanks Dana.\n\n${OWNER_SIGNATURE}`);
  });
});

describe('mentionsOwnerInThirdPerson', () => {
  it('flags a reply that talks about the owner as someone else', () => {
    expect(
      mentionsOwnerInThirdPerson(`We are glad your experience with Ben was great.\n\n${OWNER_SIGNATURE}`)
    ).toBe(true);
  });

  it('accepts a first-person reply whose only "Ben" is the signature', () => {
    expect(
      mentionsOwnerInThirdPerson(`Thanks Dana, I am glad I could help.\n\n${OWNER_SIGNATURE}`)
    ).toBe(false);
  });

  it('does not trip on an unrelated word containing the name', () => {
    expect(mentionsOwnerInThirdPerson(`Thanks for the kind words, Benjamin.\n\n${OWNER_SIGNATURE}`)).toBe(
      false
    );
  });
});

describe('planReplyRewrite', () => {
  it('generates a first-person rewrite for each published reply and writes nothing', async () => {
    mocks.prisma.reviewResponse.findMany.mockResolvedValue([responseRow()]);
    mocks.fetchSingleReview.mockResolvedValue({
      reviewReply: { comment: responseRow().content, updateTime: '2026-07-01T12:00:00Z' },
    });
    mocks.generateReviewResponse.mockResolvedValue({
      response: 'Thanks Dana, I really appreciate that.',
      sentiment: 'positive',
      tone: 'warm',
    });

    const plan = await planReplyRewrite({ profileId: 'p1', log: silentLog });

    expect(plan.candidates).toHaveLength(1);
    expect(plan.candidates[0].before).toBe(responseRow().content);
    expect(plan.candidates[0].after).toBe(
      `Thanks Dana, I really appreciate that.\n\n${OWNER_SIGNATURE}`
    );
    // Planning is strictly read-only: nothing published, nothing written.
    expect(mocks.publishReviewReply).not.toHaveBeenCalled();
    expect(mocks.prisma.reviewResponse.updateMany).not.toHaveBeenCalled();
  });

  it('passes the owner persona to the generator, keeping the profile instructions', async () => {
    mocks.prisma.profile.findUnique.mockResolvedValue({
      ...PROFILE,
      reviewInstructions: 'Mention the 5-year workmanship warranty.',
    });
    mocks.prisma.reviewResponse.findMany.mockResolvedValue([responseRow()]);
    mocks.fetchSingleReview.mockResolvedValue({
      reviewReply: { comment: responseRow().content, updateTime: '2026-07-01T12:00:00Z' },
    });
    mocks.generateReviewResponse.mockResolvedValue({
      response: 'Thanks Dana.',
      sentiment: 'positive',
      tone: 'warm',
    });

    await planReplyRewrite({ profileId: 'p1', log: silentLog });

    const passed = mocks.generateReviewResponse.mock.calls[0][0].customInstructions as string;
    expect(passed).toContain('Mention the 5-year workmanship warranty.');
    expect(passed).toContain('first person');
    expect(passed).toContain(OWNER_SIGNATURE);
  });

  it('skips a review whose live reply is no longer the text we published', async () => {
    mocks.prisma.reviewResponse.findMany.mockResolvedValue([responseRow()]);
    mocks.fetchSingleReview.mockResolvedValue({
      reviewReply: { comment: 'Ben rewrote this one himself.', updateTime: '2026-07-02T12:00:00Z' },
    });

    const plan = await planReplyRewrite({ profileId: 'p1', log: silentLog });

    expect(plan.candidates).toHaveLength(0);
    expect(plan.skipped[0].reason).toBe('FOREIGN_REPLY');
    expect(mocks.generateReviewResponse).not.toHaveBeenCalled();
  });

  it('skips a review that has no reply on Google at all', async () => {
    mocks.prisma.reviewResponse.findMany.mockResolvedValue([responseRow()]);
    mocks.fetchSingleReview.mockResolvedValue({});

    const plan = await planReplyRewrite({ profileId: 'p1', log: silentLog });

    expect(plan.candidates).toHaveLength(0);
    expect(plan.skipped[0].reason).toBe('NO_LIVE_REPLY');
  });

  it('rewrites a duplicated review only once', async () => {
    mocks.prisma.reviewResponse.findMany.mockResolvedValue([
      responseRow({
        id: 'resp1',
        reviewId: 'rev1',
        googleReviewId: 'accounts/117/locations/171/reviews/AbC1',
        publishedAt: new Date('2026-07-01T12:00:00Z'),
      }),
      responseRow({
        id: 'resp2',
        reviewId: 'rev2',
        googleReviewId: 'accounts/-/locations/171/reviews/AbC1',
        publishedAt: new Date('2026-08-04T12:00:00Z'),
      }),
    ]);
    mocks.fetchSingleReview.mockResolvedValue({
      reviewReply: { comment: responseRow().content, updateTime: '2026-07-01T12:00:00Z' },
    });
    mocks.generateReviewResponse.mockResolvedValue({
      response: 'Thanks Dana.',
      sentiment: 'positive',
      tone: 'warm',
    });

    const plan = await planReplyRewrite({ profileId: 'p1', log: silentLog });

    expect(plan.candidates).toHaveLength(1);
    // The row that actually carries the published history wins.
    expect(plan.candidates[0].responseId).toBe('resp1');
    expect(plan.skipped.map((s) => s.reason)).toContain('DUPLICATE_ROW');
  });

  it('regenerates once when the draft still refers to the owner in the third person', async () => {
    mocks.prisma.reviewResponse.findMany.mockResolvedValue([responseRow()]);
    mocks.fetchSingleReview.mockResolvedValue({
      reviewReply: { comment: responseRow().content, updateTime: '2026-07-01T12:00:00Z' },
    });
    mocks.generateReviewResponse
      .mockResolvedValueOnce({
        response: 'Glad your experience with Ben was great.',
        sentiment: 'positive',
        tone: 'warm',
      })
      .mockResolvedValueOnce({
        response: 'Glad I could get that sorted for you.',
        sentiment: 'positive',
        tone: 'warm',
      });

    const plan = await planReplyRewrite({ profileId: 'p1', log: silentLog });

    expect(mocks.generateReviewResponse).toHaveBeenCalledTimes(2);
    expect(plan.candidates[0].after).toBe(
      `Glad I could get that sorted for you.\n\n${OWNER_SIGNATURE}`
    );
  });

  it('gives up rather than publishing a third-person reply when the retry fails too', async () => {
    mocks.prisma.reviewResponse.findMany.mockResolvedValue([responseRow()]);
    mocks.fetchSingleReview.mockResolvedValue({
      reviewReply: { comment: responseRow().content, updateTime: '2026-07-01T12:00:00Z' },
    });
    mocks.generateReviewResponse.mockResolvedValue({
      response: 'Ben was happy to help.',
      sentiment: 'positive',
      tone: 'warm',
    });

    const plan = await planReplyRewrite({ profileId: 'p1', log: silentLog });

    expect(plan.candidates).toHaveLength(0);
    expect(plan.skipped[0].reason).toBe('THIRD_PERSON_OWNER');
  });
});

describe('applyReplyRewrite', () => {
  function plan(candidateOverrides = {}) {
    return {
      profileId: 'p1',
      profileName: 'Badger Gutters',
      googleAccountId: 'ga1',
      candidates: [
        {
          responseId: 'resp1',
          reviewId: 'rev1',
          googleReviewId: 'accounts/117/locations/171/reviews/AbC1',
          rating: 5,
          reviewerName: 'Dana',
          reviewComment: 'Ben did a great job.',
          publishedAt: '2026-07-01T12:00:00.000Z',
          before: responseRow().content,
          after: `Thanks Dana, glad I could help.\n\n${OWNER_SIGNATURE}`,
          ...candidateOverrides,
        },
      ],
      skipped: [],
    };
  }

  it('re-checks the live reply, publishes the rewrite, and stores it', async () => {
    mocks.fetchSingleReview.mockResolvedValue({
      reviewReply: { comment: responseRow().content, updateTime: '2026-07-01T12:00:00Z' },
    });

    const result = await applyReplyRewrite({ plan: plan(), log: silentLog, sleep: async () => {} });

    expect(mocks.publishReviewReply).toHaveBeenCalledWith(
      'ga1',
      'accounts/117/locations/171/reviews/AbC1',
      `Thanks Dana, glad I could help.\n\n${OWNER_SIGNATURE}`
    );
    // The stored content only moves if it's still the text we planned against.
    expect(mocks.prisma.reviewResponse.updateMany).toHaveBeenCalledWith({
      where: { id: 'resp1', status: 'PUBLISHED', content: responseRow().content },
      data: { content: `Thanks Dana, glad I could help.\n\n${OWNER_SIGNATURE}` },
    });
    expect(result.rewritten).toBe(1);
    expect(result.failed).toHaveLength(0);
  });

  it('refuses to publish when the live reply changed between plan and apply', async () => {
    mocks.fetchSingleReview.mockResolvedValue({
      reviewReply: { comment: 'Ben edited this in the meantime.', updateTime: '2026-08-19T12:00:00Z' },
    });

    const result = await applyReplyRewrite({ plan: plan(), log: silentLog, sleep: async () => {} });

    expect(mocks.publishReviewReply).not.toHaveBeenCalled();
    expect(mocks.prisma.reviewResponse.updateMany).not.toHaveBeenCalled();
    expect(result.rewritten).toBe(0);
    expect(result.skipped[0].reason).toBe('FOREIGN_REPLY');
  });

  it('reports drift loudly when Google took the rewrite but the row moved underneath us', async () => {
    mocks.fetchSingleReview.mockResolvedValue({
      reviewReply: { comment: responseRow().content, updateTime: '2026-07-01T12:00:00Z' },
    });
    mocks.prisma.reviewResponse.updateMany.mockResolvedValue({ count: 0 });

    const result = await applyReplyRewrite({ plan: plan(), log: silentLog, sleep: async () => {} });

    expect(result.rewritten).toBe(1);
    expect(result.drifted).toHaveLength(1);
    expect(result.drifted[0].responseId).toBe('resp1');
  });

  it('records a publish failure and keeps going instead of aborting the run', async () => {
    mocks.fetchSingleReview.mockResolvedValue({
      reviewReply: { comment: responseRow().content, updateTime: '2026-07-01T12:00:00Z' },
    });
    mocks.publishReviewReply.mockRejectedValue(new Error('429 rate limit'));

    const result = await applyReplyRewrite({ plan: plan(), log: silentLog, sleep: async () => {} });

    expect(result.rewritten).toBe(0);
    expect(result.failed[0].responseId).toBe('resp1');
    expect(result.failed[0].detail).toContain('429');
    expect(mocks.prisma.reviewResponse.updateMany).not.toHaveBeenCalled();
  });

  it('paces publishes under the GBP per-profile edit limit', async () => {
    mocks.fetchSingleReview.mockResolvedValue({
      reviewReply: { comment: responseRow().content, updateTime: '2026-07-01T12:00:00Z' },
    });
    const waits: number[] = [];
    const twoCandidates = plan();
    twoCandidates.candidates.push({ ...twoCandidates.candidates[0], responseId: 'resp2' });

    await applyReplyRewrite({
      plan: twoCandidates,
      log: silentLog,
      sleep: async (ms: number) => {
        waits.push(ms);
      },
    });

    // One pause between the two publishes, slow enough to stay under 10/min.
    expect(waits).toHaveLength(1);
    expect(waits[0]).toBeGreaterThanOrEqual(6000);
  });
});

describe('removed and missing reviews (U2)', () => {
  // A review Google took down (spam filter, reviewer deleted it) has no reply
  // to rewrite. The plan used to read those too, and one 404 from Google threw
  // out of the whole plan instead of skipping that review.

  it('only plans reviews that are still live as far as the sync knows', async () => {
    mocks.prisma.reviewResponse.findMany.mockResolvedValue([]);

    await planReplyRewrite({ profileId: 'p1', log: silentLog });

    const { where } = mocks.prisma.reviewResponse.findMany.mock.calls[0][0];
    expect(where.review).toEqual({ profileId: 'p1', removedAt: null });
  });

  it('skips a review Google says is gone and keeps planning the rest', async () => {
    mocks.prisma.reviewResponse.findMany.mockResolvedValue([
      responseRow({ id: 'gone', googleReviewId: 'accounts/117/locations/171/reviews/Gone' }),
      responseRow({ id: 'live', googleReviewId: 'accounts/117/locations/171/reviews/Live' }),
    ]);
    mocks.fetchSingleReview.mockImplementation(async (_account: string, name: string) => {
      if (name.endsWith('/Gone')) throw new ReviewNotFoundError(name);
      return { reviewReply: { comment: responseRow().content } };
    });
    mocks.generateReviewResponse.mockResolvedValue({ response: 'Thanks Dana, glad I could help.' });

    const plan = await planReplyRewrite({ profileId: 'p1', log: silentLog });

    expect(plan.candidates.map((c) => c.responseId)).toEqual(['live']);
    expect(plan.skipped).toContainEqual(
      expect.objectContaining({ responseId: 'gone', reason: 'NO_LIVE_REPLY' })
    );
  });

  it('still stops the plan on an error that is not a 404', async () => {
    mocks.prisma.reviewResponse.findMany.mockResolvedValue([responseRow()]);
    mocks.fetchSingleReview.mockRejectedValue(new Error('503 backend error'));

    await expect(planReplyRewrite({ profileId: 'p1', log: silentLog })).rejects.toThrow('503');
  });

  it('skips, rather than fails, a review that disappeared between plan and apply', async () => {
    const plan = {
      profileId: 'p1',
      profileName: 'Badger Gutters',
      googleAccountId: 'ga1',
      skipped: [],
      candidates: [
        {
          responseId: 'resp1',
          reviewId: 'rev1',
          googleReviewId: 'accounts/117/locations/171/reviews/AbC1',
          rating: 5,
          reviewerName: 'Dana',
          reviewComment: 'Great',
          publishedAt: null,
          before: 'old',
          after: `new\n\n${OWNER_SIGNATURE}`,
        },
      ],
    };
    mocks.fetchSingleReview.mockRejectedValue(
      new ReviewNotFoundError('accounts/117/locations/171/reviews/AbC1')
    );

    const result = await applyReplyRewrite({ plan, log: silentLog, sleep: async () => {} });

    expect(result.failed).toEqual([]);
    expect(result.skipped).toContainEqual(
      expect.objectContaining({ responseId: 'resp1', reason: 'NO_LIVE_REPLY' })
    );
    expect(mocks.publishReviewReply).not.toHaveBeenCalled();
  });
});

// U6: the rewrite generates and publishes outside the review sync and the
// publish worker, so it skipped two things they do. The generator was not
// given the office phone (healthcare replies point an unhappy reviewer at it),
// and nothing ran the worker's healthcare privacy check before publishing: a
// rewrite on a dental profile could confirm a patient or repeat their care in
// public. The check runs on exactly the signed text that would go out, at
// plan time and again at apply time (a plan file can be edited between the
// two). The persona signature has an em dash, which the healthcare rules
// refuse, so on a healthcare profile this tool holds every rewrite.
describe('healthcare profiles (U6)', () => {
  const DENTIST = {
    ...PROFILE,
    name: 'Rice Dentistry',
    category: 'Dentist',
    phone: '(555) 010-4477',
  };

  function planOne(generated: string) {
    mocks.prisma.reviewResponse.findMany.mockResolvedValue([responseRow({ comment: 'Great cleaning.' })]);
    mocks.fetchSingleReview.mockResolvedValue({
      reviewReply: { comment: responseRow().content, updateTime: '2026-07-01T12:00:00Z' },
    });
    mocks.generateReviewResponse.mockResolvedValue({
      response: generated,
      sentiment: 'positive',
      tone: 'warm',
    });
    return planReplyRewrite({ profileId: 'p1', log: silentLog });
  }

  it('gives the generator the office phone, as the review sync does', async () => {
    mocks.prisma.profile.findUnique.mockResolvedValue(DENTIST);
    await planOne('Thanks, Dana. We appreciate it.');

    expect(mocks.generateReviewResponse.mock.calls[0][0]).toMatchObject({
      businessCategory: 'Dentist',
      businessPhone: '(555) 010-4477',
    });
  });

  it('holds a rewrite that fails the privacy check instead of planning it', async () => {
    mocks.prisma.profile.findUnique.mockResolvedValue(DENTIST);
    const plan = await planOne('We are honored to have you as a patient, Dana.');

    expect(plan.candidates).toEqual([]);
    expect(plan.skipped).toEqual([
      expect.objectContaining({
        responseId: 'resp1',
        reason: 'HEALTHCARE_PRIVACY',
        detail: expect.stringContaining('Implies the reviewer is a patient'),
      }),
    ]);
  });

  it('holds even a clean body, because the signature has an em dash', async () => {
    mocks.prisma.profile.findUnique.mockResolvedValue(DENTIST);
    const plan = await planOne('Thanks, Dana. We appreciate it.');

    expect(plan.candidates).toEqual([]);
    expect(plan.skipped[0]).toMatchObject({
      reason: 'HEALTHCARE_PRIVACY',
      detail: expect.stringContaining('Uses an em or en dash'),
    });
  });

  it('leaves a non-healthcare profile as it was', async () => {
    const plan = await planOne('Thanks Dana, glad I could help.');
    expect(plan.candidates).toHaveLength(1);
  });

  it('re-checks at apply time against the profile as stored, and publishes nothing that fails', async () => {
    mocks.prisma.profile.findUnique.mockResolvedValue(DENTIST);
    mocks.fetchSingleReview.mockResolvedValue({
      reviewReply: { comment: responseRow().content, updateTime: '2026-07-01T12:00:00Z' },
    });

    const result = await applyReplyRewrite({
      plan: {
        profileId: 'p1',
        profileName: 'Rice Dentistry',
        googleAccountId: 'ga1',
        candidates: [
          {
            responseId: 'resp1',
            reviewId: 'rev1',
            googleReviewId: 'accounts/117/locations/171/reviews/AbC1',
            rating: 5,
            reviewerName: 'Dana',
            reviewComment: 'Great cleaning.',
            publishedAt: '2026-07-01T12:00:00.000Z',
            before: responseRow().content,
            // Edited into the plan file by hand after planning.
            after: 'We look forward to seeing you at your next visit, Dana.',
          },
        ],
        skipped: [],
      },
      log: silentLog,
      sleep: async () => {},
    });

    expect(mocks.publishReviewReply).not.toHaveBeenCalled();
    expect(result.rewritten).toBe(0);
    expect(result.skipped).toEqual([
      expect.objectContaining({ responseId: 'resp1', reason: 'HEALTHCARE_PRIVACY' }),
    ]);
  });
});
