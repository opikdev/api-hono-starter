import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { rateLimits } from '../../src/db/schema.ts';
import { clientNetwork } from '../../src/platform/client-ip.ts';
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

function login(
  app: ReturnType<typeof testApp>,
  ip: string,
  email = uniqueEmail(),
  secret = password,
) {
  return call(app, 'POST', '/v1/sessions', { ip, body: { email, password: secret } });
}

function rateLimitHeaders(response: Response) {
  return {
    policy: response.headers.get('ratelimit-policy'),
    state: response.headers.get('ratelimit'),
    retryAfter: response.headers.get('retry-after'),
  };
}

const secondsLeft = (state: string | null) => Number(/;t=(\d+)$/.exec(state ?? '')?.[1]);

describe('rate limits', () => {
  it('blocks login after the auth limit, with the auth policy in the headers', async () => {
    const app = testApp({ AUTH_RATE_LIMIT_PER_MINUTE: '3', RATE_LIMIT_PER_MINUTE: '300' });
    const ip = uniqueIp();
    for (let attempt = 0; attempt < 3; attempt += 1) {
      expect((await login(app, ip)).status).toBe(401);
    }
    const blocked = await login(app, ip);
    await expectProblem(blocked, 429, 'rate-limited');
    const headers = rateLimitHeaders(blocked);
    expect(headers.policy).toBe('"global";q=300;w=60, "auth";q=3;w=60');
    expect(headers.state).toMatch(/^"auth";r=0;t=\d+$/);
    expect(headers.retryAfter).toBe(String(secondsLeft(headers.state)));
    expect(Number(headers.retryAfter)).toBeGreaterThan(0);
    expect(Number(headers.retryAfter)).toBeLessThanOrEqual(60);
  });

  it('applies the global limit to every /v1 route', async () => {
    const app = testApp({ RATE_LIMIT_PER_MINUTE: '2' });
    const ip = uniqueIp();
    await call(app, 'GET', '/v1/notes', { ip });
    await call(app, 'GET', '/v1/users/me', { ip });
    const blocked = await call(app, 'GET', '/v1/notes', { ip });
    await expectProblem(blocked, 429, 'rate-limited');
    const headers = rateLimitHeaders(blocked);
    expect(headers.policy).toBe('"global";q=2;w=60');
    expect(headers.state).toMatch(/^"global";r=0;t=\d+$/);
    expect(headers.retryAfter).toBe(String(secondsLeft(headers.state)));
  });

  it('reports the remaining budget in the draft IETF headers', async () => {
    const app = testApp({ RATE_LIMIT_PER_MINUTE: '5' });
    const { token } = await signUp(testApp());
    const response = await call(app, 'GET', '/v1/users/me', { ip: uniqueIp(), token });
    expect(response.headers.get('ratelimit-policy')).toBe('"global";q=5;w=60');
    expect(response.headers.get('ratelimit')).toMatch(/^"global";r=4;t=\d+$/);
    expect(response.headers.get('ratelimit-limit')).toBeNull();
    expect(response.headers.get('ratelimit-remaining')).toBeNull();
    expect(response.headers.get('ratelimit-reset')).toBeNull();
  });

  it('reports every policy on auth routes', async () => {
    const app = testApp({ RATE_LIMIT_PER_MINUTE: '300', AUTH_RATE_LIMIT_PER_MINUTE: '10' });
    const response = await login(app, uniqueIp());
    expect(response.status).toBe(401);
    expect(response.headers.get('ratelimit-policy')).toBe('"global";q=300;w=60, "auth";q=10;w=60');
    expect(response.headers.get('ratelimit')).toMatch(/^"global";r=299;t=\d+, "auth";r=9;t=\d+$/);
  });

  it('counts each client separately', async () => {
    const app = testApp({ RATE_LIMIT_PER_MINUTE: '1' });
    await call(app, 'GET', '/v1/notes', { ip: uniqueIp() });
    const other = await call(app, 'GET', '/v1/notes', { ip: uniqueIp() });
    expect(other.status).toBe(401);
  });

  it('counts an IPv6 /64 as one client', async () => {
    const app = testApp({ RATE_LIMIT_PER_MINUTE: '1' });
    const prefix = uniqueIp().split(':').slice(0, 4).join(':');
    await call(app, 'GET', '/v1/notes', { ip: `${prefix}::1` });
    const sameNetwork = await call(app, 'GET', '/v1/notes', { ip: `${prefix}:ffff::2` });
    await expectProblem(sameNetwork, 429, 'rate-limited');
  });

  it('counts an IPv4-mapped IPv6 address as its IPv4 address', async () => {
    const app = testApp({ RATE_LIMIT_PER_MINUTE: '1' });
    const octet = () => Math.floor(Math.random() * 254) + 1;
    const ipv4 = `10.${octet()}.${octet()}.${octet()}`;
    await call(app, 'GET', '/v1/notes', { ip: ipv4 });
    await expectProblem(
      await call(app, 'GET', '/v1/notes', { ip: `::ffff:${ipv4}` }),
      429,
      'rate-limited',
    );
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
      .where(eq(rateLimits.key, `global:${clientNetwork(ip)}`));
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

describe('failed logins per account', () => {
  const app = testApp({ LOGIN_FAILURE_LIMIT: '2', RATE_LIMIT_PER_MINUTE: '300' });

  it('blocks an account after the limit, even with the right password', async () => {
    const { email } = await signUp(testApp());
    expect((await login(app, uniqueIp(), email, 'wrong-horse-battery')).status).toBe(401);
    expect((await login(app, uniqueIp(), email, 'wrong-horse-battery')).status).toBe(401);

    const blocked = await login(app, uniqueIp(), email);
    await expectProblem(blocked, 429, 'rate-limited');
    const headers = rateLimitHeaders(blocked);
    expect(headers.policy).toBe('"global";q=300;w=60, "auth";q=100000;w=60, "login";q=2;w=900');
    expect(headers.state).toMatch(/^"login";r=0;t=\d+$/);
    expect(headers.retryAfter).toBe(String(secondsLeft(headers.state)));
    expect(Number(headers.retryAfter)).toBeGreaterThan(60);
    expect(Number(headers.retryAfter)).toBeLessThanOrEqual(900);
  });

  it('answers an unknown email exactly like a known one', async () => {
    const email = uniqueEmail();
    for (let attempt = 0; attempt < 2; attempt += 1) {
      await expectProblem(await login(app, uniqueIp(), email), 401, 'invalid-credentials');
    }
    await expectProblem(await login(app, uniqueIp(), email), 429, 'rate-limited');
  });

  it('counts the email without regard to case', async () => {
    const { email } = await signUp(testApp());
    await login(app, uniqueIp(), email.toUpperCase(), 'wrong-horse-battery');
    await login(app, uniqueIp(), email, 'wrong-horse-battery');
    await expectProblem(await login(app, uniqueIp(), email), 429, 'rate-limited');
  });

  it("doesn't count successful logins, or reset the count", async () => {
    const { email } = await signUp(testApp());
    expect((await login(app, uniqueIp(), email, 'wrong-horse-battery')).status).toBe(401);
    expect((await login(app, uniqueIp(), email)).status).toBe(201);
    expect((await login(app, uniqueIp(), email)).status).toBe(201);
    expect((await login(app, uniqueIp(), email, 'wrong-horse-battery')).status).toBe(401);
    await expectProblem(await login(app, uniqueIp(), email), 429, 'rate-limited');
  });

  it('only advertises the login policy on its own 429', async () => {
    const { email } = await signUp(testApp());
    const failed = await login(app, uniqueIp(), email, 'wrong-horse-battery');
    const succeeded = await login(app, uniqueIp(), email);
    for (const response of [failed, succeeded]) {
      expect(response.headers.get('ratelimit-policy')).not.toContain('login');
      expect(response.headers.get('ratelimit')).not.toContain('login');
    }
  });

  it('keeps accounts separate', async () => {
    const first = uniqueEmail();
    for (let attempt = 0; attempt < 3; attempt += 1) await login(app, uniqueIp(), first);
    const { email } = await signUp(testApp());
    expect((await login(app, uniqueIp(), email)).status).toBe(201);
  });
});
