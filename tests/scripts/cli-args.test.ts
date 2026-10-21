import { describe, it, expect } from 'vitest';
import {
  assertKnownArgs,
  CliArgError,
  flagValue,
  flagValues,
  hasFlag,
  nonNegativeNumberFlag,
} from '../../scripts/cli-args';

// The flag readers behind scripts/gbp-set-service-area.ts and
// scripts/gbp-validate-writes.ts. Both used to take whatever token followed a
// value flag, so `--add --write --yes` sent the place id "--write" to Google
// in a real write, and `--delay 15s` became NaN, which setTimeout reads as no
// delay at all: the run then fired every validate call back to back into the
// rate limit the delay exists to respect.

describe('flagValue', () => {
  it('reads the value after the flag, or undefined when the flag is absent', () => {
    expect(flagValue(['--profile', 'p1', '--write'], 'profile')).toBe('p1');
    expect(flagValue(['--write'], 'profile')).toBeUndefined();
  });

  it('refuses a missing value', () => {
    expect(() => flagValue(['--profile'], 'profile')).toThrow(CliArgError);
    expect(() => flagValue(['--profile', ''], 'profile')).toThrow(CliArgError);
  });

  it('refuses another flag in the value position', () => {
    expect(() => flagValue(['--profile', '--write', '--yes'], 'profile')).toThrow(
      /--profile needs a value/
    );
  });
});

describe('flagValues', () => {
  it('reads every value of a repeatable flag, in order', () => {
    expect(
      flagValues(['--add', 'ChIJa=Lehi, UT', '--replace', '--add', 'ChIJb'], 'add')
    ).toEqual(['ChIJa=Lehi, UT', 'ChIJb']);
    expect(flagValues(['--replace'], 'add')).toEqual([]);
  });

  it('refuses `--add --write --yes` instead of adding a place called --write', () => {
    expect(() => flagValues(['--profile', 'p1', '--add', '--write', '--yes'], 'add')).toThrow(
      /--add needs a value/
    );
  });

  it('refuses a trailing flag with no value', () => {
    expect(() => flagValues(['--add', 'ChIJa', '--add'], 'add')).toThrow(CliArgError);
  });
});

describe('hasFlag', () => {
  it('matches the whole token only', () => {
    expect(hasFlag(['--write', '--yes'], 'write')).toBe(true);
    expect(hasFlag(['--writer'], 'write')).toBe(false);
  });
});

describe('nonNegativeNumberFlag', () => {
  it('reads a number, or the fallback when the flag is absent', () => {
    expect(nonNegativeNumberFlag(['--delay', '15000'], 'delay', 8000)).toBe(15000);
    expect(nonNegativeNumberFlag(['--delay', '0'], 'delay', 8000)).toBe(0);
    expect(nonNegativeNumberFlag([], 'delay', 8000)).toBe(8000);
  });

  it.each(['15s', 'abc', '-5', 'Infinity', ' '])('refuses %j', (raw) => {
    expect(() => nonNegativeNumberFlag(['--delay', raw], 'delay', 8000)).toThrow(
      /--delay must be a non-negative number/
    );
  });

  it('refuses a flag in the value position', () => {
    expect(() => nonNegativeNumberFlag(['--delay', '--profile', 'p1'], 'delay', 8000)).toThrow(
      CliArgError
    );
  });
});

describe('assertKnownArgs', () => {
  // gbp-set-service-area writes to a live listing. A misspelled flag, the
  // `--add=...` form or a stray word used to be ignored silently, so
  // `--add ChIJa --add=ChIJb --replace --write --yes` replaced the whole
  // service area with [a] alone.
  const spec = { valueFlags: ['profile', 'add'], booleanFlags: ['replace', 'write', 'yes'] };

  it('accepts a command line of known flags', () => {
    expect(() =>
      assertKnownArgs(['--profile', 'p1', '--add', 'ChIJa', '--replace', '--write', '--yes'], spec)
    ).not.toThrow();
  });

  it.each([
    [['--profile', 'p1', '--add=ChIJb']],
    [['--profile', 'p1', '--add-cty', 'Lehi']],
    [['--profile', 'p1', 'ChIJb']],
  ])('refuses %j', (argv) => {
    expect(() => assertKnownArgs(argv, spec)).toThrow(CliArgError);
  });
});
