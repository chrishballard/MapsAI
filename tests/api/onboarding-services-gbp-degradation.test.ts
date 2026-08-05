import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// Same defect class as the reoptimize GETs (see
// reoptimize-gbp-degradation.test.ts): a GBP outage during the onboarding
// services step must not 500 the wizard — the GET should still return the
// saved services from Postgres with availableServices degraded to null and
// gbpError set.

const mocks = vi.hoisted(() => ({
  prisma: {
    profile: { findUnique: vi.fn() },
    profileService: { findMany: vi.fn() },
  },
  fetchStructuredServices: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({ prisma: mocks.prisma }));
vi.mock('@/lib/auth/require-session', () => ({
  requireSession: vi.fn(async () => null),
  requireProfile: vi.fn(),
}));
vi.mock('@/lib/google-business-info', () => ({
  fetchStructuredServices: mocks.fetchStructuredServices,
}));
vi.mock('@/lib/profile-services', () => ({
  saveProfileServices: vi.fn(),
}));

const { GET: servicesGET } = await import(
  '@/app/api/onboarding/services/route'
);

const profile = {
  id: 'p1',
  googleAccountId: 'ga1',
  locationName: 'locations/123',
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
  mocks.prisma.profileService.findMany.mockResolvedValue([savedService]);
});

function servicesRequest(): NextRequest {
  return new NextRequest(
    'http://localhost:3000/api/onboarding/services?profileId=p1'
  );
}

describe('onboarding services GET when GBP fetch fails', () => {
  it('still returns the saved services with a 200', async () => {
    mocks.fetchStructuredServices.mockRejectedValue(new Error('GBP 503'));

    const res = await servicesGET(servicesRequest());
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.availableServices).toBeNull();
    expect(body.services).toHaveLength(1);
    expect(body.services[0]).toMatchObject({ serviceName: 'Drain Cleaning' });
    expect(body.gbpError).toBeTruthy();
  });

  it('passes the live GBP services through when the fetch succeeds', async () => {
    const gbpServices = [{ displayName: 'Drain Cleaning', serviceTypeId: 'st1' }];
    mocks.fetchStructuredServices.mockResolvedValue(gbpServices);

    const res = await servicesGET(servicesRequest());
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.availableServices).toEqual(gbpServices);
    expect(body.services).toHaveLength(1);
    // gbpError must be an explicitly present null on the healthy path so
    // clients can distinguish "no outage" from "route doesn't report outages".
    expect(body).toHaveProperty('gbpError', null);
  });
});
