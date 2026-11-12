import { createMiddleware } from 'hono/factory';
import type { Db } from '../../db/client.ts';
import { ProblemError } from '../../platform/problem.ts';
import type { AppEnv } from '../../platform/router.ts';
import { clearedSessionCookie, readSessionCookie } from './cookie.ts';
import { findActiveSession } from './store.ts';

const bearerScheme = /^bearer +(\S+)$/i;

function unauthorized(clearCookie: boolean): ProblemError {
  return new ProblemError(
    'unauthorized',
    'Send a valid session token in the Authorization header as `Bearer <token>`, or log in with `delivery: "cookie"` from the same origin.',
    {
      headers: {
        'WWW-Authenticate': 'Bearer',
        ...(clearCookie ? { 'Set-Cookie': clearedSessionCookie } : {}),
      },
    },
  );
}

export function createRequireAuth(db: Db) {
  return createMiddleware<AppEnv>(async (c, next) => {
    const header = c.req.header('authorization');
    const cookie = header === undefined ? readSessionCookie(c) : undefined;
    const token = header === undefined ? cookie : bearerScheme.exec(header)?.[1];

    const session = token ? await findActiveSession(db, token) : null;
    if (!session) throw unauthorized(cookie !== undefined);

    c.set('user', session);
    await next();
  });
}

export type RequireAuth = ReturnType<typeof createRequireAuth>;
