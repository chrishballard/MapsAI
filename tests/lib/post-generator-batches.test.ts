import { describe, it, expect, vi, beforeEach } from 'vitest';

// A profile can ask for up to 30 posts a month (onboarding settings accept
// 1-30), but the structured-output schema used to cap a batch at 12 and every
// post at 300 characters. A request for more than 12, or one post a little
// over 300, failed the whole parse: no posts were created, and the daily
// generation job paid for the same failing call again the next morning.

const mocks = vi.hoisted(() => ({ generate: vi.fn() }));

vi.mock('@/lib/claude', () => ({ generate: mocks.generate }));

const { generateMonthlyPosts } = await import('@/lib/post-generator');
const { BatchPostsSchema } = await import('@/lib/prompts/types');
const { GENERIC_TEMPLATE, getDefaultPrompt } = await import('@/lib/prompts/defaults');

const profile = { name: 'Ben Plumbing', category: 'Plumber', address: null };

function post(content: string) {
  return { content, suggestedType: 'WHATS_NEW' as const };
}

/** The count the user message asks Claude for. */
function requestedCount(options: { prompt: string }): number {
  const match = /Generate (\d+)/.exec(options.prompt);
  if (!match) throw new Error(`no count in prompt: ${options.prompt}`);
  return Number(match[1]);
}

beforeEach(() => {
  vi.clearAllMocks();
  // Claude answers each call with exactly the number of posts it was asked for.
  mocks.generate.mockImplementation(async (options: { prompt: string }) => ({
    posts: Array.from({ length: requestedCount(options) }, (_, i) =>
      post(`Post ${i + 1}: spring drain checks are here.`)
    ),
  }));
});

describe('generateMonthlyPosts batch size (H1)', () => {
  it.each([13, 20, 30])(
    'returns %i posts, and every call asks for a count its schema accepts',
    async (count) => {
      const result = await generateMonthlyPosts(profile, undefined, count);

      expect(result.posts).toHaveLength(count);
      for (const [options] of mocks.generate.mock.calls) {
        const asked = requestedCount(options);
        const answer = { posts: Array.from({ length: asked }, () => post('x'.repeat(200))) };
        expect(options.schema.safeParse(answer).success).toBe(true);
      }
    }
  );

  it('keeps a batch of 12 or fewer to one call', async () => {
    await generateMonthlyPosts(profile, undefined, 12);
    expect(mocks.generate).toHaveBeenCalledTimes(1);
    expect(requestedCount(mocks.generate.mock.calls[0][0])).toBe(12);
  });

  it('tells later calls what earlier ones already wrote', async () => {
    await generateMonthlyPosts(profile, undefined, 20);
    expect(mocks.generate.mock.calls.length).toBeGreaterThan(1);
    const second = mocks.generate.mock.calls[1][0].prompt as string;
    expect(second).toContain('Post 1: spring drain checks are here.');
  });
});

describe('per-post validation (M12)', () => {
  it('does not fail the whole batch on one post over 300 characters', () => {
    const parsed = BatchPostsSchema.safeParse({
      posts: [post('Short and sweet.'), post('a'.repeat(340))],
    });
    expect(parsed.success).toBe(true);
  });

  it('does not fail the whole batch on one malformed CTA URL', () => {
    const parsed = BatchPostsSchema.safeParse({
      posts: [
        post('Short and sweet.'),
        { ...post('Book a drain check.'), callToActionUrl: 'call us today' },
      ],
    });
    expect(parsed.success).toBe(true);
  });

  it('trims a post over the 1500-character GBP limit instead of throwing', async () => {
    const long = `${'Our crew clears tough clogs fast. '.repeat(60)}`;
    expect(long.length).toBeGreaterThan(1500);
    mocks.generate.mockResolvedValueOnce({ posts: [post('Fine.'), post(long)] });

    const result = await generateMonthlyPosts(profile, undefined, 2);

    expect(result.posts).toHaveLength(2);
    expect(result.posts[1].content.length).toBeLessThanOrEqual(1500);
    // Cut on a sentence end, not mid-word.
    expect(result.posts[1].content.endsWith('.')).toBe(true);
  });

  it('drops a CTA URL that is not a real URL and keeps the post', async () => {
    mocks.generate.mockResolvedValueOnce({
      posts: [
        { ...post('Book a drain check.'), callToActionUrl: 'call us today' },
        { ...post('Visit our site.'), callToActionUrl: 'https://benplumbing.com' },
      ],
    });

    const result = await generateMonthlyPosts(profile, undefined, 2);

    expect(result.posts[0].callToActionUrl).toBeUndefined();
    expect(result.posts[1].callToActionUrl).toBe('https://benplumbing.com');
  });
});

describe('default prompts name no fixed count (M13)', () => {
  it('never says "exactly 4" or "all 4 posts"', () => {
    for (const template of [GENERIC_TEMPLATE, getDefaultPrompt('Dentist'), getDefaultPrompt('Law firm')]) {
      expect(template).not.toMatch(/\b4 (monthly )?posts\b/);
      expect(template).not.toMatch(/exactly 4/);
    }
  });

  it('asks for the requested count in the message', async () => {
    await generateMonthlyPosts(profile, undefined, 8);
    expect(mocks.generate.mock.calls[0][0].prompt).toContain('Generate 8');
  });
});
