import { describe, it, expect, vi, beforeEach } from 'vitest';

// GBP media sync is the one place all Google-hosted images enter (or
// re-enter) the library, so it enqueues captions for anything approved and
// uncaptioned after every reconcile — including photos that were deleted
// from GBP and came back as brand-new rows. A queue problem must never fail
// the sync itself.

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
  createGoogleClient: vi.fn(),
  enqueueCaptionsForProfile: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({ prisma: mocks.prisma }));
vi.mock('@/lib/google', () => ({ createGoogleClient: mocks.createGoogleClient }));
vi.mock('@/lib/queue/image-caption-queue', () => ({
  enqueueCaptionsForProfile: mocks.enqueueCaptionsForProfile,
}));

const { syncProfileMediaToLibrary } = await import('@/lib/google-media');

beforeEach(() => {
  vi.clearAllMocks();
  mocks.prisma.profile.findUniqueOrThrow.mockResolvedValue({
    id: 'p1',
    googleAccountId: 'ga1',
    accountResourceName: 'accounts/1',
    locationName: 'locations/2',
  });
  mocks.createGoogleClient.mockResolvedValue({
    request: vi.fn().mockResolvedValue({
      data: {
        mediaItems: [
          {
            name: 'accounts/1/locations/2/media/m1',
            mediaFormat: 'PHOTO',
            googleUrl: 'https://lh3.googleusercontent.com/m1',
            dimensions: { widthPixels: 800, heightPixels: 600 },
          },
        ],
      },
    }),
  });
  mocks.prisma.profileImage.findMany.mockResolvedValue([]);
  mocks.enqueueCaptionsForProfile.mockResolvedValue(1);
});

describe('syncProfileMediaToLibrary caption hook', () => {
  it('enqueues captions for the profile after the reconcile', async () => {
    const result = await syncProfileMediaToLibrary('p1');

    expect(result).toMatchObject({ added: 1 });
    expect(mocks.enqueueCaptionsForProfile).toHaveBeenCalledWith('p1');
    // The enqueue runs after the reconcile transaction committed.
    expect(mocks.prisma.$transaction).toHaveBeenCalled();
  });

  it('sync still succeeds when the caption enqueue blows up', async () => {
    mocks.enqueueCaptionsForProfile.mockRejectedValue(new Error('redis down'));

    const result = await syncProfileMediaToLibrary('p1');

    expect(result).toMatchObject({ added: 1, total: 1 });
  });
});
