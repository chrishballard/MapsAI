import { describe, it, expect, vi, beforeEach } from 'vitest';

// A location's resource name is Google's and global; a Profile row was unique
// per (login, location). When two agency logins could both manage a
// location, each login's sync made its own row, and both copies could be
// onboarded, post and reply. Ten locations were stored twice by 2026-10-22;
// Blokk's two copies each posted on the same four days in April 2026. The
// sync now keeps one row per location.

const mocks = vi.hoisted(() => ({
  accountsList: vi.fn(),
  locationsList: vi.fn(),
  locationsGet: vi.fn(),
  upsert: vi.fn(),
  update: vi.fn(),
  updateMany: vi.fn(),
  findMany: vi.fn(),
}));

vi.mock('googleapis', () => ({
  google: {
    mybusinessaccountmanagement: () => ({ accounts: { list: mocks.accountsList } }),
    mybusinessbusinessinformation: () => ({
      accounts: { locations: { list: mocks.locationsList } },
      locations: { get: mocks.locationsGet },
    }),
  },
}));
vi.mock('@/lib/google', () => ({ createGoogleClient: vi.fn().mockResolvedValue({}) }));
vi.mock('@/lib/google-business-info', () => ({
  fetchGoogleProfileState: vi
    .fn()
    .mockResolvedValue({ description: '', serviceItems: [], languageCode: null }),
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

const { syncLocationsForAccount } = await import('@/lib/google-locations');

type StoredRow = { id: string; googleAccountId: string; isConnected: boolean };

/**
 * Google lists `locations` for this login; `stored` is what the database
 * already holds per location, `missing` what the disconnect sweep finds.
 */
function setUp(opts: {
  locations: string[];
  stored?: Record<string, StoredRow[]>;
  missing?: Array<{ id: string; accountResourceName: string; locationName?: string }>;
}) {
  mocks.accountsList.mockResolvedValue({ data: { accounts: [{ name: 'accounts/1' }] } });
  mocks.locationsList.mockResolvedValue({
    data: { locations: opts.locations.map((name) => ({ name, title: name })) },
  });
  mocks.findMany.mockImplementation(async ({ where }: { where: { locationName?: string } }) =>
    where.locationName ? (opts.stored?.[where.locationName] ?? []) : (opts.missing ?? [])
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.upsert.mockImplementation(async ({ create }: { create: { locationName: string } }) => ({
    id: `p-${create.locationName}`,
    ...create,
  }));
  mocks.update.mockImplementation(async ({ where, data }: { where: { id: string }; data: object }) => ({
    id: where.id,
    ...data,
  }));
  mocks.updateMany.mockResolvedValue({ count: 0 });
  mocks.locationsGet.mockImplementation(async ({ name }: { name: string }) => ({ data: { name } }));
});

/** Writes that touched the Profile row itself (not the Google-state read-back). */
function rowWrites() {
  return {
    upserts: mocks.upsert.mock.calls.map(([arg]) => arg.where.googleAccountId_locationName.locationName),
    adoptions: mocks.update.mock.calls
      .map(([arg]) => arg)
      .filter((arg) => 'googleAccountId' in arg.data),
  };
}

describe('syncLocationsForAccount keeps one row per Google location', () => {
  it('creates the row for a location nobody stores yet', async () => {
    setUp({ locations: ['locations/new'] });

    const synced = await syncLocationsForAccount('tyler');

    expect(rowWrites().upserts).toEqual(['locations/new']);
    expect(synced.map((p) => p.id)).toEqual(['p-locations/new']);
  });

  it('leaves a location stored under another login that still has it', async () => {
    setUp({
      locations: ['locations/thrive'],
      stored: {
        'locations/thrive': [{ id: 'p-chris-thrive', googleAccountId: 'chris', isConnected: true }],
      },
    });

    const synced = await syncLocationsForAccount('tyler');

    expect(rowWrites()).toEqual({ upserts: [], adoptions: [] });
    expect(synced).toEqual([]);
  });

  it('takes over the row once the login that had it lost it', async () => {
    setUp({
      locations: ['locations/maverick'],
      stored: {
        'locations/maverick': [{ id: 'p-chris-maverick', googleAccountId: 'chris', isConnected: false }],
      },
    });

    const synced = await syncLocationsForAccount('tyler');

    const { upserts, adoptions } = rowWrites();
    expect(upserts).toEqual([]);
    expect(adoptions).toEqual([
      {
        where: { id: 'p-chris-maverick' },
        data: expect.objectContaining({ googleAccountId: 'tyler', isConnected: true }),
      },
    ]);
    expect(synced.map((p) => p.id)).toEqual(['p-chris-maverick']);
    // The onboarded copy is the one taken over when there are several.
    expect(mocks.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { locationName: 'locations/maverick' },
        orderBy: [{ isOnboarded: 'desc' }, { updatedAt: 'desc' }],
      })
    );
  });

  it('keeps updating its own row of a pair made before the fix', async () => {
    setUp({
      locations: ['locations/blokk'],
      stored: {
        'locations/blokk': [
          { id: 'p-tyler-blokk', googleAccountId: 'tyler', isConnected: true },
          { id: 'p-chris-blokk', googleAccountId: 'chris', isConnected: true },
        ],
      },
    });

    await syncLocationsForAccount('chris');

    expect(rowWrites()).toEqual({ upserts: ['locations/blokk'], adoptions: [] });
  });

  it('still disconnects a vanished profile when every listed location is served elsewhere', async () => {
    // The group did answer (with a location another login holds), so it is
    // not an empty listing: this login's unlisted profile is gone.
    setUp({
      locations: ['locations/thrive'],
      stored: {
        'locations/thrive': [{ id: 'p-chris-thrive', googleAccountId: 'chris', isConnected: true }],
      },
      missing: [{ id: 'p-tyler-gone', accountResourceName: 'accounts/1', locationName: 'locations/gone' }],
    });

    await syncLocationsForAccount('tyler');

    expect(mocks.updateMany).toHaveBeenCalledWith({
      where: { googleAccountId: 'tyler', id: { in: ['p-tyler-gone'] } },
      data: { isConnected: false },
    });
    expect(mocks.locationsGet).not.toHaveBeenCalled();
  });
});
