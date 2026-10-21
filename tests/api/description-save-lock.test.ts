import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// A profile keeps one ProfileDescription row. The save and push routes read
// the latest row and update it, or create one when there is none; with no
// lock, two first saves landing together (a double click on Push, or Save
// and Push racing) both found nothing and both created a row.
//
// The table below is in memory and every call yields, so unserialised
// writers interleave the way two requests on a real pool do. tx.$executeRaw
// stands in for pg_advisory_xact_lock: the second caller waits there until
// the first transaction ends.

type Row = { id: string; profileId: string; content: string; [key: string]: unknown };

const mocks = vi.hoisted(() => {
  const state = { rows: [] as Row[], lockChain: Promise.resolve() };
  const tick = () => new Promise((r) => setTimeout(r, 0));
  const profileDescription = {
    findFirst: vi.fn(async ({ where }: { where: { profileId: string } }) => {
      await tick();
      const mine = state.rows.filter((r) => r.profileId === where.profileId);
      return mine[mine.length - 1] ?? null;
    }),
    create: vi.fn(async ({ data }: { data: Omit<Row, 'id'> }) => {
      await tick();
      const row = { id: `d${state.rows.length + 1}`, ...data } as Row;
      state.rows.push(row);
      return row;
    }),
    update: vi.fn(
      async ({ where, data }: { where: { id: string }; data: Partial<Row> }) => {
        await tick();
        const row = state.rows.find((r) => r.id === where.id)!;
        Object.assign(row, data);
        return { ...row };
      }
    ),
  };
  const executeRaw = vi.fn();
  return {
    state,
    executeRaw,
    pushDescriptionToGBP: vi.fn(),
    prisma: {
      profile: { findUnique: vi.fn() },
      profileDescription,
      $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
        let release = () => {};
        const tx = {
          profileDescription,
          $executeRaw: vi.fn(async (...args: unknown[]) => {
            executeRaw(...args);
            const previous = state.lockChain;
            state.lockChain = new Promise<void>((r) => (release = r));
            await previous;
          }),
        };
        try {
          return await fn(tx);
        } finally {
          release();
        }
      }),
    },
  };
});

vi.mock('@/lib/prisma', () => ({ prisma: mocks.prisma }));
vi.mock('@/lib/auth/require-session', () => ({
  requireSession: vi.fn(async () => null),
}));
vi.mock('@/lib/google-business-info', () => ({
  pushDescriptionToGBP: mocks.pushDescriptionToGBP,
  fetchCurrentDescription: vi.fn(),
}));
vi.mock('@/lib/description-generator', () => ({ generateDescription: vi.fn() }));
vi.mock('@/lib/website-scraper', () => ({ scrapeWebsiteText: vi.fn() }));

const onboardingPush = await import('@/app/api/onboarding/description/push/route');
const reoptimizePush = await import('@/app/api/reoptimize/description/push/route');
const onboardingSave = await import('@/app/api/onboarding/description/route');

function post(content: string): NextRequest {
  return new NextRequest('http://localhost:3000/api/description', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ profileId: 'p1', content }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.state.rows = [];
  mocks.state.lockChain = Promise.resolve();
  mocks.prisma.profile.findUnique.mockResolvedValue({
    id: 'p1',
    googleAccountId: 'ga1',
    locationName: 'locations/1',
  });
  mocks.pushDescriptionToGBP.mockResolvedValue({ success: true });
});

const routes = [
  ['onboarding push', onboardingPush.POST],
  ['reoptimize push', reoptimizePush.POST],
  ['onboarding save', onboardingSave.POST],
] as const;

describe('description writes are serialised per profile', () => {
  for (const [name, POST] of routes) {
    it(`${name}: two concurrent first writes leave one row`, async () => {
      const [a, b] = await Promise.all([POST(post('First version.')), POST(post('Second version.'))]);
      expect(a.status).toBe(200);
      expect(b.status).toBe(200);

      expect(mocks.state.rows).toHaveLength(1);
      expect(mocks.prisma.profileDescription.create).toHaveBeenCalledTimes(1);
    });

    it(`${name}: takes the advisory lock, keyed on the profile, before reading`, async () => {
      await POST(post('Only version.'));

      expect(mocks.executeRaw).toHaveBeenCalledTimes(1);
      const [strings, ...values] = mocks.executeRaw.mock.calls[0] as [TemplateStringsArray, ...unknown[]];
      expect(strings.join('?')).toContain('pg_advisory_xact_lock(hashtext(?))');
      expect(values).toEqual(['profile-description:p1']);
      expect(mocks.executeRaw.mock.invocationCallOrder[0]).toBeLessThan(
        mocks.prisma.profileDescription.findFirst.mock.invocationCallOrder[0]
      );
    });
  }

  it('a later write updates the existing row rather than adding one', async () => {
    await onboardingSave.POST(post('Draft.'));
    const res = await onboardingPush.POST(post('Approved.'));
    expect(res.status).toBe(200);
    expect(mocks.state.rows).toHaveLength(1);
    expect(mocks.state.rows[0]).toMatchObject({
      content: 'Approved.',
      isApproved: true,
      isPushed: true,
    });
  });
});
