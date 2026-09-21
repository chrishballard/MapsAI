import { describe, it, expect } from 'vitest';
import {
  scriptPoolConfig,
  DEFAULT_CONNECT_TIMEOUT_MS,
  DEFAULT_QUERY_TIMEOUT_MS,
  KEEPALIVE_INITIAL_DELAY_MS,
} from '../../scripts/db-timeouts';

// The pg pool limits scripts/export-profile.ts runs under. pg reads a falsy
// timeout as "no timeout", which is the state that let an export sit on a
// half-open socket for hours on 2026-09-21, so the cases that matter most are
// the ones where a bad value could quietly land back there.

describe('scriptPoolConfig', () => {
  it('sets every limit when the environment says nothing', () => {
    expect(scriptPoolConfig({})).toEqual({
      connectionTimeoutMillis: DEFAULT_CONNECT_TIMEOUT_MS,
      query_timeout: DEFAULT_QUERY_TIMEOUT_MS,
      statement_timeout: DEFAULT_QUERY_TIMEOUT_MS,
      keepAlive: true,
      keepAliveInitialDelayMillis: KEEPALIVE_INITIAL_DELAY_MS,
    });
  });

  it('has defaults that are real limits, not zero', () => {
    expect(DEFAULT_CONNECT_TIMEOUT_MS).toBeGreaterThan(0);
    expect(DEFAULT_QUERY_TIMEOUT_MS).toBeGreaterThan(0);
  });

  it('takes the connect timeout from SCRIPT_DB_CONNECT_TIMEOUT_MS', () => {
    const config = scriptPoolConfig({ SCRIPT_DB_CONNECT_TIMEOUT_MS: '2500' });
    expect(config.connectionTimeoutMillis).toBe(2500);
    expect(config.query_timeout).toBe(DEFAULT_QUERY_TIMEOUT_MS);
  });

  it('applies SCRIPT_DB_QUERY_TIMEOUT_MS to the client timer and the server setting alike', () => {
    const config = scriptPoolConfig({ SCRIPT_DB_QUERY_TIMEOUT_MS: '45000' });
    expect(config.query_timeout).toBe(45000);
    expect(config.statement_timeout).toBe(45000);
    expect(config.connectionTimeoutMillis).toBe(DEFAULT_CONNECT_TIMEOUT_MS);
  });

  it('lets 0 switch a limit off, since that has to be asked for by name', () => {
    const config = scriptPoolConfig({
      SCRIPT_DB_CONNECT_TIMEOUT_MS: '0',
      SCRIPT_DB_QUERY_TIMEOUT_MS: '0',
    });
    expect(config.connectionTimeoutMillis).toBe(0);
    expect(config.query_timeout).toBe(0);
    expect(config.statement_timeout).toBe(0);
  });

  it('keeps keepalive on whatever the timeouts are', () => {
    const config = scriptPoolConfig({
      SCRIPT_DB_CONNECT_TIMEOUT_MS: '0',
      SCRIPT_DB_QUERY_TIMEOUT_MS: '0',
    });
    expect(config.keepAlive).toBe(true);
    expect(config.keepAliveInitialDelayMillis).toBe(KEEPALIVE_INITIAL_DELAY_MS);
  });

  it('falls back to the default for an empty or blank value', () => {
    expect(scriptPoolConfig({ SCRIPT_DB_QUERY_TIMEOUT_MS: '' }).query_timeout).toBe(
      DEFAULT_QUERY_TIMEOUT_MS
    );
    expect(scriptPoolConfig({ SCRIPT_DB_QUERY_TIMEOUT_MS: '   ' }).query_timeout).toBe(
      DEFAULT_QUERY_TIMEOUT_MS
    );
  });

  it('tolerates whitespace around a number, as a sourced env file can leave it', () => {
    expect(scriptPoolConfig({ SCRIPT_DB_QUERY_TIMEOUT_MS: ' 5000 ' }).query_timeout).toBe(5000);
  });

  // Every one of these would otherwise reach pg as NaN, a negative, or a
  // string, and pg would run with no limit at all without saying so.
  it.each(['30s', '30_000', '-1', '1.5', 'abc', '1e4', 'Infinity'])(
    'throws on %s instead of running without a limit',
    (bad) => {
      expect(() => scriptPoolConfig({ SCRIPT_DB_QUERY_TIMEOUT_MS: bad })).toThrow(
        /SCRIPT_DB_QUERY_TIMEOUT_MS must be a whole number of milliseconds/
      );
      expect(() => scriptPoolConfig({ SCRIPT_DB_CONNECT_TIMEOUT_MS: bad })).toThrow(
        /SCRIPT_DB_CONNECT_TIMEOUT_MS must be a whole number of milliseconds/
      );
    }
  );

  it('names the offending value in the error', () => {
    expect(() => scriptPoolConfig({ SCRIPT_DB_QUERY_TIMEOUT_MS: '30s' })).toThrow(/got: 30s/);
  });
});
