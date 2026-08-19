import { describe, it, expect, vi, beforeEach } from 'vitest';

// /api/onboarding/keywords and /api/onboarding/cities back both the wizard
// step and the post-onboarding Profile Settings page. They must save at any
// time — neither route may ever gate on onboarding completion, because
// "anything entered during onboarding remains editable forever".

const mocks = vi.hoisted(() => {
  const tx = {
    profileKeyword: { deleteMany: vi.fn(), createMany: vi.fn(), findMany: vi.fn() },
    profileCity: { deleteMany: vi.fn(), createMany: vi.fn(), findMany: vi.fn() },
  };
  return {
    tx,
    prisma: {
      profileKeyword: { findMany: vi.fn() },
      profileCity: { findMany: vi.fn() },
      onboardingProgress: { findUnique: vi.fn() },
      $transaction: vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
    },
  };
});

vi.mock('@/lib/prisma', () => ({ prisma: mocks.prisma }));
vi.mock('@/lib/auth/require-session', () => ({
  requireSession: vi.fn(async () => null),
}));

const keywordsRoute = await import('@/app/api/onboarding/keywords/route');
const citiesRoute = await import('@/app/api/onboarding/cities/route');

function postRequest(url: string, body: unknown): Request {
  return new Request(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  // Re-install the passthrough cleared by clearAllMocks
  mocks.prisma.$transaction.mockImplementation(async (fn) => fn(mocks.tx));
});

describe('POST /api/onboarding/keywords', () => {
  it('replaces the keyword list without ever consulting onboarding progress', async () => {
    const saved = [
      { id: 'k1', profileId: 'p1', keyword: 'Passport Photos', sortOrder: 0 },
      { id: 'k2', profileId: 'p1', keyword: 'Visa Photos', sortOrder: 1 },
    ];
    mocks.tx.profileKeyword.findMany.mockResolvedValue(saved);

    const res = await keywordsRoute.POST(
      postRequest('http://localhost:3000/api/onboarding/keywords', {
        profileId: 'p1',
        keywords: ['Passport Photos', 'Visa Photos'],
      })
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ keywords: saved });

    expect(mocks.tx.profileKeyword.deleteMany).toHaveBeenCalledWith({
      where: { profileId: 'p1' },
    });
    expect(mocks.tx.profileKeyword.createMany).toHaveBeenCalledWith({
      data: [
        { profileId: 'p1', keyword: 'Passport Photos', sortOrder: 0 },
        { profileId: 'p1', keyword: 'Visa Photos', sortOrder: 1 },
      ],
    });
    // The "editable forever" contract: no onboarding-completion gate.
    expect(mocks.prisma.onboardingProgress.findUnique).not.toHaveBeenCalled();
  });

  it('rejects more than 10 keywords', async () => {
    const res = await keywordsRoute.POST(
      postRequest('http://localhost:3000/api/onboarding/keywords', {
        profileId: 'p1',
        keywords: Array.from({ length: 11 }, (_, i) => `kw ${i}`),
      })
    );

    expect(res.status).toBe(400);
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled();
  });
});

describe('POST /api/onboarding/cities', () => {
  it('replaces the city list without ever consulting onboarding progress', async () => {
    const saved = [
      { id: 'c1', profileId: 'p1', city: 'Edmonton', sortOrder: 0 },
    ];
    mocks.tx.profileCity.findMany.mockResolvedValue(saved);

    const res = await citiesRoute.POST(
      postRequest('http://localhost:3000/api/onboarding/cities', {
        profileId: 'p1',
        cities: ['Edmonton'],
      })
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ cities: saved });

    expect(mocks.tx.profileCity.deleteMany).toHaveBeenCalledWith({
      where: { profileId: 'p1' },
    });
    expect(mocks.prisma.onboardingProgress.findUnique).not.toHaveBeenCalled();
  });

  it('rejects more than 3 cities', async () => {
    const res = await citiesRoute.POST(
      postRequest('http://localhost:3000/api/onboarding/cities', {
        profileId: 'p1',
        cities: ['A', 'B', 'C', 'D'],
      })
    );

    expect(res.status).toBe(400);
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled();
  });
});
