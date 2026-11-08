import { createRoute, z } from '@hono/zod-openapi';
import { sql } from 'drizzle-orm';
import type { Db } from '../../db/client.ts';
import { ProblemError, problemResponses } from '../../platform/problem.ts';
import { createRouter } from '../../platform/router.ts';

const statusSchema = z.object({ status: z.literal('ok') }).openapi('HealthStatus');

export function createHealthRouter(db: Db) {
  return createRouter()
    .openapi(
      createRoute({
        method: 'get',
        path: '/healthz',
        operationId: 'getLiveness',
        summary: 'Check that the process is running',
        tags: ['Health'],
        responses: {
          200: {
            description: 'The process is running',
            content: { 'application/json': { schema: statusSchema } },
          },
        },
      }),
      (c) => c.json({ status: 'ok' as const }, 200),
    )
    .openapi(
      createRoute({
        method: 'get',
        path: '/readyz',
        operationId: 'getReadiness',
        summary: 'Check that the API can reach Postgres',
        tags: ['Health'],
        responses: {
          200: {
            description: 'Ready for traffic',
            content: { 'application/json': { schema: statusSchema } },
          },
          ...problemResponses('service-unavailable'),
        },
      }),
      async (c) => {
        try {
          await db.execute(sql`select 1`);
        } catch (cause) {
          throw new ProblemError('service-unavailable', 'Postgres is unreachable. Retry shortly.', {
            headers: { 'Retry-After': '5' },
            cause,
          });
        }
        return c.json({ status: 'ok' as const }, 200);
      },
    );
}
