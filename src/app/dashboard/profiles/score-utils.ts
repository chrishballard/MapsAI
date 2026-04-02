import type { ScoreGrade } from '@/lib/optimization-score';

// Phase 14 UI-SPEC Score Color Contract (D-02)
export const GRADE_CLASSES: Record<ScoreGrade, string> = {
  green: 'bg-emerald-100 text-emerald-700',
  amber: 'bg-yellow-100 text-yellow-700',
  red: 'bg-red-100 text-red-700',
};

// D-05: case-insensitive substring match on business name
export function filterProfiles<T extends { name: string }>(
  query: string,
  profiles: T[]
): T[] {
  if (!query.trim()) return profiles;
  const lower = query.toLowerCase();
  return profiles.filter(p => p.name.toLowerCase().includes(lower));
}
