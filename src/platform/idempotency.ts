import { createHash } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import type { Context } from 'hono';
import { routePath } from 'hono/route';
import type { Db } from '../db/client.ts';
import { idempotencyKeys } from '../db/schema.ts';
import { ProblemError } from './problem.ts';

type Transaction = Parameters<Parameters<Db['transaction']>[0]>[0];

interface IdempotentRequest {
  userId: string;
  endpoint: string;
  key: string | undefined;
  fingerprint: string;
}

export interface IdempotentResult<T> {
  body: T;
  replayed: boolean;
}

const retention = sql`now() + interval '24 hours'`;

function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) =>
    item !== null && typeof item === 'object' && !Array.isArray(item)
      ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : item,
  );
}

/** Hashes the method, path, and whole validated body, with keys sorted, so every field counts. */
export function fingerprint(method: string, path: string, body: unknown): string {
  return createHash('sha256')
    .update(`${method} ${path}\n${canonicalJson(body)}`)
    .digest('hex');
}

/**
 * Scopes keys to the route, such as `POST /v1/notes`, so one key can't replay another endpoint,
 * and fingerprints the request, so a key reused with a different request is rejected.
 */
export function idempotencyScope(c: Context, body: unknown) {
  return {
    endpoint: `${c.req.method} ${routePath(c)}`,
    fingerprint: fingerprint(c.req.method, c.req.path, body),
  };
}

export function withIdempotency<T>(
  db: Db,
  { userId, endpoint, key, fingerprint: requestHash }: IdempotentRequest,
  create: (tx: Transaction) => Promise<T>,
): Promise<IdempotentResult<T>> {
  return db.transaction(async (tx) => {
    if (!key) return { body: await create(tx), replayed: false };

    const [claimed] = await tx
      .insert(idempotencyKeys)
      .values({
        userId,
        endpoint,
        key,
        requestHash,
        responseBody: {},
        expiresAt: retention,
      })
      .onConflictDoUpdate({
        target: [idempotencyKeys.userId, idempotencyKeys.endpoint, idempotencyKeys.key],
        set: { requestHash, responseBody: {}, expiresAt: retention, updatedAt: sql`now()` },
        setWhere: sql`${idempotencyKeys.expiresAt} <= now()`,
      })
      .returning({ id: idempotencyKeys.id });

    if (!claimed) {
      const [original] = await tx
        .select()
        .from(idempotencyKeys)
        .where(
          and(
            eq(idempotencyKeys.userId, userId),
            eq(idempotencyKeys.endpoint, endpoint),
            eq(idempotencyKeys.key, key),
          ),
        );
      if (!original) throw new Error(`Idempotency key vanished during replay: ${key}`);
      if (original.requestHash !== requestHash) {
        throw new ProblemError(
          'idempotency-key-reused',
          'This Idempotency-Key was used with a different request body. Use a new key.',
        );
      }
      return { body: original.responseBody as T, replayed: true };
    }

    const body = await create(tx);
    await tx
      .update(idempotencyKeys)
      .set({ responseBody: body })
      .where(eq(idempotencyKeys.id, claimed.id));
    return { body, replayed: false };
  });
}
