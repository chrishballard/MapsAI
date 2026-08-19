import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// The replace wiring is safety-critical: the onboarding wizard always sends
// its complete list, so its save must delete deselected rows (stale approved
// rows get pushed back to Google otherwise) — while the reoptimize PUT serves
// both the full-list editor (replace: true in the body) and the suggestions
// panel's one-service saves, which must never delete other rows.

const mocks = vi.hoisted(() => ({
  prisma: {
    profile: { findUnique: vi.fn() },
  },
  saveProfileServices: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({ prisma: mocks.prisma }));
vi.mock('@/lib/auth/require-session', () => ({
  requireSession: vi.fn(async () => null),
  requireProfile: vi.fn(),
}));
vi.mock('@/lib/profile-services', () => ({
  saveProfileServices: mocks.saveProfileServices,
}));
vi.mock('@/lib/google-business-info', () => ({
  fetchStructuredServices: vi.fn(),
}));
vi.mock('@/lib/service-generator', () => ({
  generateServiceDescriptions: vi.fn(),
  ServiceGenerationIncompleteError: class extends Error {},
}));
vi.mock('@/lib/website-scraper', () => ({
  scrapeWebsiteText: vi.fn(),
}));

const { POST: onboardingSavePOST } = await import(
  '@/app/api/onboarding/services/route'
);
const { PUT: reoptimizeSavePUT } = await import(
  '@/app/api/reoptimize/services/route'
);

const services = [
  { serviceName: 'Drain Cleaning', description: 'A', isStructured: true },
];

function request(body: object): NextRequest {
  return new NextRequest('http://localhost:3000/api/services-save', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.prisma.profile.findUnique.mockResolvedValue({ id: 'p1' });
  mocks.saveProfileServices.mockResolvedValue([]);
});

describe('services save replace wiring', () => {
  it('onboarding POST always saves with replace: true (wizard sends the complete list)', async () => {
    const res = await onboardingSavePOST(
      request({ profileId: 'p1', services })
    );
    expect(res.status).toBe(200);
    expect(mocks.saveProfileServices).toHaveBeenCalledWith('p1', services, {
      replace: true,
    });
  });

  it('reoptimize PUT defaults to a non-destructive partial save (suggestions panel)', async () => {
    const res = await reoptimizeSavePUT(
      request({ profileId: 'p1', services })
    );
    expect(res.status).toBe(200);
    expect(mocks.saveProfileServices).toHaveBeenCalledWith('p1', services, {
      replace: false,
    });
  });

  it('reoptimize PUT forwards replace: true for full-list saves (editor)', async () => {
    const res = await reoptimizeSavePUT(
      request({ profileId: 'p1', services, replace: true })
    );
    expect(res.status).toBe(200);
    expect(mocks.saveProfileServices).toHaveBeenCalledWith('p1', services, {
      replace: true,
    });
  });
});
