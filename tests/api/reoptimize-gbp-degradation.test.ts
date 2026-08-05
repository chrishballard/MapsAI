import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// A GBP outage (revoked token, Google 5xx, network blip) must not take the
// re-optimization page down: the GET routes should still return the saved
// copy from Postgres with the live GBP value degraded to null + gbpError set,
// mirroring the onboarding description route's pattern.

const mocks = vi.hoisted(() => ({
  prisma: {
    profile: { findUnique: vi.fn() },
    profileDescription: { findFirst: vi.fn() },
    profileKeyword: { findMany: vi.fn() },
    profileService: { findMany: vi.fn() },
  },
  fetchCurrentDescription: vi.fn(),
  fetchStructuredServices: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({ prisma: mocks.prisma }));
vi.mock('@/lib/auth/require-session', () => ({
  requireSession: vi.fn(async () => null),
  requireProfile: vi.fn(),
}));
vi.mock('@/lib/google-business-info', () => ({
  fetchCurrentDescription: mocks.fetchCurrentDescription,
  fetchStructuredServices: mocks.fetchStructuredServices,
}));
vi.mock('@/lib/description-generator', () => ({
  generateDescription: vi.fn(),
}));
vi.mock('@/lib/service-generator', () => ({
  generateServiceDescriptions: vi.fn(),
}));
vi.mock('@/lib/profile-services', () => ({
  saveProfileServices: vi.fn(),
}));

const { GET: descriptionGET } = await import(
  '@/app/api/reoptimize/description/route'
);
const { GET: servicesGET } = await import(
  '@/app/api/reoptimize/services/route'
);

const profile = {
  id: 'p1',
  googleAccountId: 'ga1',
  locationName: 'locations/123',
};

const savedDescription = {
  id: 'd1',
  content: 'saved description copy',
  isApproved: true,
  isPushed: false,
  pushedAt: null,
};

const savedService = {
  id: 's1',
  serviceName: 'Drain Cleaning',
  description: 'We clean drains.',
  isStructured: true,
  isApproved: true,
  isPushed: false,
  pushedAt: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.prisma.profile.findUnique.mockResolvedValue(profile);
  mocks.prisma.profileDescription.findFirst.mockResolvedValue(savedDescription);
  mocks.prisma.profileKeyword.findMany.mockResolvedValue([
    { keyword: 'plumber near me' },
    { keyword: 'water heater repair' },
  ]);
  mocks.prisma.profileService.findMany.mockResolvedValue([savedService]);
});

function descriptionRequest(): NextRequest {
  return new NextRequest(
    'http://localhost:3000/api/reoptimize/description?profileId=p1'
  );
}

function servicesRequest(): NextRequest {
  return new NextRequest(
    'http://localhost:3000/api/reoptimize/services?profileId=p1'
  );
}

describe('reoptimize description GET when GBP fetch fails', () => {
  it('still returns the saved description and keywords with a 200', async () => {
    mocks.fetchCurrentDescription.mockRejectedValue(new Error('GBP 503'));

    const res = await descriptionGET(descriptionRequest());
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.currentGBPDescription).toBeNull();
    expect(body.savedDescription).toMatchObject({
      content: 'saved description copy',
    });
    expect(body.keywords).toEqual(['plumber near me', 'water heater repair']);
    expect(body.gbpError).toBeTruthy();
  });

  it('passes the live GBP description through when the fetch succeeds', async () => {
    mocks.fetchCurrentDescription.mockResolvedValue('live GBP description');

    const res = await descriptionGET(descriptionRequest());
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.currentGBPDescription).toBe('live GBP description');
    expect(body.savedDescription).toMatchObject({
      content: 'saved description copy',
    });
    expect(body.gbpError ?? null).toBeNull();
  });
});

describe('reoptimize services GET when GBP fetch fails', () => {
  it('still returns the saved services with a 200', async () => {
    mocks.fetchStructuredServices.mockRejectedValue(new Error('GBP 503'));

    const res = await servicesGET(servicesRequest());
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.currentGBPServices).toBeNull();
    expect(body.availableServices).toBeNull();
    expect(body.savedServices).toHaveLength(1);
    expect(body.savedServices[0]).toMatchObject({
      serviceName: 'Drain Cleaning',
    });
    expect(body.gbpError).toBeTruthy();
  });

  it('passes the live GBP services through when the fetch succeeds', async () => {
    const gbpServices = [{ displayName: 'Drain Cleaning', serviceTypeId: 'st1' }];
    mocks.fetchStructuredServices.mockResolvedValue(gbpServices);

    const res = await servicesGET(servicesRequest());
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.currentGBPServices).toEqual(gbpServices);
    expect(body.availableServices).toEqual(gbpServices);
    expect(body.savedServices).toHaveLength(1);
    expect(body.gbpError ?? null).toBeNull();
  });
});
