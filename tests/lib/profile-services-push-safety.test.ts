import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// pushApprovedServices writes a client's live service list. Three ways it
// could lose what is already there or misreport what went out:
//  - A replace-mode push on a degraded catalog read (a fallback answered, or
//    types came back without names) cannot tell a deselected structured
//    service from one it simply failed to match, so it would replace the
//    live structured item with a custom one. It must refuse instead.
//  - Two approved rows that go out as the same item (one service type, or
//    one custom name) collapse into one, so one description never reaches
//    Google while both rows are stamped pushed. It must refuse, naming both.
//  - The rows are stamped only after the push lands, all in one transaction,
//    and only the rows whose items went out.

const mocks = vi.hoisted(() => ({
  prisma: {
    profile: { findUnique: vi.fn() },
    profileService: { findMany: vi.fn(), updateMany: vi.fn(), update: vi.fn() },
    $transaction: vi.fn(),
  },
  fetchCurrentServices: vi.fn(),
  fetchStructuredServices: vi.fn(),
  fetchServiceTypeCatalog: vi.fn(),
  fetchCategoryId: vi.fn(),
  pushServicesToGBP: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({ prisma: mocks.prisma }));
vi.mock('@/lib/google-business-info', () => ({
  fetchCurrentServices: mocks.fetchCurrentServices,
  fetchStructuredServices: mocks.fetchStructuredServices,
  fetchServiceTypeCatalog: mocks.fetchServiceTypeCatalog,
  fetchCategoryId: mocks.fetchCategoryId,
  pushServicesToGBP: mocks.pushServicesToGBP,
}));

const { pushApprovedServices } = await import('@/lib/profile-services');

const MATTRESS = 'job_type_id:mattress_cleaning';
const CARPET = 'job_type_id:carpet_cleaning';

const englishCatalog = [
  { serviceTypeId: MATTRESS, displayName: 'Mattress cleaning' },
  { serviceTypeId: CARPET, displayName: 'Carpet cleaning' },
];

function row(serviceName: string, serviceTypeId: string | null = null, description = `About ${serviceName}.`) {
  return {
    id: `svc-${serviceName}`,
    profileId: 'p1',
    serviceName,
    serviceTypeId,
    description,
    isStructured: true,
    isApproved: true,
    isPushed: false,
    pushedAt: null,
  };
}

/** What the catalog read returns, kept in step with fetchStructuredServices. */
function catalog(serviceTypes: typeof englishCatalog, extra: { unresolvedTypeIds?: string[]; degraded?: boolean } = {}) {
  mocks.fetchStructuredServices.mockResolvedValue(serviceTypes);
  mocks.fetchServiceTypeCatalog.mockResolvedValue({
    serviceTypes,
    unresolvedTypeIds: extra.unresolvedTypeIds ?? [],
    degraded: extra.degraded ?? false,
  });
}

function pushedItems(): Array<Record<string, unknown>> {
  return mocks.pushServicesToGBP.mock.calls[0][0].serviceItems;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  mocks.prisma.profile.findUnique.mockResolvedValue({
    id: 'p1',
    googleAccountId: 'ga1',
    locationName: 'locations/123',
    category: 'House cleaning service',
    googleLanguageCode: 'en-US',
  });
  mocks.prisma.profileService.updateMany.mockResolvedValue({ count: 1 });
  mocks.prisma.profileService.update.mockResolvedValue({});
  mocks.prisma.$transaction.mockImplementation(async (ops: unknown) =>
    Array.isArray(ops) ? Promise.all(ops) : (ops as (tx: unknown) => unknown)(mocks.prisma)
  );
  mocks.fetchCurrentServices.mockResolvedValue({ serviceItems: [] });
  mocks.fetchCategoryId.mockResolvedValue('categories/gcid:house_cleaning_service');
  mocks.pushServicesToGBP.mockResolvedValue({ success: true });
  catalog(englishCatalog);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('pushApprovedServices on a degraded catalog read', () => {
  const liveMattress = { structuredServiceItem: { serviceTypeId: MATTRESS, description: 'Live copy.' } };

  beforeEach(() => {
    mocks.fetchCurrentServices.mockResolvedValue({ serviceItems: [liveMattress] });
    // Only the live ids were readable, none of them named
    catalog([], { unresolvedTypeIds: [MATTRESS], degraded: true });
  });

  it('refuses a replace push that would drop a live structured service for a custom one', async () => {
    mocks.prisma.profileService.findMany.mockResolvedValue([row('Mattress cleaning')]);

    const result = await pushApprovedServices('p1');

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.status).toBe(502);
      expect(result.error).toContain(MATTRESS);
      expect(result.error).toContain('Nothing was pushed');
    }
    expect(mocks.pushServicesToGBP).not.toHaveBeenCalled();
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled();
    expect(mocks.prisma.profileService.updateMany).not.toHaveBeenCalled();
  });

  it('pushes in replace mode when every live structured service still goes out', async () => {
    // The stored id is on the live list, so the row keeps its structured type
    mocks.prisma.profileService.findMany.mockResolvedValue([
      row('Mattress cleaning', MATTRESS),
      row('Move-out cleaning'),
    ]);

    const result = await pushApprovedServices('p1');

    expect(result).toEqual({ success: true, pushedCount: 2 });
    expect(pushedItems()).toEqual([
      { structuredServiceItem: { serviceTypeId: MATTRESS, description: 'About Mattress cleaning.' } },
      {
        freeFormServiceItem: {
          category: 'categories/gcid:house_cleaning_service',
          label: { displayName: 'Move-out cleaning', description: 'About Move-out cleaning.' },
        },
      },
    ]);
  });

  it('pushes in merge mode, which keeps the live structured service', async () => {
    mocks.prisma.profileService.findMany.mockResolvedValue([row('Move-out cleaning')]);

    const result = await pushApprovedServices('p1', { merge: true });

    expect(result).toEqual({ success: true, pushedCount: 1 });
    expect(pushedItems()[0]).toEqual(liveMattress);
  });

  it('still lets a healthy replace push drop a deselected structured service', async () => {
    catalog(englishCatalog);
    mocks.prisma.profileService.findMany.mockResolvedValue([row('Carpet cleaning')]);

    const result = await pushApprovedServices('p1');

    expect(result).toEqual({ success: true, pushedCount: 1 });
    expect(pushedItems()).toEqual([
      { structuredServiceItem: { serviceTypeId: CARPET, description: 'About Carpet cleaning.' } },
    ]);
  });
});

describe('pushApprovedServices with two approved rows going out as one item', () => {
  it('refuses rows that resolve to the same service type, naming both', async () => {
    mocks.prisma.profileService.findMany.mockResolvedValue([
      row('Mattress cleaning', MATTRESS),
      row('Mattress Cleaning Service', MATTRESS),
      row('Carpet cleaning'),
    ]);

    const result = await pushApprovedServices('p1', { merge: true });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.status).toBe(400);
      expect(result.error).toContain('"Mattress cleaning"');
      expect(result.error).toContain('"Mattress Cleaning Service"');
      expect(result.error).toContain(MATTRESS);
      expect(result.error).not.toContain('Carpet cleaning');
    }
    expect(mocks.pushServicesToGBP).not.toHaveBeenCalled();
    expect(mocks.prisma.profileService.updateMany).not.toHaveBeenCalled();
  });

  it('refuses a stored id and a display name that land on the same type', async () => {
    mocks.prisma.profileService.findMany.mockResolvedValue([
      row('Deep mattress clean', MATTRESS),
      row('MATTRESS CLEANING'),
    ]);

    const result = await pushApprovedServices('p1');

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain('"Deep mattress clean"');
      expect(result.error).toContain('"MATTRESS CLEANING"');
    }
    expect(mocks.pushServicesToGBP).not.toHaveBeenCalled();
  });

  it('refuses custom services whose names differ only in case', async () => {
    mocks.prisma.profileService.findMany.mockResolvedValue([
      row('Move-out cleaning'),
      row('Move-Out Cleaning'),
    ]);

    const result = await pushApprovedServices('p1');

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.status).toBe(400);
      expect(result.error).toContain('"Move-out cleaning"');
      expect(result.error).toContain('"Move-Out Cleaning"');
    }
    expect(mocks.pushServicesToGBP).not.toHaveBeenCalled();
  });
});

describe('pushApprovedServices records the push in one transaction', () => {
  it('stamps exactly the rows that went out and records their ids together', async () => {
    mocks.prisma.profileService.findMany.mockResolvedValue([
      row('Mattress cleaning'),
      row('Carpet cleaning', CARPET),
    ]);

    const result = await pushApprovedServices('p1');

    expect(result).toEqual({ success: true, pushedCount: 2 });
    expect(mocks.prisma.$transaction).toHaveBeenCalledTimes(1);
    const ops = mocks.prisma.$transaction.mock.calls[0][0];
    expect(Array.isArray(ops)).toBe(true);
    // Stamp by id, so a row approved while the push ran is not marked pushed
    expect(mocks.prisma.profileService.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['svc-Mattress cleaning', 'svc-Carpet cleaning'] } },
      data: { isPushed: true, pushedAt: expect.any(Date) },
    });
    // Only the id that changed is written, inside the same transaction
    expect(mocks.prisma.profileService.updateMany).toHaveBeenCalledWith({
      where: { id: 'svc-Mattress cleaning' },
      data: { serviceTypeId: MATTRESS },
    });
    expect(mocks.prisma.profileService.updateMany).toHaveBeenCalledTimes(2);
    expect(ops).toHaveLength(2);
    expect(mocks.prisma.profileService.update).not.toHaveBeenCalled();
  });
});
