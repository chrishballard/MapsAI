import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// /api/reviews/settings backs the Reviews on/off switch and the
// "Train RankMaps" box.

const mocks = vi.hoisted(() => ({
  prisma: {
    profile: { findUnique: vi.fn(), update: vi.fn() },
  },
}));

vi.mock('@/lib/prisma', () => ({ prisma: mocks.prisma }));
vi.mock('@/lib/auth/require-session', () => ({
  requireSession: vi.fn(async () => null),
  requireProfile: vi.fn(),
}));

const { GET, PATCH } = await import('@/app/api/reviews/settings/route');
const { MAX_REVIEW_INSTRUCTIONS_CHARS } = await import('@/lib/review-responder');

function patchRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost:3000/api/reviews/settings', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.prisma.profile.update.mockImplementation(
    async ({ data }: { data: Record<string, unknown> }) => ({
      reviewsEnabled: data.reviewsEnabled ?? true,
      reviewInstructions: data.reviewInstructions ?? null,
    })
  );
});

describe('GET /api/reviews/settings', () => {
  it('returns the profile settings', async () => {
    mocks.prisma.profile.findUnique.mockResolvedValue({
      reviewsEnabled: false,
      reviewInstructions: 'Respond as Ben.',
    });

    const res = await GET(
      new NextRequest(
        'http://localhost:3000/api/reviews/settings?profileId=p1'
      )
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      reviewsEnabled: false,
      reviewInstructions: 'Respond as Ben.',
    });
  });

  it('400s without a profileId and 404s for an unknown profile', async () => {
    const missing = await GET(
      new NextRequest('http://localhost:3000/api/reviews/settings')
    );
    expect(missing.status).toBe(400);

    mocks.prisma.profile.findUnique.mockResolvedValue(null);
    const unknown = await GET(
      new NextRequest(
        'http://localhost:3000/api/reviews/settings?profileId=nope'
      )
    );
    expect(unknown.status).toBe(404);
  });
});

describe('PATCH /api/reviews/settings', () => {
  it('turns reviews off without touching the instructions', async () => {
    const res = await PATCH(
      patchRequest({ profileId: 'p1', reviewsEnabled: false })
    );

    expect(res.status).toBe(200);
    expect(mocks.prisma.profile.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'p1' },
        data: { reviewsEnabled: false },
      })
    );
  });

  it('stores blank instructions as null', async () => {
    await PATCH(patchRequest({ profileId: 'p1', reviewInstructions: '   ' }));

    expect(mocks.prisma.profile.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { reviewInstructions: null } })
    );
  });

  it('rejects instructions over the length cap', async () => {
    const res = await PATCH(
      patchRequest({
        profileId: 'p1',
        reviewInstructions: 'x'.repeat(MAX_REVIEW_INSTRUCTIONS_CHARS + 1),
      })
    );

    expect(res.status).toBe(400);
    expect(mocks.prisma.profile.update).not.toHaveBeenCalled();
  });

  it('rejects a body with nothing to update', async () => {
    const res = await PATCH(patchRequest({ profileId: 'p1' }));

    expect(res.status).toBe(400);
    expect(mocks.prisma.profile.update).not.toHaveBeenCalled();
  });
});
