import { describe, it, expect, vi, beforeEach } from 'vitest';

// The review sync debug route answers "why isn't this profile's review sync
// working", so it has to look at the same profiles the sync worker does:
// onboarded ones and offboarded ones marked reviewsOnly. It used to pick
// onboarded profiles only, so a reviewsOnly profile could never be debugged.

const mocks = vi.hoisted(() => ({
  prisma: {
    profile: { findMany: vi.fn() },
    review: { findMany: vi.fn() },
  },
  fetchReviews: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({ prisma: mocks.prisma }));
vi.mock('@/lib/auth/require-session', () => ({
  requireSession: vi.fn(async () => null),
}));
vi.mock('@/lib/google-reviews', () => ({ fetchReviews: mocks.fetchReviews }));

const { GET } = await import('@/app/api/reviews/sync/debug/route');

beforeEach(() => {
  vi.clearAllMocks();
  mocks.prisma.profile.findMany.mockResolvedValue([]);
});

describe('review sync debug route', () => {
  it('selects onboarded profiles and offboarded ones marked reviewsOnly', async () => {
    await GET();

    const { where } = mocks.prisma.profile.findMany.mock.calls[0][0];
    expect(where).toMatchObject({
      isConnected: true,
      accountResourceName: { not: null },
    });
    expect(where).not.toHaveProperty('isOnboarded');
    expect(where.OR).toEqual([{ isOnboarded: true }, { reviewsOnly: true }]);
  });

  it('shows each profile\'s reviewsOnly flag when nothing is eligible', async () => {
    await GET();

    const { select } = mocks.prisma.profile.findMany.mock.calls[1][0];
    expect(select).toMatchObject({ isOnboarded: true, reviewsOnly: true });
  });
});
