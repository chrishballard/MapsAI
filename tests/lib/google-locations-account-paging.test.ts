import { describe, it, expect, vi, beforeEach } from 'vitest';

// accounts.list caps a page at 20 accounts. A login in more than 20 location
// groups must still have every group's locations synced, and must not have
// them swept to disconnected for sitting on page 2.

const mocks = vi.hoisted(() => ({
  accountsList: vi.fn(),
  locationsList: vi.fn(),
  upsert: vi.fn(),
  update: vi.fn(),
  updateMany: vi.fn(),
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
  fetchGoogleProfileState: vi.fn().mockResolvedValue({ description: '', serviceItems: [] }),
}));
vi.mock('@/lib/prisma', () => ({
  prisma: {
    profile: { upsert: mocks.upsert, update: mocks.update, updateMany: mocks.updateMany },
  },
}));

const { syncLocationsForAccount } = await import('@/lib/google-locations');

const acct = (n: number) => ({ name: `accounts/${n}`, accountName: `Group ${n}` });

beforeEach(() => {
  vi.clearAllMocks();
  // Page 1: accounts 1-20. Page 2: account 21, the one holding the location.
  mocks.accountsList.mockImplementation(async ({ pageToken }: { pageToken?: string }) =>
    pageToken === 'p2'
      ? { data: { accounts: [acct(21)] } }
      : { data: { accounts: Array.from({ length: 20 }, (_, i) => acct(i + 1)), nextPageToken: 'p2' } }
  );
  mocks.locationsList.mockImplementation(async ({ parent }: { parent: string }) =>
    parent === 'accounts/21'
      ? { data: { locations: [{ name: 'locations/miami', title: 'Bolder Apps Miami' }] } }
      : { data: { locations: [] } }
  );
  mocks.upsert.mockImplementation(async ({ create }: { create: { locationName: string } }) => ({
    id: `p-${create.locationName}`,
    ...create,
  }));
});

describe('syncLocationsForAccount account paging', () => {
  it('reads every page of accounts and syncs locations under account 21', async () => {
    const synced = await syncLocationsForAccount('ga1');

    expect(mocks.accountsList).toHaveBeenCalledTimes(2);
    expect(mocks.accountsList.mock.calls[1][0]).toMatchObject({ pageToken: 'p2' });
    expect(mocks.locationsList).toHaveBeenCalledWith(
      expect.objectContaining({ parent: 'accounts/21' })
    );
    expect(synced.map((p) => p.locationName)).toEqual(['locations/miami']);
    expect(mocks.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { googleAccountId: 'ga1', id: { notIn: ['p-locations/miami'] } },
      })
    );
  });
});
