import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// The onboarding save routes (keywords, cities, services, description) wrote
// straight away without looking the profile up. For a profile that doesn't
// exist the insert broke its foreign key and the caller got a 500 rather than
// the 404 every other profile route answers with.

const mocks = vi.hoisted(() => {
  const tx = {
    profileKeyword: { deleteMany: vi.fn(), createMany: vi.fn(), findMany: vi.fn() },
    profileCity: { deleteMany: vi.fn(), createMany: vi.fn(), findMany: vi.fn() },
  };
  return {
    tx,
    prisma: {
      profile: { findUnique: vi.fn() },
      profileDescription: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
      $transaction: vi.fn(),
    },
    saveProfileServices: vi.fn(),
  };
});

vi.mock('@/lib/prisma', () => ({ prisma: mocks.prisma }));
vi.mock('@/lib/auth/require-session', () => ({
  requireSession: vi.fn(async () => null),
}));
vi.mock('@/lib/profile-services', () => ({
  saveProfileServices: mocks.saveProfileServices,
}));
vi.mock('@/lib/google-business-info', () => ({
  fetchStructuredServices: vi.fn(),
  fetchCurrentDescription: vi.fn(),
}));

const keywordsRoute = await import('@/app/api/onboarding/keywords/route');
const citiesRoute = await import('@/app/api/onboarding/cities/route');
const servicesRoute = await import('@/app/api/onboarding/services/route');
const descriptionRoute = await import('@/app/api/onboarding/description/route');

function post(body: unknown): NextRequest {
  return new NextRequest('http://localhost:3000/api/onboarding/x', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

// What the database does for a child row whose profile isn't there.
const fkViolation = () => Object.assign(new Error('fk'), { code: 'P2003' });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.prisma.profile.findUnique.mockResolvedValue(null);
  mocks.prisma.$transaction.mockImplementation(async (fn: (t: unknown) => unknown) =>
    fn({ ...mocks.tx, $executeRaw: vi.fn(), profileDescription: mocks.prisma.profileDescription })
  );
  mocks.tx.profileKeyword.createMany.mockRejectedValue(fkViolation());
  mocks.tx.profileCity.createMany.mockRejectedValue(fkViolation());
  mocks.saveProfileServices.mockRejectedValue(fkViolation());
  mocks.prisma.profileDescription.findFirst.mockResolvedValue(null);
  mocks.prisma.profileDescription.create.mockRejectedValue(fkViolation());
});

describe('onboarding saves for a profile that does not exist', () => {
  const cases = [
    ['keywords', () => keywordsRoute.POST(post({ profileId: 'gone', keywords: ['Gutters'] }))],
    ['cities', () => citiesRoute.POST(post({ profileId: 'gone', cities: ['Lehi'] }))],
    [
      'services',
      () =>
        servicesRoute.POST(
          post({
            profileId: 'gone',
            services: [{ serviceName: 'Gutter cleaning', isStructured: true }],
          })
        ),
    ],
    [
      'description',
      () => descriptionRoute.POST(post({ profileId: 'gone', content: 'A gutter company.' })),
    ],
  ] as const;

  for (const [name, call] of cases) {
    it(`${name}: 404s and writes nothing`, async () => {
      const res = await call();
      expect(res.status).toBe(404);
      expect((await res.json()).error).toBe('Profile not found');
      expect(mocks.prisma.$transaction).not.toHaveBeenCalled();
      expect(mocks.saveProfileServices).not.toHaveBeenCalled();
      expect(mocks.prisma.profileDescription.create).not.toHaveBeenCalled();
    });
  }
});
