import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// Disconnecting a Google account (Settings) cascade-deletes every profile
// under that login and all of their history in RankMaps. It used to take a
// bare DELETE, so one stray request or an OK clicked too fast was enough.
// The route now refuses unless the body names the account's own email.

const mocks = vi.hoisted(() => ({
  prisma: {
    googleAccount: { findUnique: vi.fn(), delete: vi.fn() },
  },
}));

vi.mock('@/lib/prisma', () => ({ prisma: mocks.prisma }));
vi.mock('@/lib/auth/require-session', () => ({
  requireSession: vi.fn(async () => null),
}));

const { DELETE } = await import('@/app/api/google-accounts/[id]/route');

function del(body?: unknown): NextRequest {
  return new NextRequest('http://localhost:3000/api/google-accounts/ga1', {
    method: 'DELETE',
    ...(body === undefined
      ? {}
      : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  });
}

const params = (id = 'ga1') => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  mocks.prisma.googleAccount.findUnique.mockResolvedValue({
    id: 'ga1',
    googleEmail: 'owner@badgergutters.com',
  });
  mocks.prisma.googleAccount.delete.mockResolvedValue({ id: 'ga1' });
});

describe('DELETE /api/google-accounts/[id]', () => {
  it('refuses a bare DELETE with no confirmation', async () => {
    const res = await DELETE(del(), params());
    expect(res.status).toBe(400);
    expect(mocks.prisma.googleAccount.delete).not.toHaveBeenCalled();
  });

  it('refuses when the email does not match the account', async () => {
    const res = await DELETE(del({ confirmEmail: 'someone@else.com' }), params());
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/does not match/i);
    expect(mocks.prisma.googleAccount.delete).not.toHaveBeenCalled();
  });

  it('deletes when the email matches, ignoring case and surrounding spaces', async () => {
    const res = await DELETE(del({ confirmEmail: '  Owner@BadgerGutters.com ' }), params());
    expect(res.status).toBe(200);
    expect(mocks.prisma.googleAccount.delete).toHaveBeenCalledWith({ where: { id: 'ga1' } });
  });

  it('404s for an account that does not exist', async () => {
    mocks.prisma.googleAccount.findUnique.mockResolvedValue(null);
    const res = await DELETE(del({ confirmEmail: 'owner@badgergutters.com' }), params('gone'));
    expect(res.status).toBe(404);
    expect(mocks.prisma.googleAccount.delete).not.toHaveBeenCalled();
  });

  it('404s when the account went away between the check and the delete', async () => {
    mocks.prisma.googleAccount.delete.mockRejectedValue(
      Object.assign(new Error('gone'), { code: 'P2025' })
    );
    const res = await DELETE(del({ confirmEmail: 'owner@badgergutters.com' }), params());
    expect(res.status).toBe(404);
  });
});
