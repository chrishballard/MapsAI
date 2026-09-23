import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { z } from 'zod';

// generate() through the real SDK: only the HTTP layer is faked (global fetch,
// captured when the client is built), so messages.parse and its structured
// output parsing run exactly as in production. No network, placeholder key.
//
// The case that matters: a refusal that fires MID-output leaves partial JSON.
// The SDK parses text blocks before generate() sees the response, and used to
// throw "Failed to parse structured output" there, so callers could not tell a
// decline (permanent for that input) from a transient failure.

const answers: { text: string; stop_reason: string }[] = [];
const fetchMock = vi.fn(async () => {
  const a = answers.shift() ?? { text: '{}', stop_reason: 'end_turn' };
  return new Response(
    JSON.stringify({
      id: 'msg_test',
      type: 'message',
      role: 'assistant',
      model: 'claude-opus-5-5',
      content: [
        { type: 'thinking', thinking: '', signature: 'sig' },
        { type: 'text', text: a.text },
      ],
      stop_reason: a.stop_reason,
      stop_sequence: null,
      usage: { input_tokens: 1, output_tokens: 1 },
    }),
    { status: 200, headers: { 'content-type': 'application/json' } }
  );
});

let mod: typeof import('@/lib/claude');
let ClaudeRefusalError: typeof import('@/lib/claude-refusal').ClaudeRefusalError;

beforeAll(async () => {
  process.env.ANTHROPIC_API_KEY ??= 'test-placeholder';
  vi.stubGlobal('fetch', fetchMock);
  // claude.ts caches its client on globalThis outside production; start clean
  // so the client is built with the stubbed fetch.
  delete (globalThis as { anthropic?: unknown }).anthropic;
  mod = await import('@/lib/claude');
  ({ ClaudeRefusalError } = await import('@/lib/claude-refusal'));
});

beforeEach(() => {
  answers.length = 0;
  fetchMock.mockClear();
});

const Schema = z.object({ description: z.string() });
const call = () =>
  mod.generate({
    system: 's',
    prompt: 'p',
    schema: Schema,
    maxTokens: 4_096,
    effort: 'low',
    errorMessage: 'Failed to parse image caption from Claude',
  });

describe('generate() with the real SDK parse', () => {
  it('returns the parsed object and sends the model and effort', async () => {
    answers.push({ text: '{"description":"A new gutter."}', stop_reason: 'end_turn' });
    await expect(call()).resolves.toEqual({ description: 'A new gutter.' });
    const body = JSON.parse((fetchMock.mock.calls[0] as unknown as [string, { body: string }])[1].body);
    expect(body.model).toBe('claude-opus-5-5');
    expect(body.output_config.effort).toBe('low');
  });

  it('throws ClaudeRefusalError on a refusal that fired mid-output', async () => {
    answers.push({ text: '{"descrip', stop_reason: 'refusal' });
    await expect(call()).rejects.toBeInstanceOf(ClaudeRefusalError);
  });

  it('throws the caller\'s error, with the parse failure as its cause, on cut-off JSON', async () => {
    answers.push({ text: '{"description":"A new gu', stop_reason: 'max_tokens' });
    const err = await call().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(ClaudeRefusalError);
    expect((err as Error).message).toBe('Failed to parse image caption from Claude');
    expect(String((err as Error).cause)).toMatch(/Failed to parse structured output/);
  });
});
