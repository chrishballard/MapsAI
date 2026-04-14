/**
 * Calculate schedule dates for posts, distributing them evenly across future
 * weekdays (Mon–Fri) in the target month at 10:00 AM UTC.
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

  // Collect all future weekdays in the target month at 10:00 AM UTC
  const date = new Date(Date.UTC(targetYear, targetMonth, 1, 10, 0, 0, 0));
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
