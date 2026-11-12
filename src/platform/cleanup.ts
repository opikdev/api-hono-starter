import { SpanStatusCode, trace } from '@opentelemetry/api';
import { lte, sql } from 'drizzle-orm';
import type { Db } from '../db/client.ts';
import { idempotencyKeys, rateLimits, sessions } from '../db/schema.ts';

const tracer = trace.getTracer('cleanup');

export function deleteExpiredRows(db: Db): Promise<void> {
  return tracer.startActiveSpan('delete expired rows', async (span) => {
    try {
      const now = sql`now()`;
      await db.delete(sessions).where(lte(sessions.expiresAt, now));
      await db.delete(idempotencyKeys).where(lte(idempotencyKeys.expiresAt, now));
      await db.delete(rateLimits).where(lte(rateLimits.resetAt, now));
    } catch (error) {
      span.recordException(error as Error);
      span.setStatus({ code: SpanStatusCode.ERROR });
      throw error;
    } finally {
      span.end();
    }
  });
}
