import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// The team found posts too thin to be useful: the default template asked for
// 150-300 characters, one or two sentences. The posts they liked (from the
// agent we used before) ran 850-1,000 characters in two or three short
// paragraphs. A longer post needs real material or it fills up with made-up
// claims, so the business's own Google description goes in with it, and so
// does today's date, so a seasonal hook lands in the right season.

const mocks = vi.hoisted(() => ({ generate: vi.fn() }));

vi.mock('@/lib/claude', () => ({ generate: mocks.generate }));

const { generateMonthlyPosts } = await import('@/lib/post-generator');
const { GENERIC_TEMPLATE, getDefaultPrompt } = await import('@/lib/prompts/defaults');

const profile = { name: 'Ben Plumbing', category: 'Plumber', address: null };

const templates = () => [
  GENERIC_TEMPLATE,
  getDefaultPrompt('Dentist'),
  getDefaultPrompt('Restaurant'),
  getDefaultPrompt('Law firm'),
];

function lastCall(): { prompt: string; system: string; maxTokens: number } {
  const calls = mocks.generate.mock.calls;
  return calls[calls.length - 1][0];
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.generate.mockResolvedValue({
    posts: [{ content: 'Fall drain checks are here.', suggestedType: 'WHATS_NEW' }],
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('post length', () => {
  it('no default template holds a post to a couple of sentences', () => {
    for (const template of templates()) {
      expect(template).not.toMatch(/150-300 characters/);
      expect(template).toMatch(/120-180 words/);
    }
  });

  it('keeps every post clear of Google\'s 1,500-character cutoff', () => {
    for (const template of templates()) {
      expect(template).toMatch(/1,500 characters/);
    }
  });

  it('leaves room for a full batch of long posts plus thinking', async () => {
    // 12 posts of ~1,000 characters is ~4k tokens of JSON before Opus 5.5
    // thinks at all; 8,192 could cut the answer off mid-batch.
    await generateMonthlyPosts(profile, undefined, 12);
    expect(lastCall().maxTokens).toBeGreaterThanOrEqual(16_000);
  });
});

describe('business facts', () => {
  it('gives Claude the business\'s own Google description', async () => {
    await generateMonthlyPosts({
      ...profile,
      description: 'Family-owned since 1998. Free estimates on water heaters.',
    });
    expect(lastCall().prompt).toContain(
      'Family-owned since 1998. Free estimates on water heaters.'
    );
  });

  it('leaves the description out when Google has none', async () => {
    await generateMonthlyPosts({ ...profile, description: '  ' });
    expect(lastCall().prompt).not.toMatch(/Google description/i);
    await generateMonthlyPosts({ ...profile, description: null });
    expect(lastCall().prompt).not.toMatch(/Google description/i);
  });

  it('tells Claude not to invent facts to fill the space', () => {
    for (const template of templates()) {
      expect(template).toMatch(/never invent/i);
    }
  });
});

describe('date', () => {
  it('tells Claude today\'s date so seasonal hooks land in the right season', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-27T15:00:00Z'));
    await generateMonthlyPosts(profile);
    expect(lastCall().prompt).toContain('October 27, 2026');
  });

  it('keeps the date out of the cached system prompt', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-27T15:00:00Z'));
    await generateMonthlyPosts(profile);
    expect(lastCall().system).not.toContain('2026');
  });
});
