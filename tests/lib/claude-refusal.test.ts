import { describe, it, expect, beforeAll } from 'vitest';

// Opus 5.5 answers a classifier decline with HTTP 200 and stop_reason
// "refusal". The shared helper must turn that into a typed error before any
// output is read, and leave every other stop reason alone. No network: the
// client is constructed with a placeholder key and never called.

let mod: typeof import('@/lib/claude');

beforeAll(async () => {
  process.env.ANTHROPIC_API_KEY ??= 'test-placeholder';
  mod = await import('@/lib/claude');
});

describe('claude.ts', () => {
  it('targets Claude Opus 5.5', () => {
    expect(mod.CLAUDE_MODEL).toBe('claude-opus-5-5');
  });

  it('throws ClaudeRefusalError on a refusal, with the category when present', () => {
    const refusal = {
      stop_reason: 'refusal',
      stop_details: { type: 'refusal', category: 'cyber', explanation: null },
    };
    expect(() => mod.throwIfRefused(refusal, 'Review response')).toThrow(mod.ClaudeRefusalError);
    expect(() => mod.throwIfRefused(refusal, 'Review response')).toThrow(
      /Review response: declined by Claude \(stop_reason: refusal, category: cyber\)/
    );
  });

  it('treats a refusal with no stop_details as a refusal all the same', () => {
    expect(() => mod.throwIfRefused({ stop_reason: 'refusal' }, 'x')).toThrow(/category: none/);
  });

  it('leaves other stop reasons alone', () => {
    for (const stop_reason of ['end_turn', 'max_tokens', 'tool_use', null]) {
      expect(() => mod.throwIfRefused({ stop_reason }, 'x')).not.toThrow();
    }
  });
});
