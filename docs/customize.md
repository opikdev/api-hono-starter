# Customize the starter

## Rename the project

Replace `api-hono-starter` in `package.json`, `compose.yaml`, `.devcontainer/`, and `src/instrumentation.ts`. Replace the database names in `compose.yaml`, `.env.example`, and `docker/postgres/init.sql`.

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

Add `:optional` to a field to make it nullable. Optional fields are `null` when omitted.

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

To build a feature by hand instead, copy `src/features/notes/` and `test/integration/notes.test.ts`.

## Remove the notes feature

1. Delete `src/features/notes/` and `test/integration/notes.test.ts`, then remove the router from `src/app.ts`.
2. Remove `notes` from `src/db/schema.ts` and `src/db/seed.ts`, then run `pnpm db:generate`.
3. Update or remove the note tests in `test/integration/` and `test/e2e/`.
4. Run `pnpm openapi:generate`, then `pnpm verify`.

## Remove idempotency

Delete `src/platform/idempotency.ts`, call `insertNote` directly in `src/features/notes/routes.ts`, and remove `idempotencyKeys` from `src/db/schema.ts` and `src/platform/cleanup.ts`.

## Remove tracing

Delete `src/instrumentation.ts`, remove `httpInstrumentationMiddleware` from `src/app.ts`, and remove `--import ./src/instrumentation.ts` from `Dockerfile` and `package.json`. Error logging keeps working.
