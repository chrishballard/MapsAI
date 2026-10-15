import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from 'vitest';

// Google localizes structured service type names into the location's own
// language, and a location's languageCode cannot be changed through the API
// (a PATCH answers 400 "cannot be updated"). The Bees Friends Cleaners
// Portland profile is es-419, so Google calls its mattress cleaning type
// "Limpieza de colchones". Matching a stored title against that display name
// meant an English title pushed as a custom service. The push must resolve a
// row by the service type id it stored, and fall back to the display name
// only when it has none (or the stored id is no longer valid).

const mocks = vi.hoisted(() => ({
  prisma: {
    profile: { findUnique: vi.fn() },
    profileService: { findMany: vi.fn(), updateMany: vi.fn(), update: vi.fn() },
  },
  fetchCurrentServices: vi.fn(),
  fetchStructuredServices: vi.fn(),
  fetchCategoryId: vi.fn(),
  pushServicesToGBP: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({ prisma: mocks.prisma }));
vi.mock('@/lib/google-business-info', () => ({
  fetchCurrentServices: mocks.fetchCurrentServices,
  fetchStructuredServices: mocks.fetchStructuredServices,
  fetchCategoryId: mocks.fetchCategoryId,
  pushServicesToGBP: mocks.pushServicesToGBP,
}));

const { pushApprovedServices } = await import('@/lib/profile-services');

const MATTRESS = 'job_type_id:mattress_cleaning';
const CARPET = 'job_type_id:carpet_cleaning';

const spanishCatalog = [
  { serviceTypeId: MATTRESS, displayName: 'Limpieza de colchones' },
  { serviceTypeId: CARPET, displayName: 'Limpieza de alfombras' },
];

const englishCatalog = [
  { serviceTypeId: MATTRESS, displayName: 'Mattress cleaning' },
  { serviceTypeId: CARPET, displayName: 'Carpet cleaning' },
];

function profile(googleLanguageCode: string | null) {
  return {
    id: 'p1',
    name: 'Bees Friends Cleaners',
    googleAccountId: 'ga1',
    locationName: 'locations/123',
    category: 'Servicio de limpieza',
    googleLanguageCode,
  };
}

function row(serviceName: string, serviceTypeId: string | null, description = `About ${serviceName}.`) {
  return {
    id: `svc-${serviceName}`,
    profileId: 'p1',
    serviceName,
    serviceTypeId,
    description,
    isStructured: true,
    isApproved: true,
    isPushed: false,
    pushedAt: null,
  };
}

function pushedItems(): Array<Record<string, unknown>> {
  return mocks.pushServicesToGBP.mock.calls[0][0].serviceItems;
}

/** serviceTypeId writes the push made, as { rowId: serviceTypeId }. */
function idWrites(): Record<string, string | null> {
  return Object.fromEntries(
    mocks.prisma.profileService.update.mock.calls.map(([args]) => [
      args.where.id,
      args.data.serviceTypeId,
    ])
  );
}

let warn: MockInstance<typeof console.warn>;

beforeEach(() => {
  vi.clearAllMocks();
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'log').mockImplementation(() => {});
  mocks.prisma.profile.findUnique.mockResolvedValue(profile('es-419'));
  mocks.prisma.profileService.updateMany.mockResolvedValue({ count: 1 });
  mocks.prisma.profileService.update.mockResolvedValue({});
  mocks.fetchCurrentServices.mockResolvedValue({ serviceItems: [] });
  mocks.fetchStructuredServices.mockResolvedValue(spanishCatalog);
  mocks.fetchCategoryId.mockResolvedValue('categories/gcid:house_cleaning_service');
  mocks.pushServicesToGBP.mockResolvedValue({ success: true });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('pushApprovedServices matches by stored service type id', () => {
  it('pushes an English title on a Spanish-language profile as the structured type its id names', async () => {
    mocks.prisma.profileService.findMany.mockResolvedValue([
      row('Mattress cleaning', MATTRESS, 'Deep mattress cleaning in Portland.'),
    ]);

    const result = await pushApprovedServices('p1');

    expect(result).toEqual({ success: true, pushedCount: 1 });
    expect(pushedItems()).toEqual([
      {
        structuredServiceItem: {
          serviceTypeId: MATTRESS,
          description: 'Deep mattress cleaning in Portland.',
        },
      },
    ]);
  });

  it('replaces the live structured item in merge mode instead of adding a custom one beside it', async () => {
    mocks.fetchCurrentServices.mockResolvedValue({
      serviceItems: [
        { structuredServiceItem: { serviceTypeId: MATTRESS, description: 'Limpieza profunda.' } },
        { freeFormServiceItem: { category: 'x', label: { displayName: 'Window washing' } } },
      ],
    });
    mocks.prisma.profileService.findMany.mockResolvedValue([
      row('Mattress cleaning', MATTRESS, 'Deep mattress cleaning in Portland.'),
    ]);

    await pushApprovedServices('p1', { merge: true });

    expect(pushedItems()).toEqual([
      {
        structuredServiceItem: {
          serviceTypeId: MATTRESS,
          description: 'Deep mattress cleaning in Portland.',
        },
      },
      { freeFormServiceItem: { category: 'x', label: { displayName: 'Window washing' } } },
    ]);
  });

  it('trusts a stored id Google already holds on the live list even when the catalog lacks it', async () => {
    const ADDITIONAL = 'job_type_id:upholstery_cleaning';
    mocks.fetchCurrentServices.mockResolvedValue({
      serviceItems: [{ structuredServiceItem: { serviceTypeId: ADDITIONAL } }],
    });
    mocks.prisma.profileService.findMany.mockResolvedValue([
      row('Upholstery cleaning', ADDITIONAL),
    ]);

    await pushApprovedServices('p1', { merge: true });

    expect(pushedItems()).toEqual([
      {
        structuredServiceItem: {
          serviceTypeId: ADDITIONAL,
          description: 'About Upholstery cleaning.',
        },
      },
    ]);
  });

  it('falls back to the display name when the stored id is not valid for the profile', async () => {
    mocks.prisma.profileService.findMany.mockResolvedValue([
      row('Limpieza de alfombras', 'job_type_id:retired_type'),
    ]);

    await pushApprovedServices('p1');

    expect(pushedItems()).toEqual([
      {
        structuredServiceItem: {
          serviceTypeId: CARPET,
          description: 'About Limpieza de alfombras.',
        },
      },
    ]);
    expect(idWrites()).toEqual({ 'svc-Limpieza de alfombras': CARPET });
  });

  it('pushes a free-form item when neither the id nor the name resolves', async () => {
    mocks.prisma.profileService.findMany.mockResolvedValue([
      row('Move-out cleaning', 'job_type_id:retired_type'),
    ]);

    await pushApprovedServices('p1');

    expect(pushedItems()).toEqual([
      {
        freeFormServiceItem: {
          category: 'categories/gcid:house_cleaning_service',
          label: { displayName: 'Move-out cleaning', description: 'About Move-out cleaning.' },
        },
      },
    ]);
    // The row is a custom service on Google now, so it no longer claims a type
    expect(idWrites()).toEqual({ 'svc-Move-out cleaning': null });
  });
});

describe('pushApprovedServices on an English profile with no stored ids', () => {
  beforeEach(() => {
    mocks.prisma.profile.findUnique.mockResolvedValue(profile('en-US'));
    mocks.fetchStructuredServices.mockResolvedValue(englishCatalog);
  });

  it('matches by display name, case-insensitively, as before', async () => {
    mocks.prisma.profileService.findMany.mockResolvedValue([
      row('MATTRESS CLEANING', null),
      row('Move-out cleaning', null),
    ]);

    await pushApprovedServices('p1');

    expect(pushedItems()).toEqual([
      {
        structuredServiceItem: {
          serviceTypeId: MATTRESS,
          description: 'About MATTRESS CLEANING.',
        },
      },
      {
        freeFormServiceItem: {
          category: 'categories/gcid:house_cleaning_service',
          label: { displayName: 'Move-out cleaning', description: 'About Move-out cleaning.' },
        },
      },
    ]);
  });

  it('records the id it resolved, so a later rename or language change still finds the type', async () => {
    mocks.prisma.profileService.findMany.mockResolvedValue([
      row('Mattress cleaning', null),
      row('Move-out cleaning', null),
      row('Carpet cleaning', CARPET),
    ]);

    await pushApprovedServices('p1');

    // Only rows whose stored id changed are written
    expect(idWrites()).toEqual({ 'svc-Mattress cleaning': MATTRESS });
  });

  it('records nothing when the push to Google fails', async () => {
    mocks.pushServicesToGBP.mockResolvedValue({ success: false, error: 'boom' });
    mocks.prisma.profileService.findMany.mockResolvedValue([row('Mattress cleaning', null)]);

    const result = await pushApprovedServices('p1');

    expect(result.success).toBe(false);
    expect(mocks.prisma.profileService.update).not.toHaveBeenCalled();
  });
});

describe('pushApprovedServices language warning', () => {
  beforeEach(() => {
    mocks.prisma.profileService.findMany.mockResolvedValue([row('Mattress cleaning', MATTRESS)]);
  });

  it('warns when the profile language is not English', async () => {
    await pushApprovedServices('p1');

    const messages = warn.mock.calls.map((c) => c.join(' '));
    expect(messages.some((m) => m.includes('es-419') && m.includes('p1'))).toBe(true);
  });

  it.each(['en', 'en-US', 'en-GB', null])('stays quiet for %s', async (code) => {
    mocks.prisma.profile.findUnique.mockResolvedValue(profile(code));

    await pushApprovedServices('p1');

    expect(warn.mock.calls.some((c) => c.join(' ').includes('language'))).toBe(false);
  });
});
