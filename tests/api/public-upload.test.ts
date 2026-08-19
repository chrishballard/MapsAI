import { describe, it, expect, vi, beforeEach } from 'vitest';
import { pngBytes, junkBytes } from '../helpers/image-fixtures';

// The public client upload endpoint — token-authenticated, photos land as
// PENDING so a team member reviews them before they can reach a post.
// Storage runs inside a per-profile advisory-lock transaction so concurrent
// uploads can't race past the library cap.

const mocks = vi.hoisted(() => ({
  prisma: {
    profile: { findUnique: vi.fn() },
    profileImage: { count: vi.fn(), create: vi.fn() },
    $executeRaw: vi.fn(),
    $transaction: vi.fn(),
  },
}));

vi.mock('@/lib/prisma', () => ({ prisma: mocks.prisma }));

const { POST } = await import('@/app/api/public/upload/[token]/route');

const TOKEN = 'ab'.repeat(16);

function uploadRequest(files: Array<{ name: string; bytes: Uint8Array }>): Request {
  const form = new FormData();
  for (const f of files) {
    form.append('files', new File([f.bytes as BlobPart], f.name, { type: 'image/png' }));
  }
  return new Request(`http://localhost:3000/api/public/upload/${TOKEN}`, {
    method: 'POST',
    body: form,
  });
}

function call(request: Request, token = TOKEN) {
  return POST(request, { params: Promise.resolve({ token }) });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.prisma.profile.findUnique.mockResolvedValue({
    id: 'p1',
    name: 'Badger Test Gutters',
    isConnected: true,
  });
  // Interactive transaction: hand the callback a tx that shares the mocks.
  mocks.prisma.$transaction.mockImplementation(
    async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({
        $executeRaw: mocks.prisma.$executeRaw,
        profileImage: mocks.prisma.profileImage,
      })
  );
  mocks.prisma.profileImage.count.mockResolvedValue(0);
  mocks.prisma.profileImage.create.mockResolvedValue({ id: 'img1' });
});

describe('POST /api/public/upload/[token]', () => {
  it('404s for a malformed token without touching the DB', async () => {
    const res = await call(
      uploadRequest([{ name: 'a.png', bytes: pngBytes(800, 600) }]),
      'not-a-token'
    );
    expect(res.status).toBe(404);
    expect(mocks.prisma.profile.findUnique).not.toHaveBeenCalled();
  });

  it('404s for an unknown or disconnected profile', async () => {
    mocks.prisma.profile.findUnique.mockResolvedValue(null);
    const res = await call(uploadRequest([{ name: 'a.png', bytes: pngBytes(800, 600) }]));
    expect(res.status).toBe(404);

    mocks.prisma.profile.findUnique.mockResolvedValue({
      id: 'p1',
      name: 'X',
      isConnected: false,
    });
    const res2 = await call(uploadRequest([{ name: 'a.png', bytes: pngBytes(800, 600) }]));
    expect(res2.status).toBe(404);
  });

  it('stores valid photos as PENDING CLIENT uploads under the advisory lock', async () => {
    const res = await call(uploadRequest([{ name: 'deck.png', bytes: pngBytes(1200, 900) }]));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.stored).toBe(1);
    expect(body.results[0]).toMatchObject({ fileName: 'deck.png', ok: true });

    // Cap enforcement is serialized per profile.
    expect(mocks.prisma.$executeRaw).toHaveBeenCalledTimes(1);

    expect(mocks.prisma.profileImage.create).toHaveBeenCalledTimes(1);
    const createArg = mocks.prisma.profileImage.create.mock.calls[0][0];
    expect(createArg.data).toMatchObject({
      profileId: 'p1',
      source: 'CLIENT',
      status: 'PENDING',
      contentType: 'image/png',
      width: 1200,
      height: 900,
      // Header-only fixture can't be decoded, so no thumbnail is stored.
      thumbData: null,
    });
    expect(createArg.data.publicToken).toMatch(/^[a-f0-9]{32}$/);
  });

  it('stores a real thumbnail for decodable images larger than the thumb size', async () => {
    const { createCanvas } = await import('canvas');
    const canvas = createCanvas(800, 600);
    const ctx = canvas.getContext('2d');
    for (let i = 0; i < 3000; i++) {
      ctx.fillStyle = `rgb(${(i * 37) % 255},${(i * 61) % 255},${(i * 89) % 255})`;
      ctx.fillRect((i * 13) % 800, (i * 29) % 600, 10, 10);
    }
    const realPng = new Uint8Array(canvas.toBuffer('image/png'));
    expect(realPng.byteLength).toBeGreaterThan(10 * 1024);

    const res = await call(uploadRequest([{ name: 'real.png', bytes: realPng }]));
    expect(res.status).toBe(200);

    const createArg = mocks.prisma.profileImage.create.mock.calls[0][0];
    const thumb = createArg.data.thumbData as Uint8Array;
    expect(thumb).toBeInstanceOf(Uint8Array);
    // Thumbs are JPEG re-encodes (noise-heavy test images can outweigh the
    // PNG original, so assert the format rather than the byte count).
    expect([thumb[0], thumb[1], thumb[2]]).toEqual([0xff, 0xd8, 0xff]);
  });

  it('reports per-file validation errors without failing the batch', async () => {
    const res = await call(
      uploadRequest([
        { name: 'good.png', bytes: pngBytes(800, 600) },
        { name: 'bad.txt', bytes: junkBytes() },
        { name: 'tiny.png', bytes: pngBytes(100, 100) },
      ])
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.stored).toBe(1);
    expect(body.results).toHaveLength(3);
    expect(body.results[1].ok).toBe(false);
    expect(body.results[1].error).toMatch(/JPG and PNG/);
    expect(body.results[2].ok).toBe(false);
    expect(body.results[2].error).toMatch(/400x300/);
  });

  it('rejects uploads once the profile library is full', async () => {
    mocks.prisma.profileImage.count.mockResolvedValue(500);
    const res = await call(uploadRequest([{ name: 'a.png', bytes: pngBytes(800, 600) }]));
    const body = await res.json();
    expect(body.stored).toBe(0);
    expect(body.results[0].error).toMatch(/library is full/);
    expect(mocks.prisma.profileImage.create).not.toHaveBeenCalled();
  });

  it('400s on an empty form', async () => {
    const res = await call(uploadRequest([]));
    expect(res.status).toBe(400);
  });
});
