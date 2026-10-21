import { describe, it, expect, vi, beforeEach } from 'vitest';

// The description prompt says no phone numbers and no URLs, which is also
// Google's rule for the field, but the only thing checked after generation
// was the length. A draft that slipped a phone number or the client's
// domain in came back as if it were fine. Now a draft that breaks either
// rule gets the same treatment as one of the wrong length: it goes back
// with feedback saying what was wrong, and if the retries still break the
// rule it is refused rather than handed to the operator to push.

const mocks = vi.hoisted(() => ({ generate: vi.fn() }));

vi.mock('@/lib/claude', () => ({ generate: mocks.generate }));

const { generateDescription } = await import('@/lib/description-generator');

const profile = {
  name: 'Badger Gutters',
  category: 'Gutter cleaning service',
  address: 'Charlotte, NC',
  keywords: ['gutter cleaning'],
  cities: ['Charlotte'],
};

/** A description of `length` characters that starts with `lead`. */
function sized(lead: string, length = 730): string {
  const filler = ' Badger Gutters cleans and repairs gutters across Charlotte.';
  let text = lead;
  while (text.length < length) text += filler;
  return text.slice(0, length - 1) + '.';
}

const clean = sized('Badger Gutters has served Charlotte homeowners since 2004, across 25 neighborhoods.');

/** The feedback message sent back to the model on the nth call (0-based). */
function feedbackOnCall(n: number): string {
  const messages = mocks.generate.mock.calls[n][0].prompt as { role: string; content: string }[];
  return messages[messages.length - 1].content;
}

beforeEach(() => {
  // Reset, not clear: a test whose first draft is accepted leaves its queued
  // retry value behind, and it must not leak into the next test.
  mocks.generate.mockReset();
});

describe('generateDescription post-generation rules', () => {
  it('accepts a clean draft first time, years and counts included', async () => {
    mocks.generate.mockResolvedValue({ description: clean });
    await expect(generateDescription(profile)).resolves.toBe(clean);
    expect(mocks.generate).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['a bare domain', 'Visit badgergutters.com for a quote.'],
    ['a www address', 'See www.badgergutters.com today.'],
    ['an https link', 'Book at https://badgergutters.com/book now.'],
  ])('sends back a draft with %s and keeps the clean retry', async (_label, lead) => {
    mocks.generate
      .mockResolvedValueOnce({ description: sized(lead) })
      .mockResolvedValueOnce({ description: clean });

    await expect(generateDescription(profile)).resolves.toBe(clean);
    expect(mocks.generate).toHaveBeenCalledTimes(2);
    expect(feedbackOnCall(1)).toMatch(/URL|web address/i);
  });

  it.each([
    ['(704) 555-0123'],
    ['704-555-0123'],
    ['704.555.0123'],
    ['+1 704 555 0123'],
    ['555-0123'],
  ])('sends back a draft with the phone number %s', async (phone) => {
    mocks.generate
      .mockResolvedValueOnce({ description: sized(`Call ${phone} for a free estimate.`) })
      .mockResolvedValueOnce({ description: clean });

    await expect(generateDescription(profile)).resolves.toBe(clean);
    expect(mocks.generate).toHaveBeenCalledTimes(2);
    expect(feedbackOnCall(1)).toMatch(/phone number/i);
  });

  it('names every problem in one round of feedback', async () => {
    mocks.generate
      .mockResolvedValueOnce({ description: 'Call 704-555-0123 or visit badgergutters.com.' })
      .mockResolvedValueOnce({ description: clean });

    await generateDescription(profile);
    const feedback = feedbackOnCall(1);
    expect(feedback).toMatch(/characters/);
    expect(feedback).toMatch(/phone number/i);
    expect(feedback).toMatch(/URL|web address/i);
  });

  it('refuses a draft that still breaks the rules after the retries', async () => {
    mocks.generate.mockResolvedValue({
      description: sized('Call 704-555-0123 for a free estimate.'),
    });

    await expect(generateDescription(profile)).rejects.toThrow(/phone number/i);
    expect(mocks.generate).toHaveBeenCalledTimes(3);
  });

  it('lets a business whose name looks like a domain use its own name', async () => {
    const named = sized('Gutters.com Pros has cleaned gutters across Charlotte since 2004.');
    mocks.generate.mockResolvedValue({ description: named });
    await expect(
      generateDescription({ ...profile, name: 'Gutters.com Pros' })
    ).resolves.toBe(named);
    expect(mocks.generate).toHaveBeenCalledTimes(1);
  });

  it('does not mistake a year range for a phone number', async () => {
    const years = sized('Badger Gutters, family run 1998-2024 and still growing, serves Charlotte.');
    mocks.generate.mockResolvedValue({ description: years });
    await expect(generateDescription(profile)).resolves.toBe(years);
    expect(mocks.generate).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['homes from 800-3000 square feet'],
    ['repairs from $150-1500'],
    ['100-1000 gallon tanks'],
    ['the 300-4000 series'],
    ['just off Highway 101 2024 rebuild'],
  ])('does not mistake a range or a number pair for a phone number (%s)', async (text) => {
    const clean = sized(`Badger Gutters handles ${text} across Charlotte.`);
    mocks.generate.mockResolvedValue({ description: clean });
    await expect(generateDescription(profile)).resolves.toBe(clean);
    expect(mocks.generate).toHaveBeenCalledTimes(1);
  });
});
