import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// Ten Google locations were stored twice (one row per agency login that can
// see them). Onboarding the second copy would have both posting and replying
// on one listing, so the pickers hide it and completion refuses it.

const mocks = vi.hoisted(() => ({
  prisma: {
    profile: { findMany: vi.fn(), findUnique: vi.fn(), findFirst: vi.fn(), update: vi.fn() },
    onboardingProgress: { update: vi.fn() },
    $transaction: vi.fn(),
  },
  enqueueOnboardingSync: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({ prisma: mocks.prisma }));
vi.mock('@/lib/auth/require-session', () => ({ requireSession: vi.fn(async () => null) }));
vi.mock('@/lib/queue/onboarding-sync-queue', () => ({
  enqueueOnboardingSync: mocks.enqueueOnboardingSync,
}));

const { hideCopiesOfActiveLocations, activeCopyOf } = await import('@/lib/location-copies');
const completeRoute = await import('@/app/api/onboarding/complete/route');
const availableRoute = await import('@/app/api/profiles/available/route');

const TYLER_THRIVE = 'cmnz37hx8005s1cqohrwur1gg';
const CHRIS_THRIVE = 'cmnrm67n200131appnqejgm52';

function post(body: unknown): NextRequest {
  return new NextRequest('http://localhost:3000/api/onboarding/complete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.prisma.profile.findUnique.mockResolvedValue({ locationName: 'locations/thrive' });
  mocks.prisma.profile.findFirst.mockResolvedValue(null);
  mocks.prisma.$transaction.mockResolvedValue([{ completedAt: new Date('2026-10-22T20:00:00Z') }]);
});

describe('hideCopiesOfActiveLocations', () => {
  it('hides inactive rows of locations onboarded or reviews-only elsewhere', async () => {
    mocks.prisma.profile.findMany.mockResolvedValue([
      { locationName: 'locations/thrive' },
      { locationName: 'locations/vineyard' },
    ]);

    await expect(hideCopiesOfActiveLocations()).resolves.toEqual({
      NOT: {
        isOnboarded: false,
        reviewsOnly: false,
        locationName: { in: ['locations/thrive', 'locations/vineyard'] },
      },
    });
    // A reviews-only copy still syncs and auto-publishes replies, so it
    // counts as active too.
    expect(mocks.prisma.profile.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { OR: [{ isOnboarded: true }, { reviewsOnly: true }] } })
    );
  });

  it('filters nothing when nothing is active', async () => {
    mocks.prisma.profile.findMany.mockResolvedValue([]);
    await expect(hideCopiesOfActiveLocations()).resolves.toEqual({});
  });
});

const chrisCopy = (isConnected = true) => ({
  id: CHRIS_THRIVE,
  name: 'Thrive Medical Spa',
  isConnected,
  googleAccount: { googleEmail: 'chris@vineyardgrowth.com' },
});

describe('activeCopyOf', () => {
  it('finds the other active row of the same location', async () => {
    mocks.prisma.profile.findFirst.mockResolvedValue(chrisCopy());

    await expect(activeCopyOf(TYLER_THRIVE)).resolves.toEqual({
      id: CHRIS_THRIVE,
      name: 'Thrive Medical Spa',
      googleEmail: 'chris@vineyardgrowth.com',
      isConnected: true,
    });
    expect(mocks.prisma.profile.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          OR: [{ isOnboarded: true }, { reviewsOnly: true }],
          locationName: 'locations/thrive',
          id: { not: TYLER_THRIVE },
        },
      })
    );
  });

  it('is null for a profile that does not exist', async () => {
    mocks.prisma.profile.findUnique.mockResolvedValue(null);
    await expect(activeCopyOf(TYLER_THRIVE)).resolves.toBeNull();
    expect(mocks.prisma.profile.findFirst).not.toHaveBeenCalled();
  });
});

describe('POST /api/onboarding/complete', () => {
  it('refuses to onboard a second copy of an onboarded location', async () => {
    mocks.prisma.profile.findFirst.mockResolvedValue(chrisCopy());

    const res = await completeRoute.POST(post({ profileId: TYLER_THRIVE }));

    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.onboardedProfileId).toBe(CHRIS_THRIVE);
    expect(body.error).toContain('chris@vineyardgrowth.com');
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled();
    expect(mocks.enqueueOnboardingSync).not.toHaveBeenCalled();
  });

  it('says so when the onboarded copy is disconnected', async () => {
    mocks.prisma.profile.findFirst.mockResolvedValue(chrisCopy(false));

    const res = await completeRoute.POST(post({ profileId: TYLER_THRIVE }));

    expect(res.status).toBe(409);
    expect((await res.json()).error).toContain('that copy is disconnected');
  });

  it('completes a location onboarded nowhere else', async () => {
    const res = await completeRoute.POST(post({ profileId: TYLER_THRIVE }));

    expect(res.status).toBe(200);
    expect(mocks.prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(mocks.enqueueOnboardingSync).toHaveBeenCalledWith(TYLER_THRIVE);
  });
});

describe('GET /api/profiles/available', () => {
  it('leaves out copies of onboarded locations', async () => {
    mocks.prisma.profile.findMany
      .mockResolvedValueOnce([{ locationName: 'locations/thrive' }]) // onboarded locations
      .mockResolvedValueOnce([]); // the picker itself

    await availableRoute.GET();

    expect(mocks.prisma.profile.findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: {
          isConnected: true,
          isOnboarded: false,
          NOT: { isOnboarded: false, reviewsOnly: false, locationName: { in: ['locations/thrive'] } },
        },
      })
    );
  });
});
