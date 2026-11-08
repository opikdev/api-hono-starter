import { describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/config.ts';

const databaseUrl = 'postgres://user:secret-value@localhost/db';

describe('loadConfig', () => {
  it('applies defaults', () => {
    const config = loadConfig({ DATABASE_URL: databaseUrl });
    expect(config.PORT).toBe(3000);
    expect(config.TRUST_PROXY).toBe(false);
    expect(config.CORS_ORIGINS).toEqual([]);
    expect(config.AUTH_RATE_LIMIT_PER_MINUTE).toBe(10);
  });

  it('parses comma-separated origins', () => {
    const config = loadConfig({
      DATABASE_URL: databaseUrl,
      CORS_ORIGINS: 'https://a.example, https://b.example,',
    });
    expect(config.CORS_ORIGINS).toEqual(['https://a.example', 'https://b.example']);
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
