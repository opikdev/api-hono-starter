import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { sessions, users } from '../../src/db/schema.ts';
import { fromPublicId } from '../../src/platform/public-id.ts';
import { call, db, expectProblem, password, signUp, testApp, uniqueEmail } from '../helpers.ts';

const app = testApp();

const cookieAttributes = ['Max-Age=604800', 'Path=/', 'HttpOnly', 'Secure', 'SameSite=Strict'];
const clearingAttributes = ['Max-Age=0', 'Path=/', 'HttpOnly', 'Secure', 'SameSite=Strict'];

function parseSetCookie(response: Response) {
  const [pair = '', ...attributes] = response.headers.get('set-cookie')?.split('; ') ?? [];
  const [name, value] = pair.split('=');
  return { name, value, attributes };
}

async function logInWithCookie(email: string, headers: Record<string, string> = {}) {
  const response = await call(app, 'POST', '/v1/sessions', {
    body: { email, password, delivery: 'cookie' },
    headers,
  });
  const { value } = parseSetCookie(response);
  return { response, cookie: `__Host-session=${value}` };
}

async function signUpWithCookie() {
  const { email, userId } = await signUp(app);
  const { cookie } = await logInWithCookie(email);
  return { email, userId, cookie };
}

function expectClearedCookie(response: Response) {
  expect(parseSetCookie(response)).toEqual({
    name: '__Host-session',
    value: '',
    attributes: clearingAttributes,
  });
}

describe('registration', () => {
  it('creates a user and hides the password', async () => {
    const email = uniqueEmail();
    const response = await call(app, 'POST', '/v1/users', { body: { email, password } });
    expect(response.status).toBe(201);
    const body = (await response.json()) as Record<string, string>;
    expect(body.id).toMatch(/^usr_[0-9a-f]{32}$/);
    expect(body.email).toBe(email);
    expect(body.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T.*Z$/);
    expect(JSON.stringify(body)).not.toContain('password');
  });

  it('stores a hash, not the password', async () => {
    const { email } = await signUp(app);
    const [user] = await db.select().from(users).where(eq(users.email, email));
    expect(user?.passwordHash).toMatch(/^scrypt\$/);
    expect(user?.passwordHash).not.toContain(password);
  });

  it('lowercases the email', async () => {
    const email = uniqueEmail();
    const response = await call(app, 'POST', '/v1/users', {
      body: { email: email.toUpperCase(), password },
    });
    expect(((await response.json()) as { email: string }).email).toBe(email);
  });

  it('rejects a duplicate email', async () => {
    const { email } = await signUp(app);
    const response = await call(app, 'POST', '/v1/users', { body: { email, password } });
    await expectProblem(response, 409, 'email-taken');
  });

  it('treats differently cased emails as the same user', async () => {
    const { email } = await signUp(app);
    const response = await call(app, 'POST', '/v1/users', {
      body: { email: email.toUpperCase(), password },
    });
    await expectProblem(response, 409, 'email-taken');
  });

  it.each([
    ['a short password', { email: 'a@example.com', password: 'short' }, 'password'],
    ['a long password', { email: 'a@example.com', password: 'x'.repeat(129) }, 'password'],
    ['a bad email', { email: 'nope', password }, 'email'],
    ['a missing email', { password }, 'email'],
    ['a very long email', { email: `${'a'.repeat(250)}@example.com`, password }, 'email'],
  ])('rejects %s and names the field', async (_label, body, field) => {
    const response = await call(app, 'POST', '/v1/users', { body });
    const problem = await expectProblem(response, 400, 'validation-failed');
    expect(problem.errors).toEqual(expect.arrayContaining([expect.objectContaining({ field })]));
  });

  it('rejects unknown fields', async () => {
    const response = await call(app, 'POST', '/v1/users', {
      body: { email: uniqueEmail(), password, isAdmin: true },
    });
    await expectProblem(response, 400, 'validation-failed');
  });
});

describe('sessions', () => {
  it('logs in with a token that is not stored in plain text', async () => {
    const { email } = await signUp(app);
    const response = await call(app, 'POST', '/v1/sessions', { body: { email, password } });
    expect(response.status).toBe(201);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('set-cookie')).toBeNull();
    const { token, expiresAt } = (await response.json()) as { token: string; expiresAt: string };
    expect(new Date(expiresAt).getTime()).toBeGreaterThan(Date.now());
    const stored = await db.select({ hash: sessions.tokenHash }).from(sessions);
    expect(stored.map((row) => row.hash)).not.toContain(token);
  });

  it('returns the token in the body when delivery is body', async () => {
    const { email } = await signUp(app);
    const response = await call(app, 'POST', '/v1/sessions', {
      body: { email, password, delivery: 'body' },
    });
    expect(response.status).toBe(201);
    const body = (await response.json()) as Record<string, string>;
    expect(Object.keys(body).sort()).toEqual(['expiresAt', 'token']);
  });

  it('sets an HttpOnly host cookie and leaves the token out of the body', async () => {
    const { email } = await signUp(app);
    const { response } = await logInWithCookie(email);
    expect(response.status).toBe(201);
    expect(response.headers.get('cache-control')).toBe('no-store');
    const { name, value, attributes } = parseSetCookie(response);
    expect(name).toBe('__Host-session');
    expect(value).toMatch(/^[\w-]{43}$/);
    expect(attributes).toEqual(cookieAttributes);
    const body = (await response.json()) as Record<string, string>;
    expect(Object.keys(body)).toEqual(['expiresAt']);
    expect(new Date(body.expiresAt as string).getTime()).toBeGreaterThan(Date.now());
  });

  it('issues a fresh cookie on each login, even when one is sent', async () => {
    const { email } = await signUp(app);
    const first = await logInWithCookie(email);
    const second = await logInWithCookie(email, { Cookie: first.cookie });
    expect(second.cookie).not.toBe(first.cookie);
  });

  it.each([
    ['an unknown delivery', 'header'],
    ['a differently cased delivery', 'Cookie'],
  ])('rejects %s', async (_label, delivery) => {
    const { email } = await signUp(app);
    const response = await call(app, 'POST', '/v1/sessions', {
      body: { email, password, delivery },
    });
    const problem = await expectProblem(response, 400, 'validation-failed');
    expect(problem.errors).toEqual([expect.objectContaining({ field: 'delivery' })]);
  });

  it('rejects unknown fields on login', async () => {
    const response = await call(app, 'POST', '/v1/sessions', {
      body: { email: uniqueEmail(), password, remember: true },
    });
    await expectProblem(response, 400, 'validation-failed');
  });

  it('keeps delivery off registration', async () => {
    const response = await call(app, 'POST', '/v1/users', {
      body: { email: uniqueEmail(), password, delivery: 'cookie' },
    });
    await expectProblem(response, 400, 'validation-failed');
  });

  it('rejects a wrong password', async () => {
    const { email } = await signUp(app);
    const response = await call(app, 'POST', '/v1/sessions', {
      body: { email, password: 'wrong-horse-battery' },
    });
    await expectProblem(response, 401, 'invalid-credentials');
  });

  it('gives an unknown email the same answer as a wrong password', async () => {
    const response = await call(app, 'POST', '/v1/sessions', {
      body: { email: uniqueEmail(), password },
    });
    const problem = await expectProblem(response, 401, 'invalid-credentials');
    expect(problem.detail).toBe('The email or password is wrong.');
  });
});

describe('authentication', () => {
  it('returns the current user', async () => {
    const { email, token, userId } = await signUp(app);
    const response = await call(app, 'GET', '/v1/users/me', { token });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ id: userId, email });
  });

  it.each([
    ['no token', {}],
    ['a wrong token', { token: 'not-a-real-token' }],
    ['the wrong scheme', { headers: { Authorization: 'Basic abc' } }],
  ])('rejects %s', async (_label, options) => {
    const response = await call(app, 'GET', '/v1/users/me', options);
    const problem = await expectProblem(response, 401, 'unauthorized');
    expect(problem.detail).toBe(
      'Send a valid session token in the Authorization header as `Bearer <token>`, or log in with `delivery: "cookie"` from the same origin.',
    );
    expect(response.headers.get('www-authenticate')).toBe('Bearer');
    expect(response.headers.get('set-cookie')).toBeNull();
  });

  it('rejects an expired session', async () => {
    const { token, userId } = await signUp(app);
    await db
      .update(sessions)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(sessions.userId, fromPublicId('usr', userId) as string));
    const response = await call(app, 'GET', '/v1/users/me', { token });
    await expectProblem(response, 401, 'unauthorized');
  });

  it('revokes the token on logout', async () => {
    const { token } = await signUp(app);
    expect((await call(app, 'DELETE', '/v1/sessions/current', { token })).status).toBe(204);
    const response = await call(app, 'GET', '/v1/users/me', { token });
    await expectProblem(response, 401, 'unauthorized');
  });

  it('clears the cookie on logout with a bearer token too', async () => {
    const { token } = await signUp(app);
    const response = await call(app, 'DELETE', '/v1/sessions/current', { token });
    expect(response.status).toBe(204);
    expectClearedCookie(response);
  });

  it('keeps other sessions alive on logout', async () => {
    const { email, token } = await signUp(app);
    const second = await call(app, 'POST', '/v1/sessions', { body: { email, password } });
    const { token: other } = (await second.json()) as { token: string };
    await call(app, 'DELETE', '/v1/sessions/current', { token });
    expect((await call(app, 'GET', '/v1/users/me', { token: other })).status).toBe(200);
  });
});

describe('cookie authentication', () => {
  it('returns the current user from the cookie alone', async () => {
    const { email, userId, cookie } = await signUpWithCookie();
    const response = await call(app, 'GET', '/v1/users/me', { headers: { Cookie: cookie } });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ id: userId, email });
  });

  it('prefers the Authorization header over the cookie', async () => {
    const bearer = await signUp(app);
    const { cookie } = await signUpWithCookie();
    const response = await call(app, 'GET', '/v1/users/me', {
      token: bearer.token,
      headers: { Cookie: cookie },
    });
    expect(await response.json()).toMatchObject({ id: bearer.userId });
  });

  it.each([
    ['a wrong token', { Authorization: 'Bearer not-a-real-token' }],
    ['the wrong scheme', { Authorization: 'Basic abc' }],
    ['an empty header', { Authorization: '' }],
  ])('rejects %s even with a valid cookie', async (_label, headers) => {
    const { cookie } = await signUpWithCookie();
    const response = await call(app, 'GET', '/v1/users/me', {
      headers: { ...headers, Cookie: cookie },
    });
    await expectProblem(response, 401, 'unauthorized');
    expect(response.headers.get('set-cookie')).toBeNull();
  });

  it.each([
    ['an unknown cookie', '__Host-session=not-a-real-token'],
    ['an empty cookie', '__Host-session='],
  ])('rejects %s and clears it', async (_label, cookie) => {
    const response = await call(app, 'GET', '/v1/users/me', { headers: { Cookie: cookie } });
    await expectProblem(response, 401, 'unauthorized');
    expect(response.headers.get('www-authenticate')).toBe('Bearer');
    expectClearedCookie(response);
  });

  it('ignores a cookie without the host prefix', async () => {
    const { cookie } = await signUpWithCookie();
    const response = await call(app, 'GET', '/v1/users/me', {
      headers: { Cookie: cookie.replace('__Host-', '') },
    });
    await expectProblem(response, 401, 'unauthorized');
  });

  it('rejects an expired cookie and clears it', async () => {
    const { userId, cookie } = await signUpWithCookie();
    await db
      .update(sessions)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(sessions.userId, fromPublicId('usr', userId) as string));
    const response = await call(app, 'GET', '/v1/users/me', { headers: { Cookie: cookie } });
    await expectProblem(response, 401, 'unauthorized');
    expectClearedCookie(response);
  });

  it('revokes the cookie session on logout and clears it', async () => {
    const { cookie } = await signUpWithCookie();
    const logout = await call(app, 'DELETE', '/v1/sessions/current', {
      headers: { Cookie: cookie },
    });
    expect(logout.status).toBe(204);
    expectClearedCookie(logout);
    const response = await call(app, 'GET', '/v1/users/me', { headers: { Cookie: cookie } });
    await expectProblem(response, 401, 'unauthorized');
    expectClearedCookie(response);
  });
});
