import { describe, it, expect } from 'vitest';
import {
  replyModeForRating,
  ratingNotIgnoredFilter,
  REPLY_MODE_FIELDS,
  STAR_RATINGS,
} from '@/lib/review-reply-mode';

const profile = {
  reviewReplyMode1: 'IGNORE',
  reviewReplyMode2: 'DRAFT',
  reviewReplyMode3: 'DRAFT',
  reviewReplyMode4: 'AUTO',
  reviewReplyMode5: 'AUTO',
} as const;

describe('replyModeForRating', () => {
  it('returns the mode for each star rating', () => {
    expect(replyModeForRating(profile, 1)).toBe('IGNORE');
    expect(replyModeForRating(profile, 2)).toBe('DRAFT');
    expect(replyModeForRating(profile, 3)).toBe('DRAFT');
    expect(replyModeForRating(profile, 4)).toBe('AUTO');
    expect(replyModeForRating(profile, 5)).toBe('AUTO');
  });

  it('clamps out-of-range ratings instead of crashing', () => {
    expect(replyModeForRating(profile, 0)).toBe('IGNORE');
    expect(replyModeForRating(profile, 6)).toBe('AUTO');
  });
});

describe('REPLY_MODE_FIELDS', () => {
  it('maps every star rating to its Profile column', () => {
    expect(STAR_RATINGS).toEqual([1, 2, 3, 4, 5]);
    expect(REPLY_MODE_FIELDS[1]).toBe('reviewReplyMode1');
    expect(REPLY_MODE_FIELDS[5]).toBe('reviewReplyMode5');
  });
});

describe('ratingNotIgnoredFilter', () => {
  it('excludes exactly the (rating, IGNORE) pairs', () => {
    expect(ratingNotIgnoredFilter()).toEqual({
      NOT: {
        OR: [
          { rating: 1, profile: { reviewReplyMode1: 'IGNORE' } },
          { rating: 2, profile: { reviewReplyMode2: 'IGNORE' } },
          { rating: 3, profile: { reviewReplyMode3: 'IGNORE' } },
          { rating: 4, profile: { reviewReplyMode4: 'IGNORE' } },
          { rating: 5, profile: { reviewReplyMode5: 'IGNORE' } },
        ],
      },
    });
  });
});
