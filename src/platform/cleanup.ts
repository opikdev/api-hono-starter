import { lte, sql } from 'drizzle-orm';
import type { Db } from '../db/client.ts';
import { idempotencyKeys, rateLimits, sessions } from '../db/schema.ts';

export async function deleteExpiredRows(db: Db): Promise<void> {
  const now = sql`now()`;
  await db.delete(sessions).where(lte(sessions.expiresAt, now));
  await db.delete(idempotencyKeys).where(lte(idempotencyKeys.expiresAt, now));
  await db.delete(rateLimits).where(lte(rateLimits.resetAt, now));
}
