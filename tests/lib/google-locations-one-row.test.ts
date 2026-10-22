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
  findUnique: vi.fn(),
  fetchGoogleProfileState: vi.fn(),
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
  fetchGoogleProfileState: mocks.fetchGoogleProfileState,
}));
vi.mock('@/lib/prisma', () => ({
  prisma: {
    profile: {
      upsert: mocks.upsert,
      update: mocks.update,
      updateMany: mocks.updateMany,
      findMany: mocks.findMany,
      findUnique: mocks.findUnique,
    },
  },
}));

const { syncLocationsForAccount } = await import('@/lib/google-locations');

type StoredRow = {
  id: string;
  googleAccountId: string;
  isConnected: boolean;
  googleAccount: { needsReauth: boolean };
};

const stored = (
  id: string,
  googleAccountId: string,
  isConnected: boolean,
  needsReauth = false
): StoredRow => ({ id, googleAccountId, isConnected, googleAccount: { needsReauth } });

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
  mocks.fetchGoogleProfileState.mockResolvedValue({
    description: '',
    serviceItems: [],
    languageCode: null,
  });
});

const duplicateLocation = () =>
  Object.assign(new Error('Unique constraint failed on the fields: (`locationName`)'), {
    code: 'P2002',
  });

/** Locations whose Google profile state was read back. */
const readBack = () =>
  mocks.fetchGoogleProfileState.mock.calls.map(([arg]) => arg.locationName);

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
        'locations/thrive': [stored('p-chris-thrive', 'chris', true)],
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
        'locations/maverick': [stored('p-chris-maverick', 'chris', false)],
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

  it('takes over a row held by a login whose grant was revoked', async () => {
    // A revoked login never syncs again (createGoogleClient throws), so its
    // rows stay "connected" with nobody able to post through them.
    setUp({
      locations: ['locations/gopro'],
      stored: { 'locations/gopro': [stored('p-diesel-gopro', 'diesel', true, true)] },
    });

    const synced = await syncLocationsForAccount('tyler');

    expect(rowWrites().adoptions).toEqual([
      {
        where: { id: 'p-diesel-gopro' },
        data: expect.objectContaining({ googleAccountId: 'tyler', isConnected: true }),
      },
    ]);
    expect(synced.map((p) => p.id)).toEqual(['p-diesel-gopro']);
  });

  it('keeps updating its own row of a pair made before the fix', async () => {
    setUp({
      locations: ['locations/blokk'],
      stored: {
        'locations/blokk': [
          stored('p-tyler-blokk', 'tyler', true),
          stored('p-chris-blokk', 'chris', true),
        ],
      },
    });

    await syncLocationsForAccount('chris');

    expect(rowWrites()).toEqual({ upserts: ['locations/blokk'], adoptions: [] });
  });

  it('leaves a location another login stored between the check and the write', async () => {
    // Two logins syncing at once can both find a new location unstored. The
    // unique index on locationName turns the second write into a P2002; that
    // login leaves the row where it is and carries on with the rest.
    setUp({ locations: ['locations/race', 'locations/next'] });
    mocks.upsert.mockRejectedValueOnce(duplicateLocation());
    mocks.findUnique.mockResolvedValue({ id: 'p-chris-race', googleAccountId: 'chris' });

    const synced = await syncLocationsForAccount('tyler');

    expect(synced.map((p) => p.id)).toEqual(['p-locations/next']);
    expect(rowWrites().upserts).toEqual(['locations/race', 'locations/next']);
    expect(mocks.findUnique).toHaveBeenCalledWith({ where: { locationName: 'locations/race' } });
    expect(readBack()).toEqual(['locations/next']);
    expect(mocks.updateMany).not.toHaveBeenCalled();
  });

  it('keeps a row its own login stored between the check and the write', async () => {
    // Two syncs of ONE login overlapping (Resync while a reconnect syncs):
    // the row the other sync just made is this login's own, so it counts as
    // synced. Skipping it would let the sweep below disconnect it.
    setUp({ locations: ['locations/race'] });
    mocks.upsert.mockRejectedValueOnce(duplicateLocation());
    mocks.findUnique.mockResolvedValue({ id: 'p-tyler-race', googleAccountId: 'tyler' });

    const synced = await syncLocationsForAccount('tyler');

    expect(synced.map((p) => p.id)).toEqual(['p-tyler-race']);
    expect(readBack()).toEqual(['locations/race']);
    expect(mocks.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { googleAccountId: 'tyler', isConnected: true, id: { notIn: ['p-tyler-race'] } },
      })
    );
  });

  it('still throws a write error that is not a duplicate location', async () => {
    setUp({ locations: ['locations/broken'] });
    mocks.upsert.mockRejectedValueOnce(Object.assign(new Error('db down'), { code: 'P1001' }));

    await expect(syncLocationsForAccount('tyler')).rejects.toThrow('db down');
  });

  it('still disconnects a vanished profile when every listed location is served elsewhere', async () => {
    // The group did answer (with a location another login holds), so it is
    // not an empty listing: this login's unlisted profile is gone.
    setUp({
      locations: ['locations/thrive'],
      stored: {
        'locations/thrive': [stored('p-chris-thrive', 'chris', true)],
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
