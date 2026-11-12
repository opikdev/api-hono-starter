import { describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/config.ts';

const databaseUrl = 'postgres://user:secret-value@localhost/db';

describe('loadConfig', () => {
  it('applies defaults', () => {
    const config = loadConfig({ DATABASE_URL: databaseUrl });
    expect(config.PORT).toBe(3000);
    expect(config.TRUST_PROXY_HOPS).toBe(0);
    expect(config.CORS_ORIGINS).toEqual([]);
    expect(config.AUTH_RATE_LIMIT_PER_MINUTE).toBe(10);
    expect(config.DATABASE_POOL_MAX).toBe(10);
    expect(config.LOGIN_FAILURE_LIMIT).toBe(5);
    expect(config.LOGIN_FAILURE_WINDOW_SECONDS).toBe(900);
    expect(config.SHUTDOWN_DRAIN_SECONDS).toBe(5);
    expect(config.SHUTDOWN_TIMEOUT_SECONDS).toBe(30);
  });

  it('allows a drain of 0 seconds', () => {
    expect(
      loadConfig({ DATABASE_URL: databaseUrl, SHUTDOWN_DRAIN_SECONDS: '0' }).SHUTDOWN_DRAIN_SECONDS,
    ).toBe(0);
  });

  it('rejects a shutdown timeout shorter than the statement timeout', () => {
    expect(() =>
      loadConfig({
        DATABASE_URL: databaseUrl,
        DATABASE_STATEMENT_TIMEOUT_MS: '10000',
        SHUTDOWN_TIMEOUT_SECONDS: '5',
      }),
    ).toThrow(/SHUTDOWN_TIMEOUT_SECONDS: Must be at least DATABASE_STATEMENT_TIMEOUT_MS/);
  });

  it('parses the pool size', () => {
    expect(
      loadConfig({ DATABASE_URL: databaseUrl, DATABASE_POOL_MAX: '25' }).DATABASE_POOL_MAX,
    ).toBe(25);
  });

  it.each(['0', '-1', '2.5', 'many'])('rejects a pool size of %s', (value) => {
    expect(() => loadConfig({ DATABASE_URL: databaseUrl, DATABASE_POOL_MAX: value })).toThrow(
      /DATABASE_POOL_MAX/,
    );
  });

  it('parses comma-separated origins', () => {
    const config = loadConfig({
      DATABASE_URL: databaseUrl,
      CORS_ORIGINS: 'https://a.example, https://b.example,',
    });
    expect(config.CORS_ORIGINS).toEqual(['https://a.example', 'https://b.example']);
  });

  it.each(['-1', '1.5', 'true'])('rejects TRUST_PROXY_HOPS=%s', (value) => {
    expect(() => loadConfig({ DATABASE_URL: databaseUrl, TRUST_PROXY_HOPS: value })).toThrow(
      /TRUST_PROXY_HOPS/,
    );
  });

  it.each(['true', 'false', ''])('tells you how to replace TRUST_PROXY=%s', (value) => {
    expect(() => loadConfig({ DATABASE_URL: databaseUrl, TRUST_PROXY: value })).toThrow(
      'TRUST_PROXY was replaced by TRUST_PROXY_HOPS. Set TRUST_PROXY_HOPS=1 for the old behavior.',
    );
  });

  it.each(['0', '9601'])('rejects SESSION_TTL_HOURS=%s', (value) => {
    expect(() => loadConfig({ DATABASE_URL: databaseUrl, SESSION_TTL_HOURS: value })).toThrow(
      /SESSION_TTL_HOURS/,
    );
  });

  it('accepts a session lifetime of up to 400 days, the longest a browser keeps a cookie', () => {
    expect(
      loadConfig({ DATABASE_URL: databaseUrl, SESSION_TTL_HOURS: '9600' }).SESSION_TTL_HOURS,
    ).toBe(9600);
  });

  it('names every invalid variable', () => {
    expect(() => loadConfig({ PORT: 'not-a-port' })).toThrow(/PORT.*DATABASE_URL/);
  });

  it('rejects a port out of range', () => {
    expect(() => loadConfig({ DATABASE_URL: databaseUrl, PORT: '70000' })).toThrow(/PORT/);
  });

  it('does not put secrets in the error', () => {
    expect(() => loadConfig({ DATABASE_URL: databaseUrl, PORT: 'x' })).not.toThrow(/secret-value/);
  });
});
