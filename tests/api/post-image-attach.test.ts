import { describe, it, expect, vi, beforeEach } from 'vitest';

// Manually attaching a library image to a post via PATCH /api/posts/[id]:
// the image must belong to the post's profile and be approved.

const mocks = vi.hoisted(() => ({
  prisma: {
    post: { findUnique: vi.fn(), update: vi.fn() },
    profileImage: { findUnique: vi.fn() },
  },
  markImagesUsed: vi.fn(async () => {}),
}));

vi.mock('@/lib/prisma', () => ({ prisma: mocks.prisma }));
vi.mock('@/lib/auth/require-session', () => ({
  requireSession: vi.fn(async () => null),
  requireProfile: vi.fn(),
}));
vi.mock('@/lib/post-images', () => ({ markImagesUsed: mocks.markImagesUsed }));

const { PATCH } = await import('@/app/api/posts/[id]/route');

function patchRequest(body: unknown): Request {
  return new Request('http://localhost:3000/api/posts/post1', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function call(body: unknown) {
  return PATCH(patchRequest(body), { params: Promise.resolve({ id: 'post1' }) });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.prisma.post.findUnique.mockResolvedValue({
    id: 'post1',
    profileId: 'p1',
    status: 'DRAFT',
    imageId: null,
  });
  mocks.prisma.post.update.mockImplementation(async ({ data }) => ({
    id: 'post1',
    ...data,
  }));
});

describe('PATCH /api/posts/[id] imageId', () => {
  it('attaches an approved image from the same profile and records a use', async () => {
    mocks.prisma.profileImage.findUnique.mockResolvedValue({
      profileId: 'p1',
      status: 'APPROVED',
    });

    const res = await call({ imageId: 'img1' });

    expect(res.status).toBe(200);
    expect(mocks.prisma.post.update).toHaveBeenCalledWith({
      where: { id: 'post1' },
      data: { imageId: 'img1' },
    });
    expect(mocks.markImagesUsed).toHaveBeenCalledWith(['img1']);
  });

  it("rejects an image belonging to a different profile", async () => {
    mocks.prisma.profileImage.findUnique.mockResolvedValue({
      profileId: 'other-profile',
      status: 'APPROVED',
    });

    const res = await call({ imageId: 'img1' });

    expect(res.status).toBe(400);
    expect(mocks.prisma.post.update).not.toHaveBeenCalled();
  });

  it('rejects an unapproved image', async () => {
    mocks.prisma.profileImage.findUnique.mockResolvedValue({
      profileId: 'p1',
      status: 'PENDING',
    });

    const res = await call({ imageId: 'img1' });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/approved/i);
  });

  it('allows removing the image with imageId: null', async () => {
    const res = await call({ imageId: null });

    expect(res.status).toBe(200);
    expect(mocks.prisma.post.update).toHaveBeenCalledWith({
      where: { id: 'post1' },
      data: { imageId: null },
    });
    expect(mocks.markImagesUsed).not.toHaveBeenCalled();
  });

  it('refuses image edits on published posts', async () => {
    mocks.prisma.post.findUnique.mockResolvedValue({
      id: 'post1',
      profileId: 'p1',
      status: 'PUBLISHED',
      imageId: null,
    });

    const res = await call({ imageId: 'img1' });

    expect(res.status).toBe(400);
  });
});
