import { describe, it, expect, vi, beforeEach } from 'vitest';

// pushApprovedServices pushes ALL isApproved rows, so a save that leaves
// stale rows behind resurrects deselected services on Google. Callers that
// send their complete list use replace: true, which deletes rows absent from
// the input; partial savers (the optimization suggestions panel approves one
// service at a time) must be able to save without touching other rows.

const mocks = vi.hoisted(() => ({
  tx: {
    profileService: {
      deleteMany: vi.fn(),
      upsert: vi.fn(),
    },
  },
  prisma: {
    $transaction: vi.fn(),
    profileService: { findMany: vi.fn() },
  },
}));

vi.mock('@/lib/prisma', () => ({ prisma: mocks.prisma }));
vi.mock('@/lib/google-business-info', () => ({
  fetchCurrentServices: vi.fn(),
  fetchStructuredServices: vi.fn(),
  fetchCategoryId: vi.fn(),
  pushServicesToGBP: vi.fn(),
}));

const { saveProfileServices } = await import('@/lib/profile-services');

const services = [
  { serviceName: 'Drain Cleaning', description: 'A', isStructured: true },
  { serviceName: 'Leak Detection', description: 'B', isStructured: false },
];

beforeEach(() => {
  vi.clearAllMocks();
  mocks.prisma.$transaction.mockImplementation(
    async (fn: (tx: unknown) => Promise<unknown>) => fn(mocks.tx)
  );
  mocks.prisma.profileService.findMany.mockResolvedValue([]);
});

describe('saveProfileServices replace semantics', () => {
  it('replace: true deletes rows not in the submitted set', async () => {
    await saveProfileServices('p1', services, { replace: true });

    expect(mocks.tx.profileService.deleteMany).toHaveBeenCalledWith({
      where: {
        profileId: 'p1',
        serviceName: { notIn: ['Drain Cleaning', 'Leak Detection'] },
      },
    });
    expect(mocks.tx.profileService.upsert).toHaveBeenCalledTimes(2);
  });

  it('default (partial save) never deletes other rows', async () => {
    await saveProfileServices('p1', [services[0]]);

    expect(mocks.tx.profileService.deleteMany).not.toHaveBeenCalled();
    expect(mocks.tx.profileService.upsert).toHaveBeenCalledTimes(1);
  });
});
