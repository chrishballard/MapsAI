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
});

describe('syncLocationsForAccount disconnect sweep', () => {
  it('disconnects a profile Google stopped listing when the listing came back', async () => {
    listing({ 'accounts/1': ['locations/kept'] });
    mocks.findMany.mockResolvedValue([
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
    mocks.findMany.mockResolvedValue([
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
    mocks.findMany.mockResolvedValue([
      { id: 'p-a', accountResourceName: 'accounts/1' },
    ]);

    await syncLocationsForAccount('ga1');

    expect(disconnectedIds()).toEqual([]);
  });

  it("keeps a location group's profiles when that group comes back empty", async () => {
    listing({ 'accounts/1': ['locations/kept'], 'accounts/2': [] });
    mocks.findMany.mockResolvedValue([
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
    mocks.findMany.mockResolvedValue([
      { id: 'p-gone', accountResourceName: 'accounts/1' },
    ]);

    await expect(syncLocationsForAccount('ga1')).rejects.toThrow('backend error');

    expect(disconnectedIds()).toEqual([]);
  });
});
