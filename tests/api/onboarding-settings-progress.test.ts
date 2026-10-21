import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// PATCH /api/onboarding/settings and PATCH /api/onboarding/progress. Both
// caught every error as "not found", so a dropped DB connection told the
// operator the profile didn't exist. And progress set completedAt when the
// wizard was completed but never cleared it, so a profile whose wizard was
// re-opened read as not complete with a completion date still on it.

const mocks = vi.hoisted(() => ({
  prisma: {
    profile: { findUnique: vi.fn(), update: vi.fn() },
    onboardingProgress: { findUnique: vi.fn(), upsert: vi.fn(), update: vi.fn() },
  },
}));

vi.mock('@/lib/prisma', () => ({ prisma: mocks.prisma }));
vi.mock('@/lib/auth/require-session', () => ({
  requireSession: vi.fn(async () => null),
  requireProfile: vi.fn(),
}));

const settingsRoute = await import('@/app/api/onboarding/settings/route');
const progressRoute = await import('@/app/api/onboarding/progress/route');

function patchRequest(url: string, body: unknown): NextRequest {
  return new NextRequest(`http://localhost:3000${url}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const notFound = () => Object.assign(new Error('not found'), { code: 'P2025' });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.prisma.profile.update.mockResolvedValue({ postFrequency: 3 });
  mocks.prisma.onboardingProgress.update.mockImplementation(
    async ({ data }: { data: Record<string, unknown> }) => ({ id: 'op1', ...data })
  );
});

describe('PATCH /api/onboarding/settings', () => {
  const settings = (profileId: string) =>
    patchRequest('/api/onboarding/settings', { profileId, postFrequency: 3 });

  it('404s when the profile is gone (P2025)', async () => {
    mocks.prisma.profile.update.mockRejectedValueOnce(notFound());
    const res = await settingsRoute.PATCH(settings('gone'));
    expect(res.status).toBe(404);
  });

  it('lets any other failure through instead of calling it a missing profile', async () => {
    mocks.prisma.profile.update.mockRejectedValueOnce(new Error('db down'));
    await expect(settingsRoute.PATCH(settings('p1'))).rejects.toThrow('db down');
  });
});

describe('PATCH /api/onboarding/progress', () => {
  const progress = (body: Record<string, unknown>) =>
    patchRequest('/api/onboarding/progress', { profileId: 'p1', ...body });

  const sentData = () =>
    mocks.prisma.onboardingProgress.update.mock.calls[0][0].data as Record<string, unknown>;

  it('stamps completedAt when the wizard is completed', async () => {
    const res = await progressRoute.PATCH(progress({ currentStep: 6, isComplete: true }));
    expect(res.status).toBe(200);
    expect(sentData().isComplete).toBe(true);
    expect(sentData().completedAt).toBeInstanceOf(Date);
  });

  it('clears completedAt when the wizard is marked not complete again', async () => {
    // What the wizard sends when someone re-opens a finished profile and
    // steps back through it.
    const res = await progressRoute.PATCH(progress({ currentStep: 2, isComplete: false }));
    expect(res.status).toBe(200);
    expect(sentData()).toMatchObject({ isComplete: false, completedAt: null });
  });

  it('leaves completedAt alone when completion is not part of the update', async () => {
    await progressRoute.PATCH(progress({ currentStep: 3 }));
    expect(sentData()).toEqual({ currentStep: 3 });
  });

  it('404s when there is no progress row (P2025)', async () => {
    mocks.prisma.onboardingProgress.update.mockRejectedValueOnce(notFound());
    const res = await progressRoute.PATCH(progress({ currentStep: 1 }));
    expect(res.status).toBe(404);
  });

  it('lets any other failure through instead of calling it missing', async () => {
    mocks.prisma.onboardingProgress.update.mockRejectedValueOnce(new Error('db down'));
    await expect(progressRoute.PATCH(progress({ currentStep: 1 }))).rejects.toThrow('db down');
  });
});
