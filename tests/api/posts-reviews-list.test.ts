import { describe, it, expect, vi, beforeEach } from 'vitest';

// GET /api/posts and GET /api/reviews: the list endpoints. A filter value
// that isn't one of the enum's values used to go straight into the Prisma
// where clause, which throws and came back as a 500; and neither list had a
// limit, so a profile with years of reviews returned every row.

const mocks = vi.hoisted(() => ({
  prisma: {
    post: { findMany: vi.fn() },
    review: { findMany: vi.fn() },
  },
}));

vi.mock('@/lib/prisma', () => ({ prisma: mocks.prisma }));
vi.mock('@/lib/auth/require-session', () => ({
  requireSession: vi.fn(async () => null),
}));

const postsRoute = await import('@/app/api/posts/route');
const reviewsRoute = await import('@/app/api/reviews/route');

const get = (url: string) => new Request(`http://localhost:3000${url}`);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.prisma.post.findMany.mockResolvedValue([]);
  mocks.prisma.review.findMany.mockResolvedValue([]);
});

describe('GET /api/posts', () => {
  it('400s on a status or type that is not a real value, without querying', async () => {
    const badStatus = await postsRoute.GET(get('/api/posts?status=LIVE'));
    expect(badStatus.status).toBe(400);
    const badType = await postsRoute.GET(get('/api/posts?type=whats_new'));
    expect(badType.status).toBe(400);
    expect(mocks.prisma.post.findMany).not.toHaveBeenCalled();
  });

  it('filters on valid values and applies the default limit', async () => {
    const res = await postsRoute.GET(
      get('/api/posts?profileId=p1&status=DRAFT&type=OFFER')
    );
    expect(res.status).toBe(200);
    const args = mocks.prisma.post.findMany.mock.calls[0][0];
    expect(args.where).toEqual({ profileId: 'p1', status: 'DRAFT', type: 'OFFER' });
    expect(args.take).toBe(100);
  });

  it('ignores empty filters, as it always has', async () => {
    const res = await postsRoute.GET(get('/api/posts?status=&type='));
    expect(res.status).toBe(200);
    expect(mocks.prisma.post.findMany.mock.calls[0][0].where).toEqual({});
  });

  it('honours a limit up to the cap and 400s past it', async () => {
    await postsRoute.GET(get('/api/posts?limit=250'));
    expect(mocks.prisma.post.findMany.mock.calls[0][0].take).toBe(250);

    for (const limit of ['501', '0', '-1', 'ten', '2.5']) {
      const res = await postsRoute.GET(get(`/api/posts?limit=${limit}`));
      expect(res.status, `limit=${limit}`).toBe(400);
    }
    expect(mocks.prisma.post.findMany).toHaveBeenCalledTimes(1);
  });
});

describe('GET /api/reviews', () => {
  it('400s on a bad responseStatus or rating, without querying', async () => {
    for (const query of [
      'responseStatus=done',
      'rating=five',
      'rating=0',
      'rating=6',
      'rating=4.5',
    ]) {
      const res = await reviewsRoute.GET(get(`/api/reviews?${query}`));
      expect(res.status, query).toBe(400);
    }
    expect(mocks.prisma.review.findMany).not.toHaveBeenCalled();
  });

  it('filters on valid values and applies the default limit', async () => {
    const res = await reviewsRoute.GET(
      get('/api/reviews?profileId=p1&rating=4&responseStatus=DRAFTED')
    );
    expect(res.status).toBe(200);
    const args = mocks.prisma.review.findMany.mock.calls[0][0];
    expect(args.where).toEqual({
      removedAt: null,
      profileId: 'p1',
      rating: 4,
      response: { status: 'DRAFTED' },
    });
    expect(args.take).toBe(100);
  });

  it('honours a limit up to the cap and 400s past it', async () => {
    await reviewsRoute.GET(get('/api/reviews?limit=500'));
    expect(mocks.prisma.review.findMany.mock.calls[0][0].take).toBe(500);

    const res = await reviewsRoute.GET(get('/api/reviews?limit=1000'));
    expect(res.status).toBe(400);
  });
});
