import { describe, it, expect, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// scripts/client-perf.ts and scripts/review-count-audit.ts took their
// positional arguments and silently ignored the rest, so an unquoted
// `client-perf.ts Badger Gutters` looked up every profile matching "Badger",
// and `review-count-audit.ts 0 Badger Gutters` filtered on "badger". Both now
// stop with a usage line that says to quote the name.
//
// Both scripts call main() at import time, so they run here as child
// processes. Nothing can reach a database or Google: the environment holds
// only PATH, TMPDIR, NODE_ENV and a DATABASE_URL aimed at a closed local port,
// and the working directory is an empty temp dir, so client-perf's dotenv
// finds no .env to load. The argument errors exit before any query is made.

const repo = fileURLToPath(new URL('../..', import.meta.url));
const tsx = join(repo, 'node_modules/.bin/tsx');
const emptyDir = mkdtempSync(join(tmpdir(), 'script-args-'));

afterAll(() => rmSync(emptyDir, { recursive: true, force: true }));

function run(script: string, args: string[]) {
  const result = spawnSync(
    tsx,
    ['--tsconfig', join(repo, 'tsconfig.json'), join(repo, 'scripts', script), ...args],
    {
      cwd: emptyDir,
      env: {
        PATH: process.env.PATH,
        TMPDIR: process.env.TMPDIR,
        NODE_ENV: 'test',
        DATABASE_URL: 'postgresql://nobody@127.0.0.1:1/none',
      },
      encoding: 'utf8',
      timeout: 60_000,
    }
  );
  return { status: result.status, stderr: result.stderr, stdout: result.stdout };
}

describe('client-perf.ts', () => {
  it('refuses an unquoted multi-word client name', () => {
    const { status, stderr } = run('client-perf.ts', ['Badger', 'Gutters']);
    expect(status).toBe(1);
    expect(stderr).toMatch(/unexpected argument: Gutters/);
    expect(stderr).toMatch(/quote/i);
  }, 60_000);
});

describe('review-count-audit.ts', () => {
  it('refuses an unquoted multi-word name filter', () => {
    const { status, stderr } = run('review-count-audit.ts', ['0', 'Badger', 'Gutters']);
    expect(status).toBe(1);
    expect(stderr).toMatch(/unexpected argument: Gutters/);
    expect(stderr).toMatch(/quote/i);
  }, 60_000);

  it('refuses a name given where the sample size goes', () => {
    const { status, stderr } = run('review-count-audit.ts', ['Badger']);
    expect(status).toBe(1);
    expect(stderr).toMatch(/apiSampleSize must be a whole number/);
  }, 60_000);

  it('refuses anything after --plan', () => {
    const { status, stderr } = run('review-count-audit.ts', ['--plan', 'Badger']);
    expect(status).toBe(1);
    expect(stderr).toMatch(/unexpected argument: Badger/);
  }, 60_000);
});
