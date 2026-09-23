import { describe, it, expect, vi, beforeEach } from 'vitest';

// Review action routes with the healthcare and confirmation rules:
// - Approve all needs the operator's confirmed count, and is refused
//   outright for healthcare profiles
// - single Approve refuses a healthcare draft that fails the privacy check,
//   and only approves the exact text the operator was looking at
// - a person can edit a draft's text (or write one) before approving it

const mocks = vi.hoisted(() => ({
  prisma: {
    profile: { findUnique: vi.fn() },
    review: { findUnique: vi.fn(), findMany: vi.fn() },
    reviewResponse: {
      update: vi.fn(),
      updateMany: vi.fn(),
      create: vi.fn(),
    },
  },
  scheduleReviewPublish: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({ prisma: mocks.prisma }));
vi.mock('@/lib/auth/require-session', () => ({
  requireSession: vi.fn(async () => null),
  requireProfile: vi.fn(),
}));
vi.mock('@/lib/queue/review-publish-queue', () => ({
  scheduleReviewPublish: mocks.scheduleReviewPublish,
}));

const { POST: bulkApprovePOST } = await import('@/app/api/reviews/approve/route');
const { POST: approvePOST } = await import('@/app/api/reviews/[id]/approve/route');
const { PATCH: editPATCH } = await import('@/app/api/reviews/[id]/response/route');

const params = Promise.resolve({ id: 'rev1' });

function jsonRequest(url: string, body: unknown, method = 'POST'): Request {
  return new Request(`http://localhost:3000${url}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const SAFE =
  "Dana, we're sorry to read this. Please call the office at (555) 010-4477.";
const UNSAFE = 'Thanks Dana! We look forward to seeing you at your next visit!';

function review(overrides: {
  content?: string;
  status?: string;
  category?: string;
}) {
  return {
    id: 'rev1',
    reviewerName: 'Dana',
    repliedExternally: false,
    removedAt: null,
    response: {
      id: 'resp1',
      status: overrides.status ?? 'DRAFTED',
      content: overrides.content ?? SAFE,
    },
    profile: {
      reviewsEnabled: true,
      category: overrides.category ?? 'Dentist',
      phone: '(555) 010-4477',
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('Approve all', () => {
  it('is refused for a healthcare profile before any draft is touched', async () => {
    mocks.prisma.profile.findUnique.mockResolvedValue({
      reviewsEnabled: true,
      category: 'Dentist',
    });

    const res = await bulkApprovePOST(
      jsonRequest('/api/reviews/approve', { profileId: 'p1', confirmCount: 3 })
    );

    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/healthcare/);
    expect(mocks.prisma.review.findMany).not.toHaveBeenCalled();
    expect(mocks.prisma.reviewResponse.update).not.toHaveBeenCalled();
    expect(mocks.scheduleReviewPublish).not.toHaveBeenCalled();
  });

  it('needs a confirmed count', async () => {
    const res = await bulkApprovePOST(
      jsonRequest('/api/reviews/approve', { profileId: 'p1' })
    );

    expect(res.status).toBe(400);
    expect(mocks.prisma.profile.findUnique).not.toHaveBeenCalled();
  });

  it('approves nothing when the confirmed count no longer matches', async () => {
    mocks.prisma.profile.findUnique.mockResolvedValue({
      reviewsEnabled: true,
      category: 'Plumber',
    });
    mocks.prisma.review.findMany.mockResolvedValue([
      { id: 'rev1', response: { id: 'resp1', status: 'DRAFTED' } },
      { id: 'rev2', response: { id: 'resp2', status: 'DRAFTED' } },
    ]);

    const res = await bulkApprovePOST(
      jsonRequest('/api/reviews/approve', { profileId: 'p1', confirmCount: 1 })
    );

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual(
      expect.objectContaining({ draftCount: 2 })
    );
    expect(mocks.prisma.reviewResponse.update).not.toHaveBeenCalled();
    expect(mocks.scheduleReviewPublish).not.toHaveBeenCalled();
  });

  it('approves and staggers every draft when the count matches', async () => {
    mocks.prisma.profile.findUnique.mockResolvedValue({
      reviewsEnabled: true,
      category: 'Plumber',
    });
    mocks.prisma.review.findMany.mockResolvedValue([
      { id: 'rev1', response: { id: 'resp1', status: 'DRAFTED' } },
      { id: 'rev2', response: { id: 'resp2', status: 'DRAFTED' } },
    ]);

    const res = await bulkApprovePOST(
      jsonRequest('/api/reviews/approve', { profileId: 'p1', confirmCount: 2 })
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ approved: 2 });
    expect(mocks.scheduleReviewPublish).toHaveBeenNthCalledWith(1, 'resp1', { delayMs: 0 });
    expect(mocks.scheduleReviewPublish).toHaveBeenNthCalledWith(2, 'resp2', { delayMs: 7_500 });
  });
});

describe('single Approve', () => {
  it('refuses a healthcare draft that fails the privacy check', async () => {
    mocks.prisma.review.findUnique.mockResolvedValue(review({ content: UNSAFE }));

    const res = await approvePOST(
      jsonRequest('/api/reviews/rev1/approve', { content: UNSAFE }),
      { params }
    );

    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error).toMatch(/Edit this reply/);
    expect(body.issues.map((i: { reason: string }) => i.reason)).toContain(
      'Mentions a visit or appointment'
    );
    expect(mocks.prisma.reviewResponse.updateMany).not.toHaveBeenCalled();
    expect(mocks.scheduleReviewPublish).not.toHaveBeenCalled();
  });

  it('approves a healthcare draft that passes, guarded on the checked text', async () => {
    mocks.prisma.review.findUnique.mockResolvedValue(review({}));
    mocks.prisma.reviewResponse.updateMany.mockResolvedValue({ count: 1 });

    const res = await approvePOST(
      jsonRequest('/api/reviews/rev1/approve', { content: SAFE }),
      { params }
    );

    expect(res.status).toBe(200);
    expect(mocks.prisma.reviewResponse.updateMany).toHaveBeenCalledWith({
      where: { id: 'resp1', status: 'DRAFTED', content: SAFE },
      data: { status: 'APPROVED', autoApproved: false },
    });
    expect(mocks.scheduleReviewPublish).toHaveBeenCalledWith('resp1');
  });

  it('does not run the healthcare check for other businesses', async () => {
    mocks.prisma.review.findUnique.mockResolvedValue(
      review({ content: UNSAFE, category: 'Plumber' })
    );
    mocks.prisma.reviewResponse.updateMany.mockResolvedValue({ count: 1 });

    const res = await approvePOST(
      jsonRequest('/api/reviews/rev1/approve', { content: UNSAFE }),
      { params }
    );

    expect(res.status).toBe(200);
  });

  it('refuses when the text on screen is not the stored draft', async () => {
    mocks.prisma.review.findUnique.mockResolvedValue(review({}));

    const res = await approvePOST(
      jsonRequest('/api/reviews/rev1/approve', { content: 'an older draft' }),
      { params }
    );

    expect(res.status).toBe(409);
    expect(mocks.prisma.reviewResponse.updateMany).not.toHaveBeenCalled();
    expect(mocks.scheduleReviewPublish).not.toHaveBeenCalled();
  });

  it('queues nothing when the draft changed between the check and the write', async () => {
    mocks.prisma.review.findUnique.mockResolvedValue(review({}));
    mocks.prisma.reviewResponse.updateMany.mockResolvedValue({ count: 0 });

    const res = await approvePOST(
      jsonRequest('/api/reviews/rev1/approve', { content: SAFE }),
      { params }
    );

    expect(res.status).toBe(409);
    expect(mocks.scheduleReviewPublish).not.toHaveBeenCalled();
  });
});

describe('editing a reply', () => {
  function edit(body: unknown) {
    return editPATCH(jsonRequest('/api/reviews/rev1/response', body, 'PATCH'), {
      params,
    });
  }

  it('replaces a draft with the text a person wrote, back on the approval track', async () => {
    mocks.prisma.review.findUnique.mockResolvedValue(review({ content: UNSAFE }));
    mocks.prisma.reviewResponse.updateMany.mockResolvedValue({ count: 1 });

    const res = await edit({ content: `  ${SAFE}  ` });

    expect(res.status).toBe(200);
    expect(mocks.prisma.reviewResponse.updateMany).toHaveBeenCalledWith({
      where: { id: 'resp1', status: { in: ['DRAFTED', 'FAILED'] } },
      data: {
        content: SAFE,
        status: 'DRAFTED',
        errorMessage: null,
        autoApproved: false,
      },
    });
    expect(mocks.scheduleReviewPublish).not.toHaveBeenCalled();
  });

  it('creates a draft when the review has no reply yet', async () => {
    mocks.prisma.review.findUnique.mockResolvedValue({
      ...review({}),
      response: null,
    });

    const res = await edit({ content: SAFE });

    expect(res.status).toBe(200);
    expect(mocks.prisma.reviewResponse.create).toHaveBeenCalledWith({
      data: {
        reviewId: 'rev1',
        content: SAFE,
        status: 'DRAFTED',
        autoApproved: false,
      },
    });
  });

  it.each(['APPROVED', 'PUBLISHED', 'SKIPPED'])(
    'refuses to edit a %s reply',
    async (status) => {
      mocks.prisma.review.findUnique.mockResolvedValue(review({ status }));

      const res = await edit({ content: SAFE });

      expect(res.status).toBe(409);
      expect(mocks.prisma.reviewResponse.updateMany).not.toHaveBeenCalled();
    }
  );

  it('refuses when the reply was approved while it was being edited', async () => {
    mocks.prisma.review.findUnique.mockResolvedValue(review({}));
    mocks.prisma.reviewResponse.updateMany.mockResolvedValue({ count: 0 });

    const res = await edit({ content: SAFE });

    expect(res.status).toBe(409);
  });

  it('rejects an empty reply and one over the 4096-byte limit', async () => {
    expect((await edit({ content: '   ' })).status).toBe(400);
    expect((await edit({ content: 'é'.repeat(2049) })).status).toBe(400);
    expect(mocks.prisma.review.findUnique).not.toHaveBeenCalled();
  });

  it('refuses while review management is off', async () => {
    mocks.prisma.review.findUnique.mockResolvedValue({
      ...review({}),
      profile: { reviewsEnabled: false },
    });

    const res = await edit({ content: SAFE });

    expect(res.status).toBe(409);
    expect(mocks.prisma.reviewResponse.updateMany).not.toHaveBeenCalled();
  });

  it('refuses a review already answered on Google', async () => {
    mocks.prisma.review.findUnique.mockResolvedValue({
      ...review({}),
      repliedExternally: true,
    });

    const res = await edit({ content: SAFE });

    expect(res.status).toBe(400);
  });
});
