import { describe, it, expect, vi, beforeEach } from 'vitest';

// Regenerate reads the response, then waits seconds on Claude. A person can
// approve the draft (or a sync can AUTO-approve a new one, and the worker
// publish it) in that window. The write after the Claude call must not drag
// an APPROVED or PUBLISHED response back to DRAFTED or replace its text: it
// answers 409 and leaves the row alone. A response that is still a draft, or
// a review with no response at all, regenerates as before.

type Row = {
  reviewId: string;
  content: string;
  status: string;
  autoApproved: boolean;
  errorMessage: string | null;
};

const mocks = vi.hoisted(() => ({
  prisma: {
    review: { findUnique: vi.fn() },
    reviewResponse: { upsert: vi.fn() },
  },
  generateReviewResponse: vi.fn(),
  rows: new Map<string, Row>(),
}));

vi.mock('@/lib/prisma', () => ({ prisma: mocks.prisma }));
vi.mock('@/lib/auth/require-session', () => ({
  requireSession: vi.fn(async () => null),
  requireProfile: vi.fn(),
}));
vi.mock('@/lib/review-responder', () => ({
  generateReviewResponse: mocks.generateReviewResponse,
}));

const { POST: generatePOST } = await import(
  '@/app/api/reviews/[id]/generate/route'
);

const params = Promise.resolve({ id: 'rev1' });

function request() {
  return new Request('http://localhost:3000/api/reviews/rev1/generate', {
    method: 'POST',
  });
}

/** Does `row` pass the non-unique filters in an extended where-unique? */
function matchesFilters(row: Row, where: Record<string, unknown>): boolean {
  return Object.entries(where).every(([key, condition]) => {
    if (key === 'reviewId') return true;
    const value = row[key as keyof Row];
    if (condition && typeof condition === 'object') {
      const c = condition as { in?: unknown[]; notIn?: unknown[] };
      if (c.in) return c.in.includes(value);
      if (c.notIn) return !c.notIn.includes(value);
    }
    return value === condition;
  });
}

// Prisma's upsert against the unique reviewId: update the row if it exists
// and passes the extra filters, create it if there is none, and fail the
// create on the unique constraint if a row exists that the filters exclude.
function fakeUpsert({
  where,
  create,
  update,
}: {
  where: Record<string, unknown> & { reviewId: string };
  create: Omit<Row, 'errorMessage'>;
  update: Partial<Row>;
}) {
  const row = mocks.rows.get(where.reviewId);
  if (row && matchesFilters(row, where)) {
    Object.assign(row, update);
    return Promise.resolve({ id: 'resp1', ...row });
  }
  if (!row) {
    const created = { errorMessage: null, ...create };
    mocks.rows.set(where.reviewId, created);
    return Promise.resolve({ id: 'resp1', ...created });
  }
  return Promise.reject(
    Object.assign(new Error('Unique constraint failed on the fields: (`reviewId`)'), {
      code: 'P2002',
    })
  );
}

function reviewWith(response: { status: string } | null) {
  return {
    id: 'rev1',
    rating: 5,
    comment: 'Great',
    reviewerName: 'Dana',
    repliedExternally: false,
    removedAt: null,
    profile: {
      name: 'Ben Plumbing',
      category: 'Plumber',
      phone: null,
      reviewsEnabled: true,
      reviewInstructions: null,
    },
    response,
  };
}

function seed(status: string) {
  mocks.rows.set('rev1', {
    reviewId: 'rev1',
    content: 'Approved text',
    status,
    autoApproved: false,
    errorMessage: null,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.rows.clear();
  mocks.prisma.reviewResponse.upsert.mockImplementation(fakeUpsert);
});

describe('regenerate racing an approval', () => {
  it.each(['APPROVED', 'PUBLISHED'])(
    'answers 409 and leaves the response alone when it became %s during the Claude call',
    async (status) => {
      seed('DRAFTED');
      mocks.prisma.review.findUnique.mockResolvedValue(reviewWith({ status: 'DRAFTED' }));
      mocks.generateReviewResponse.mockImplementation(async () => {
        // The operator approves (and the worker may publish) meanwhile.
        mocks.rows.get('rev1')!.status = status;
        return { response: 'Regenerated text' };
      });

      const res = await generatePOST(request(), { params });

      expect(res.status).toBe(409);
      expect(mocks.rows.get('rev1')).toMatchObject({
        status,
        content: 'Approved text',
      });
    }
  );

  it('answers 409 when a sync AUTO-approved a response for a review that had none', async () => {
    mocks.prisma.review.findUnique.mockResolvedValue(reviewWith(null));
    mocks.generateReviewResponse.mockImplementation(async () => {
      mocks.rows.set('rev1', {
        reviewId: 'rev1',
        content: 'Auto text',
        status: 'APPROVED',
        autoApproved: true,
        errorMessage: null,
      });
      return { response: 'Regenerated text' };
    });

    const res = await generatePOST(request(), { params });

    expect(res.status).toBe(409);
    expect(mocks.rows.get('rev1')).toMatchObject({
      status: 'APPROVED',
      content: 'Auto text',
      autoApproved: true,
    });
  });

  it('answers 409 when the guarded write finds nothing to update', async () => {
    mocks.prisma.review.findUnique.mockResolvedValue(reviewWith({ status: 'DRAFTED' }));
    mocks.generateReviewResponse.mockResolvedValue({ response: 'Regenerated text' });
    mocks.prisma.reviewResponse.upsert.mockRejectedValue(
      Object.assign(new Error('No record was found for an upsert.'), { code: 'P2025' })
    );

    const res = await generatePOST(request(), { params });

    expect(res.status).toBe(409);
  });

  it('still replaces a response that is still a draft', async () => {
    seed('DRAFTED');
    mocks.prisma.review.findUnique.mockResolvedValue(reviewWith({ status: 'DRAFTED' }));
    mocks.generateReviewResponse.mockResolvedValue({ response: 'Regenerated text' });

    const res = await generatePOST(request(), { params });

    expect(res.status).toBe(200);
    expect(mocks.rows.get('rev1')).toMatchObject({
      status: 'DRAFTED',
      content: 'Regenerated text',
      autoApproved: false,
    });
  });

  it('still creates a draft for a review with no response', async () => {
    mocks.prisma.review.findUnique.mockResolvedValue(reviewWith(null));
    mocks.generateReviewResponse.mockResolvedValue({ response: 'Regenerated text' });

    const res = await generatePOST(request(), { params });

    expect(res.status).toBe(200);
    expect(mocks.rows.get('rev1')).toMatchObject({
      status: 'DRAFTED',
      content: 'Regenerated text',
      autoApproved: false,
    });
  });
});
