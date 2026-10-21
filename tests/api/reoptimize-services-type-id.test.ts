import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

// Regenerating services on the re-optimization page replaces the saved set.
// It must keep the service type id a surviving row already carries (an
// English title on a Spanish-language profile only resolves through it) and
// record the id for any name that matches Google's current catalog.

const mocks = vi.hoisted(() => ({
  tx: {
    profileService: { deleteMany: vi.fn(), createMany: vi.fn(), findMany: vi.fn() },
  },
  prisma: {
    profileKeyword: { findMany: vi.fn() },
    profileCity: { findMany: vi.fn() },
    profileService: { findMany: vi.fn() },
    $transaction: vi.fn(),
  },
  requireProfile: vi.fn(),
  fetchStructuredServices: vi.fn(),
  generateServiceDescriptions: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({ prisma: mocks.prisma }));
vi.mock('@/lib/auth/require-session', () => ({
  requireSession: vi.fn(async () => null),
  requireProfile: mocks.requireProfile,
}));
vi.mock('@/lib/google-business-info', () => ({
  fetchStructuredServices: mocks.fetchStructuredServices,
}));
vi.mock('@/lib/service-generator', () => ({
  generateServiceDescriptions: mocks.generateServiceDescriptions,
  ServiceGenerationIncompleteError: class extends Error {},
}));
// The route resolves ids with the push's own resolveServiceTypeId
vi.mock('@/lib/profile-services', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/profile-services')>()),
  saveProfileServices: vi.fn(),
}));

const { POST } = await import('@/app/api/reoptimize/services/route');

const MATTRESS = 'job_type_id:mattress_cleaning';
const CARPET = 'job_type_id:carpet_cleaning';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireProfile.mockResolvedValue({
    id: 'p1',
    name: 'Bees Friends Cleaners',
    category: 'Servicio de limpieza',
    address: 'Portland, ME',
    googleAccountId: 'ga1',
    locationName: 'locations/123',
  });
  mocks.prisma.profileKeyword.findMany.mockResolvedValue([]);
  mocks.prisma.profileCity.findMany.mockResolvedValue([]);
  mocks.prisma.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => fn(mocks.tx));
  mocks.tx.profileService.findMany.mockResolvedValue([]);
  mocks.fetchStructuredServices.mockResolvedValue([
    { serviceTypeId: MATTRESS, displayName: 'Limpieza de colchones' },
    { serviceTypeId: CARPET, displayName: 'Limpieza de alfombras' },
  ]);
  // Saved before the regenerate: an English title anchored by its id
  mocks.prisma.profileService.findMany.mockResolvedValue([
    { serviceName: 'Mattress cleaning', serviceTypeId: MATTRESS },
  ]);
  mocks.generateServiceDescriptions.mockImplementation(
    async ({ serviceNames }: { serviceNames: string[] }) =>
      serviceNames.map((serviceName) => ({ serviceName, description: `About ${serviceName}.` }))
  );
});

function request(serviceNames: string[]): NextRequest {
  return new NextRequest('http://localhost:3000/api/reoptimize/services', {
    method: 'POST',
    body: JSON.stringify({ profileId: 'cmppohric00ns17pa9poqsdry', serviceNames }),
    headers: { 'content-type': 'application/json' },
  });
}

describe('reoptimize services POST service type ids', () => {
  it('keeps stored ids, records catalog matches, and leaves custom services without one', async () => {
    const res = await POST(request(['Mattress cleaning', 'Limpieza de alfombras', 'Move-out cleaning']));
    expect(res).toBeInstanceOf(NextResponse);
    expect(res.status).toBe(200);

    const rows = mocks.tx.profileService.createMany.mock.calls[0][0].data;
    expect(rows).toEqual([
      expect.objectContaining({ serviceName: 'Mattress cleaning', serviceTypeId: MATTRESS, isStructured: true }),
      expect.objectContaining({ serviceName: 'Limpieza de alfombras', serviceTypeId: CARPET, isStructured: true }),
      expect.objectContaining({ serviceName: 'Move-out cleaning', serviceTypeId: null, isStructured: false }),
    ]);
  });
});

describe('reoptimize services POST id resolution', () => {
  it('finds the type by its id slug on a non-English profile, as the push does', async () => {
    mocks.requireProfile.mockResolvedValue({
      id: 'p1',
      name: 'Bees Friends Cleaners',
      category: 'Servicio de limpieza',
      address: 'Portland, ME',
      googleAccountId: 'ga1',
      locationName: 'locations/123',
      googleLanguageCode: 'es-419',
    });
    mocks.prisma.profileService.findMany.mockResolvedValue([]);

    const res = await POST(request(['Carpet Cleaning']));
    expect(res.status).toBe(200);

    const rows = mocks.tx.profileService.createMany.mock.calls[0][0].data;
    expect(rows).toEqual([
      expect.objectContaining({ serviceName: 'Carpet Cleaning', serviceTypeId: CARPET, isStructured: true }),
    ]);
  });

  it('keeps a stored id when the regenerated name differs only in case', async () => {
    mocks.requireProfile.mockResolvedValue({
      id: 'p1',
      name: 'Bees Friends Cleaners',
      category: 'House cleaning service',
      address: 'Portland, ME',
      googleAccountId: 'ga1',
      locationName: 'locations/123',
      googleLanguageCode: 'en-US',
    });

    const res = await POST(request(['Mattress Cleaning']));
    expect(res.status).toBe(200);

    const rows = mocks.tx.profileService.createMany.mock.calls[0][0].data;
    expect(rows).toEqual([
      expect.objectContaining({ serviceName: 'Mattress Cleaning', serviceTypeId: MATTRESS, isStructured: true }),
    ]);
  });
});

describe('reoptimize services POST saved rows', () => {
  it('replaces the whole saved set with the services sent', async () => {
    // The re-optimize editor pre-checks every saved service and sends every
    // one still checked, so a saved row left out is one the user unchecked:
    // replacing the set is how a service gets dropped.
    mocks.prisma.profileService.findMany.mockResolvedValue([
      { id: 'r1', serviceName: 'Mattress cleaning', serviceTypeId: MATTRESS },
      { id: 'r2', serviceName: 'Window washing', serviceTypeId: null },
    ]);

    const res = await POST(request(['Mattress Cleaning']));
    expect(res.status).toBe(200);

    expect(mocks.tx.profileService.deleteMany).toHaveBeenCalledTimes(1);
    expect(mocks.tx.profileService.deleteMany).toHaveBeenCalledWith({
      where: { profileId: 'cmppohric00ns17pa9poqsdry' },
    });
  });

  it.each([
    [['Drain cleaning', 'Drain cleaning']],
    [['Drain cleaning', 'DRAIN CLEANING']],
    // The generator matches names ignoring punctuation, so these would come
    // back as one service and one row would silently go missing.
    [['Drain-cleaning', 'Drain cleaning']],
  ])('answers 400, not 500, when a name is listed twice (%j)', async (names) => {
    const res = await POST(request(names));
    expect(res.status).toBe(400);

    const body = await res.json();
    expect(body.error).toMatch(/Drain.cleaning/);
    expect(mocks.generateServiceDescriptions).not.toHaveBeenCalled();
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled();
  });
});
