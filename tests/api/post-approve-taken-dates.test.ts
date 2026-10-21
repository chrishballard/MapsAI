import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Approving one draft (POST /api/posts/[id]/approve) must not schedule it on
// a day another of the profile's posts already holds. Bulk approve already
// skips those days; single approve has to as well.

const mocks = vi.hoisted(() => ({
  prisma: {
    post: { findUnique: vi.fn(), findMany: vi.fn(), update: vi.fn() },
  },
  schedulePostPublish: vi.fn(async () => {}),
}));

vi.mock('@/lib/prisma', () => ({ prisma: mocks.prisma }));
vi.mock('@/lib/auth/require-session', () => ({
  requireSession: vi.fn(async () => null),
}));
vi.mock('@/lib/queue/publish-queue', () => ({
  schedulePostPublish: mocks.schedulePostPublish,
}));

const { POST } = await import('@/app/api/posts/[id]/approve/route');

function call() {
  return POST(new Request('http://localhost:3000/api/posts/post1/approve', { method: 'POST' }), {
    params: Promise.resolve({ id: 'post1' }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  // Monday 5 Oct 2026, 12:00 UTC: the first free slot is today at 17:00 UTC.
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-05T12:00:00Z'));
  mocks.prisma.post.findUnique.mockResolvedValue({
    id: 'post1',
    profileId: 'p1',
    status: 'DRAFT',
  });
  mocks.prisma.post.findMany.mockResolvedValue([]);
  mocks.prisma.post.update.mockImplementation(async ({ data }) => ({ id: 'post1', ...data }));
});

afterEach(() => {
  vi.useRealTimers();
});

function scheduledDay() {
  const { data } = mocks.prisma.post.update.mock.calls[0][0] as {
    data: { scheduledAt: Date };
  };
  return data.scheduledAt.toISOString().slice(0, 10);
}

describe('POST /api/posts/[id]/approve schedule date', () => {
  it('takes the first free weekday when nothing else is scheduled', async () => {
    const res = await call();

    expect(res.status).toBe(200);
    expect(scheduledDay()).toBe('2026-10-05');
  });

  it("skips a day another of this profile's scheduled posts already has", async () => {
    mocks.prisma.post.findMany.mockResolvedValue([
      { scheduledAt: new Date('2026-10-05T17:00:00Z') },
    ]);

    const res = await call();

    expect(res.status).toBe(200);
    expect(mocks.prisma.post.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ profileId: 'p1', status: 'SCHEDULED' }),
      })
    );
    expect(scheduledDay()).toBe('2026-10-06');
    expect(mocks.schedulePostPublish).toHaveBeenCalledWith(
      'post1',
      new Date('2026-10-06T17:00:00Z')
    );
  });

  it('rolls into next month when every remaining weekday this month is taken', async () => {
    vi.setSystemTime(new Date('2026-10-29T12:00:00Z')); // Thursday
    mocks.prisma.post.findMany.mockResolvedValue([
      { scheduledAt: new Date('2026-10-29T17:00:00Z') },
      { scheduledAt: new Date('2026-10-30T17:00:00Z') },
    ]);

    const res = await call();

    expect(res.status).toBe(200);
    expect(scheduledDay()).toBe('2026-11-02');
  });
});
