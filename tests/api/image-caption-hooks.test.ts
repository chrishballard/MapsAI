import { describe, it, expect, vi, beforeEach } from 'vitest';

// Caption enqueue hooks: every path that lands an APPROVED image (team
// upload, single approval, bulk approve-all) queues captioning — and a
// queueing problem must never change the route's outcome.

const mocks = vi.hoisted(() => ({
  prisma: {
    profileImage: { update: vi.fn(), updateMany: vi.fn() },
  },
  requireProfile: vi.fn(),
  getServerSession: vi.fn(),
  storeUploadedImages: vi.fn(),
  filesFromForm: vi.fn(),
  enqueueImageCaption: vi.fn(),
  enqueueCaptionsForProfile: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({ prisma: mocks.prisma }));
vi.mock('@/lib/auth', () => ({ authOptions: {} }));
vi.mock('next-auth', () => ({ getServerSession: mocks.getServerSession }));
vi.mock('@/lib/auth/require-session', () => ({
  requireSession: vi.fn(async () => null),
  requireProfile: mocks.requireProfile,
}));
vi.mock('@/lib/image-upload', () => ({
  storeUploadedImages: mocks.storeUploadedImages,
  filesFromForm: mocks.filesFromForm,
}));
vi.mock('@/lib/queue/image-caption-queue', () => ({
  enqueueImageCaption: mocks.enqueueImageCaption,
  enqueueCaptionsForProfile: mocks.enqueueCaptionsForProfile,
}));

const { POST, PATCH: bulkPatch } = await import('@/app/api/images/route');
const { PATCH: singlePatch } = await import('@/app/api/images/[id]/route');

function jsonRequest(url: string, body: unknown): Request {
  return new Request(url, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function uploadRequest(): Request {
  const form = new FormData();
  form.set('profileId', 'p1');
  form.set('files', new File([new Uint8Array(16)], 'a.jpg', { type: 'image/jpeg' }));
  return new Request('http://localhost:3000/api/images', {
    method: 'POST',
    body: form,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireProfile.mockResolvedValue({ id: 'p1' });
  mocks.getServerSession.mockResolvedValue({ user: { email: 'team@x.com' } });
  mocks.filesFromForm.mockReturnValue([{ name: 'a.jpg' }]);
  mocks.storeUploadedImages.mockResolvedValue([{ ok: true, id: 'img1' }]);
  mocks.prisma.profileImage.updateMany.mockResolvedValue({ count: 2 });
  mocks.prisma.profileImage.update.mockResolvedValue({
    id: 'img1',
    status: 'APPROVED',
    captionedAt: null,
  });
  mocks.enqueueImageCaption.mockResolvedValue(undefined);
  mocks.enqueueCaptionsForProfile.mockResolvedValue(1);
});

describe('POST /api/images (team upload)', () => {
  it('enqueues captions for the profile after storing uploads', async () => {
    const res = await POST(uploadRequest());

    expect(res.status).toBe(200);
    expect(mocks.enqueueCaptionsForProfile).toHaveBeenCalledWith('p1');
  });

  it('skips enqueueing when nothing was stored', async () => {
    mocks.storeUploadedImages.mockResolvedValue([
      { ok: false, error: 'too small' },
    ]);

    const res = await POST(uploadRequest());

    expect(res.status).toBe(200);
    expect(mocks.enqueueCaptionsForProfile).not.toHaveBeenCalled();
  });
});

describe('PATCH /api/images (bulk approve)', () => {
  it('enqueues captions when images move to APPROVED', async () => {
    const res = await bulkPatch(
      jsonRequest('http://localhost:3000/api/images', {
        profileId: 'p1',
        from: 'PENDING',
        to: 'APPROVED',
      })
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ updated: 2 });
    expect(mocks.enqueueCaptionsForProfile).toHaveBeenCalledWith('p1');
  });

  it('does not enqueue for non-APPROVED transitions', async () => {
    await bulkPatch(
      jsonRequest('http://localhost:3000/api/images', {
        profileId: 'p1',
        from: 'APPROVED',
        to: 'HIDDEN',
      })
    );

    expect(mocks.enqueueCaptionsForProfile).not.toHaveBeenCalled();
  });

  it('does not enqueue when nothing matched', async () => {
    mocks.prisma.profileImage.updateMany.mockResolvedValue({ count: 0 });

    await bulkPatch(
      jsonRequest('http://localhost:3000/api/images', {
        profileId: 'p1',
        from: 'PENDING',
        to: 'APPROVED',
      })
    );

    expect(mocks.enqueueCaptionsForProfile).not.toHaveBeenCalled();
  });
});

describe('PATCH /api/images/[id] (single approval)', () => {
  const params = { params: Promise.resolve({ id: 'img1' }) };

  it('enqueues a caption when an uncaptioned image becomes APPROVED', async () => {
    const res = await singlePatch(
      jsonRequest('http://localhost:3000/api/images/img1', {
        status: 'APPROVED',
      }),
      params
    );

    expect(res.status).toBe(200);
    // Response shape stays exactly {id, status} — captionedAt is internal.
    await expect(res.json()).resolves.toEqual({
      id: 'img1',
      status: 'APPROVED',
    });
    expect(mocks.enqueueImageCaption).toHaveBeenCalledWith('img1');
  });

  it('skips already-captioned images', async () => {
    mocks.prisma.profileImage.update.mockResolvedValue({
      id: 'img1',
      status: 'APPROVED',
      captionedAt: new Date(),
    });

    await singlePatch(
      jsonRequest('http://localhost:3000/api/images/img1', {
        status: 'APPROVED',
      }),
      params
    );

    expect(mocks.enqueueImageCaption).not.toHaveBeenCalled();
  });

  it('does not enqueue when hiding an image', async () => {
    mocks.prisma.profileImage.update.mockResolvedValue({
      id: 'img1',
      status: 'HIDDEN',
      captionedAt: null,
    });

    await singlePatch(
      jsonRequest('http://localhost:3000/api/images/img1', {
        status: 'HIDDEN',
      }),
      params
    );

    expect(mocks.enqueueImageCaption).not.toHaveBeenCalled();
  });

  it('still succeeds when the enqueue fails (captioning never blocks approval)', async () => {
    mocks.enqueueImageCaption.mockRejectedValue(new Error('redis down'));

    const res = await singlePatch(
      jsonRequest('http://localhost:3000/api/images/img1', {
        status: 'APPROVED',
      }),
      params
    );

    expect(res.status).toBe(200);
  });
});
