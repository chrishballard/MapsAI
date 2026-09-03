import { describe, it, expect } from 'vitest';
import { normalizeReviewKey, reviewResourceName } from '@/lib/review-key';

// The account segment of a GBP review resource name is mutable: the API
// returns the real account id from one endpoint and the `accounts/-`
// wildcard from another. Identity lives in the locations/.../reviews/...
// suffix.

describe('normalizeReviewKey', () => {
  it('strips a real account id', () => {
    expect(
      normalizeReviewKey('accounts/117021863248044506375/locations/171548/reviews/AbFvOqm')
    ).toBe('locations/171548/reviews/AbFvOqm');
  });

  it('strips the wildcard account', () => {
    expect(normalizeReviewKey('accounts/-/locations/171548/reviews/AbFvOqm')).toBe(
      'locations/171548/reviews/AbFvOqm'
    );
  });

  it('leaves an already-normalized key alone', () => {
    expect(normalizeReviewKey('locations/171548/reviews/AbFvOqm')).toBe(
      'locations/171548/reviews/AbFvOqm'
    );
  });

  it('maps both forms of the same review to the same key', () => {
    const a = normalizeReviewKey('accounts/103088058873659208402/locations/9/reviews/X');
    const b = normalizeReviewKey('accounts/-/locations/9/reviews/X');
    expect(a).toBe(b);
  });
});

describe('reviewResourceName', () => {
  it("builds the full name from the profile's current account", () => {
    expect(
      reviewResourceName('accounts/103088058873659208402', 'locations/9/reviews/X')
    ).toBe('accounts/103088058873659208402/locations/9/reviews/X');
  });

  it('falls back to the wildcard account when the profile has none', () => {
    expect(reviewResourceName(null, 'locations/9/reviews/X')).toBe(
      'accounts/-/locations/9/reviews/X'
    );
  });
});
