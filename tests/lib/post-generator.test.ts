import { describe, it, expect, vi, beforeEach } from 'vitest';

// Profiles that share a post template run back to back in the daily
// generation job, so the template (plus the output schema) is cached.

const mocks = vi.hoisted(() => ({ generate: vi.fn() }));

vi.mock('@/lib/claude', () => ({ generate: mocks.generate }));

const { generateMonthlyPosts } = await import('@/lib/post-generator');

beforeEach(() => {
  vi.clearAllMocks();
  mocks.generate.mockResolvedValue({
    posts: [{ content: 'Spring drain checks are here.', suggestedType: 'WHATS_NEW' }],
  });
});

describe('generateMonthlyPosts prompt caching', () => {
  it('caches the post template', async () => {
    await generateMonthlyPosts({ name: 'Ben Plumbing', category: 'Plumber', address: null });

    const options = mocks.generate.mock.calls[0][0];
    expect(options.cacheSystem).toBe(true);
    expect(options.label).toBe('monthly-posts');
  });
});
