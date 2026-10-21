import { describe, it, expect, vi, beforeEach } from 'vitest';

// Google reports a search keyword's monthly impressions either as an exact
// `value` or, for low-volume keywords, only as a `threshold` ("fewer than
// N"). The threshold is an upper bound, not a count: storing it as the
// impression count ranks every long-tail keyword at the threshold and lets
// them outscore keywords with real numbers in the top-keyword lists.

const mocks = vi.hoisted(() => ({
  monthlyList: vi.fn(),
}));

vi.mock('googleapis', () => ({
  google: {
    businessprofileperformance: () => ({
      locations: { searchkeywords: { impressions: { monthly: { list: mocks.monthlyList } } } },
    }),
  },
}));
vi.mock('@/lib/google', () => ({ createGoogleClient: vi.fn().mockResolvedValue({}) }));

const { fetchSearchKeywords } = await import('@/lib/google-keywords');

const MONTH = new Date(Date.UTC(2026, 8, 1));

beforeEach(() => {
  vi.clearAllMocks();
});

describe('fetchSearchKeywords', () => {
  it('keeps exact values and leaves out threshold-only keywords', async () => {
    mocks.monthlyList.mockResolvedValue({
      data: {
        searchKeywordsCounts: [
          { searchKeyword: 'gutter cleaning', insightsValue: { value: '240' } },
          { searchKeyword: 'gutter guards near me', insightsValue: { threshold: '15' } },
          { searchKeyword: 'badger gutters', insightsValue: { value: '0' } },
        ],
      },
    });

    const keywords = await fetchSearchKeywords('ga1', '123', MONTH, MONTH);

    expect(keywords).toEqual([
      { keyword: 'gutter cleaning', impressions: 240 },
      { keyword: 'badger gutters', impressions: 0 },
    ]);
  });

  it('reads every page', async () => {
    mocks.monthlyList.mockImplementation(async ({ pageToken }: { pageToken?: string }) =>
      pageToken === 'p2'
        ? { data: { searchKeywordsCounts: [{ searchKeyword: 'b', insightsValue: { value: '5' } }] } }
        : {
            data: {
              searchKeywordsCounts: [{ searchKeyword: 'a', insightsValue: { value: '9' } }],
              nextPageToken: 'p2',
            },
          }
    );

    const keywords = await fetchSearchKeywords('ga1', '123', MONTH, MONTH);

    expect(keywords.map((k) => k.keyword)).toEqual(['a', 'b']);
  });
});
