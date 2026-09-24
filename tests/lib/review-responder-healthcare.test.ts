import { describe, it, expect, vi, beforeEach } from 'vitest';

// Healthcare mode: a dental/medical profile gets the privacy prompt, the
// office phone as the one number a reply may carry, and a check on every
// draft (one retry, then a plain safe reply). Other profiles are untouched.

const mocks = vi.hoisted(() => ({ generate: vi.fn() }));

vi.mock('@/lib/claude', () => ({ generate: mocks.generate }));

const { generateReviewResponse } = await import('@/lib/review-responder');

const dentist = {
  businessName: 'Lee Family Dental',
  businessCategory: 'Dentist',
  businessPhone: '(555) 010-4477',
  reviewerName: 'Dana',
  starRating: 1,
  reviewComment: 'They billed my insurance wrong after my crown.',
};

function call(n = 0) {
  return mocks.generate.mock.calls[n][0] as { system: string; prompt: string };
}

function reply(response: string) {
  return { response, sentiment: 'negative', tone: 'warm' };
}

const SAFE =
  "Dana, we're sorry to read this. We'd like to talk with you directly. Please call the office at (555) 010-4477.";
const UNSAFE =
  'Dana, I take full responsibility for the billing mix-up on your crown. See you at your next visit!';

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('generateReviewResponse healthcare mode', () => {
  it('uses the privacy prompt and gives the office phone for a dental profile', async () => {
    mocks.generate.mockResolvedValue(reply(SAFE));

    const result = await generateReviewResponse(dentist);

    expect(result.response).toBe(SAFE);
    expect(mocks.generate).toHaveBeenCalledOnce();
    const { system, prompt } = call();
    expect(system).toContain('HIPAA');
    expect(system).toContain('Never confirm or imply that the reviewer');
    expect(system).toContain('Never use em dashes or en dashes');
    // None of the general guidance that produced the unsafe drafts.
    expect(system).not.toContain('reference specific details they mentioned, invite them back');
    expect(system).not.toContain('take responsibility, offer to discuss privately');
    expect(system).not.toMatch(/[\u2013\u2014]/);
    expect(prompt).toContain('Office phone: (555) 010-4477');
  });

  it('keeps the general prompt, with no phone, for other businesses', async () => {
    mocks.generate.mockResolvedValue(reply('Thanks Dana!'));

    await generateReviewResponse({
      ...dentist,
      businessName: 'Ben Plumbing',
      businessCategory: 'Plumber',
      reviewComment: 'Great work',
      starRating: 5,
    });

    const { system, prompt } = call();
    expect(system).not.toContain('HIPAA');
    expect(system).toContain('reference specific details they mentioned, invite them back');
    expect(prompt).not.toContain('Office phone');
  });

  it('restates the privacy rules after operator instructions', async () => {
    mocks.generate.mockResolvedValue(reply(SAFE));

    await generateReviewResponse({
      ...dentist,
      customInstructions: 'Always mention how their cleaning went.',
    });

    const system = call().system;
    const afterOperator = system.slice(system.indexOf('</operator_instructions>'));
    expect(afterOperator).toContain('never confirm or imply the reviewer is or was a patient');
    expect(afterOperator).toContain('never mention a visit, treatment, appointment, bill, insurance or record');
  });

  it('retries once, naming what was wrong, when a draft breaks the rules', async () => {
    mocks.generate
      .mockResolvedValueOnce(reply(UNSAFE))
      .mockResolvedValueOnce(reply(SAFE));

    const result = await generateReviewResponse(dentist);

    expect(mocks.generate).toHaveBeenCalledTimes(2);
    expect(call(1).prompt).toContain('An earlier draft broke the privacy rules');
    expect(call(1).prompt).toContain('Admits fault');
    expect(call(1).prompt).toContain('Mentions a visit or appointment');
    expect(result.response).toBe(SAFE);
  });

  it('falls back to a plain safe reply when the retry also breaks the rules', async () => {
    mocks.generate.mockResolvedValue(reply(UNSAFE));

    const result = await generateReviewResponse(dentist);

    expect(mocks.generate).toHaveBeenCalledTimes(2);
    expect(result).toEqual({
      response:
        "Dana, we're sorry to read this. We'd like to talk with you directly, so please call the office at (555) 010-4477.",
      sentiment: 'negative',
      tone: 'healthcare-safe-fallback',
    });
  });

  it('never sends a phone number to the prompt outside healthcare mode', async () => {
    mocks.generate.mockResolvedValue(reply('Thanks!'));

    await generateReviewResponse({
      ...dentist,
      businessCategory: 'Roofing contractor',
    });

    expect(call().prompt).not.toContain('(555) 010-4477');
  });
});
