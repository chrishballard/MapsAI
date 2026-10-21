import { describe, it, expect, vi, beforeEach } from 'vitest';

// The GBP media reconcile owns every Google-hosted library row: it must
// only delete a row when Google stopped returning the photo, survive two
// syncs of one profile racing each other, and never import a second copy
// of an upload the library itself pushed to the listing.

const mocks = vi.hoisted(() => ({
  prisma: {
    profile: { findUniqueOrThrow: vi.fn(), update: vi.fn() },
    profileImage: {
      findMany: vi.fn(),
      update: vi.fn(),
      createMany: vi.fn(),
      deleteMany: vi.fn(),
    },
    $transaction: vi.fn(async (ops: unknown[]) => ops),
  },
  request: vi.fn(),
  createGoogleClient: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({ prisma: mocks.prisma }));
vi.mock('@/lib/google', () => ({ createGoogleClient: mocks.createGoogleClient }));
vi.mock('@/lib/queue/image-caption-queue', () => ({
  enqueueCaptionsForProfile: vi.fn().mockResolvedValue(0),
}));

const { syncProfileMediaToLibrary } = await import('@/lib/google-media');

const M1 = 'accounts/1/locations/2/media/m1';

function photo(overrides: Record<string, unknown> = {}) {
  return {
    name: M1,
    mediaFormat: 'PHOTO',
    googleUrl: 'https://lh3.googleusercontent.com/m1',
    dimensions: { widthPixels: 800, heightPixels: 600 },
    ...overrides,
  };
}

function gbpRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'row1',
    source: 'GBP',
    googleMediaName: M1,
    googleUrl: 'https://lh3.googleusercontent.com/m1',
    thumbnailUrl: null,
    width: 800,
    height: 600,
    category: null,
    ...overrides,
  };
}

function googleReturns(mediaItems: unknown[]) {
  mocks.request.mockResolvedValue({ data: { mediaItems } });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.prisma.profile.findUniqueOrThrow.mockResolvedValue({
    id: 'p1',
    googleAccountId: 'ga1',
    accountResourceName: 'accounts/1',
    locationName: 'locations/2',
  });
  mocks.createGoogleClient.mockResolvedValue({ request: mocks.request });
  mocks.prisma.profileImage.findMany.mockResolvedValue([]);
  mocks.prisma.profileImage.createMany.mockImplementation(
    ({ data }: { data: unknown[] }) => ({ count: data.length })
  );
});

describe('stale-row removal', () => {
  it('keeps the row of a photo Google returned without a URL (a degraded read, not a deletion)', async () => {
    // Deleting it would throw away its caption, its usage history and the
    // public link scheduled posts were built with.
    mocks.prisma.profileImage.findMany.mockResolvedValue([gbpRow()]);
    googleReturns([photo({ googleUrl: undefined })]);

    const result = await syncProfileMediaToLibrary('p1');

    expect(mocks.prisma.profileImage.deleteMany).not.toHaveBeenCalled();
    expect(result.removed).toBe(0);
    // Nor is its stored URL overwritten with nothing.
    expect(mocks.prisma.profileImage.update).not.toHaveBeenCalled();
  });

  it('still removes the row of a photo Google no longer returns at all', async () => {
    mocks.prisma.profileImage.findMany.mockResolvedValue([gbpRow()]);
    googleReturns([photo({ name: 'accounts/1/locations/2/media/other' })]);

    const result = await syncProfileMediaToLibrary('p1');

    expect(mocks.prisma.profileImage.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ['row1'] } },
    });
    expect(result.removed).toBe(1);
  });

  it('removes nothing when Google returns no photos at all', async () => {
    // An empty list for a profile we hold photos for is indistinguishable
    // from an API hiccup, and deleting on it would lose every row's caption,
    // usage history and public link in one sync.
    mocks.prisma.profileImage.findMany.mockResolvedValue([gbpRow()]);
    googleReturns([]);

    const result = await syncProfileMediaToLibrary('p1');

    expect(mocks.prisma.profileImage.deleteMany).not.toHaveBeenCalled();
    expect(result.removed).toBe(0);
  });
});

describe('two syncs of one profile at once', () => {
  it('inserts with skipDuplicates, so the slower sync does not roll back on P2002', async () => {
    googleReturns([photo()]);

    await syncProfileMediaToLibrary('p1');

    expect(mocks.prisma.profileImage.createMany).toHaveBeenCalledWith(
      expect.objectContaining({ skipDuplicates: true })
    );
  });

  it('reports only the rows it actually inserted', async () => {
    googleReturns([photo()]);
    // The other sync inserted this photo first.
    mocks.prisma.profileImage.createMany.mockReturnValue({ count: 0 });

    const result = await syncProfileMediaToLibrary('p1');

    expect(result.added).toBe(0);
  });
});

describe('library uploads pushed to the listing', () => {
  // pushLibraryImageToGBP records the media name Google gave the upload.
  const upload = {
    id: 'up1',
    source: 'TEAM',
    googleMediaName: M1,
    googleUrl: null,
    thumbnailUrl: null,
    width: 1200,
    height: 900,
    category: null,
  };

  beforeEach(() => {
    // A query that asks for GBP rows only cannot see the upload.
    mocks.prisma.profileImage.findMany.mockImplementation(
      async ({ where }: { where: { source?: string } }) =>
        where.source === 'GBP' ? [] : [upload]
    );
  });

  it('does not import a second APPROVED row for the same photo', async () => {
    googleReturns([photo()]);

    const result = await syncProfileMediaToLibrary('p1');

    expect(mocks.prisma.profileImage.createMany).not.toHaveBeenCalled();
    expect(result.added).toBe(0);
    // The upload is not treated as a Google row either.
    expect(mocks.prisma.profileImage.update).not.toHaveBeenCalled();
  });

  it('never deletes the upload when its Google copy goes away', async () => {
    googleReturns([]);

    await syncProfileMediaToLibrary('p1');

    expect(mocks.prisma.profileImage.deleteMany).not.toHaveBeenCalled();
  });
});
