import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// The impressions chart's x-axis labels. Chart dates are UTC "YYYY-MM-DD"
// strings, which parse to UTC midnight; read back through local getters in a
// zone west of UTC they land on the previous day, so every label in a US
// timezone was one day early.

const mocks = vi.hoisted(() => ({ configs: [] as unknown[] }));

vi.mock('chartjs-node-canvas', () => ({
  ChartJSNodeCanvas: class {
    async renderToBuffer(config: unknown) {
      mocks.configs.push(config);
      return Buffer.from('png');
    }
  },
}));

const { renderImpressionsChart } = await import('@/lib/pdf/chart-renderer');

let previousTz: string | undefined;
beforeEach(() => {
  mocks.configs.length = 0;
  previousTz = process.env.TZ;
  process.env.TZ = 'America/Denver';
});
afterEach(() => {
  if (previousTz === undefined) delete process.env.TZ;
  else process.env.TZ = previousTz;
});

describe('renderImpressionsChart', () => {
  it('the zone is really in effect (guards the case below)', () => {
    expect(new Date('2026-03-01').getDate()).toBe(28);
  });

  it('labels each point with its own UTC date', async () => {
    await renderImpressionsChart([
      { date: '2026-03-02', search: 2, maps: 2 },
      { date: '2026-03-01', search: 1, maps: 1 },
      { date: '2026-03-31', search: 3, maps: 3 },
    ]);
    const config = mocks.configs[0] as { data: { labels: string[] } };
    expect(config.data.labels).toEqual(['3/1', '3/2', '3/31']);
  });
});
