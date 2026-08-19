import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// The onboarding UI pre-checks every available GBP service type. Service-rich
// categories (law firms expose 30-70 types) previously 400ed instantly because
// the route capped serviceNames at 20 — the "Generate Descriptions" button
// just showed "Invalid request body". The route must accept the full checklist
// (up to 100, matching the save endpoint) and let the generator batch it.

const mocks = vi.hoisted(() => ({
  prisma: {
    profileKeyword: { findMany: vi.fn() },
    profileCity: { findMany: vi.fn() },
  },
  requireProfile: vi.fn(),
  generateServiceDescriptions: vi.fn(),
  scrapeWebsiteText: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({ prisma: mocks.prisma }));
vi.mock('@/lib/auth/require-session', () => ({
  requireSession: vi.fn(async () => null),
  requireProfile: mocks.requireProfile,
}));
vi.mock('@/lib/service-generator', () => ({
  generateServiceDescriptions: mocks.generateServiceDescriptions,
}));
vi.mock('@/lib/website-scraper', () => ({
  scrapeWebsiteText: mocks.scrapeWebsiteText,
}));

const { POST: generatePOST } = await import(
  '@/app/api/onboarding/services/generate/route'
);

const profile = {
  id: 'p1',
  name: 'Divorce Matters',
  category: 'Divorce lawyer',
  address: '123 Main St, Denver, CO',
  websiteUrl: null,
};

function generateRequest(serviceNames: string[]): NextRequest {
  return new NextRequest(
    'http://localhost:3000/api/onboarding/services/generate',
    {
      method: 'POST',
      body: JSON.stringify({ profileId: 'p1', serviceNames }),
      headers: { 'Content-Type': 'application/json' },
    }
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireProfile.mockResolvedValue(profile);
  mocks.prisma.profileKeyword.findMany.mockResolvedValue([]);
  mocks.prisma.profileCity.findMany.mockResolvedValue([]);
  mocks.scrapeWebsiteText.mockResolvedValue(null);
  mocks.generateServiceDescriptions.mockImplementation(
    async ({ serviceNames }: { serviceNames: string[] }) =>
      serviceNames.map((serviceName) => ({
        serviceName,
        description: `About ${serviceName}.`,
      }))
  );
});

describe('onboarding services generate route', () => {
  it('accepts a 69-service checklist (service-rich GBP category)', async () => {
    const serviceNames = Array.from(
      { length: 69 },
      (_, i) => `Legal Service ${i + 1}`
    );

    const res = await generatePOST(generateRequest(serviceNames));
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.services).toHaveLength(69);
    expect(mocks.generateServiceDescriptions).toHaveBeenCalledTimes(1);
    expect(
      mocks.generateServiceDescriptions.mock.calls[0][0].serviceNames
    ).toHaveLength(69);
  });

  it('still rejects absurd requests over 100 services', async () => {
    const serviceNames = Array.from({ length: 101 }, (_, i) => `S${i + 1}`);

    const res = await generatePOST(generateRequest(serviceNames));
    expect(res.status).toBe(400);
    expect(mocks.generateServiceDescriptions).not.toHaveBeenCalled();
  });

  it('returns a 500 with an error message when generation fails outright', async () => {
    mocks.generateServiceDescriptions.mockRejectedValue(
      new Error('Claude API down')
    );

    const res = await generatePOST(generateRequest(['Drain Cleaning']));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBeTruthy();
  });
});
