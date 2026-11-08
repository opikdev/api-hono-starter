import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { sessions, users } from '../../src/db/schema.ts';
import { fromPublicId } from '../../src/platform/public-id.ts';
import { call, db, expectProblem, password, signUp, testApp, uniqueEmail } from '../helpers.ts';

const app = testApp();

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
    const { token, expiresAt } = (await response.json()) as { token: string; expiresAt: string };
    expect(new Date(expiresAt).getTime()).toBeGreaterThan(Date.now());
    const stored = await db.select({ hash: sessions.tokenHash }).from(sessions);
    expect(stored.map((row) => row.hash)).not.toContain(token);
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
    await expectProblem(response, 401, 'unauthorized');
    expect(response.headers.get('www-authenticate')).toBe('Bearer');
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

  it('keeps other sessions alive on logout', async () => {
    const { email, token } = await signUp(app);
    const second = await call(app, 'POST', '/v1/sessions', { body: { email, password } });
    const { token: other } = (await second.json()) as { token: string };
    await call(app, 'DELETE', '/v1/sessions/current', { token });
    expect((await call(app, 'GET', '/v1/users/me', { token: other })).status).toBe(200);
  });
});
