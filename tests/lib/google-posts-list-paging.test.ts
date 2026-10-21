import { describe, it, expect, vi, beforeEach } from 'vitest';

// listGBPPosts backs the publish worker's duplicate check. Google returns at
// most 100 posts a page, so a location with more than that must be read past
// the first page, but never without a bound.

const mocks = vi.hoisted(() => ({
  request: vi.fn(),
}));

vi.mock('@/lib/google', () => ({
  createGoogleClient: vi.fn().mockResolvedValue({ request: mocks.request }),
}));

const { listGBPPosts } = await import('@/lib/google-posts');

const PARAMS = {
  googleAccountId: 'ga1',
  accountResourceName: 'accounts/1',
  locationName: 'locations/2',
};

const post = (n: number) => ({
  name: `accounts/1/locations/2/localPosts/${n}`,
  summary: `Post ${n}`,
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe('listGBPPosts paging', () => {
  it('follows nextPageToken and returns every page', async () => {
    mocks.request.mockImplementation(async ({ url }: { url: string }) =>
      new URL(url).searchParams.get('pageToken') === 'page2'
        ? { data: { localPosts: [post(101)] } }
        : { data: { localPosts: [post(1)], nextPageToken: 'page2' } }
    );

    const posts = await listGBPPosts(PARAMS);

    expect(mocks.request).toHaveBeenCalledTimes(2);
    expect(posts.map((p) => p.name)).toEqual([post(1).name, post(101).name]);
  });

  it('stops after a bounded number of pages even if Google keeps paging', async () => {
    mocks.request.mockResolvedValue({
      data: { localPosts: [post(1)], nextPageToken: 'again' },
    });

    await listGBPPosts(PARAMS);

    expect(mocks.request.mock.calls.length).toBeGreaterThan(1);
    expect(mocks.request.mock.calls.length).toBeLessThanOrEqual(5);
  });
});
