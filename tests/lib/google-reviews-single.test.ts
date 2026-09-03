import { describe, it, expect, vi, beforeEach } from 'vitest';

// fetchSingleReview tries the exact resource name, then the accounts/-
// wildcard. "The review is gone" is only established when BOTH say 404;
// any other mix is an ordinary error the caller retries.

const mocks = vi.hoisted(() => ({
  request: vi.fn(),
  createGoogleClient: vi.fn(),
}));

vi.mock('@/lib/google', () => ({ createGoogleClient: mocks.createGoogleClient }));

const { fetchSingleReview } = await import('@/lib/google-reviews');
const { ReviewNotFoundError, isReviewNotFound } = await import('@/lib/review-removal');

const name = 'accounts/103/locations/1/reviews/r1';

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  mocks.createGoogleClient.mockResolvedValue({ request: mocks.request });
});

describe('fetchSingleReview not-found detection', () => {
  it('throws a typed not-found when every endpoint answers 404', async () => {
    mocks.request.mockRejectedValue({ response: { status: 404 } });

    const err = await fetchSingleReview('ga1', name).catch((e) => e);

    expect(err).toBeInstanceOf(ReviewNotFoundError);
    expect(isReviewNotFound(err)).toBe(true);
    expect(mocks.request).toHaveBeenCalledTimes(2);
    expect(mocks.request.mock.calls[1][0].url).toContain('accounts/-/');
  });

  it('rethrows a plain error when only one endpoint said 404', async () => {
    mocks.request
      .mockRejectedValueOnce({ response: { status: 404 } })
      .mockRejectedValueOnce({ response: { status: 403 } });

    const err = await fetchSingleReview('ga1', name).catch((e) => e);

    expect(isReviewNotFound(err)).toBe(false);
    expect(err).toEqual({ response: { status: 403 } });
  });

  it('returns the review from the wildcard endpoint when the exact one fails', async () => {
    mocks.request
      .mockRejectedValueOnce({ response: { status: 404 } })
      .mockResolvedValueOnce({ data: { name, starRating: 'FIVE' } });

    await expect(fetchSingleReview('ga1', name)).resolves.toEqual({
      name,
      starRating: 'FIVE',
    });
  });
});
