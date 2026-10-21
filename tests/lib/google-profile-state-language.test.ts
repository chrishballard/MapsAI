import { describe, it, expect, vi, beforeEach } from 'vitest';

// A location's languageCode decides what language Google speaks to RankMaps
// in (service type names, category names). It cannot be changed through the
// API, so RankMaps reads it with the rest of the profile state and stores it,
// to warn on a push and flag the profile in the UI.

const mocks = vi.hoisted(() => ({
  request: vi.fn(),
  accountsList: vi.fn(),
  locationsList: vi.fn(),
  upsert: vi.fn(),
  update: vi.fn(),
  updateMany: vi.fn(),
  findMany: vi.fn(),
}));

vi.mock('@/lib/google', () => ({
  createGoogleClient: vi.fn().mockResolvedValue({ request: mocks.request }),
}));
vi.mock('googleapis', () => ({
  google: {
    mybusinessaccountmanagement: () => ({ accounts: { list: mocks.accountsList } }),
    mybusinessbusinessinformation: () => ({
      accounts: { locations: { list: mocks.locationsList } },
    }),
  },
}));
vi.mock('@/lib/prisma', () => ({
  prisma: {
    profile: {
      upsert: mocks.upsert,
      update: mocks.update,
      updateMany: mocks.updateMany,
      findMany: mocks.findMany,
    },
  },
}));

const { fetchGoogleProfileState } = await import('@/lib/google-business-info');
const { syncLocationsForAccount } = await import('@/lib/google-locations');
const { isNonEnglishLanguageCode } = await import('@/lib/copy-language');

beforeEach(() => {
  vi.clearAllMocks();
  mocks.request.mockResolvedValue({
    data: {
      languageCode: 'es-419',
      profile: { description: 'Limpieza profesional.' },
      serviceItems: [],
    },
  });
  mocks.accountsList.mockResolvedValue({ data: { accounts: [{ name: 'accounts/1' }] } });
  mocks.locationsList.mockResolvedValue({
    data: { locations: [{ name: 'locations/123', title: 'Bees Friends Cleaners' }] },
  });
  mocks.upsert.mockImplementation(async ({ create }: { create: { locationName: string } }) => ({
    id: 'p1',
    ...create,
  }));
  mocks.findMany.mockResolvedValue([]);
});

describe('fetchGoogleProfileState language', () => {
  it('asks Google for languageCode in the same read and returns it', async () => {
    const state = await fetchGoogleProfileState({
      googleAccountId: 'ga1',
      locationName: 'locations/123',
    });

    const url = new URL(mocks.request.mock.calls[0][0].url);
    expect(url.searchParams.get('readMask')?.split(',')).toEqual(
      expect.arrayContaining(['profile', 'serviceItems', 'languageCode'])
    );
    expect(state.languageCode).toBe('es-419');
  });

  it('returns null when Google sends no languageCode', async () => {
    mocks.request.mockResolvedValue({ data: {} });

    const state = await fetchGoogleProfileState({
      googleAccountId: 'ga1',
      locationName: 'locations/123',
    });

    expect(state.languageCode).toBeNull();
  });
});

describe('syncLocationsForAccount language', () => {
  it('stores the location language on the profile', async () => {
    await syncLocationsForAccount('ga1');

    expect(mocks.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'p1' },
        data: expect.objectContaining({ googleLanguageCode: 'es-419' }),
      })
    );
  });

  it('keeps the stored language when Google sends none', async () => {
    // A read that omits languageCode says nothing about the language; writing
    // null would erase a stored es-419 and drop the non-English guard.
    mocks.request.mockResolvedValue({
      data: { profile: { description: 'Limpieza profesional.' }, serviceItems: [] },
    });

    await syncLocationsForAccount('ga1');

    expect(mocks.update).toHaveBeenCalledTimes(1);
    const { data } = mocks.update.mock.calls[0][0] as { data: Record<string, unknown> };
    expect(data).not.toHaveProperty('googleLanguageCode');
    expect(data).toMatchObject({ googleDescription: 'Limpieza profesional.' });
  });
});

describe('isNonEnglishLanguageCode', () => {
  it.each([
    ['es-419', true],
    ['es', true],
    ['fr-CA', true],
    ['en', false],
    ['en-US', false],
    ['en-GB', false],
    ['EN-us', false],
    [null, false],
    [undefined, false],
    ['', false],
  ])('%s -> %s', (code, expected) => {
    expect(isNonEnglishLanguageCode(code)).toBe(expected);
  });
});
