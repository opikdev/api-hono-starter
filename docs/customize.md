# Customize the starter

## Rename the project

Projects created with `pik new` are already renamed. To rename a clone by hand, replace `api-hono-starter` in the files listed under `replace` in `pik.yaml`. Then replace the database names in `compose.yaml`, `.env.example`, and `docker/postgres/init.sql`.

## Add a feature

Run the generator, and answer its prompts:

```sh
pnpm gen:feature
```

Or pass everything on one line, which is what agents and scripts use:

```sh
pnpm gen:feature projects name:string status:enum:active,archived dueAt:datetime:optional
```

| Field type | Stored as | Accepts |
|---|---|---|
| `string` | `text` | 1–200 characters, trimmed |
| `text` | `text` | Up to 10,000 characters |
| `int` | `integer` | A 32-bit integer |
| `boolean` | `boolean` | `true` or `false` |
| `datetime` | `timestamptz` | An ISO 8601 UTC timestamp |
| `enum:a,b` | `text` with a check | One of the listed values |

| Modifier | Does |
|---|---|
| `:optional` | Makes the field nullable. It's `null` when omitted |
| `:unique` | Rejects a value the same user already used, with 409 `conflict`. Adds a unique constraint on the user ID and the field. For `string`, `int`, and `datetime` only. Two `null`s don't clash |

Write modifiers in any order, such as `slug:string:unique` or `code:string:optional:unique`.

| Flag | Does |
|---|---|
| `--dry-run` | Lists the files without writing anything |
| `--yes` | Skips the confirmation |
| `--json` | Prints a JSON result |
| `--skip-verify` | Skips `pnpm verify` |
| `--keep` | Keeps the files if `pnpm verify` fails, instead of rolling back |
| `--singular`, `--prefix` | Override the derived singular name and ID prefix |

`pnpm verify` runs the tests against Postgres, so Docker must be running, or `TEST_DATABASE_URL` must be set. The generator checks this before writing anything.

The generator writes the table, store, routes, and tests, and mounts the router. It then creates the migration, updates `openapi.json`, and runs `pnpm verify`. If anything fails, it rolls every change back. Add business logic to the generated files afterward.

Start every new resource this way, even one that needs custom logic, so it gets the same contract, tests, and migration. `src/features/notes/` has the same layout, so read it for examples of business logic.

## Change the schema by hand

Edit `src/db/schema.ts`, then generate a migration with a name that says what it does:

```sh
pnpm db:generate --name add_projects_slug
```

Without `--name`, drizzle-kit picks a random one.

### Add a join table

Give a join table its own `id` and timestamps, like every other table, and make the pair unique. The schema tests require `id`, `created_at`, and `updated_at` on every table, so a composite primary key fails them. This keeps every row addressable by one opaque ID, such as for a `DELETE /v1/project-members/{id}` route.

```ts
export const projectMembers = pgTable(
  'project_members',
  {
    id,
    projectId: uuid('project_id').notNull(),
    userId: uuid('user_id').notNull(),
    ...timestamps,
  },
  (table) => [
    primaryKey({ name: 'pk_project_members', columns: [table.id] }),
    foreignKey({
      name: 'fk_project_members_project_id',
      columns: [table.projectId],
      foreignColumns: [projects.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'fk_project_members_user_id',
      columns: [table.userId],
      foreignColumns: [users.id],
    }).onDelete('cascade'),
    unique('uq_project_members_project_id_user_id').on(table.projectId, table.userId),
    index('idx_project_members_user_id').on(table.userId),
  ],
);
```

The unique constraint also indexes `project_id`, and `idx_project_members_user_id` covers the other foreign key, which the schema tests also require. A duplicate pair that reaches the database returns 409 `conflict`.

## Remove the notes feature

1. Delete `src/features/notes/` and `test/integration/notes.test.ts`, then remove the router from `src/app.ts`.
2. Remove `notes` from `src/db/schema.ts` and `src/db/seed.ts`, then run `pnpm db:generate`.
3. Update or remove the note tests in `test/integration/` and `test/e2e/`.
4. Run `pnpm openapi:generate`, then `pnpm verify`.

## Remove idempotency

1. Delete `src/platform/idempotency.ts` and `test/integration/idempotency.test.ts`.
2. In `src/features/notes/routes.ts` and each generated feature's `routes.ts`, call the insert function directly instead of through `withIdempotency`. Remove `idempotencyHeaders`, `'idempotency-key-reused'`, and the `Idempotency-Replayed` header.
3. Make the same change in the generator template, `renderRoutes` in `scripts/gen-feature/render.ts`, and delete the replay test from `renderTest` in the same file and from each generated feature's tests.
4. Remove `idempotencyHeaders` from `src/platform/resource.ts`, `Idempotency-Replayed` from the CORS headers in `src/app.ts` and `test/integration/http.test.ts`, and `idempotency-key-reused` from `src/platform/problem.ts` and `docs/errors.md`.
5. Remove `idempotencyKeys` from `src/db/schema.ts`, `src/platform/cleanup.ts`, and `test/integration/database.test.ts`, then run `pnpm db:generate`.
6. Run `pnpm openapi:generate`, then `pnpm verify` and `pnpm test:generator`.

## Remove tracing

Delete `src/instrumentation.ts`, remove `httpInstrumentationMiddleware` from `src/app.ts`, and remove `--import ./src/instrumentation.ts` from `Dockerfile` and `package.json`. Error logging keeps working.
