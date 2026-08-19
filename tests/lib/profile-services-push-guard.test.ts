import { describe, it, expect, vi, beforeEach } from 'vitest';

// Google rejects the ENTIRE serviceItems patch if any one description exceeds
// 300 characters, surfacing only a cryptic 502 to the user. The push must
// pre-validate approved descriptions and name the offending services in a
// clear error before any GBP call happens.

const mocks = vi.hoisted(() => ({
  prisma: {
    profile: { findUnique: vi.fn() },
    profileService: { findMany: vi.fn(), updateMany: vi.fn() },
  },
  fetchCurrentServices: vi.fn(),
  fetchStructuredServices: vi.fn(),
  fetchCategoryId: vi.fn(),
  pushServicesToGBP: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({ prisma: mocks.prisma }));
vi.mock('@/lib/google-business-info', () => ({
  fetchCurrentServices: mocks.fetchCurrentServices,
  fetchStructuredServices: mocks.fetchStructuredServices,
  fetchCategoryId: mocks.fetchCategoryId,
  pushServicesToGBP: mocks.pushServicesToGBP,
}));

const { pushApprovedServices } = await import('@/lib/profile-services');

const profile = {
  id: 'p1',
  googleAccountId: 'ga1',
  locationName: 'locations/123',
  category: 'Plumber',
};

function service(name: string, descriptionLength: number) {
  return {
    id: `svc-${name}`,
    profileId: 'p1',
    serviceName: name,
    description: 'x'.repeat(descriptionLength),
    isStructured: false,
    isApproved: true,
    isPushed: false,
    pushedAt: null,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.prisma.profile.findUnique.mockResolvedValue(profile);
  mocks.prisma.profileService.updateMany.mockResolvedValue({ count: 1 });
  mocks.fetchCurrentServices.mockResolvedValue({ serviceItems: [] });
  mocks.fetchStructuredServices.mockResolvedValue([]);
  mocks.fetchCategoryId.mockResolvedValue('categories/gcid:plumber');
  mocks.pushServicesToGBP.mockResolvedValue({ success: true });
});

describe('pushApprovedServices 300-character guard', () => {
  it('refuses to push when an approved description exceeds 300 chars', async () => {
    mocks.prisma.profileService.findMany.mockResolvedValue([
      service('Drain Cleaning', 250),
      service('Sewer Line Repair', 301),
    ]);

    const result = await pushApprovedServices('p1');

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.status).toBe(400);
      // The error must name the offending service so the user can fix it
      expect(result.error).toContain('Sewer Line Repair');
      expect(result.error).toContain('300');
    }
    // No GBP traffic at all — the live list must not be touched
    expect(mocks.fetchCurrentServices).not.toHaveBeenCalled();
    expect(mocks.pushServicesToGBP).not.toHaveBeenCalled();
  });

  it('pushes normally when every description is within 300 chars', async () => {
    mocks.prisma.profileService.findMany.mockResolvedValue([
      service('Drain Cleaning', 300),
    ]);

    const result = await pushApprovedServices('p1');

    expect(result).toEqual({ success: true, pushedCount: 1 });
    expect(mocks.pushServicesToGBP).toHaveBeenCalledTimes(1);
  });
});
