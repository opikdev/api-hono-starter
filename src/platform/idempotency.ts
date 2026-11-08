import { createHash } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import type { Db } from '../db/client.ts';
import { idempotencyKeys } from '../db/schema.ts';
import { ProblemError } from './problem.ts';

type Transaction = Parameters<Parameters<Db['transaction']>[0]>[0];

interface IdempotentRequest {
  userId: string;
  key: string | undefined;
  payload: unknown;
}

export interface IdempotentResult<T> {
  body: T;
  replayed: boolean;
}

const retention = sql`now() + interval '24 hours'`;

function hashPayload(payload: unknown): string {
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

export function withIdempotency<T>(
  db: Db,
  { userId, key, payload }: IdempotentRequest,
  create: (tx: Transaction) => Promise<T>,
): Promise<IdempotentResult<T>> {
  return db.transaction(async (tx) => {
    if (!key) return { body: await create(tx), replayed: false };

    const requestHash = hashPayload(payload);
    const [claimed] = await tx
      .insert(idempotencyKeys)
      .values({
        userId,
        key,
        requestHash,
        responseBody: {},
        expiresAt: retention,
      })
      .onConflictDoNothing({ target: [idempotencyKeys.userId, idempotencyKeys.key] })
      .returning({ id: idempotencyKeys.id });

    if (!claimed) {
      const [original] = await tx
        .select()
        .from(idempotencyKeys)
        .where(and(eq(idempotencyKeys.userId, userId), eq(idempotencyKeys.key, key)));
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
