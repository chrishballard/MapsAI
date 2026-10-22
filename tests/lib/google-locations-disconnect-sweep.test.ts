import { describe, it, expect, vi, beforeEach } from 'vitest';

// The location sync marks a profile disconnected when Google stops listing
// it, and the publish worker then demotes that profile's due posts to DRAFT.
// So an empty listing (Google answering with nothing, for the login or for
// one location group that still holds connected profiles) must not
// disconnect anything it would have listed; only a listing that actually
// came back can prove a location is gone.

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

/** Give each account its locations; anything unlisted comes back empty. */
function listing(byAccount: Record<string, string[]>) {
  mocks.accountsList.mockResolvedValue({
    data: { accounts: Object.keys(byAccount).map((name) => ({ name })) },
  });
  mocks.locationsList.mockImplementation(async ({ parent }: { parent: string }) => ({
    data: {
      locations: (byAccount[parent] ?? []).map((name) => ({ name, title: name })),
    },
  }));
}

/**
 * The connected profiles the sweep finds unlisted. The per-location lookup
 * (is this location stored under another login?) finds nothing.
 */
function missingProfiles(rows: Array<Record<string, unknown>>) {
  mocks.findMany.mockImplementation(async ({ where }: { where: { locationName?: string } }) =>
    where.locationName ? [] : rows
  );
}

/** The ids the sweep set isConnected:false on, across every updateMany. */
function disconnectedIds(): string[] {
  return mocks.updateMany.mock.calls
    .map(([arg]) => arg as { where: { id?: { in?: string[] } }; data: { isConnected?: boolean } })
    .filter((arg) => arg.data.isConnected === false)
    .flatMap((arg) => arg.where.id?.in ?? ['<every unlisted profile>']);
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.upsert.mockImplementation(async ({ create }: { create: { locationName: string } }) => ({
    id: `p-${create.locationName}`,
    ...create,
  }));
  mocks.updateMany.mockResolvedValue({ count: 0 });
  // A direct read of a kept profile's location finds it, by default.
  mocks.locationsGet.mockImplementation(async ({ name }: { name: string }) => ({ data: { name } }));
});

function googleError(status: number) {
  return Object.assign(new Error(`HTTP ${status}`), { response: { status } });
}

describe('syncLocationsForAccount disconnect sweep', () => {
  it('disconnects a profile Google stopped listing when the listing came back', async () => {
    listing({ 'accounts/1': ['locations/kept'] });
    missingProfiles([
      { id: 'p-gone', accountResourceName: 'accounts/1' },
    ]);

    await syncLocationsForAccount('ga1');

    expect(mocks.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          googleAccountId: 'ga1',
          isConnected: true,
          id: { notIn: ['p-locations/kept'] },
        }),
      })
    );
    expect(disconnectedIds()).toEqual(['p-gone']);
  });

  it('disconnects nothing when Google lists no accounts at all', async () => {
    listing({});
    missingProfiles([
      { id: 'p-a', accountResourceName: 'accounts/1' },
      { id: 'p-b', accountResourceName: 'accounts/2' },
    ]);

    await syncLocationsForAccount('ga1');

    expect(disconnectedIds()).toEqual([]);
  });

  it('disconnects nothing when every account comes back with no locations', async () => {
    // The personal account answers, the location groups holding the
    // profiles are missing: still an empty listing for this login.
    listing({ 'accounts/personal': [] });
    missingProfiles([
      { id: 'p-a', accountResourceName: 'accounts/1' },
    ]);

    await syncLocationsForAccount('ga1');

    expect(disconnectedIds()).toEqual([]);
  });

  it("keeps a location group's profiles when that group comes back empty", async () => {
    listing({ 'accounts/1': ['locations/kept'], 'accounts/2': [] });
    missingProfiles([
      { id: 'p-gone', accountResourceName: 'accounts/1' },
      { id: 'p-in-empty-group', accountResourceName: 'accounts/2' },
    ]);

    await syncLocationsForAccount('ga1');

    // accounts/1 really listed, so its missing profile goes; accounts/2
    // listing nothing proves nothing about the profile stored under it.
    expect(disconnectedIds()).toEqual(['p-gone']);
  });

  it('disconnects nothing when a page of the listing fails', async () => {
    listing({ 'accounts/1': ['locations/kept'] });
    mocks.locationsList.mockRejectedValueOnce(new Error('backend error'));
    missingProfiles([
      { id: 'p-gone', accountResourceName: 'accounts/1' },
    ]);

    await expect(syncLocationsForAccount('ga1')).rejects.toThrow('backend error');

    expect(disconnectedIds()).toEqual([]);
  });

  describe('profiles kept because their listing came back empty', () => {
    // An empty listing proves nothing, but keeping those profiles forever
    // meant a client who took their only location out of the agency's group
    // stayed "connected" and kept getting AI posts that could never publish.
    // So each kept profile's own location is read directly: Google saying it
    // is gone (404) or not ours to read (403) disconnects it.
    beforeEach(() => {
      listing({ 'accounts/1': ['locations/kept'], 'accounts/2': [] });
    });

    it.each([404, 403])('disconnects one whose location read answers %i', async (status) => {
      missingProfiles([
        { id: 'p-left', accountResourceName: 'accounts/2', locationName: 'locations/left' },
      ]);
      mocks.locationsGet.mockRejectedValue(googleError(status));

      await syncLocationsForAccount('ga1');

      expect(mocks.locationsGet).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'locations/left' })
      );
      expect(disconnectedIds()).toEqual(['p-left']);
    });

    it('keeps one whose location Google still returns', async () => {
      missingProfiles([
        { id: 'p-here', accountResourceName: 'accounts/2', locationName: 'locations/here' },
      ]);

      await syncLocationsForAccount('ga1');

      expect(disconnectedIds()).toEqual([]);
    });

    it('keeps one when the read fails for any other reason', async () => {
      missingProfiles([
        { id: 'p-here', accountResourceName: 'accounts/2', locationName: 'locations/here' },
      ]);
      mocks.locationsGet.mockRejectedValue(googleError(503));

      await syncLocationsForAccount('ga1');

      expect(disconnectedIds()).toEqual([]);
    });

    it('checks the same way when the whole login listed nothing', async () => {
      listing({});
      missingProfiles([
        { id: 'p-left', accountResourceName: 'accounts/2', locationName: 'locations/left' },
        { id: 'p-here', accountResourceName: 'accounts/3', locationName: 'locations/here' },
      ]);
      mocks.locationsGet.mockImplementation(async ({ name }: { name: string }) => {
        if (name === 'locations/left') throw googleError(404);
        return { data: { name } };
      });

      await syncLocationsForAccount('ga1');

      expect(disconnectedIds()).toEqual(['p-left']);
    });
  });
});
