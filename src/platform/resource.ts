import { z } from '@hono/zod-openapi';
import { ProblemError } from './problem.ts';
import { fromPublicId, type IdPrefix } from './public-id.ts';

const maxVersion = 2_147_483_647;

export const bearerSecurity = [{ bearerAuth: [] }];

export const hasNoNul = (value: string) => !value.includes('\0');
export const nulMessage = 'Must not contain NUL characters';

export const jsonContent = <T extends z.ZodType>(schema: T) => ({
  content: { 'application/json': { schema } },
});

export const idParams = z.object({
  id: z.string().openapi({ param: { name: 'id', in: 'path' } }),
});

export const listQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20).openapi({ example: 20 }),
  cursor: z.string().optional().openapi({ description: '`meta.nextCursor` from a prior page.' }),
});

export const idempotencyHeaders = z.object({
  'idempotency-key': z
    .string()
    .min(1)
    .max(255)
    .optional()
    .openapi({ description: 'Replays within 24 hours return the original response.' }),
});

export const ifMatchHeaders = z.object({
  'if-match': z.string().optional().openapi({
    description: 'The `ETag` from your last read. Required.',
    example: '"1"',
  }),
});

export function pageSchema<T extends z.ZodType>(item: T, name: string) {
  return z
    .object({
      data: z.array(item),
      meta: z.object({
        limit: z.number().int().openapi({ example: 20 }),
        nextCursor: z.string().nullable().openapi({ example: null }),
      }),
    })
    .openapi(name);
}

export function etag(version: number): string {
  return `"${version}"`;
}

export function parseIfMatch(header: string | undefined): number {
  if (!header) {
    throw new ProblemError(
      'precondition-required',
      'Send the If-Match header with the ETag from your last read of this resource.',
    );
  }
  const version = Number(/^"(\d+)"$/.exec(header)?.[1]);
  if (!Number.isInteger(version) || version > maxVersion) {
    throw new ProblemError('version-mismatch', `If-Match ${header} is not a current ETag.`);
  }
  return version;
}

export function parseCursor(prefix: IdPrefix, cursor: string | undefined): string | null {
  if (!cursor) return null;
  const id = fromPublicId(prefix, cursor);
  if (!id) {
    throw new ProblemError('validation-failed', `Cursor ${cursor} is not valid.`, {
      errors: [{ field: 'cursor', detail: 'Use meta.nextCursor from a previous response' }],
    });
  }
  return id;
}

export function toPage<Row, Item extends { id: string }>(
  rows: Row[],
  limit: number,
  present: (row: Row) => Item,
) {
  const data = rows.slice(0, limit).map(present);
  const nextCursor = rows.length > limit ? (data.at(-1)?.id ?? null) : null;
  return { data, meta: { limit, nextCursor } };
}
