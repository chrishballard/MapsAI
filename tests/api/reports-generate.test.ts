import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

// POST /api/reports/generate: which month a report covers when none is asked
// for, and that a Report row is created once per (profile, month) even when
// two requests race. Report has no unique on (profileId, month), so the route
// serialises find-or-create under a Postgres advisory lock; the fake
// transaction below honours that lock the way Postgres would.

type ReportRow = { id: string; profileId: string; month: Date };

const mocks = vi.hoisted(() => ({
  prisma: {
    profile: { findUnique: vi.fn(), findMany: vi.fn() },
    report: { findFirst: vi.fn(), create: vi.fn() },
    $transaction: vi.fn(),
  },
  generateReport: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({ prisma: mocks.prisma }));
vi.mock('@/lib/auth/require-session', () => ({
  requireSession: vi.fn(async () => null),
}));
vi.mock('@/lib/pdf/report-generator', () => ({
  generateReport: mocks.generateReport,
}));

const { POST } = await import('@/app/api/reports/generate/route');

function generateRequest(body: Record<string, unknown>): NextRequest {
  return new NextRequest('http://localhost:3000/api/reports/generate', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });
}

let table: ReportRow[];
let lockCalls: Array<{ sql: string; key: unknown; tagged: boolean }>;

beforeEach(() => {
  vi.clearAllMocks();
  table = [];
  lockCalls = [];

  mocks.generateReport.mockResolvedValue(new Uint8Array([1]));
  mocks.prisma.profile.findUnique.mockResolvedValue({ id: 'p1', name: 'Badger Test Gutters' });
  mocks.prisma.profile.findMany.mockResolvedValue([]);

  // The first read waits (up to 50ms) for a second read to start. Two
  // unserialised requests therefore both read before either creates, the
  // race in its worst order. Under the lock the second read cannot start
  // until the first transaction ends, so the first just times out and goes on.
  let reads = 0;
  let secondReadStarted!: () => void;
  const secondRead = new Promise<void>((resolve) => (secondReadStarted = resolve));
  const findFirst = async ({ where }: { where: { profileId: string; month: Date } }) => {
    reads++;
    if (reads >= 2) secondReadStarted();
    await Promise.race([secondRead, new Promise((resolve) => setTimeout(resolve, 50))]);
    return (
      table.find(
        (r) => r.profileId === where.profileId && r.month.getTime() === where.month.getTime()
      ) ?? null
    );
  };
  const create = async ({ data }: { data: { profileId: string; month: Date } }) => {
    const row = { id: `rep${table.length + 1}`, ...data };
    table.push(row);
    return row;
  };
  mocks.prisma.report.findFirst.mockImplementation(findFirst);
  mocks.prisma.report.create.mockImplementation(create);

  // pg_advisory_xact_lock: a second taker of the same key waits until the
  // first transaction ends.
  const held = new Map<string, Promise<void>>();
  mocks.prisma.$transaction.mockImplementation(
    async (fn: (tx: unknown) => Promise<unknown>) => {
      const releases: Array<() => void> = [];
      const tx = {
        $executeRaw: async (strings: TemplateStringsArray, ...values: unknown[]) => {
          lockCalls.push({
            sql: strings.join('?'),
            key: values[0],
            tagged: Array.isArray(strings) && 'raw' in strings,
          });
          const key = String(values[0]);
          while (held.has(key)) await held.get(key);
          let release!: () => void;
          held.set(
            key,
            new Promise<void>((resolve) => {
              release = () => {
                held.delete(key);
                resolve();
              };
            })
          );
          releases.push(release);
          return 1;
        },
        report: { findFirst, create },
      };
      try {
        return await fn(tx);
      } finally {
        releases.forEach((release) => release());
      }
    }
  );
});

afterEach(() => {
  vi.useRealTimers();
});

describe('POST /api/reports/generate: default month', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
  });

  it('defaults to the last complete month, not the one in progress', async () => {
    vi.setSystemTime(new Date('2026-10-21T15:00:00Z'));
    const res = await POST(generateRequest({ profileId: 'p1' }));
    expect(res.status).toBe(200);
    expect(mocks.generateReport).toHaveBeenCalledWith('p1', new Date('2026-09-01T00:00:00Z'));
    expect(table[0].month).toEqual(new Date('2026-09-01T00:00:00Z'));
  });

  it('rolls back across a year boundary in UTC', async () => {
    // 01:00 UTC on Jan 1 is still Dec 31 in the US; the month is UTC's.
    vi.setSystemTime(new Date('2027-01-01T01:00:00Z'));
    await POST(generateRequest({ profileId: 'p1' }));
    expect(mocks.generateReport).toHaveBeenCalledWith('p1', new Date('2026-12-01T00:00:00Z'));
  });

  it('still generates an explicitly requested current month', async () => {
    vi.setSystemTime(new Date('2026-10-21T15:00:00Z'));
    await POST(generateRequest({ profileId: 'p1', month: '2026-10' }));
    expect(mocks.generateReport).toHaveBeenCalledWith('p1', new Date('2026-10-01T00:00:00Z'));
  });
});

describe('POST /api/reports/generate: one Report per profile and month', () => {
  it('creates a single Report when two requests race', async () => {
    const [a, b] = await Promise.all([
      POST(generateRequest({ profileId: 'p1', month: '2026-09' })),
      POST(generateRequest({ profileId: 'p1', month: '2026-09' })),
    ]);
    const [bodyA, bodyB] = await Promise.all([a.json(), b.json()]);

    expect(table).toHaveLength(1);
    expect(bodyA.reports[0].reportId).toBe(table[0].id);
    expect(bodyB.reports[0].reportId).toBe(table[0].id);
  });

  it('takes the lock with a tagged template keyed on profile and month', async () => {
    await POST(generateRequest({ profileId: 'p1', month: '2026-09' }));
    expect(lockCalls).toHaveLength(1);
    expect(lockCalls[0].tagged).toBe(true);
    expect(lockCalls[0].sql).toContain('pg_advisory_xact_lock(hashtext(');
    expect(String(lockCalls[0].key)).toContain('p1');
    expect(String(lockCalls[0].key)).toContain('2026-09');
  });

  it('reuses the existing Report on a later run', async () => {
    table.push({ id: 'existing', profileId: 'p1', month: new Date('2026-09-01T00:00:00Z') });
    const res = await POST(generateRequest({ profileId: 'p1', month: '2026-09' }));
    expect((await res.json()).reports[0].reportId).toBe('existing');
    expect(table).toHaveLength(1);
  });

  it('keeps PDF rendering outside the transaction', async () => {
    // Rendering takes seconds; holding a connection and the lock for it
    // would stall every other generate for the same profile and month.
    let inTransaction = false;
    mocks.prisma.$transaction.mockImplementationOnce(async (fn: (tx: unknown) => Promise<unknown>) => {
      inTransaction = true;
      try {
        return await fn({
          $executeRaw: async () => 1,
          report: { findFirst: async () => null, create: async () => ({ id: 'r1' }) },
        });
      } finally {
        inTransaction = false;
      }
    });
    let renderedInTransaction: boolean | null = null;
    mocks.generateReport.mockImplementationOnce(async () => {
      renderedInTransaction = inTransaction;
      return new Uint8Array([1]);
    });

    await POST(generateRequest({ profileId: 'p1', month: '2026-09' }));
    expect(renderedInTransaction).toBe(false);
  });
});

// "All Profiles" in the generate form ran the bulk path over every connected
// Profile row: about 325 PDFs and Report rows, ~225 of them for locations
// that are not clients (the logins see every location in the agency's
// groups). It is the profiles the form lists: connected and onboarded.
describe('POST /api/reports/generate: All Profiles', () => {
  it('generates for onboarded, connected profiles only', async () => {
    await POST(generateRequest({ month: '2026-09' }));

    expect(mocks.prisma.profile.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { isConnected: true, isOnboarded: true } })
    );
  });
});
