import { createRoute, z } from '@hono/zod-openapi';
import type { Db } from '../../db/client.ts';
import { ProblemError, problemResponses } from '../../platform/problem.ts';
import { toPublicId } from '../../platform/public-id.ts';
import type { RateLimit } from '../../platform/rate-limit.ts';
import { sessionSecurity } from '../../platform/resource.ts';
import { createRouter } from '../../platform/router.ts';
import { clearSessionCookie, setSessionCookie } from './cookie.ts';
import type { RequireAuth } from './middleware.ts';
import { hashPassword, verifyPassword } from './password.ts';
import {
  createSession,
  createUser,
  deleteSession,
  findUserByEmail,
  updatePasswordHash,
} from './store.ts';

const unknownUserPasswordHash = await hashPassword('timing-equalizer');

const credentialFields = {
  email: z.email().max(254).toLowerCase().openapi({ example: 'ada@example.com' }),
  password: z.string().min(12).max(128).openapi({ example: 'correct-horse-battery' }),
};

const credentialsSchema = z.strictObject(credentialFields).openapi('Credentials');

const loginSchema = z
  .strictObject({
    ...credentialFields,
    delivery: z.enum(['body', 'cookie']).default('body').openapi({
      description:
        '`body` returns the token in the response. `cookie` sets it in an `HttpOnly` cookie instead, for a browser app on the same origin as the API.',
      example: 'cookie',
    }),
  })
  .openapi('Login');

const userSchema = z
  .object({
    id: z.string().openapi({ example: 'usr_0190a7e4c1f07c3e8d21b6f4a9e05d13' }),
    email: z.string().openapi({ example: 'ada@example.com' }),
    createdAt: z.iso.datetime().openapi({ example: '2026-11-07T15:20:30.000Z' }),
  })
  .openapi('User');

const sessionSchema = z
  .object({
    token: z.string().optional().openapi({
      description: 'Present when `delivery` is `body`. Send it as `Authorization: Bearer <token>`.',
    }),
    expiresAt: z.iso.datetime().openapi({ example: '2026-11-14T15:20:30.000Z' }),
  })
  .openapi('Session');

const sessionCookieHeader = {
  'Set-Cookie': {
    description:
      'Sent when `delivery` is `cookie`. Browsers send the cookie back on every request.',
    schema: {
      type: 'string' as const,
      example: '__Host-session=<token>; Max-Age=604800; Path=/; HttpOnly; Secure; SameSite=Strict',
    },
  },
};

const clearedCookieHeader = {
  'Set-Cookie': {
    description: 'Clears the session cookie.',
    schema: {
      type: 'string' as const,
      example: '__Host-session=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Strict',
    },
  },
};

const jsonBody = <T extends z.ZodType>(schema: T) => ({
  content: { 'application/json': { schema } },
  required: true,
});

function presentUser(user: { id: string; email: string; createdAt: Date }) {
  return {
    id: toPublicId('usr', user.id),
    email: user.email,
    createdAt: user.createdAt.toISOString(),
  };
}

interface AuthRouterOptions {
  db: Db;
  requireAuth: RequireAuth;
  authRateLimit: RateLimit;
  sessionTtlHours: number;
}

export function createAuthRouter({
  db,
  requireAuth,
  authRateLimit,
  sessionTtlHours,
}: AuthRouterOptions) {
  return createRouter()
    .openapi(
      createRoute({
        method: 'post',
        path: '/users',
        operationId: 'createUser',
        summary: 'Register a user',
        tags: ['Auth'],
        middleware: [authRateLimit],
        request: { body: jsonBody(credentialsSchema) },
        responses: {
          201: {
            description: 'User created',
            content: { 'application/json': { schema: userSchema } },
          },
          ...problemResponses(
            'validation-failed',
            'email-taken',
            'unsupported-media-type',
            'rate-limited',
          ),
        },
      }),
      async (c) => {
        const { email, password } = c.req.valid('json');
        const user = await createUser(db, email, await hashPassword(password));
        if (!user) {
          throw new ProblemError('email-taken', `${email} is already registered. Log in instead.`);
        }
        return c.json(presentUser(user), 201);
      },
    )
    .openapi(
      createRoute({
        method: 'post',
        path: '/sessions',
        operationId: 'createSession',
        summary: 'Log in',
        description: 'Exempt from Idempotency-Key, because a replay would have to store the token.',
        tags: ['Auth'],
        middleware: [authRateLimit],
        request: { body: jsonBody(loginSchema) },
        responses: {
          201: {
            description: 'Session created',
            headers: sessionCookieHeader,
            content: { 'application/json': { schema: sessionSchema } },
          },
          ...problemResponses(
            'validation-failed',
            'invalid-credentials',
            'unsupported-media-type',
            'rate-limited',
          ),
        },
      }),
      async (c) => {
        const { email, password, delivery } = c.req.valid('json');
        const user = await findUserByEmail(db, email);
        const { valid, needsRehash } = await verifyPassword(
          password,
          user?.passwordHash ?? unknownUserPasswordHash,
        );
        if (!user || !valid) {
          throw new ProblemError('invalid-credentials', 'The email or password is wrong.');
        }
        if (needsRehash) await updatePasswordHash(db, user.id, await hashPassword(password));

        const session = await createSession(db, user.id, sessionTtlHours);
        const expiresAt = session.expiresAt.toISOString();
        c.header('Cache-Control', 'no-store');
        if (delivery === 'cookie') {
          setSessionCookie(c, session.token, sessionTtlHours * 3600);
          return c.json({ expiresAt }, 201);
        }
        return c.json({ token: session.token, expiresAt }, 201);
      },
    )
    .openapi(
      createRoute({
        method: 'delete',
        path: '/sessions/current',
        operationId: 'deleteCurrentSession',
        summary: 'Log out',
        tags: ['Auth'],
        security: sessionSecurity,
        middleware: [requireAuth],
        responses: {
          204: { description: 'Session revoked', headers: clearedCookieHeader },
          ...problemResponses('unauthorized', 'rate-limited'),
        },
      }),
      async (c) => {
        await deleteSession(db, c.get('user').sessionId);
        clearSessionCookie(c);
        return c.body(null, 204);
      },
    )
    .openapi(
      createRoute({
        method: 'get',
        path: '/users/me',
        operationId: 'getCurrentUser',
        summary: 'Get the current user',
        tags: ['Auth'],
        security: sessionSecurity,
        middleware: [requireAuth],
        responses: {
          200: {
            description: 'Current user',
            content: { 'application/json': { schema: userSchema } },
          },
          ...problemResponses('unauthorized', 'rate-limited'),
        },
      }),
      (c) => c.json(presentUser(c.get('user')), 200),
    );
}
