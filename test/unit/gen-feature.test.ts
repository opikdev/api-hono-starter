import { describe, expect, it } from 'vitest';
import {
  editApp,
  editChangelog,
  editPublicId,
  editSchema,
} from '../../scripts/gen-feature/edit.ts';
import { buildSpec, parseField, singularize } from '../../scripts/gen-feature/spec.ts';

const spec = (name = 'projects', fields = ['name:string']) =>
  buildSpec({ name, fields: fields.map(parseField) });

describe('parseField', () => {
  it('parses a required field', () => {
    expect(parseField('dueAt:datetime')).toEqual({
      name: 'dueAt',
      column: 'due_at',
      type: 'datetime',
      optional: false,
      unique: false,
      values: [],
    });
  });

  it.each(['slug:string:unique:optional', 'slug:string:optional:unique'])(
    'parses the modifiers of %s in any order',
    (raw) => {
      expect(parseField(raw)).toMatchObject({ optional: true, unique: true });
    },
  );

  it('parses optional fields and enum values', () => {
    expect(parseField('status:enum:active,archived:optional')).toMatchObject({
      optional: true,
      values: ['active', 'archived'],
    });
  });

  it.each([
    ['a missing type', 'name', 'Invalid field'],
    ['an unknown type', 'name:strng', 'Unknown type "strng"'],
    ['an uppercase start', 'Name:string', 'Invalid field name'],
    ['a reserved name', 'version:int', 'reserved'],
    ['an enum with no values', 'kind:enum', 'needs values'],
    ['a bad enum value', 'kind:enum:A', 'Invalid enum value'],
    ['a duplicate enum value', 'kind:enum:a,a', 'twice'],
    ['values on a non-enum', 'name:string:x', 'Only enum fields take values'],
    ['extra parts', 'kind:enum:a:b:c', 'Invalid field'],
    ['a repeated modifier', 'slug:string:unique:unique', 'lists unique twice'],
    ['a unique text field', 'notes:text:unique', "can't be unique"],
    ['a unique boolean', 'done:boolean:unique', "can't be unique"],
    ['a unique enum', 'kind:enum:a,b:unique', "can't be unique"],
  ])('rejects %s', (_label, raw, message) => {
    expect(() => parseField(raw)).toThrow(message);
  });
});

describe('buildSpec', () => {
  it('derives names from a multi-word feature', () => {
    expect(spec('time-entries')).toMatchObject({
      table: 'time_entries',
      plural: 'timeEntries',
      singular: 'timeEntry',
      Plural: 'TimeEntries',
      Singular: 'TimeEntry',
      prefix: 'timeentry',
    });
  });

  it.each([
    ['projects', 'project'],
    ['categories', 'category'],
    ['boxes', 'box'],
    ['addresses', 'address'],
    ['status', 'statu'],
  ])('singularizes %s as %s', (plural, singular) => {
    expect(singularize(plural)).toBe(singular);
  });

  it.each([
    ['an uppercase name', 'Projects', ['name:string'], 'Invalid feature name'],
    ['a starter feature', 'notes', ['name:string'], 'already used'],
    ['no fields', 'projects', [], 'at least one field'],
    ['a duplicate field', 'projects', ['a:int', 'a:string'], 'listed twice'],
    ['a reserved word', 'class', ['a:int'], 'reserved word'],
    ['no distinct singular', 'data', ['a:int'], '--singular'],
    [
      'too many fields',
      'projects',
      Array.from({ length: 21 }, (_, i) => `f${i}:int`),
      'at most 20',
    ],
  ])('rejects %s', (_label, name, fields, message) => {
    expect(() => spec(name, fields)).toThrow(message);
  });

  it('rejects a taken ID prefix', () => {
    expect(() =>
      buildSpec({ name: 'projects', fields: [parseField('a:int')], prefix: 'usr' }),
    ).toThrow('already used');
  });

  it('rejects names that are too long for Postgres', () => {
    const field = parseField('averyveryverylongfieldnamexx:string');
    expect(() =>
      buildSpec({ name: 'extremely-long-feature-names', fields: [field], prefix: 'long' }),
    ).toThrow('63');
  });
});

const schemaSource = `import { sql } from 'drizzle-orm';
import { pgTable, text, uuid } from 'drizzle-orm/pg-core';

export const users = pgTable('users', { id: uuid('id') });
`;

const publicIdSource = "export type IdPrefix = 'usr' | 'note';\n";

const appSource = `import { createRouter } from './platform/router.ts';

export function createApp() {
  const app = createRouter();
  const routes = app
    .route('/', createHealthRouter(db))
    .route('/v1', createNotesRouter({ db, requireAuth }));
  return routes;
}
`;

describe('file edits', () => {
  const projects = spec('projects', ['name:string', 'done:boolean', 'dueAt:datetime:optional']);

  it('adds the table and missing imports to the schema', () => {
    const result = editSchema(schemaSource, projects);
    expect(result).toContain("export const projects = pgTable(\n  'projects',");
    expect(result).toMatch(/import \{[^}]*\bboolean\b[^}]*\} from 'drizzle-orm\/pg-core'/);
    expect(result).toContain('chk_projects_name_length');
    expect(() => editSchema(result, projects)).toThrow('already defines');
  });

  it('adds a per-user unique constraint for a unique field', () => {
    const result = editSchema(schemaSource, spec('projects', ['slug:string:unique']));
    expect(result).toMatch(/import \{[^}]*\bunique\b[^}]*\} from 'drizzle-orm\/pg-core'/);
    expect(result).toContain("unique('uq_projects_user_id_slug').on(table.userId, table.slug),");
    expect(editSchema(schemaSource, projects)).not.toContain('uq_projects');
  });

  it('adds the ID prefix', () => {
    const result = editPublicId(publicIdSource, projects);
    expect(result).toContain("export type IdPrefix = 'usr' | 'note' | 'project';");
    expect(() => editPublicId(result, projects)).toThrow('already used');
  });

  it('imports and mounts the router', () => {
    const result = editApp(appSource, projects);
    expect(result).toContain(
      "import { createProjectsRouter } from './features/projects/routes.ts';",
    );
    expect(result).toContain(".route('/v1', createProjectsRouter({ db, requireAuth }));");
    expect(() => editApp(result, projects)).toThrow('already mounts');
  });

  it('refuses an app without the route chain', () => {
    expect(() => editApp('export const app = 1;\n', projects)).toThrow('by hand');
  });

  it('adds a changelog entry under Unreleased', () => {
    const changelog = '# Changelog\n\n## [Unreleased]\n\n## [0.1.0]\n';
    const once = editChangelog(changelog, projects);
    expect(once).toContain('## [Unreleased]\n\n### Added\n\n- Projects feature');
    const twice = editChangelog(once, spec('time-entries'));
    expect(twice.match(/### Added/g)).toHaveLength(1);
    expect(twice).toContain('- Time entries feature');
    expect(twice.indexOf('Time entries')).toBeLessThan(twice.indexOf('## [0.1.0]'));
  });
});
