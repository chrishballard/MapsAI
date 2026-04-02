import { describe, it, expect } from 'vitest';
import { filterProfiles, GRADE_CLASSES } from '../../src/app/dashboard/profiles/score-utils';

describe('filterProfiles', () => {
  const profiles = [
    { id: '1', name: 'Pizza Palace' },
    { id: '2', name: 'Burger Barn' },
    { id: '3', name: 'Taco Town' },
  ];

  it('returns profiles that match the query (case-sensitive match)', () => {
    const result = filterProfiles('Pizza', profiles);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('Pizza Palace');
  });

  it('returns profiles that match the query (case-insensitive per D-05)', () => {
    const result = filterProfiles('PIZZA', profiles);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('Pizza Palace');
  });

  it('returns empty array when no profiles match', () => {
    const result = filterProfiles('xyz', profiles);
    expect(result).toHaveLength(0);
  });

  it('returns all profiles when query is empty string', () => {
    const result = filterProfiles('', profiles);
    expect(result).toHaveLength(3);
  });

  it('returns all profiles when query is whitespace only', () => {
    const result = filterProfiles('   ', profiles);
    expect(result).toHaveLength(3);
  });

  it('supports substring match', () => {
    const result = filterProfiles('Town', profiles);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('Taco Town');
  });
});

describe('GRADE_CLASSES', () => {
  it('maps green to bg-emerald-100 text-emerald-700', () => {
    expect(GRADE_CLASSES['green']).toBe('bg-emerald-100 text-emerald-700');
  });

  it('maps amber to bg-yellow-100 text-yellow-700', () => {
    expect(GRADE_CLASSES['amber']).toBe('bg-yellow-100 text-yellow-700');
  });

  it('maps red to bg-red-100 text-red-700', () => {
    expect(GRADE_CLASSES['red']).toBe('bg-red-100 text-red-700');
  });
});
