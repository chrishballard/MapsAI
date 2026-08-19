import { describe, it, expect, vi, beforeEach } from 'vitest';

// Content-aware image matching: post text and photo must never clash.
// Claude only ever decides WHICH specific photo fits (or GENERIC/NONE);
// generic rotation fairness stays mechanical LRU in code. Every failure
// tier degrades — captioned generics, then text-only — and with zero
// captions the picker behaves exactly like the legacy blind rotation.
// Nothing in here may ever throw into post generation.

const mocks = vi.hoisted(() => ({
  generate: vi.fn(),
  prisma: {
    profileImage: { findMany: vi.fn() },
    profile: { findUnique: vi.fn() },
  },
  syncProfileMediaToLibrary: vi.fn(),
  enqueueCaptionsForProfile: vi.fn(),
}));

vi.mock('@/lib/claude', () => ({ generate: mocks.generate }));
vi.mock('@/lib/prisma', () => ({ prisma: mocks.prisma }));
vi.mock('@/lib/google-media', () => ({
  syncProfileMediaToLibrary: mocks.syncProfileMediaToLibrary,
}));
vi.mock('@/lib/queue/image-caption-queue', () => ({
  enqueueCaptionsForProfile: mocks.enqueueCaptionsForProfile,
}));

const { pickImagesForPostContents } = await import('@/lib/post-image-matcher');

function specific(id: string, description = `photo of ${id}`) {
  return {
    id,
    aiDescription: description,
    aiTags: ['subject'],
    aiGeneric: false,
    captionedAt: new Date('2026-08-19'),
    captionSkipReason: null,
  };
}

function generic(id: string) {
  return {
    id,
    aiDescription: 'storefront',
    aiTags: ['storefront'],
    aiGeneric: true,
    captionedAt: new Date('2026-08-19'),
    captionSkipReason: null,
  };
}

function uncaptioned(id: string) {
  return {
    id,
    aiDescription: null,
    aiTags: [],
    aiGeneric: null,
    captionedAt: null,
    captionSkipReason: null,
  };
}

function permanentlySkipped(id: string) {
  return { ...uncaptioned(id), captionSkipReason: 'NO_INPUT' };
}

const POSTS = [
  { content: 'Kitchen remodel season is here!', type: 'WHATS_NEW' },
  { content: 'We are hiring — join the team.', type: 'WHATS_NEW' },
];

beforeEach(() => {
  vi.clearAllMocks();
  mocks.prisma.profile.findUnique.mockResolvedValue({
    name: 'Acme Remodeling',
    category: 'Remodeler',
    mediaSyncedAt: new Date(),
    accountResourceName: 'accounts/1',
  });
  mocks.enqueueCaptionsForProfile.mockResolvedValue(0);
});

describe('pickImagesForPostContents matching', () => {
  it('assigns the specific image Claude picked and rotates generics for the rest', async () => {
    mocks.prisma.profileImage.findMany.mockResolvedValue([
      specific('kitchen1', 'a remodeled kitchen'),
      generic('g1'),
    ]);
    mocks.generate.mockResolvedValue({ choices: ['kitchen1', 'GENERIC'] });

    const picked = await pickImagesForPostContents('p1', POSTS);

    expect(picked).toEqual(['kitchen1', 'g1']);
  });

  it('resolves GENERIC choices round-robin over the LRU-ordered generic list', async () => {
    mocks.prisma.profileImage.findMany.mockResolvedValue([
      generic('g1'),
      specific('s1'),
      generic('g2'),
    ]);
    mocks.generate.mockResolvedValue({
      choices: ['GENERIC', 'GENERIC', 'GENERIC'],
    });

    const picked = await pickImagesForPostContents('p1', [
      { content: 'a' },
      { content: 'b' },
      { content: 'c' },
    ]);

    expect(picked).toEqual(['g1', 'g2', 'g1']);
  });

  it('maps NONE to a text-only post', async () => {
    mocks.prisma.profileImage.findMany.mockResolvedValue([
      specific('s1'),
      generic('g1'),
    ]);
    mocks.generate.mockResolvedValue({ choices: ['s1', 'NONE'] });

    const picked = await pickImagesForPostContents('p1', POSTS);

    expect(picked).toEqual(['s1', null]);
  });

  it('normalizes casing/whitespace on the GENERIC and NONE tokens', async () => {
    // With no wire-level enum, a model may emit "none" or " GENERIC " —
    // that must honor the judgment, not fall through to the demotion path.
    mocks.prisma.profileImage.findMany.mockResolvedValue([
      specific('s1'),
      generic('g1'),
    ]);
    mocks.generate.mockResolvedValue({ choices: [' generic ', 'none'] });

    const picked = await pickImagesForPostContents('p1', POSTS);

    expect(picked).toEqual(['g1', null]);
  });

  it('sends posts and only the specific images to Claude', async () => {
    mocks.prisma.profileImage.findMany.mockResolvedValue([
      specific('s1', 'a new roof install'),
      generic('g1'),
    ]);
    mocks.generate.mockResolvedValue({ choices: ['GENERIC', 'GENERIC'] });

    await pickImagesForPostContents('p1', POSTS);

    const call = mocks.generate.mock.calls[0][0];
    const prompt = call.prompt as string;
    expect(prompt).toContain('Kitchen remodel season is here!');
    expect(prompt).toContain('s1');
    expect(prompt).toContain('a new roof install');
    expect(prompt).not.toContain('g1');
    expect(prompt).toContain('Acme Remodeling');
  });

  it('caps the specific list sent to Claude at 40, least-recently-used first', async () => {
    const pool = Array.from({ length: 45 }, (_, i) =>
      specific(`s${String(i + 1).padStart(2, '0')}`)
    );
    mocks.prisma.profileImage.findMany.mockResolvedValue(pool);
    mocks.generate.mockResolvedValue({ choices: ['GENERIC', 'GENERIC'] });

    await pickImagesForPostContents('p1', POSTS);

    const prompt = mocks.generate.mock.calls[0][0].prompt as string;
    expect(prompt).toContain('s40');
    expect(prompt).not.toContain('s41');
  });

  it('keeps the wire schema permissive — id validation happens in code', async () => {
    // zodOutputFormat sends enum constraints only as description hints, so a
    // strict client-side enum would hard-fail the whole batch on one invented
    // id instead of reaching the per-post demotion path.
    mocks.prisma.profileImage.findMany.mockResolvedValue([
      specific('s1'),
      generic('g1'),
    ]);
    mocks.generate.mockResolvedValue({ choices: ['s1', 'GENERIC'] });

    await pickImagesForPostContents('p1', POSTS);

    const schema = mocks.generate.mock.calls[0][0].schema;
    expect(
      schema.safeParse({ choices: ['made-up-id', 'GENERIC'] }).success
    ).toBe(true);
  });
});

describe('pickImagesForPostContents fallback ladder', () => {
  it('returns [] for an empty batch', async () => {
    await expect(pickImagesForPostContents('p1', [])).resolves.toEqual([]);
    expect(mocks.prisma.profileImage.findMany).not.toHaveBeenCalled();
  });

  it('falls back to the legacy blind rotation when nothing is captioned (status quo)', async () => {
    mocks.prisma.profileImage.findMany.mockResolvedValue([
      uncaptioned('u1'),
      uncaptioned('u2'),
    ]);

    const picked = await pickImagesForPostContents('p1', [
      { content: 'a' },
      { content: 'b' },
      { content: 'c' },
    ]);

    expect(picked).toEqual(['u1', 'u2', 'u1']);
    expect(mocks.generate).not.toHaveBeenCalled();
  });

  it('queues captions for uncaptioned pool members (fire-and-forget)', async () => {
    mocks.prisma.profileImage.findMany.mockResolvedValue([
      generic('g1'),
      uncaptioned('u1'),
    ]);
    mocks.generate.mockResolvedValue({ choices: ['GENERIC', 'GENERIC'] });

    await pickImagesForPostContents('p1', POSTS);

    expect(mocks.enqueueCaptionsForProfile).toHaveBeenCalledWith('p1');
  });

  it('does not re-enqueue permanently skipped images', async () => {
    mocks.prisma.profileImage.findMany.mockResolvedValue([
      generic('g1'),
      permanentlySkipped('u1'),
    ]);

    await pickImagesForPostContents('p1', POSTS);

    expect(mocks.enqueueCaptionsForProfile).not.toHaveBeenCalled();
  });

  it('survives an enqueue failure', async () => {
    mocks.prisma.profileImage.findMany.mockResolvedValue([
      generic('g1'),
      uncaptioned('u1'),
    ]);
    mocks.enqueueCaptionsForProfile.mockRejectedValue(new Error('redis down'));

    const picked = await pickImagesForPostContents('p1', POSTS);

    expect(picked).toEqual(['g1', 'g1']);
  });

  it('once captions exist, uncaptioned images are never blind-attached', async () => {
    mocks.prisma.profileImage.findMany.mockResolvedValue([
      uncaptioned('u1'),
      generic('g1'),
    ]);
    mocks.generate.mockResolvedValue({ choices: ['GENERIC', 'GENERIC'] });

    const picked = await pickImagesForPostContents('p1', POSTS);

    expect(picked).toEqual(['g1', 'g1']);
  });

  it('skips the Claude call entirely when the captioned pool is all generic', async () => {
    mocks.prisma.profileImage.findMany.mockResolvedValue([
      generic('g1'),
      generic('g2'),
    ]);

    const picked = await pickImagesForPostContents('p1', POSTS);

    expect(picked).toEqual(['g1', 'g2']);
    expect(mocks.generate).not.toHaveBeenCalled();
  });

  it('falls back to generics-only rotation when the matcher call fails', async () => {
    mocks.prisma.profileImage.findMany.mockResolvedValue([
      specific('s1'),
      generic('g1'),
    ]);
    mocks.generate.mockRejectedValue(new Error('rate limited'));

    const picked = await pickImagesForPostContents('p1', POSTS);

    expect(picked).toEqual(['g1', 'g1']);
  });

  it('falls back to text-only when the matcher fails and there are no generics', async () => {
    mocks.prisma.profileImage.findMany.mockResolvedValue([specific('s1')]);
    mocks.generate.mockRejectedValue(new Error('rate limited'));

    const picked = await pickImagesForPostContents('p1', POSTS);

    expect(picked).toEqual([null, null]);
  });

  it('treats a choices/posts length mismatch as a matcher failure', async () => {
    mocks.prisma.profileImage.findMany.mockResolvedValue([
      specific('s1'),
      generic('g1'),
    ]);
    mocks.generate.mockResolvedValue({ choices: ['s1'] });

    const picked = await pickImagesForPostContents('p1', POSTS);

    expect(picked).toEqual(['g1', 'g1']);
  });

  it('returns all nulls when the pool query fails (never throws)', async () => {
    mocks.prisma.profileImage.findMany.mockRejectedValue(
      new Error('db exploded')
    );

    const picked = await pickImagesForPostContents('p1', POSTS);

    expect(picked).toEqual([null, null]);
  });

  it('returns all nulls when the library is empty and a recent sync already ran', async () => {
    mocks.prisma.profileImage.findMany.mockResolvedValue([]);

    const picked = await pickImagesForPostContents('p1', POSTS);

    expect(picked).toEqual([null, null]);
    expect(mocks.syncProfileMediaToLibrary).not.toHaveBeenCalled();
  });
});

describe('pickImagesForPostContents id validation', () => {
  it('demotes an invented image id to GENERIC', async () => {
    mocks.prisma.profileImage.findMany.mockResolvedValue([
      specific('s1'),
      generic('g1'),
    ]);
    mocks.generate.mockResolvedValue({ choices: ['made-up-id', 's1'] });

    const picked = await pickImagesForPostContents('p1', POSTS);

    expect(picked).toEqual(['g1', 's1']);
  });

  it('demotes a reused specific to GENERIC (one specific per batch)', async () => {
    mocks.prisma.profileImage.findMany.mockResolvedValue([
      specific('s1'),
      generic('g1'),
    ]);
    mocks.generate.mockResolvedValue({ choices: ['s1', 's1'] });

    const picked = await pickImagesForPostContents('p1', POSTS);

    expect(picked).toEqual(['s1', 'g1']);
  });

  it('demotes to text-only instead of GENERIC when there are no generics', async () => {
    mocks.prisma.profileImage.findMany.mockResolvedValue([specific('s1')]);
    mocks.generate.mockResolvedValue({ choices: ['made-up-id', 's1'] });

    const picked = await pickImagesForPostContents('p1', POSTS);

    expect(picked).toEqual([null, 's1']);
  });
});
