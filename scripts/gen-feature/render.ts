import type { FeatureSpec, Field } from './spec.ts';

const maxStringLength = 200;
const maxTextLength = 10_000;

const quote = (value: string) => `'${value}'`;

function columnBuilder(field: Field): string {
  const name = quote(field.column);
  const base = {
    string: `text(${name})`,
    text: `text(${name})`,
    enum: `text(${name})`,
    int: `integer(${name})`,
    boolean: `boolean(${name})`,
    datetime: `timestamp(${name}, { withTimezone: true })`,
  }[field.type];
  return field.optional ? base : `${base}.notNull()`;
}

function checkConstraint(spec: FeatureSpec, field: Field): string | null {
  const column = `\${table.${field.name}}`;
  switch (field.type) {
    case 'string':
      return `check('chk_${spec.table}_${field.column}_length', sql\`char_length(${column}) between 1 and ${maxStringLength}\`)`;
    case 'text':
      return `check('chk_${spec.table}_${field.column}_length', sql\`char_length(${column}) <= ${maxTextLength}\`)`;
    case 'enum':
      return `check('chk_${spec.table}_${field.column}_values', sql\`${column} in (${field.values.map(quote).join(', ')})\`)`;
    default:
      return null;
  }
}

export function schemaImports(spec: FeatureSpec): string[] {
  const names = new Set([
    'check',
    'foreignKey',
    'index',
    'integer',
    'pgTable',
    'primaryKey',
    'uuid',
  ]);
  for (const field of spec.fields) {
    if (field.unique) names.add('unique');
    if (['string', 'text', 'enum'].includes(field.type)) names.add('text');
    if (field.type === 'boolean') names.add('boolean');
    if (field.type === 'datetime') names.add('timestamp');
  }
  return [...names];
}

export function renderTable(spec: FeatureSpec): string {
  const columns = spec.fields
    .map((field) => `    ${field.name}: ${columnBuilder(field)},`)
    .join('\n');
  const checks = spec.fields
    .map((field) => checkConstraint(spec, field))
    .filter((check) => check !== null)
    .map((check) => `    ${check},`)
    .join('\n');
  const uniques = spec.fields
    .filter((field) => field.unique)
    .map(
      (field) =>
        `    unique('uq_${spec.table}_user_id_${field.column}').on(table.userId, table.${field.name}),\n`,
    )
    .join('');
  return `
export const ${spec.plural} = pgTable(
  '${spec.table}',
  {
    id,
    userId: uuid('user_id').notNull(),
${columns}
    version: integer('version').notNull().default(1),
    ...timestamps,
  },
  (table) => [
    primaryKey({ name: 'pk_${spec.table}', columns: [table.id] }),
    foreignKey({
      name: 'fk_${spec.table}_user_id',
      columns: [table.userId],
      foreignColumns: [users.id],
    }).onDelete('cascade'),
    index('idx_${spec.table}_user_id_id').on(table.userId, table.id.desc()),
${uniques}${checks}
    check('chk_${spec.table}_version_positive', sql\`\${table.version} > 0\`),
  ],
);
`;
}

export function renderStore(spec: FeatureSpec): string {
  const { plural: table, Singular, Plural } = spec;
  return `import { and, desc, eq, lt } from 'drizzle-orm';
import type { Db } from '../../db/client.ts';
import { ${table} } from '../../db/schema.ts';

type Writer = Pick<Db, 'insert'>;

export type ${Singular}Row = typeof ${table}.$inferSelect;
export type ${Singular}Values = Omit<
  typeof ${table}.$inferInsert,
  'id' | 'userId' | 'version' | 'createdAt' | 'updatedAt'
>;

export async function insert${Singular}(db: Writer, userId: string, values: ${Singular}Values) {
  const [row] = await db
    .insert(${table})
    .values({ userId, ...values })
    .returning();
  if (!row) throw new Error(\`${Singular} insert returned no row for user: \${userId}\`);
  return row;
}

export async function find${Singular}(db: Db, userId: string, id: string) {
  const [row] = await db
    .select()
    .from(${table})
    .where(and(eq(${table}.id, id), eq(${table}.userId, userId)));
  return row ?? null;
}

export function list${Plural}(db: Db, userId: string, limit: number, cursor: string | null) {
  return db
    .select()
    .from(${table})
    .where(and(eq(${table}.userId, userId), cursor ? lt(${table}.id, cursor) : undefined))
    .orderBy(desc(${table}.id))
    .limit(limit);
}

export async function update${Singular}(
  db: Db,
  userId: string,
  id: string,
  version: number,
  patch: Partial<${Singular}Values>,
) {
  const [row] = await db
    .update(${table})
    .set({ ...patch, version: version + 1 })
    .where(and(eq(${table}.id, id), eq(${table}.userId, userId), eq(${table}.version, version)))
    .returning();
  return row ?? null;
}

export async function delete${Singular}(db: Db, userId: string, id: string) {
  const deleted = await db
    .delete(${table})
    .where(and(eq(${table}.id, id), eq(${table}.userId, userId)))
    .returning({ id: ${table}.id });
  return deleted.length > 0;
}
`;
}

const sample = {
  string: () => `'Example'`,
  text: () => `'Some text'`,
  int: () => '42',
  boolean: () => 'true',
  datetime: () => `'2026-01-01T00:00:00.000Z'`,
  enum: (field: Field) => quote(field.values[0] as string),
};

const changed = {
  string: () => `'Changed'`,
  text: () => `'Other text'`,
  int: () => '7',
  boolean: () => 'false',
  datetime: () => `'2027-06-15T12:30:00.000Z'`,
  enum: (field: Field) => quote(field.values.at(-1) as string),
};

const sequenced: Partial<Record<Field['type'], string>> = {
  string: `\`Example \${sequence}\``,
  int: 'sequence',
  datetime: 'new Date(Date.UTC(2026, 0, 1, 0, 0, sequence)).toISOString()',
};

function renderUniqueTests(field: Field, fullBody: string): string {
  return `
describe('unique ${field.name}', () => {
  it('rejects a duplicate ${field.name} with 409', async () => {
    const { token } = await signUp(app);
    await create(token, ${fullBody});
    const response = await call(app, 'POST', path, { token, body: ${fullBody} });
    await expectProblem(response, 409, 'conflict');
  });

  it('lets another user use the same ${field.name}', async () => {
    await create((await signUp(app)).token, ${fullBody});
    const { token } = await signUp(app);
    expect((await call(app, 'POST', path, { token, body: ${fullBody} })).status).toBe(201);
  });

  it('rejects an update to a taken ${field.name} with 409', async () => {
    const { token } = await signUp(app);
    await create(token, ${fullBody});
    const other = await create(token);
    const response = await call(app, 'PATCH', \`\${path}/\${other.id}\`, {
      token,
      body: { ${field.name}: ${sample[field.type](field)} },
      headers: { 'If-Match': '"1"' },
    });
    await expectProblem(response, 409, 'conflict');
  });
});
`;
}

const wrongType = {
  string: () => '123',
  text: () => '123',
  int: () => `'not-a-number'`,
  boolean: () => `'yes'`,
  datetime: () => `'not-a-date'`,
  enum: () => `'not-an-option'`,
};

function inputSchema(field: Field): string {
  switch (field.type) {
    case 'string':
      return `z.string().trim().min(1).max(${maxStringLength}).refine(hasNoNul, nulMessage).openapi({ example: 'Example' })`;
    case 'text':
      return `z.string().max(${maxTextLength}).refine(hasNoNul, nulMessage).openapi({ example: 'Some text' })`;
    case 'int':
      return `z.number().int().min(-2_147_483_648).max(2_147_483_647).openapi({ example: 42 })`;
    case 'boolean':
      return 'z.boolean().openapi({ example: true })';
    case 'datetime':
      return `z.iso.datetime().openapi({ example: '2026-01-01T00:00:00.000Z' })`;
    case 'enum':
      return `z.enum([${field.values.map(quote).join(', ')}]).openapi({ example: ${quote(field.values[0] as string)} })`;
  }
}

function outputSchema(field: Field): string {
  const base = {
    string: 'z.string()',
    text: 'z.string()',
    int: 'z.number().int()',
    boolean: 'z.boolean()',
    datetime: 'z.iso.datetime()',
    enum: `z.enum([${field.values.map(quote).join(', ')}])`,
  }[field.type];
  return field.optional ? `${base}.nullable()` : base;
}

function presentValue(field: Field): string {
  const value = `row.${field.name}`;
  if (field.type === 'datetime') {
    return field.optional ? `${value}?.toISOString() ?? null` : `${value}.toISOString()`;
  }
  if (field.type === 'enum') {
    return `${value} as z.infer<typeof fields.${field.name}>${field.optional ? ' | null' : ''}`;
  }
  return value;
}

function createValue(field: Field): string {
  const value = `input.${field.name}`;
  if (field.type === 'datetime') {
    return field.optional ? `${value} == null ? null : new Date(${value})` : `new Date(${value})`;
  }
  return field.optional ? `${value} ?? null` : value;
}

function patchLine(field: Field): string {
  const value = `input.${field.name}`;
  const converted =
    field.type === 'datetime'
      ? field.optional
        ? `${value} === null ? null : new Date(${value})`
        : `new Date(${value})`
      : value;
  return `  if (${value} !== undefined) patch.${field.name} = ${converted};`;
}

export function renderRoutes(spec: FeatureSpec): string {
  const { Singular, Plural, singular, prefix, name } = spec;
  const usesText = spec.fields.some((field) => field.type === 'string' || field.type === 'text');
  const textImports = usesText ? '  hasNoNul,\n' : '';
  const nulImport = usesText ? '  nulMessage,\n' : '';
  const fieldDefs = spec.fields
    .map((field) => `  ${field.name}: ${inputSchema(field)},`)
    .join('\n');
  const outputs = spec.fields
    .map((field) => `    ${field.name}: ${outputSchema(field)},`)
    .join('\n');
  const createShape = spec.fields
    .map(
      (field) =>
        `    ${field.name}: fields.${field.name}${field.optional ? '.nullable().optional()' : ''},`,
    )
    .join('\n');
  const updateShape = spec.fields
    .map(
      (field) =>
        `    ${field.name}: fields.${field.name}${field.optional ? '.nullable()' : ''}.optional(),`,
    )
    .join('\n');
  const present = spec.fields
    .map((field) => `    ${field.name}: ${presentValue(field)},`)
    .join('\n');
  const createValues = spec.fields
    .map((field) => `    ${field.name}: ${createValue(field)},`)
    .join('\n');
  const patchLines = spec.fields.map(patchLine).join('\n');
  const path = `/${name}`;
  const label = spec.title;
  const article = /^[aeiou]/.test(singular) ? 'an' : 'a';
  const singularLabel = singular.replace(/[A-Z]/g, (char) => ` ${char.toLowerCase()}`);
  const conflict = spec.fields.some((field) => field.unique) ? `\n            'conflict',` : '';

  return `import { createRoute, z } from '@hono/zod-openapi';
import type { Db } from '../../db/client.ts';
import { idempotencyScope, withIdempotency } from '../../platform/idempotency.ts';
import { ProblemError, problemResponses } from '../../platform/problem.ts';
import { fromPublicId, toPublicId } from '../../platform/public-id.ts';
import {
  etag,
${textImports}  idempotencyHeaders,
  idParams,
  ifMatchHeaders,
  jsonContent,
  listQuery,
${nulImport}  pageSchema,
  parseCursor,
  parseIfMatch,
  sessionSecurity,
  toPage,
} from '../../platform/resource.ts';
import { createRouter } from '../../platform/router.ts';
import type { RequireAuth } from '../auth/middleware.ts';
import {
  delete${Singular},
  find${Singular},
  insert${Singular},
  list${Plural},
  type ${Singular}Row,
  type ${Singular}Values,
  update${Singular},
} from './store.ts';

const fields = {
${fieldDefs}
};

const ${singular}Schema = z
  .object({
    id: z.string().openapi({ example: '${prefix}_0190a7e4c1f07c3e8d21b6f4a9e05d13' }),
${outputs}
    version: z.number().int().openapi({ example: 1 }),
    createdAt: z.iso.datetime().openapi({ example: '2026-11-07T15:20:30.000Z' }),
    updatedAt: z.iso.datetime().openapi({ example: '2026-11-07T15:20:30.000Z' }),
  })
  .openapi('${Singular}');

const create${Singular}Schema = z
  .strictObject({
${createShape}
  })
  .openapi('Create${Singular}');

const update${Singular}Schema = z
  .strictObject({
${updateShape}
  })
  .refine((patch) => Object.keys(patch).length > 0, { message: 'Provide at least one field' })
  .openapi('Update${Singular}');

const ${singular}ListSchema = pageSchema(${singular}Schema, '${Singular}List');

function present${Singular}(row: ${Singular}Row) {
  return {
    id: toPublicId('${prefix}', row.id),
${present}
    version: row.version,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toValues(input: z.infer<typeof create${Singular}Schema>): ${Singular}Values {
  return {
${createValues}
  };
}

function toPatch(input: z.infer<typeof update${Singular}Schema>): Partial<${Singular}Values> {
  const patch: Partial<${Singular}Values> = {};
${patchLines}
  return patch;
}

function notFound(publicId: string): ProblemError {
  return new ProblemError('not-found', \`${Singular} \${publicId} does not exist.\`);
}

interface ${Plural}RouterOptions {
  db: Db;
  requireAuth: RequireAuth;
}

export function create${Plural}Router({ db, requireAuth }: ${Plural}RouterOptions) {
  return createRouter()
    .openapi(
      createRoute({
        method: 'post',
        path: '${path}',
        operationId: 'create${Singular}',
        summary: 'Create ${article}${singularLabel.startsWith(' ') ? '' : ' '}${singularLabel}',
        tags: ['${Plural}'],
        security: sessionSecurity,
        middleware: [requireAuth],
        request: {
          headers: idempotencyHeaders,
          body: { ...jsonContent(create${Singular}Schema), required: true },
        },
        responses: {
          201: { description: '${Singular} created', ...jsonContent(${singular}Schema) },
          ...problemResponses(
            'validation-failed',
            'unauthorized',${conflict}
            'idempotency-key-reused',
            'unsupported-media-type',
            'rate-limited',
          ),
        },
      }),
      async (c) => {
        const input = c.req.valid('json');
        const userId = c.get('user').id;
        const { body: item, replayed } = await withIdempotency(
          db,
          {
            userId,
            key: c.req.valid('header')['idempotency-key'],
            ...idempotencyScope(c, input),
          },
          async (tx) => present${Singular}(await insert${Singular}(tx, userId, toValues(input))),
        );

        if (replayed) c.header('Idempotency-Replayed', 'true');
        c.header('ETag', etag(item.version));
        c.header('Location', \`/v1${path}/\${item.id}\`);
        return c.json(item, 201);
      },
    )
    .openapi(
      createRoute({
        method: 'get',
        path: '${path}',
        operationId: 'list${Plural}',
        summary: 'List your ${label}, newest first',
        tags: ['${Plural}'],
        security: sessionSecurity,
        middleware: [requireAuth],
        request: { query: listQuery },
        responses: {
          200: { description: 'A page of ${label}', ...jsonContent(${singular}ListSchema) },
          ...problemResponses('validation-failed', 'unauthorized', 'rate-limited'),
        },
      }),
      async (c) => {
        const { limit, cursor } = c.req.valid('query');
        const after = parseCursor('${prefix}', cursor);
        const rows = await list${Plural}(db, c.get('user').id, limit + 1, after);
        return c.json(toPage(rows, limit, present${Singular}), 200);
      },
    )
    .openapi(
      createRoute({
        method: 'get',
        path: '${path}/{id}',
        operationId: 'get${Singular}',
        summary: 'Get ${article}${singularLabel.startsWith(' ') ? '' : ' '}${singularLabel}',
        tags: ['${Plural}'],
        security: sessionSecurity,
        middleware: [requireAuth],
        request: { params: idParams },
        responses: {
          200: { description: 'The ${singularLabel.trim()}', ...jsonContent(${singular}Schema) },
          ...problemResponses('unauthorized', 'not-found', 'rate-limited'),
        },
      }),
      async (c) => {
        const { id } = c.req.valid('param');
        const rowId = fromPublicId('${prefix}', id);
        const row = rowId ? await find${Singular}(db, c.get('user').id, rowId) : null;
        if (!row) throw notFound(id);

        c.header('ETag', etag(row.version));
        return c.json(present${Singular}(row), 200);
      },
    )
    .openapi(
      createRoute({
        method: 'patch',
        path: '${path}/{id}',
        operationId: 'update${Singular}',
        summary: 'Update ${article}${singularLabel.startsWith(' ') ? '' : ' '}${singularLabel}',
        tags: ['${Plural}'],
        security: sessionSecurity,
        middleware: [requireAuth],
        request: {
          params: idParams,
          headers: ifMatchHeaders,
          body: { ...jsonContent(update${Singular}Schema), required: true },
        },
        responses: {
          200: { description: 'The updated ${singularLabel.trim()}', ...jsonContent(${singular}Schema) },
          ...problemResponses(
            'validation-failed',
            'unauthorized',
            'not-found',${conflict}
            'version-mismatch',
            'precondition-required',
            'unsupported-media-type',
            'rate-limited',
          ),
        },
      }),
      async (c) => {
        const { id } = c.req.valid('param');
        const version = parseIfMatch(c.req.valid('header')['if-match']);
        const userId = c.get('user').id;
        const rowId = fromPublicId('${prefix}', id);
        if (!rowId) throw notFound(id);

        const row = await update${Singular}(db, userId, rowId, version, toPatch(c.req.valid('json')));
        if (!row) {
          const current = await find${Singular}(db, userId, rowId);
          if (!current) throw notFound(id);
          throw new ProblemError(
            'version-mismatch',
            \`${Singular} \${id} is at version \${current.version}. Fetch it again, then retry.\`,
          );
        }

        c.header('ETag', etag(row.version));
        return c.json(present${Singular}(row), 200);
      },
    )
    .openapi(
      createRoute({
        method: 'delete',
        path: '${path}/{id}',
        operationId: 'delete${Singular}',
        summary: 'Delete ${article}${singularLabel.startsWith(' ') ? '' : ' '}${singularLabel}',
        tags: ['${Plural}'],
        security: sessionSecurity,
        middleware: [requireAuth],
        request: { params: idParams },
        responses: {
          204: { description: '${Singular} deleted' },
          ...problemResponses('unauthorized', 'not-found', 'rate-limited'),
        },
      }),
      async (c) => {
        const { id } = c.req.valid('param');
        const rowId = fromPublicId('${prefix}', id);
        const deleted = rowId ? await delete${Singular}(db, c.get('user').id, rowId) : false;
        if (!deleted) throw notFound(id);
        return c.body(null, 204);
      },
    );
}
`;
}

export function renderTest(spec: FeatureSpec): string {
  const { prefix, name, title } = spec;
  const path = `/v1/${name}`;
  const required = spec.fields.filter((field) => !field.optional);
  const optional = spec.fields.filter((field) => field.optional);
  const validBody = `{ ${required.map((field) => `${field.name}: ${sample[field.type](field)}`).join(', ')} }`;
  const fullBody = `{ ${spec.fields.map((field) => `${field.name}: ${sample[field.type](field)}`).join(', ')} }`;
  const first = spec.fields[0] as Field;
  const missingCases = required
    .map((field) => {
      const rest = required.filter((other) => other !== field);
      const body = `{ ${rest.map((other) => `${other.name}: ${sample[other.type](other)}`).join(', ')} }`;
      return `    ['a missing ${field.name}', ${body}],`;
    })
    .join('\n');
  const wrongCases = spec.fields
    .map((field) => {
      const body = `{ ...validBody, ${field.name}: ${wrongType[field.type]()} }`;
      return `    ['a wrong type for ${field.name}', ${body}],`;
    })
    .join('\n');
  const optionalNulls = optional.map((field) => `${field.name}: null`).join(', ');
  const tooLong = spec.fields.find((field) => field.type === 'string');
  const uniqueFields = spec.fields.filter((field) => field.unique);
  const nextBody =
    uniqueFields.length === 0
      ? ''
      : `
let sequence = 0;

function nextBody(): Record<string, unknown> {
  sequence += 1;
  return { ...validBody, ${uniqueFields.map((field) => `${field.name}: ${sequenced[field.type]}`).join(', ')} };
}
`;
  const defaultBody = uniqueFields.length === 0 ? 'validBody' : 'nextBody()';
  const uniqueTests = uniqueFields.map((field) => renderUniqueTests(field, fullBody)).join('');

  return `import { describe, expect, it } from 'vitest';
import { call, expectProblem, signUp, testApp } from '../helpers.ts';

const app = testApp();
const path = '${path}';
const missingId = '${prefix}_00000000000070008000000000000000';
const validBody = ${validBody};

interface Item {
  id: string;
  version: number;
  [field: string]: unknown;
}
${nextBody}
async function create(token: string, body: Record<string, unknown> = ${defaultBody}) {
  const response = await call(app, 'POST', path, { token, body });
  return (await response.json()) as Item;
}

describe('creating ${title}', () => {
  it('returns the item with ETag and Location', async () => {
    const { token } = await signUp(app);
    const response = await call(app, 'POST', path, { token, body: ${fullBody} });
    expect(response.status).toBe(201);
    const item = (await response.json()) as Item;
    expect(item).toMatchObject({ ...${fullBody}, version: 1 });
    expect(item.id).toMatch(/^${prefix}_[0-9a-f]{32}$/);
    expect(response.headers.get('etag')).toBe('"1"');
    expect(response.headers.get('location')).toBe(\`\${path}/\${item.id}\`);
  });
${
  optional.length > 0
    ? `
  it('stores omitted optional fields as null', async () => {
    const { token } = await signUp(app);
    expect(await create(token, validBody)).toMatchObject({ ${optionalNulls} });
  });
`
    : ''
}
  it('requires authentication', async () => {
    const response = await call(app, 'POST', path, { body: validBody });
    await expectProblem(response, 401, 'unauthorized');
  });

  it.each([
${missingCases}
${wrongCases}
    ['an unknown field', { ...validBody, ownerId: 'usr_1' }],${
      tooLong
        ? `
    ['a ${tooLong.name} over 200 characters', { ...validBody, ${tooLong.name}: 'x'.repeat(201) }],`
        : ''
    }
  ])('rejects %s', async (_label, body) => {
    const { token } = await signUp(app);
    const response = await call(app, 'POST', path, { token, body });
    await expectProblem(response, 400, 'validation-failed');
  });

  it('returns the original on an idempotent replay', async () => {
    const { token } = await signUp(app);
    const send = () =>
      call(app, 'POST', path, { token, body: validBody, headers: { 'Idempotency-Key': 'once' } });
    const first = (await (await send()).json()) as Item;
    const replay = await send();
    expect(replay.headers.get('idempotency-replayed')).toBe('true');
    expect(await replay.json()).toEqual(first);
  });
});

describe('listing ${title}', () => {
  it('pages through every item exactly once, newest first', async () => {
    const { token } = await signUp(app);
    const created: string[] = [];
    for (let index = 0; index < 3; index += 1) created.push((await create(token)).id);

    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const query: string = cursor ? \`?limit=2&cursor=\${cursor}\` : '?limit=2';
      const response: Response = await call(app, 'GET', \`\${path}\${query}\`, { token });
      const page = (await response.json()) as { data: Item[]; meta: { nextCursor: string | null } };
      seen.push(...page.data.map((item) => item.id));
      cursor = page.meta.nextCursor;
    } while (cursor);

    expect(seen).toEqual(created.reverse());
  });

  it.each(['limit=101', 'cursor=bad'])('rejects %s', async (query) => {
    const { token } = await signUp(app);
    const response = await call(app, 'GET', \`\${path}?\${query}\`, { token });
    await expectProblem(response, 400, 'validation-failed');
  });
});

describe('ownership', () => {
  it("never reveals or changes another user's item", async () => {
    const owner = await signUp(app);
    const intruder = await signUp(app);
    const item = await create(owner.token);
    const itemPath = \`\${path}/\${item.id}\`;
    const token = intruder.token;

    await expectProblem(await call(app, 'GET', itemPath, { token }), 404, 'not-found');
    await expectProblem(
      await call(app, 'PATCH', itemPath, {
        token,
        body: { ${first.name}: ${changed[first.type](first)} },
        headers: { 'If-Match': '"1"' },
      }),
      404,
      'not-found',
    );
    await expectProblem(await call(app, 'DELETE', itemPath, { token }), 404, 'not-found');

    const list = await call(app, 'GET', path, { token });
    expect(((await list.json()) as { data: Item[] }).data).toEqual([]);
    const unchanged = await call(app, 'GET', itemPath, { token: owner.token });
    expect(await unchanged.json()).toMatchObject({ version: 1 });
  });
});

describe('reading ${title}', () => {
  it.each([
    ['an unknown id', missingId],
    ['a malformed id', 'nope'],
  ])('returns 404 for %s', async (_label, id) => {
    const { token } = await signUp(app);
    await expectProblem(await call(app, 'GET', \`\${path}/\${id}\`, { token }), 404, 'not-found');
  });
});

describe('updating ${title}', () => {
  it('changes a field and bumps the version', async () => {
    const { token } = await signUp(app);
    const item = await create(token);
    const response = await call(app, 'PATCH', \`\${path}/\${item.id}\`, {
      token,
      body: { ${first.name}: ${changed[first.type](first)} },
      headers: { 'If-Match': '"1"' },
    });
    expect(response.status).toBe(200);
    expect(response.headers.get('etag')).toBe('"2"');
    expect(await response.json()).toMatchObject({ ${first.name}: ${changed[first.type](first)}, version: 2 });
  });

  it('requires If-Match', async () => {
    const { token } = await signUp(app);
    const item = await create(token);
    const response = await call(app, 'PATCH', \`\${path}/\${item.id}\`, {
      token,
      body: { ${first.name}: ${changed[first.type](first)} },
    });
    await expectProblem(response, 428, 'precondition-required');
  });

  it('rejects a stale version', async () => {
    const { token } = await signUp(app);
    const item = await create(token);
    const response = await call(app, 'PATCH', \`\${path}/\${item.id}\`, {
      token,
      body: { ${first.name}: ${changed[first.type](first)} },
      headers: { 'If-Match': '"9"' },
    });
    await expectProblem(response, 412, 'version-mismatch');
  });

  it('rejects an empty patch', async () => {
    const { token } = await signUp(app);
    const item = await create(token);
    const response = await call(app, 'PATCH', \`\${path}/\${item.id}\`, {
      token,
      body: {},
      headers: { 'If-Match': '"1"' },
    });
    await expectProblem(response, 400, 'validation-failed');
  });

  it('returns 404 for an unknown id', async () => {
    const { token } = await signUp(app);
    const response = await call(app, 'PATCH', \`\${path}/\${missingId}\`, {
      token,
      body: { ${first.name}: ${changed[first.type](first)} },
      headers: { 'If-Match': '"1"' },
    });
    await expectProblem(response, 404, 'not-found');
  });
});

describe('deleting ${title}', () => {
  it('removes the item', async () => {
    const { token } = await signUp(app);
    const item = await create(token);
    const itemPath = \`\${path}/\${item.id}\`;
    expect((await call(app, 'DELETE', itemPath, { token })).status).toBe(204);
    await expectProblem(await call(app, 'GET', itemPath, { token }), 404, 'not-found');
  });
});
${uniqueTests}`;
}
