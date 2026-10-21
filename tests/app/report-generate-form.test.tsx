import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { GenerateForm } from '../../src/app/dashboard/reports/report-actions';

// The Generate Report form always sends a month, so its starting value is the
// month most reports get made for. A month still in progress compares
// month-to-date with a whole month, so the form starts on the last complete
// one, in UTC like every other report month.

afterEach(() => {
  vi.useRealTimers();
});

function initialMonth(): string | undefined {
  const html = renderToStaticMarkup(<GenerateForm profiles={[]} />);
  return html.match(/id="month-select"[^>]*value="([^"]*)"/)?.[1];
}

describe('GenerateForm', () => {
  it('starts on the last complete month', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-21T15:00:00Z'));
    expect(initialMonth()).toBe('2026-09');
  });

  it('rolls back across a year boundary', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2027-01-01T01:00:00Z'));
    expect(initialMonth()).toBe('2026-12');
  });
});
