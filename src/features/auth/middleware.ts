import { createMiddleware } from 'hono/factory';
import type { Db } from '../../db/client.ts';
import { ProblemError } from '../../platform/problem.ts';
import type { AppEnv } from '../../platform/router.ts';
import { findActiveSession } from './store.ts';

const bearerPrefix = 'Bearer ';

function unauthorized(): ProblemError {
  return new ProblemError(
    'unauthorized',
    'Send a valid session token in the Authorization header as `Bearer <token>`.',
    { headers: { 'WWW-Authenticate': 'Bearer' } },
  );
}

export function createRequireAuth(db: Db) {
  return createMiddleware<AppEnv>(async (c, next) => {
    const header = c.req.header('authorization');
    if (!header?.startsWith(bearerPrefix)) throw unauthorized();

    const session = await findActiveSession(db, header.slice(bearerPrefix.length));
    if (!session) throw unauthorized();

    c.set('user', session);
    await next();
  });
}

export type RequireAuth = ReturnType<typeof createRequireAuth>;
