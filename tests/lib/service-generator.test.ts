import { describe, it, expect, vi, beforeEach } from 'vitest';

// The onboarding services step pre-checks every GBP service type, so
// service-rich categories (law firms expose 30-70) must generate cleanly in
// one click. The generator has to: batch large lists into small Claude calls,
// map Claude's output back to the exact input names (Claude drifts on casing
// and punctuation), retry names Claude drops, clamp descriptions to Google's
// hard 300-character service description limit, and never invent services.

const mocks = vi.hoisted(() => ({
  generate: vi.fn(),
}));

vi.mock('@/lib/claude', () => ({ generate: mocks.generate }));

const { generateServiceDescriptions } = await import('@/lib/service-generator');

const baseParams = {
  businessName: 'Acme Plumbing',
  category: 'Plumber',
  address: '123 Main St, Denver, CO',
  keywords: ['plumber denver'],
  cities: ['Denver'],
};

/** Pull the numbered service list back out of the prompt the generator built. */
function namesFromPrompt(prompt: string): string[] {
  const section = prompt.split('Services to describe:')[1] ?? '';
  return [...section.matchAll(/^\d+\. (.+)$/gm)].map((m) => m[1]);
}

/** Default mock: describe every service the prompt asks for. */
function echoDescriptions(overrides?: {
  mutateName?: (name: string) => string;
  description?: (name: string) => string;
  omit?: Set<string>;
  extra?: { serviceName: string; description: string }[];
}) {
  return async (opts: { prompt: string }) => {
    const names = namesFromPrompt(opts.prompt);
    const services = names
      .filter((n) => !overrides?.omit?.has(n))
      .map((n) => ({
        serviceName: overrides?.mutateName ? overrides.mutateName(n) : n,
        description: overrides?.description
          ? overrides.description(n)
          : `Professional ${n.toLowerCase()} from Acme Plumbing in Denver.`,
      }));
    return { services: [...services, ...(overrides?.extra ?? [])] };
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.generate.mockImplementation(echoDescriptions());
});

describe('generateServiceDescriptions batching', () => {
  it('handles a 69-service category by splitting into batches of at most 10', async () => {
    const serviceNames = Array.from(
      { length: 69 },
      (_, i) => `Legal Service ${i + 1}`
    );

    const result = await generateServiceDescriptions({
      ...baseParams,
      serviceNames,
    });

    expect(result).toHaveLength(69);
    // Every Claude call carried 10 or fewer services
    for (const call of mocks.generate.mock.calls) {
      expect(namesFromPrompt(call[0].prompt).length).toBeLessThanOrEqual(10);
    }
    expect(mocks.generate.mock.calls.length).toBeGreaterThanOrEqual(7);
    // Input order preserved, every service described
    expect(result.map((r) => r.serviceName)).toEqual(serviceNames);
    for (const r of result) {
      expect(r.description.length).toBeGreaterThan(0);
    }
  });
});

describe('generateServiceDescriptions name fidelity', () => {
  it('returns the exact input names even when Claude drifts on casing', async () => {
    mocks.generate.mockImplementation(
      echoDescriptions({ mutateName: (n) => n.toLowerCase() })
    );

    const result = await generateServiceDescriptions({
      ...baseParams,
      serviceNames: ['Water Heater Repair', 'Drain Cleaning'],
    });

    expect(result.map((r) => r.serviceName)).toEqual([
      'Water Heater Repair',
      'Drain Cleaning',
    ]);
  });

  it('matches names when Claude rewrites punctuation ("&" → "and", apostrophes)', async () => {
    mocks.generate.mockImplementation(
      echoDescriptions({
        mutateName: (n) =>
          n.replace(/&/g, 'and').replace(/'/g, '’'),
      })
    );

    const result = await generateServiceDescriptions({
      ...baseParams,
      serviceNames: ["Kitchen & Bath Remodeling", "Men's Haircut"],
    });

    expect(result.map((r) => r.serviceName)).toEqual([
      'Kitchen & Bath Remodeling',
      "Men's Haircut",
    ]);
    for (const r of result) {
      expect(r.description.length).toBeGreaterThan(0);
    }
  });

  it('falls back to positional matching when a rewritten name is unrecognizable', async () => {
    // Claude answers for every service in order but rewrites one name beyond
    // any normalization ("Trip & Fall" → "Slip and Fall Accidents")
    mocks.generate.mockImplementation(
      echoDescriptions({
        mutateName: (n) =>
          n === 'Trip & Fall' ? 'Slip and Fall Accidents' : n,
      })
    );

    const result = await generateServiceDescriptions({
      ...baseParams,
      serviceNames: ['Divorce Mediation', 'Trip & Fall', 'Child Custody'],
    });

    expect(result.map((r) => r.serviceName)).toEqual([
      'Divorce Mediation',
      'Trip & Fall',
      'Child Custody',
    ]);
    for (const r of result) {
      expect(r.description.length).toBeGreaterThan(0);
    }
  });

  it('drops services Claude invented that were never requested', async () => {
    mocks.generate.mockImplementation(
      echoDescriptions({
        extra: [{ serviceName: 'Bonus Upsell Service', description: 'Nope.' }],
      })
    );

    const result = await generateServiceDescriptions({
      ...baseParams,
      serviceNames: ['Drain Cleaning'],
    });

    expect(result.map((r) => r.serviceName)).toEqual(['Drain Cleaning']);
  });

  it('dedupes input names case-insensitively, keeping the first casing', async () => {
    const result = await generateServiceDescriptions({
      ...baseParams,
      serviceNames: ['Drain Cleaning', 'drain cleaning'],
    });

    expect(result.map((r) => r.serviceName)).toEqual(['Drain Cleaning']);
  });
});

describe('generateServiceDescriptions retry for dropped services', () => {
  it('retries names missing from the first response and merges them in', async () => {
    let firstCall = true;
    mocks.generate.mockImplementation(async (opts: { prompt: string }) => {
      if (firstCall) {
        firstCall = false;
        return echoDescriptions({ omit: new Set(['Sewer Line Repair']) })(opts);
      }
      return echoDescriptions()(opts);
    });

    const result = await generateServiceDescriptions({
      ...baseParams,
      serviceNames: ['Drain Cleaning', 'Sewer Line Repair', 'Leak Detection'],
    });

    expect(mocks.generate).toHaveBeenCalledTimes(2);
    // Retry call only asked for the missing service
    expect(namesFromPrompt(mocks.generate.mock.calls[1][0].prompt)).toEqual([
      'Sewer Line Repair',
    ]);
    expect(result.map((r) => r.serviceName)).toEqual([
      'Drain Cleaning',
      'Sewer Line Repair',
      'Leak Detection',
    ]);
    expect(
      result.find((r) => r.serviceName === 'Sewer Line Repair')!.description
        .length
    ).toBeGreaterThan(0);
  });

  it('throws naming the service when a description is still missing after retry', async () => {
    // A partial result must never be returned — the reoptimize route replaces
    // its saved set with the result, so missing services would destroy data
    mocks.generate.mockImplementation(
      echoDescriptions({ omit: new Set(['Sewer Line Repair']) })
    );

    await expect(
      generateServiceDescriptions({
        ...baseParams,
        serviceNames: ['Drain Cleaning', 'Sewer Line Repair'],
      })
    ).rejects.toThrow(/Sewer Line Repair/);
  });

  it('treats a blank description as missing and retries it', async () => {
    let firstCall = true;
    mocks.generate.mockImplementation(async (opts: { prompt: string }) => {
      if (firstCall) {
        firstCall = false;
        return echoDescriptions({
          description: (n) => (n === 'Drain Cleaning' ? '   ' : `About ${n}.`),
        })(opts);
      }
      return echoDescriptions()(opts);
    });

    const result = await generateServiceDescriptions({
      ...baseParams,
      serviceNames: ['Drain Cleaning', 'Leak Detection'],
    });

    expect(mocks.generate).toHaveBeenCalledTimes(2);
    expect(
      result.find((r) => r.serviceName === 'Drain Cleaning')!.description.trim()
        .length
    ).toBeGreaterThan(0);
  });

  it('recovers services from a failed batch via the retry pass', async () => {
    let calls = 0;
    mocks.generate.mockImplementation(async (opts: { prompt: string }) => {
      calls++;
      if (calls === 1) throw new Error('Claude 529 overloaded');
      return echoDescriptions()(opts);
    });

    const result = await generateServiceDescriptions({
      ...baseParams,
      serviceNames: ['Drain Cleaning', 'Leak Detection'],
    });

    expect(result.map((r) => r.serviceName)).toEqual([
      'Drain Cleaning',
      'Leak Detection',
    ]);
    for (const r of result) {
      expect(r.description.length).toBeGreaterThan(0);
    }
  });

  it('throws when every call fails and nothing was generated', async () => {
    mocks.generate.mockRejectedValue(new Error('Claude API down'));

    await expect(
      generateServiceDescriptions({
        ...baseParams,
        serviceNames: ['Drain Cleaning'],
      })
    ).rejects.toThrow();
  });
});

describe('generateServiceDescriptions 300-character limit', () => {
  it('clamps overlong descriptions to 300 chars at a word boundary', async () => {
    const longDescription = Array.from({ length: 60 }, (_, i) => `word${i + 1}`).join(
      ' '
    ); // ~420 chars of space-separated words
    expect(longDescription.length).toBeGreaterThan(300);
    mocks.generate.mockImplementation(
      echoDescriptions({ description: () => longDescription })
    );

    const result = await generateServiceDescriptions({
      ...baseParams,
      serviceNames: ['Drain Cleaning'],
    });

    const clamped = result[0].description;
    expect(clamped.length).toBeLessThanOrEqual(300);
    // Must not cut mid-word: the clamped text ends exactly where a word ends
    expect(longDescription.startsWith(clamped)).toBe(true);
    expect(longDescription[clamped.length]).toBe(' ');
  });

  it('leaves compliant descriptions untouched', async () => {
    const fine = 'Fast, reliable drain cleaning for Denver homes.';
    mocks.generate.mockImplementation(
      echoDescriptions({ description: () => fine })
    );

    const result = await generateServiceDescriptions({
      ...baseParams,
      serviceNames: ['Drain Cleaning'],
    });

    expect(result[0].description).toBe(fine);
  });
});
