import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { rateLimits } from '../../src/db/schema.ts';
import {
  call,
  db,
  expectProblem,
  password,
  signUp,
  testApp,
  uniqueEmail,
  uniqueIp,
} from '../helpers.ts';

function login(app: ReturnType<typeof testApp>, ip: string) {
  return call(app, 'POST', '/v1/sessions', {
    ip,
    body: { email: uniqueEmail(), password },
  });
}

describe('rate limits', () => {
  it('blocks login after the auth limit, with Retry-After', async () => {
    const app = testApp({ AUTH_RATE_LIMIT_PER_MINUTE: '3' });
    const ip = uniqueIp();
    for (let attempt = 0; attempt < 3; attempt += 1) {
      expect((await login(app, ip)).status).toBe(401);
    }
    const blocked = await login(app, ip);
    await expectProblem(blocked, 429, 'rate-limited');
    const retryAfter = Number(blocked.headers.get('retry-after'));
    expect(retryAfter).toBeGreaterThan(0);
    expect(retryAfter).toBeLessThanOrEqual(60);
  });

  it('applies the global limit to every /v1 route', async () => {
    const app = testApp({ RATE_LIMIT_PER_MINUTE: '2' });
    const ip = uniqueIp();
    await call(app, 'GET', '/v1/notes', { ip });
    await call(app, 'GET', '/v1/users/me', { ip });
    await expectProblem(await call(app, 'GET', '/v1/notes', { ip }), 429, 'rate-limited');
  });

  it('reports the remaining budget', async () => {
    const app = testApp({ RATE_LIMIT_PER_MINUTE: '5' });
    const { token } = await signUp(testApp());
    const ip = uniqueIp();
    const response = await call(app, 'GET', '/v1/users/me', { ip, token });
    expect(response.headers.get('ratelimit-limit')).toBe('5');
    expect(response.headers.get('ratelimit-remaining')).toBe('4');
  });

  it('counts each client separately', async () => {
    const app = testApp({ RATE_LIMIT_PER_MINUTE: '1' });
    await call(app, 'GET', '/v1/notes', { ip: uniqueIp() });
    const other = await call(app, 'GET', '/v1/notes', { ip: uniqueIp() });
    expect(other.status).toBe(401);
  });

  it('counts concurrent requests exactly', async () => {
    const app = testApp({ RATE_LIMIT_PER_MINUTE: '5' });
    const ip = uniqueIp();
    const responses = await Promise.all(
      Array.from({ length: 12 }, () => call(app, 'GET', '/v1/notes', { ip })),
    );
    expect(responses.filter((response) => response.status === 429)).toHaveLength(7);
  });

  it('starts a new window once the old one ends', async () => {
    const app = testApp({ RATE_LIMIT_PER_MINUTE: '1' });
    const ip = uniqueIp();
    await call(app, 'GET', '/v1/notes', { ip });
    await expectProblem(await call(app, 'GET', '/v1/notes', { ip }), 429, 'rate-limited');
    await db
      .update(rateLimits)
      .set({ resetAt: new Date(Date.now() - 1000) })
      .where(eq(rateLimits.key, `global:${ip}`));
    expect((await call(app, 'GET', '/v1/notes', { ip })).status).toBe(401);
  });

  it('never limits health checks', async () => {
    const app = testApp({ RATE_LIMIT_PER_MINUTE: '1' });
    const ip = uniqueIp();
    for (let attempt = 0; attempt < 3; attempt += 1) {
      expect((await call(app, 'GET', '/healthz', { ip })).status).toBe(200);
    }
  });
});
