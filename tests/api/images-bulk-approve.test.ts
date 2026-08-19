import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextResponse } from 'next/server';

// Bulk status change on /api/images — one updateMany backs "Approve all"
// instead of a request per pending photo.

const mocks = vi.hoisted(() => ({
  prisma: {
    profileImage: { updateMany: vi.fn() },
  },
  requireProfile: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({ prisma: mocks.prisma }));
vi.mock('@/lib/auth/require-session', () => ({
  requireSession: vi.fn(async () => null),
  requireProfile: mocks.requireProfile,
}));

const { PATCH } = await import('@/app/api/images/route');

function patchRequest(body: unknown): Request {
  return new Request('http://localhost:3000/api/images', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireProfile.mockResolvedValue({ id: 'p1' });
  mocks.prisma.profileImage.updateMany.mockResolvedValue({ count: 3 });
});

describe('PATCH /api/images (bulk status)', () => {
  it('moves all matching images in one updateMany scoped to the profile', async () => {
    const res = await PATCH(
      patchRequest({ profileId: 'p1', from: 'PENDING', to: 'APPROVED' })
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ updated: 3 });
    expect(mocks.prisma.profileImage.updateMany).toHaveBeenCalledWith({
      where: { profileId: 'p1', status: 'PENDING' },
      data: { status: 'APPROVED' },
    });
  });

  it('rejects invalid status values', async () => {
    const res = await PATCH(
      patchRequest({ profileId: 'p1', from: 'PENDING', to: 'PUBLISHED' })
    );
    expect(res.status).toBe(400);
    expect(mocks.prisma.profileImage.updateMany).not.toHaveBeenCalled();
  });

  it('propagates profile lookup failures', async () => {
    mocks.requireProfile.mockResolvedValue(
      NextResponse.json({ error: 'Profile not found' }, { status: 404 })
    );
    const res = await PATCH(
      patchRequest({ profileId: 'nope', from: 'PENDING', to: 'APPROVED' })
    );
    expect(res.status).toBe(404);
  });
});
