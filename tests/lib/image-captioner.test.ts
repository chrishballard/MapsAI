import { describe, it, expect, vi, beforeEach } from 'vitest';

// Vision captioning: every library image gets a short description, subject
// tags, and a generic-vs-specific flag so post/photo pairs can be matched
// for coherence. Captioning failures must never corrupt rows — transient
// failures throw (so BullMQ retries), permanent no-input cases are recorded
// as skips with captionedAt left null, and the batch helper never throws.

const mocks = vi.hoisted(() => ({
  generate: vi.fn(),
  prisma: {
    profileImage: { findUnique: vi.fn(), findMany: vi.fn(), update: vi.fn() },
  },
  fetch: vi.fn(),
}));

vi.mock('@/lib/claude', () => ({ generate: mocks.generate }));
vi.mock('@/lib/prisma', () => ({ prisma: mocks.prisma }));
vi.stubGlobal('fetch', mocks.fetch);

const { captionImage, captionImages, captionUncaptionedApproved } =
  await import('@/lib/image-captioner');

function imageRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'img1',
    status: 'APPROVED',
    data: null,
    thumbData: null,
    contentType: null,
    googleUrl: null,
    category: null,
    captionedAt: null,
    captionSkipReason: null,
    profile: { name: 'Badger Gutters', category: 'Gutter cleaning service' },
    ...overrides,
  };
}

function fetchResponse({
  ok = true,
  status = 200,
  contentType = 'image/jpeg',
  bytes = new Uint8Array([1, 2, 3]),
}: {
  ok?: boolean;
  status?: number;
  contentType?: string | null;
  bytes?: Uint8Array;
} = {}) {
  return {
    ok,
    status,
    headers: { get: (name: string) => (name.toLowerCase() === 'content-type' ? contentType : null) },
    arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.generate.mockResolvedValue({
    description: 'A finished kitchen remodel with white cabinets.',
    tags: ['Kitchen', 'remodel'],
    generic: false,
  });
  mocks.prisma.profileImage.update.mockResolvedValue({ id: 'img1' });
});

describe('captionImage input selection', () => {
  it('prefers thumbData (always JPEG) over data and googleUrl', async () => {
    const thumb = new Uint8Array([9, 9, 9]);
    mocks.prisma.profileImage.findUnique.mockResolvedValue(
      imageRow({
        thumbData: thumb,
        data: new Uint8Array([1]),
        contentType: 'image/png',
        googleUrl: 'https://lh3.googleusercontent.com/x',
      })
    );

    const result = await captionImage('img1');

    expect(result.ok).toBe(true);
    expect(mocks.fetch).not.toHaveBeenCalled();
    const call = mocks.generate.mock.calls[0][0];
    const content = call.prompt[0].content;
    const imageBlock = content.find((b: { type: string }) => b.type === 'image');
    expect(imageBlock.source.media_type).toBe('image/jpeg');
    expect(imageBlock.source.data).toBe(Buffer.from(thumb).toString('base64'));
  });

  it('falls back to original data with the stored contentType', async () => {
    const data = new Uint8Array([5, 6, 7]);
    mocks.prisma.profileImage.findUnique.mockResolvedValue(
      imageRow({ data, contentType: 'image/png' })
    );

    await captionImage('img1');

    const content = mocks.generate.mock.calls[0][0].prompt[0].content;
    const imageBlock = content.find((b: { type: string }) => b.type === 'image');
    expect(imageBlock.source.media_type).toBe('image/png');
    expect(imageBlock.source.data).toBe(Buffer.from(data).toString('base64'));
  });

  it('fetches a downscaled CDN variant of googleUrl for GBP-synced rows', async () => {
    // Full-res originals routinely exceed the vision byte cap (450 skipped
    // in the first prod backfill) and cost ~5x the tokens; the CDN's size
    // suffix serves a small variant.
    const bytes = new Uint8Array([7, 7]);
    mocks.prisma.profileImage.findUnique.mockResolvedValue(
      imageRow({ googleUrl: 'https://lh3.googleusercontent.com/photo', category: 'INTERIOR' })
    );
    mocks.fetch.mockResolvedValue(fetchResponse({ bytes }));

    const result = await captionImage('img1');

    expect(result.ok).toBe(true);
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    expect(mocks.fetch).toHaveBeenCalledWith(
      'https://lh3.googleusercontent.com/photo=s512',
      expect.objectContaining({ signal: expect.anything() })
    );
    const content = mocks.generate.mock.calls[0][0].prompt[0].content;
    const imageBlock = content.find((b: { type: string }) => b.type === 'image');
    expect(imageBlock.source.data).toBe(Buffer.from(bytes).toString('base64'));
  });

  it('falls back to the raw googleUrl when the sized variant fails', async () => {
    const bytes = new Uint8Array([8, 8]);
    mocks.prisma.profileImage.findUnique.mockResolvedValue(
      imageRow({ googleUrl: 'https://lh3.googleusercontent.com/photo' })
    );
    mocks.fetch
      .mockResolvedValueOnce(fetchResponse({ ok: false, status: 404 }))
      .mockResolvedValueOnce(fetchResponse({ bytes }));

    const result = await captionImage('img1');

    expect(result.ok).toBe(true);
    expect(mocks.fetch.mock.calls.map((c) => c[0])).toEqual([
      'https://lh3.googleusercontent.com/photo=s512',
      'https://lh3.googleusercontent.com/photo',
    ]);
  });

  it('does not append a size suffix to an already-parameterized URL', async () => {
    mocks.prisma.profileImage.findUnique.mockResolvedValue(
      imageRow({ googleUrl: 'https://lh3.googleusercontent.com/photo=w1000' })
    );
    mocks.fetch.mockResolvedValue(fetchResponse());

    await captionImage('img1');

    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    expect(mocks.fetch.mock.calls[0][0]).toBe(
      'https://lh3.googleusercontent.com/photo=w1000'
    );
  });

  it('includes business context and the GBP category hint in the prompt', async () => {
    mocks.prisma.profileImage.findUnique.mockResolvedValue(
      imageRow({ googleUrl: 'https://lh3.googleusercontent.com/photo', category: 'FOOD_AND_DRINK' })
    );
    mocks.fetch.mockResolvedValue(fetchResponse());

    await captionImage('img1');

    const call = mocks.generate.mock.calls[0][0];
    const text = call.prompt[0].content.find(
      (b: { type: string }) => b.type === 'text'
    ).text;
    expect(text).toContain('Badger Gutters');
    expect(text).toContain('Gutter cleaning service');
    expect(text).toContain('FOOD_AND_DRINK');
    expect(call.system).toMatch(/generic/i);
  });
});

describe('captionImage permanent skips (no Claude call, captionedAt untouched)', () => {
  it('NO_INPUT when the row has no bytes and no googleUrl', async () => {
    mocks.prisma.profileImage.findUnique.mockResolvedValue(imageRow());

    const result = await captionImage('img1');

    expect(result).toMatchObject({ ok: false, skipped: 'NO_INPUT' });
    expect(mocks.generate).not.toHaveBeenCalled();
  });

  it('persists the skip reason so the image is never reprocessed', async () => {
    mocks.prisma.profileImage.findUnique.mockResolvedValue(imageRow());

    await captionImage('img1');

    const arg = mocks.prisma.profileImage.update.mock.calls[0][0];
    expect(arg.where).toEqual({ id: 'img1' });
    expect(arg.data).toEqual({ captionSkipReason: 'NO_INPUT' });
    expect(arg.select).toEqual({ id: true });
  });

  it('is a noop for an image already marked permanently skipped', async () => {
    mocks.prisma.profileImage.findUnique.mockResolvedValue(
      imageRow({
        googleUrl: 'https://lh3.googleusercontent.com/x',
        captionSkipReason: 'FETCH_DENIED',
      })
    );

    const result = await captionImage('img1');

    expect(result).toMatchObject({ ok: false, skipped: 'FETCH_DENIED' });
    expect(mocks.fetch).not.toHaveBeenCalled();
    expect(mocks.generate).not.toHaveBeenCalled();
    expect(mocks.prisma.profileImage.update).not.toHaveBeenCalled();
  });

  it('treats the row as GONE when the skip persist hits P2025', async () => {
    mocks.prisma.profileImage.findUnique.mockResolvedValue(imageRow());
    mocks.prisma.profileImage.update.mockRejectedValue(
      Object.assign(new Error('Record not found'), { code: 'P2025' })
    );

    const result = await captionImage('img1');

    expect(result).toMatchObject({ ok: false, skipped: 'GONE' });
  });

  it('TOO_LARGE when stored bytes exceed the vision size cap', async () => {
    mocks.prisma.profileImage.findUnique.mockResolvedValue(
      imageRow({ data: new Uint8Array(5 * 1024 * 1024), contentType: 'image/jpeg' })
    );

    const result = await captionImage('img1');

    expect(result).toMatchObject({ ok: false, skipped: 'TOO_LARGE' });
    expect(mocks.generate).not.toHaveBeenCalled();
  });

  it('UNSUPPORTED_TYPE when a fetched response is not an image', async () => {
    mocks.prisma.profileImage.findUnique.mockResolvedValue(
      imageRow({ googleUrl: 'https://lh3.googleusercontent.com/photo' })
    );
    mocks.fetch.mockResolvedValue(fetchResponse({ contentType: 'text/html' }));

    const result = await captionImage('img1');

    expect(result).toMatchObject({ ok: false, skipped: 'UNSUPPORTED_TYPE' });
    expect(mocks.generate).not.toHaveBeenCalled();
  });

  it('FETCH_DENIED on a 4xx from the image host (stale URL — next sync refreshes it)', async () => {
    mocks.prisma.profileImage.findUnique.mockResolvedValue(
      imageRow({ googleUrl: 'https://lh3.googleusercontent.com/photo' })
    );
    mocks.fetch.mockResolvedValue(fetchResponse({ ok: false, status: 404 }));

    const result = await captionImage('img1');

    expect(result).toMatchObject({ ok: false, skipped: 'FETCH_DENIED' });
    expect(mocks.generate).not.toHaveBeenCalled();
  });

  it('GONE when the row no longer exists', async () => {
    mocks.prisma.profileImage.findUnique.mockResolvedValue(null);

    const result = await captionImage('img1');

    expect(result).toMatchObject({ ok: false, skipped: 'GONE' });
    expect(mocks.generate).not.toHaveBeenCalled();
  });

  it('GONE when the row vanishes between caption and persist (P2025)', async () => {
    mocks.prisma.profileImage.findUnique.mockResolvedValue(
      imageRow({ thumbData: new Uint8Array([1]) })
    );
    mocks.prisma.profileImage.update.mockRejectedValue(
      Object.assign(new Error('Record not found'), { code: 'P2025' })
    );

    const result = await captionImage('img1');

    expect(result).toMatchObject({ ok: false, skipped: 'GONE' });
  });
});

describe('captionImage transient failures (throw so BullMQ retries)', () => {
  it('throws when the image fetch rejects (network/timeout)', async () => {
    mocks.prisma.profileImage.findUnique.mockResolvedValue(
      imageRow({ googleUrl: 'https://lh3.googleusercontent.com/photo' })
    );
    mocks.fetch.mockRejectedValue(new Error('network down'));

    await expect(captionImage('img1')).rejects.toThrow('network down');
  });

  it('throws on a 5xx from the image host', async () => {
    mocks.prisma.profileImage.findUnique.mockResolvedValue(
      imageRow({ googleUrl: 'https://lh3.googleusercontent.com/photo' })
    );
    mocks.fetch.mockResolvedValue(fetchResponse({ ok: false, status: 503 }));

    await expect(captionImage('img1')).rejects.toThrow();
  });

  it('treats a 429 from the image host as transient, never a sticky skip', async () => {
    // A rate-limit burst during the backfill must not permanently poison
    // rows (a persisted FETCH_DENIED only recovers if the URL changes).
    mocks.prisma.profileImage.findUnique.mockResolvedValue(
      imageRow({ googleUrl: 'https://lh3.googleusercontent.com/photo' })
    );
    mocks.fetch.mockResolvedValue(fetchResponse({ ok: false, status: 429 }));

    await expect(captionImage('img1')).rejects.toThrow();
    expect(mocks.prisma.profileImage.update).not.toHaveBeenCalled();
  });

  it('throws when the Claude call fails', async () => {
    mocks.prisma.profileImage.findUnique.mockResolvedValue(
      imageRow({ thumbData: new Uint8Array([1]) })
    );
    mocks.generate.mockRejectedValue(new Error('rate limited'));

    await expect(captionImage('img1')).rejects.toThrow('rate limited');
  });

  it('throws when the persist fails for a non-P2025 reason', async () => {
    mocks.prisma.profileImage.findUnique.mockResolvedValue(
      imageRow({ thumbData: new Uint8Array([1]) })
    );
    mocks.prisma.profileImage.update.mockRejectedValue(new Error('db down'));

    await expect(captionImage('img1')).rejects.toThrow('db down');
  });
});

describe('captionImage persistence', () => {
  it('persists a clamped description, lowercased tags, the flag, and captionedAt', async () => {
    mocks.prisma.profileImage.findUnique.mockResolvedValue(
      imageRow({ thumbData: new Uint8Array([1]) })
    );
    mocks.generate.mockResolvedValue({
      description: 'X'.repeat(400),
      tags: ['Kitchen', 'REMODEL', 'cabinets', 'island', 'white', 'extra'],
      generic: false,
    });

    const result = await captionImage('img1');

    expect(result.ok).toBe(true);
    const arg = mocks.prisma.profileImage.update.mock.calls[0][0];
    expect(arg.where).toEqual({ id: 'img1' });
    expect(arg.data.aiDescription).toBe('X'.repeat(300));
    expect(arg.data.aiTags).toEqual(['kitchen', 'remodel', 'cabinets', 'island', 'white']);
    expect(arg.data.aiGeneric).toBe(false);
    expect(arg.data.captionedAt).toBeInstanceOf(Date);
    // Never return the row's multi-MB image bytes just to discard them.
    expect(arg.select).toEqual({ id: true });
  });

  it('does not constrain lengths on the wire — the slices are the enforcement', async () => {
    // zodOutputFormat demotes max/maxItems to description hints, so strict
    // schema caps would make generate() throw on benign over-limit output
    // (a billed retry loop) instead of reaching the tolerate-and-trim path.
    mocks.prisma.profileImage.findUnique.mockResolvedValue(
      imageRow({ thumbData: new Uint8Array([1]) })
    );

    await captionImage('img1');

    const schema = mocks.generate.mock.calls[0][0].schema;
    const overLimit = schema.safeParse({
      description: 'X'.repeat(400),
      tags: ['commercial gutter installation equipment', 'a', 'b', 'c', 'd', 'e'],
      generic: true,
    });
    expect(overLimit.success).toBe(true);
  });

  it('is an idempotent noop for an already-captioned image', async () => {
    mocks.prisma.profileImage.findUnique.mockResolvedValue(
      imageRow({ thumbData: new Uint8Array([1]), captionedAt: new Date() })
    );

    const result = await captionImage('img1');

    expect(result.ok).toBe(true);
    expect(mocks.generate).not.toHaveBeenCalled();
    expect(mocks.prisma.profileImage.update).not.toHaveBeenCalled();
  });
});

describe('captionImages (batch)', () => {
  it('never throws — per-image transient failures become error results', async () => {
    mocks.prisma.profileImage.findUnique
      .mockResolvedValueOnce(imageRow({ id: 'a', thumbData: new Uint8Array([1]) }))
      .mockResolvedValueOnce(imageRow({ id: 'b', googleUrl: 'https://lh3.googleusercontent.com/x' }))
      .mockResolvedValueOnce(imageRow({ id: 'c', thumbData: new Uint8Array([2]) }));
    mocks.fetch.mockRejectedValue(new Error('network down'));
    mocks.prisma.profileImage.update.mockResolvedValue({ id: 'x' });

    const results = await captionImages(['a', 'b', 'c'], { concurrency: 1 });

    expect(results).toHaveLength(3);
    expect(results[0].ok).toBe(true);
    expect(results[1]).toMatchObject({ imageId: 'b', ok: false });
    expect(results[1].error).toContain('network down');
    expect(results[2].ok).toBe(true);
  });

  it('returns [] for an empty id list without touching anything', async () => {
    const results = await captionImages([]);
    expect(results).toEqual([]);
    expect(mocks.prisma.profileImage.findUnique).not.toHaveBeenCalled();
  });
});

describe('captionUncaptionedApproved (bounded pre-pass)', () => {
  it('captions up to the limit of APPROVED uncaptioned images and never throws', async () => {
    mocks.prisma.profileImage.findMany.mockResolvedValue([{ id: 'a' }, { id: 'b' }]);
    mocks.prisma.profileImage.findUnique
      .mockResolvedValueOnce(imageRow({ id: 'a', thumbData: new Uint8Array([1]) }))
      .mockResolvedValueOnce(imageRow({ id: 'b', thumbData: new Uint8Array([2]) }));

    const count = await captionUncaptionedApproved('p1', { limit: 10, concurrency: 1 });

    expect(count).toBe(2);
    const query = mocks.prisma.profileImage.findMany.mock.calls[0][0];
    expect(query.where).toMatchObject({
      profileId: 'p1',
      status: 'APPROVED',
      captionedAt: null,
      captionSkipReason: null,
    });
    expect(query.take).toBe(10);
  });

  it('swallows a failing query (pre-pass must never block its caller)', async () => {
    mocks.prisma.profileImage.findMany.mockRejectedValue(new Error('db down'));

    await expect(captionUncaptionedApproved('p1')).resolves.toBe(0);
  });
});
