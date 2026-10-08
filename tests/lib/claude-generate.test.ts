import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
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

function sentBody() {
  return JSON.parse(
    (fetchMock.mock.calls[0] as unknown as [string, { body: string }])[1].body
  );
}

const ok = () => answers.push({ text: '{"description":"A new gutter."}', stop_reason: 'end_turn' });
const base = { schema: Schema, maxTokens: 4_096, effort: 'low' as const };

// Prompt caching may add a cache marker and nothing else: the same system
// prompt and message text go out, and call sites that don't opt in send
// exactly the request they always did.
describe('generate() prompt caching', () => {
  it('sends system and messages unchanged when no caching is asked for', async () => {
    ok();
    await mod.generate({ ...base, system: 's', prompt: 'p' });

    const body = sentBody();
    expect(body.system).toBe('s');
    expect(body.messages).toEqual([{ role: 'user', content: 'p' }]);
    expect(JSON.stringify(body)).not.toContain('cache_control');
  });

  it('cacheSystem puts a 5-minute breakpoint on the system prompt, text unchanged', async () => {
    ok();
    await mod.generate({ ...base, system: 's', prompt: 'p', cacheSystem: true });

    const body = sentBody();
    expect(body.system).toEqual([
      { type: 'text', text: 's', cache_control: { type: 'ephemeral' } },
    ]);
    expect(body.messages).toEqual([{ role: 'user', content: 'p' }]);
  });
});

describe('Claude usage logging', () => {
  const usage = {
    input_tokens: 12,
    output_tokens: 3,
    cache_creation_input_tokens: 1200,
    cache_read_input_tokens: 0,
  } as Parameters<typeof mod.logUsage>[1];

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('stays quiet unless CLAUDE_USAGE_LOG=1', () => {
    vi.stubEnv('CLAUDE_USAGE_LOG', '');
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});

    mod.logUsage('quiet', usage);
    expect(log).not.toHaveBeenCalled();

    vi.stubEnv('CLAUDE_USAGE_LOG', '1');
    mod.logUsage('loud', usage);
    expect(log).toHaveBeenCalledTimes(1);
    const line = log.mock.calls[0][0] as string;
    expect(line).toContain('[claude-usage] loud');
    expect(line).toContain('input=12');
    expect(line).toContain('cache_write=1200');
    expect(line).toContain('cache_read=0');
    expect(line).toContain('output=3');
  });

  it('generate logs each response under its call-site label', async () => {
    vi.stubEnv('CLAUDE_USAGE_LOG', '1');
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    ok();

    await mod.generate({ ...base, system: 's', prompt: 'p', label: 'review-response' });

    expect(log).toHaveBeenCalledTimes(1);
    expect(log.mock.calls[0][0]).toContain('[claude-usage] review-response');
  });
});
