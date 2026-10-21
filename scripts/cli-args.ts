/**
 * Flag readers for the GBP operator scripts (gbp-set-service-area.ts,
 * gbp-validate-writes.ts).
 *
 * Both used to take whatever token followed a value flag. With `--add
 * --write --yes` that meant a real write with the place id "--write", and
 * `--delay 15s` became NaN, which setTimeout treats as no delay: every
 * validate call then went out back to back, into the rate limit the delay
 * exists to respect. A value may not start with "--", the rule
 * scripts/client-perf.ts already applies to --id; and a number flag has to
 * be a number.
 *
 * In a module of its own for the same reason as scripts/metrics-window.ts:
 * the scripts call main() at import time, so a test cannot reach a helper
 * defined next to them.
 */

/** A bad command line. The scripts print the message and their usage line. */
export class CliArgError extends Error {}

/** The value at argv[i + 1] for the flag at argv[i], refusing another flag. */
function valueAt(argv: string[], i: number, name: string): string {
  const value = argv[i + 1];
  if (!value || value.startsWith("--")) {
    throw new CliArgError(
      value ? `--${name} needs a value, not ${value}` : `--${name} needs a value`
    );
  }
  return value;
}

/** Whether `--name` appears as a whole token. */
export function hasFlag(argv: string[], name: string): boolean {
  return argv.includes(`--${name}`);
}

/** The value after the first `--name`, or undefined when the flag is absent. */
export function flagValue(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? valueAt(argv, i, name) : undefined;
}

/** Every value of a repeatable `--name`, in order. */
export function flagValues(argv: string[], name: string): string[] {
  const out: string[] = [];
  argv.forEach((token, i) => {
    if (token === `--${name}`) out.push(valueAt(argv, i, name));
  });
  return out;
}

/** A finite number >= 0 for `--name`, or `fallback` when the flag is absent. */
export function nonNegativeNumberFlag(
  argv: string[],
  name: string,
  fallback: number
): number {
  const raw = flagValue(argv, name);
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (raw.trim() === "" || !Number.isFinite(value) || value < 0) {
    throw new CliArgError(`--${name} must be a non-negative number, not "${raw}"`);
  }
  return value;
}
