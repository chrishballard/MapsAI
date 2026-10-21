import { describe, it, expect, vi, beforeEach } from 'vitest';

// M19: a reviews-only profile (offboarded, but its Google reviews still
// synced) was filtered out of /api/profiles, which feeds the business
// selector, so its single-profile reviews view (star modes, instructions,
// the on/off toggle, Approve all) couldn't be reached. Chris, 2026-10-21:
// show them in the selector, and clear reviewsOnly when a client is
// offboarded. The post Generate page still lists onboarded profiles only:
// a reviews-only profile gets no AI posts.

const mocks = vi.hoisted(() => ({
  prisma: {
    profile: { findMany: vi.fn(), update: vi.fn() },
    post: { findMany: vi.fn(), updateMany: vi.fn() },
    onboardingProgress: { deleteMany: vi.fn() },
    profileKeyword: { deleteMany: vi.fn() },
    profileCity: { deleteMany: vi.fn() },
    profileDescription: { deleteMany: vi.fn() },
    profileService: { deleteMany: vi.fn() },
    $transaction: vi.fn(async (ops: unknown[]) => ops),
  },
}));

vi.mock('@/lib/prisma', () => ({ prisma: mocks.prisma }));
vi.mock('@/lib/auth/require-session', () => ({
  requireSession: vi.fn(async () => null),
}));
vi.mock('@/lib/queue/publish-queue', () => ({
  publishQueue: { getJob: vi.fn(async () => null) },
}));

const { GET } = await import('@/app/api/profiles/route');
const { POST: offboard } = await import('@/app/api/profiles/offboard/route');

beforeEach(() => {
  vi.clearAllMocks();
  mocks.prisma.profile.findMany.mockResolvedValue([]);
  mocks.prisma.post.findMany.mockResolvedValue([]);
});

describe('GET /api/profiles', () => {
  it('lists connected profiles that are onboarded or reviews-only, and says which', async () => {
    await GET(new Request('http://localhost/api/profiles'));

    const { where, select } = mocks.prisma.profile.findMany.mock.calls[0][0];
    expect(where).toEqual({
      isConnected: true,
      OR: [{ isOnboarded: true }, { reviewsOnly: true }],
    });
    expect(select).toMatchObject({ reviewsOnly: true });
  });

  it('lists onboarded profiles only for post generation', async () => {
    await GET(new Request('http://localhost/api/profiles?scope=posts'));

    const { where } = mocks.prisma.profile.findMany.mock.calls[0][0];
    expect(where).toEqual({ isConnected: true, isOnboarded: true });
  });
});

describe('POST /api/profiles/offboard', () => {
  it('clears reviewsOnly along with isOnboarded', async () => {
    await offboard(
      new Request('http://localhost/api/profiles/offboard', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profileId: 'p1' }),
      })
    );

    expect(mocks.prisma.profile.update).toHaveBeenCalledWith({
      where: { id: 'p1' },
      data: { isOnboarded: false, reviewsOnly: false },
    });
  });
});
