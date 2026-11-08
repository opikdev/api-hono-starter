# Customize the starter

## Rename the project

Replace `api-hono-starter` in `package.json`, `compose.yaml`, `.devcontainer/`, and `src/instrumentation.ts`. Replace the database names in `compose.yaml`, `.env.example`, and `docker/postgres/init.sql`.

## Add a feature

Use `notes` as the pattern:

1. Add the table to `src/db/schema.ts`, then run `pnpm db:generate`.
2. Create `src/features/<name>/store.ts` for queries, scoped by user ID.
3. Create `src/features/<name>/routes.ts` for the contract, and mount it in `src/app.ts`.
4. Add `test/integration/<name>.test.ts`, including a test that another user can't reach the data.
5. Run `pnpm openapi:generate`, then `pnpm verify`.

## Remove the notes feature

1. Delete `src/features/notes/` and `test/integration/notes.test.ts`, then remove the router from `src/app.ts`.
2. Remove `notes` from `src/db/schema.ts` and `src/db/seed.ts`, then run `pnpm db:generate`.
3. Update or remove the note tests in `test/integration/` and `test/e2e/`.
4. Run `pnpm openapi:generate`, then `pnpm verify`.

## Remove idempotency

Delete `src/platform/idempotency.ts`, call `insertNote` directly in `src/features/notes/routes.ts`, and remove `idempotencyKeys` from `src/db/schema.ts` and `src/platform/cleanup.ts`.

## Remove tracing

Delete `src/instrumentation.ts`, remove `httpInstrumentationMiddleware` from `src/app.ts`, and remove `--import ./src/instrumentation.ts` from `Dockerfile` and `package.json`. Error logging keeps working.
