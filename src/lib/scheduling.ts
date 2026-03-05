/**
 * Calculate schedule dates for posts, distributing them across future Tuesdays
 * in the target month at 10:00 AM.
 */
export function calculateScheduleDates(
  postCount: number,
  targetMonth: number, // 0-indexed (Date.getMonth())
  targetYear: number
): Date[] {
  if (postCount <= 0) return [];

  const now = new Date();
  const tuesdays: Date[] = [];

  // Find all Tuesdays in the target month
  const date = new Date(targetYear, targetMonth, 1, 10, 0, 0, 0);
  while (date.getMonth() === targetMonth) {
    // Tuesday = 2
    if (date.getDay() === 2 && date > now) {
      tuesdays.push(new Date(date));
    }
    date.setDate(date.getDate() + 1);
  }

  if (tuesdays.length === 0) return [];

  // Distribute posts evenly across available Tuesdays
  const scheduleDates: Date[] = [];
  for (let i = 0; i < postCount; i++) {
    const tuesdayIndex = i % tuesdays.length;
    scheduleDates.push(new Date(tuesdays[tuesdayIndex]));
  }

  // Sort chronologically
  scheduleDates.sort((a, b) => a.getTime() - b.getTime());

  return scheduleDates;
}
