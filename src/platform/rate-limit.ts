import { createHash } from 'node:crypto';
import { and, eq, gt, sql } from 'drizzle-orm';
import type { Context } from 'hono';
import { createMiddleware } from 'hono/factory';
import type { Db } from '../db/client.ts';
import { rateLimits } from '../db/schema.ts';
import { clientIp, clientNetwork } from './client-ip.ts';
import { ProblemError } from './problem.ts';
import type { AppEnv } from './router.ts';

export interface PolicyState {
  name: string;
  quota: number;
  windowSeconds: number;
  remaining: number;
  resetSeconds: number;
}

interface Policy {
  name: string;
  quota: number;
  windowSeconds: number;
}

async function hit(db: Db, key: string, policy: Policy) {
  const expired = sql`${rateLimits.resetAt} <= now()`;
  const nextReset = sql`now() + ${policy.windowSeconds}::int * interval '1 second'`;
  const [row] = await db
    .insert(rateLimits)
    .values({ key, resetAt: nextReset })
    .onConflictDoUpdate({
      target: rateLimits.key,
      set: {
        count: sql`case when ${expired} then 1 else ${rateLimits.count} + 1 end`,
        resetAt: sql`case when ${expired} then ${nextReset} else ${rateLimits.resetAt} end`,
        updatedAt: sql`now()`,
      },
    })
    .returning({ count: rateLimits.count, resetAt: rateLimits.resetAt });
  if (!row) throw new Error(`Rate limit upsert returned no row for key: ${key}`);

  const resetSeconds = Math.max(1, Math.ceil((row.resetAt.getTime() - Date.now()) / 1000));
  const state: PolicyState = {
    ...policy,
    remaining: Math.max(0, policy.quota - row.count),
    resetSeconds,
  };
  return { state, exceeded: row.count > policy.quota };
}

const policyItem = (state: PolicyState) =>
  `"${state.name}";q=${state.quota};w=${state.windowSeconds}`;
const stateItem = (state: PolicyState) =>
  `"${state.name}";r=${state.remaining};t=${state.resetSeconds}`;

function rateLimited(policies: PolicyState[], exceeded: PolicyState, detail: string) {
  return new ProblemError('rate-limited', detail, {
    headers: {
      'RateLimit-Policy': policies.map(policyItem).join(', '),
      RateLimit: stateItem(exceeded),
      'Retry-After': String(exceeded.resetSeconds),
    },
  });
}

export type RateLimit = ReturnType<typeof rateLimit>;

interface RateLimitOptions {
  db: Db;
  name: string;
  limit: number;
  trustedProxyHops: number;
}

/**
 * Counts requests per client network each minute. The innermost limiter writes the RateLimit
 * headers for every policy applied so far, and a 429 keeps the headers of the policy it exceeded.
 */
export function rateLimit({ db, name, limit, trustedProxyHops }: RateLimitOptions) {
  const policy = { name, quota: limit, windowSeconds: 60 };
  return createMiddleware<AppEnv>(async (c, next) => {
    const key = `${name}:${clientNetwork(clientIp(c, trustedProxyHops))}`;
    const { state, exceeded } = await hit(db, key, policy);
    const policies = [...(c.get('rateLimits') ?? []), state];
    c.set('rateLimits', policies);

    if (exceeded) {
      throw rateLimited(
        policies,
        state,
        `You've reached the limit of ${limit} requests per minute. Retry in ${state.resetSeconds} seconds.`,
      );
    }

    await next();
    if (!c.res.headers.has('RateLimit')) {
      c.header('RateLimit-Policy', policies.map(policyItem).join(', '));
      c.header('RateLimit', policies.map(stateItem).join(', '));
    }
  });
}

export interface LoginAttempt {
  blocked: ProblemError | null;
  succeeded: () => Promise<void>;
}

export type LoginFailureLimit = ReturnType<typeof loginFailureLimit>;

interface LoginFailureLimitOptions {
  db: Db;
  limit: number;
  windowSeconds: number;
}

/**
 * Counts failed logins per email, whether or not the account exists. Each attempt counts up
 * front, so concurrent guesses can't overshoot, and a success takes its count back.
 */
export function loginFailureLimit({ db, limit, windowSeconds }: LoginFailureLimitOptions) {
  const policy = { name: 'login', quota: limit, windowSeconds };
  return async (c: Context<AppEnv>, email: string): Promise<LoginAttempt> => {
    const digest = createHash('sha256').update(email.trim().toLowerCase()).digest('hex');
    const key = `login:${digest}`;
    const { state, exceeded } = await hit(db, key, policy);
    const blocked = exceeded
      ? rateLimited(
          [...(c.get('rateLimits') ?? []), state],
          state,
          `Too many failed logins for this account. Retry in ${state.resetSeconds} seconds.`,
        )
      : null;
    const succeeded = async () => {
      await db
        .update(rateLimits)
        .set({ count: sql`${rateLimits.count} - 1` })
        .where(
          and(eq(rateLimits.key, key), gt(rateLimits.count, 0), gt(rateLimits.resetAt, sql`now()`)),
        );
    };
    return { blocked, succeeded };
  };
}
