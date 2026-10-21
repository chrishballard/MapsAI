import { describe, it, expect, vi } from 'vitest';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';

// The SDK sends the sentiment enum to Claude only as a description (it is
// not a constrained enum in the JSON schema), so a reply can come back as
// "Positive" or "NEGATIVE". That casing must not fail an otherwise good
// reply: the schema lower-cases it before validating.

vi.mock('@/lib/claude', () => ({ generate: vi.fn() }));

const { ReviewResponseSchema } = await import('@/lib/review-responder');

// The same parse generate() runs on Claude's text output.
const format = zodOutputFormat(ReviewResponseSchema);

describe('ReviewResponseSchema sentiment', () => {
  it.each([
    ['Positive', 'positive'],
    ['NEGATIVE', 'negative'],
    [' Neutral ', 'neutral'],
  ])('accepts %j and stores it as %j', (sentiment, expected) => {
    const parsed = format.parse(
      JSON.stringify({ response: 'Thanks Dana!', sentiment, tone: 'warm' })
    );
    expect(parsed.sentiment).toBe(expected);
  });

  it('still rejects a sentiment outside the three values', () => {
    expect(() =>
      format.parse(
        JSON.stringify({ response: 'Thanks Dana!', sentiment: 'mixed', tone: 'warm' })
      )
    ).toThrow();
  });

  it('sends Claude the same schema as before (no prompt cache churn)', () => {
    expect(format.schema).toMatchObject({
      properties: {
        sentiment: {
          type: 'string',
          description: '{enum: ["positive","neutral","negative"]}',
        },
      },
    });
  });
});
