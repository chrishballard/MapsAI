import { describe, it, expect, vi, beforeEach } from 'vitest';

// Photos and the logo have no v1 surface, so media:create stays on v4 like
// listGBPMedia and createGBPPost. Google fetches sourceUrl server-side, so an
// unreachable URL has to be caught before the call.

const mocks = vi.hoisted(() => ({
  request: vi.fn(),
  createGoogleClient: vi.fn(),
  prisma: {
    profile: { findUnique: vi.fn() },
    profileImage: { findFirst: vi.fn() },
  },
}));

vi.mock('@/lib/google', () => ({ createGoogleClient: mocks.createGoogleClient }));
vi.mock('@/lib/prisma', () => ({ prisma: mocks.prisma }));
vi.mock('@/lib/queue/image-caption-queue', () => ({
  enqueueCaptionsForProfile: vi.fn(),
}));

const {
  createGBPMedia,
  pushLogoToGBP,
  pushCoverPhotoToGBP,
  pushPhotoToGBP,
  pushLibraryImageToGBP,
} = await import('@/lib/google-media');

const target = {
  googleAccountId: 'ga1',
  accountResourceName: 'accounts/103088058873659208402',
  locationName: 'locations/8617399245086614454',
  sourceUrl: 'https://rankmaps.example.com/api/public/images/tok123',
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.request.mockResolvedValue({
    data: { name: 'accounts/103088058873659208402/locations/8617399245086614454/media/m9' },
  });
  mocks.createGoogleClient.mockResolvedValue({ request: mocks.request });
});

function sent() {
  expect(mocks.request).toHaveBeenCalledTimes(1);
  return mocks.request.mock.calls[0][0] as {
    url: string;
    method: string;
    data: Record<string, unknown>;
  };
}

describe('createGBPMedia', () => {
  it('POSTs to the v4 media collection under accounts/{a}/locations/{l}', async () => {
    const result = await createGBPMedia({ ...target, category: 'ADDITIONAL' });

    expect(result.success).toBe(true);
    expect(result.mediaName).toContain('/media/m9');
    const call = sent();
    expect(call.method).toBe('POST');
    expect(call.url).toBe(
      'https://mybusiness.googleapis.com/v4/accounts/103088058873659208402/locations/8617399245086614454/media'
    );
  });

  it('sends the category inside locationAssociation with a PHOTO format', async () => {
    await createGBPMedia({ ...target, category: 'ADDITIONAL' });

    expect(sent().data).toEqual({
      mediaFormat: 'PHOTO',
      locationAssociation: { category: 'ADDITIONAL' },
      sourceUrl: target.sourceUrl,
    });
  });

  it('refuses a sourceUrl Google cannot fetch, before calling out', async () => {
    const result = await createGBPMedia({
      ...target,
      sourceUrl: 'http://localhost:3000/api/public/images/tok123',
      category: 'ADDITIONAL',
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('public https URL');
    expect(mocks.request).not.toHaveBeenCalled();
  });

  it('never throws — a Google failure comes back as { success: false }', async () => {
    mocks.request.mockRejectedValue({
      response: {
        status: 400,
        data: {
          error: {
            status: 'INVALID_ARGUMENT',
            details: [{ fieldViolations: [{ field: 'source_url', description: 'Fetch failed' }] }],
          },
        },
      },
    });

    const result = await createGBPMedia({ ...target, category: 'COVER' });
    expect(result.success).toBe(false);
    expect(result.error).toContain('source_url: Fetch failed');
  });
});

describe('category wrappers', () => {
  // PROFILE is the profile photo Maps shows as the business avatar — what a
  // client means by "the logo". LOGO is a separate legacy category.
  it('pushLogoToGBP uses PROFILE', async () => {
    await pushLogoToGBP(target);
    expect(sent().data.locationAssociation).toEqual({ category: 'PROFILE' });
  });

  it('pushCoverPhotoToGBP uses COVER', async () => {
    await pushCoverPhotoToGBP(target);
    expect(sent().data.locationAssociation).toEqual({ category: 'COVER' });
  });

  it('pushPhotoToGBP defaults to ADDITIONAL', async () => {
    await pushPhotoToGBP(target);
    expect(sent().data.locationAssociation).toEqual({ category: 'ADDITIONAL' });
  });

  it('pushPhotoToGBP honours an explicit category', async () => {
    await pushPhotoToGBP({ ...target, category: 'AT_WORK' });
    expect(sent().data.locationAssociation).toEqual({ category: 'AT_WORK' });
  });
});

describe('pushLibraryImageToGBP', () => {
  beforeEach(() => {
    process.env.NEXTAUTH_URL = 'https://rankmaps.example.com';
    mocks.prisma.profile.findUnique.mockResolvedValue({
      googleAccountId: 'ga1',
      accountResourceName: 'accounts/1',
      locationName: 'locations/2',
    });
    mocks.prisma.profileImage.findFirst.mockResolvedValue({
      publicToken: 'tok123',
      googleUrl: null,
      thumbnailUrl: null,
    });
  });

  it('resolves the v4 parent and the image public URL from two ids', async () => {
    const result = await pushLibraryImageToGBP({
      profileId: 'p1',
      imageId: 'img1',
      category: 'PROFILE',
    });

    expect(result.success).toBe(true);
    const call = sent();
    expect(call.url).toContain('/v4/accounts/1/locations/2/media');
    expect(call.data.sourceUrl).toBe(
      'https://rankmaps.example.com/api/public/images/tok123'
    );
  });

  it('prefers the Google-hosted URL for a photo already synced from GBP', async () => {
    mocks.prisma.profileImage.findFirst.mockResolvedValue({
      publicToken: 'tok123',
      googleUrl: 'https://lh3.googleusercontent.com/m1',
      thumbnailUrl: 'https://lh3.googleusercontent.com/m1=s100',
    });

    await pushLibraryImageToGBP({ profileId: 'p1', imageId: 'img1', category: 'COVER' });
    expect(sent().data.sourceUrl).toBe('https://lh3.googleusercontent.com/m1');
  });

  it('fails cleanly when the profile has no accountResourceName', async () => {
    mocks.prisma.profile.findUnique.mockResolvedValue({
      googleAccountId: 'ga1',
      accountResourceName: null,
      locationName: 'locations/2',
    });

    const result = await pushLibraryImageToGBP({
      profileId: 'p1',
      imageId: 'img1',
      category: 'PROFILE',
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain('accountResourceName');
    expect(mocks.request).not.toHaveBeenCalled();
  });

  it('will not upload an image belonging to another profile', async () => {
    mocks.prisma.profileImage.findFirst.mockResolvedValue(null);

    const result = await pushLibraryImageToGBP({
      profileId: 'p1',
      imageId: 'img-other',
      category: 'PROFILE',
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain('not found');
    expect(mocks.request).not.toHaveBeenCalled();
  });
});
