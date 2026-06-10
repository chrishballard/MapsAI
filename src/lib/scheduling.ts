/**
 * Calculate schedule dates for posts, distributing them evenly across future
 * weekdays (Mon–Fri) in the target month at 17:00 UTC (= 9 AM Pacific /
 * noon Eastern — clients are US local businesses, so posts land during
 * business hours instead of the middle of the night).
 *
 * Never schedules two posts on the same day. If there are fewer available
 * weekdays than posts requested, only as many dates as available are returned.
 */
export function calculateScheduleDates(
  postCount: number,
  targetMonth: number, // 0-indexed (Date.getMonth())
  targetYear: number,
  takenDates?: Set<string> // ISO date strings (YYYY-MM-DD) to exclude
): Date[] {
  if (postCount <= 0) return [];

  const now = new Date();
  const weekdays: Date[] = [];

  // Collect all future weekdays in the target month at 17:00 UTC
  const date = new Date(Date.UTC(targetYear, targetMonth, 1, 17, 0, 0, 0));
  while (date.getUTCMonth() === targetMonth) {
    const day = date.getUTCDay();
    const dateStr = date.toISOString().slice(0, 10);
    if (day >= 1 && day <= 5 && date > now && (!takenDates || !takenDates.has(dateStr))) {
      weekdays.push(new Date(date));
    }
    date.setUTCDate(date.getUTCDate() + 1);
  }

  if (weekdays.length === 0) return [];

  // Evenly space posts across available weekdays — no duplicate dates
  const count = Math.min(postCount, weekdays.length);
  const step = weekdays.length / count;
  const scheduleDates: Date[] = [];
  for (let i = 0; i < count; i++) {
    scheduleDates.push(weekdays[Math.floor(i * step)]);
  }

  return scheduleDates;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Calculate schedule dates at the profile's true cadence: postCount posts
 * spread over a rolling ~30-day window (postFrequency 4 = every ~7-8 days,
 * 8 = every ~4 days, 12 = every ~2-3 days), at 17:00 UTC.
 *
 * Unlike calculateScheduleDates, this is independent of calendar-month
 * boundaries, so a batch generated mid-month never bunches posts into the
 * month's remaining days denser than the user selected at onboarding.
 *
 * `anchor` is the profile's most recent post (scheduled or published): when
 * it's recent, the new batch continues one interval after it so cadence is
 * seamless across batches; when it's stale or absent, the first post lands
 * tomorrow. Posts prefer weekdays unless the cadence is too dense to fit
 * (interval < 1.5 days), never share a day, and skip `takenDates`.
 * Always returns exactly postCount dates.
 */
export function calculateRollingScheduleDates(
  postCount: number,
  anchor?: Date | null,
  takenDates?: Set<string> // ISO date strings (YYYY-MM-DD) to exclude
): Date[] {
  if (postCount <= 0) return [];

  const now = new Date();
  const intervalMs = (30 / postCount) * DAY_MS;
  const allowWeekends = intervalMs < 1.5 * DAY_MS;

  // Continue the cadence from the last post when it's recent; otherwise
  // (new or dormant profile) resume promptly with the first post tomorrow.
  let firstMs = anchor ? anchor.getTime() + intervalMs : now.getTime() + DAY_MS;
  if (firstMs <= now.getTime()) firstMs = now.getTime() + DAY_MS;

  const taken = new Set(takenDates ?? []);
  const dates: Date[] = [];

  for (let i = 0; i < postCount; i++) {
    const target = new Date(firstMs + i * intervalMs);
    let d = new Date(
      Date.UTC(
        target.getUTCFullYear(),
        target.getUTCMonth(),
        target.getUTCDate(),
        17,
        0,
        0,
        0
      )
    );

    // Never on or before the previous pick's day
    const prev = dates[dates.length - 1];
    if (prev && d.getTime() <= prev.getTime()) {
      d = new Date(prev.getTime() + DAY_MS);
    }

    // Advance past weekends (when cadence allows), taken days, and the past
    for (let guard = 0; guard < 60; guard++) {
      const day = d.getUTCDay();
      const isWeekend = day === 0 || day === 6;
      const key = d.toISOString().slice(0, 10);
      if ((allowWeekends || !isWeekend) && !taken.has(key) && d > now) break;
      d = new Date(d.getTime() + DAY_MS);
    }

    taken.add(d.toISOString().slice(0, 10));
    dates.push(d);
  }

  return dates;
}
