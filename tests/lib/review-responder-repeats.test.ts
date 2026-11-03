import { describe, it, expect, vi, beforeEach } from 'vitest';

// A new reply is written knowing what the profile already said, gets one retry
// if it repeats it anyway, and a repeat never comes back as the result. The
// earlier replies stay out of the shared, cached system prompt.

const mocks = vi.hoisted(() => ({ generate: vi.fn() }));

vi.mock('@/lib/claude', () => ({ generate: mocks.generate }));

const { generateReviewResponse } = await import('@/lib/review-responder');
const { checkHealthcareReply, safeHealthcareReply } = await import('@/lib/healthcare');

const ROBIN = {
  content: 'Thank you so much for the 5-star rating, Robin, we really appreciate it!',
  reviewerName: 'Robin Hale',
  ratingOnly: true,
};
const REPEAT = 'Thank you so much for the 5-star rating, Sam, we really appreciate it!';
const FRESH = 'Thanks for the five stars, Sam. It means a lot to our team.';

const dentist = {
  businessName: 'Lee Family Dental',
  businessCategory: 'Dentist',
  businessPhone: '(555) 010-4477',
  reviewerName: 'Sam Ortiz',
  starRating: 5,
  reviewComment: null,
  earlierReplies: [ROBIN],
};
const plumber = { ...dentist, businessName: 'Lee Plumbing', businessCategory: 'Plumber' };

function reply(response: string) {
  return { response, sentiment: 'positive', tone: 'warm' };
}
function prompt(n = 0) {
  return mocks.generate.mock.calls[n][0].prompt as string;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('generateReviewResponse and earlier replies', () => {
  it('shows the model earlier replies with the names out, in the message only', async () => {
    mocks.generate.mockResolvedValue(reply(FRESH));
    const result = await generateReviewResponse(dentist);

    expect(result.response).toBe(FRESH);
    expect(mocks.generate).toHaveBeenCalledOnce();
    expect(prompt()).toContain('Thank you so much for the 5-star rating, we really appreciate it!');
    expect(prompt()).not.toContain('Robin');
    expect(mocks.generate.mock.calls[0][0].system).not.toContain('5-star rating');
  });

  it('shows replies to the same kind of review, newest first, and caps them', async () => {
    mocks.generate.mockResolvedValue(reply('A note nobody has seen before, Sam.'));
    const withComment = { content: 'Glad the office stood out.', reviewerName: 'Sam', ratingOnly: false };
    const many = Array.from({ length: 30 }, (_, i) => ({
      content: `Rating reply number ${i}`,
      reviewerName: null,
      ratingOnly: true,
    }));
    await generateReviewResponse({ ...dentist, earlierReplies: [withComment, ...many] });

    expect(prompt()).not.toContain('Glad the office stood out');
    expect(prompt()).toContain('Rating reply number 0');
    expect(prompt()).toContain('Rating reply number 19');
    expect(prompt()).not.toContain('Rating reply number 20');
  });

  it('sends the same message as before when there is nothing earlier', async () => {
    mocks.generate.mockResolvedValue(reply(FRESH));
    await generateReviewResponse({ ...dentist, earlierReplies: [] });
    expect(prompt()).not.toContain('already wrote');
  });

  it('retries once, naming the reply it repeated', async () => {
    mocks.generate.mockResolvedValueOnce(reply(REPEAT)).mockResolvedValueOnce(reply(FRESH));
    const result = await generateReviewResponse(plumber);

    expect(result.response).toBe(FRESH);
    expect(mocks.generate).toHaveBeenCalledTimes(2);
    expect(prompt(1)).toContain('said the same thing as a reply');
  });

  it('healthcare falls back to a safe wording nobody has had', async () => {
    const taken = safeHealthcareReply({
      reviewerName: 'Robin Hale',
      starRating: 5,
      reviewComment: null,
    });
    mocks.generate.mockResolvedValue(reply(taken.replace('Robin Hale', 'Sam Ortiz')));
    const result = await generateReviewResponse({
      ...dentist,
      earlierReplies: [{ content: taken, reviewerName: 'Robin Hale', ratingOnly: true }],
    });

    expect(mocks.generate).toHaveBeenCalledTimes(2);
    expect(result.tone).toBe('healthcare-safe-fallback');
    expect(result.response).toContain('Sam Ortiz');
    expect(result.response).not.toBe(taken.replace('Robin Hale', 'Sam Ortiz'));
  });

  it('outside healthcare it fails rather than return a repeat that could publish unread', async () => {
    mocks.generate.mockResolvedValue(reply(REPEAT));
    await expect(generateReviewResponse(plumber)).rejects.toThrow(/still repeats/);
  });
});

describe('safeHealthcareReply wordings', () => {
  const name = 'Dana Lee';
  const phone = '(555) 010-4477';
  const shapes = [
    { starRating: 1, reviewComment: 'Bad.' },
    { starRating: 3, reviewComment: 'Okay.' },
    { starRating: 5, reviewComment: 'Great.' },
    { starRating: 5, reviewComment: null },
  ];

  it.each(shapes)('every wording passes the privacy check: %o', (shape) => {
    const seen: string[] = [];
    for (;;) {
      const next = safeHealthcareReply(
        { reviewerName: name, businessPhone: phone, ...shape },
        (reply) => seen.includes(reply)
      );
      if (seen.includes(next)) break;
      seen.push(next);
      expect(checkHealthcareReply(next, { reviewerName: name, officePhone: phone })).toEqual([]);
      expect(next).not.toMatch(/[–—]/);
    }
    expect(seen.length).toBeGreaterThanOrEqual(3);
  });

  it('reads properly with no name', () => {
    const seen: string[] = [];
    for (let i = 0; i < 5; i++) {
      const next = safeHealthcareReply(
        { reviewerName: null, starRating: 5, reviewComment: 'Great.' },
        (reply) => seen.includes(reply)
      );
      seen.push(next);
    }
    for (const reply of seen) expect(reply).toMatch(/^[A-Z]/);
    expect(seen.join(' ')).not.toContain('null');
    expect(seen.join(' ')).not.toContain(' ,');
  });
});
