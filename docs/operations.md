# Operate the API

## Configure it

Set these on the API process. `.env.example` lists every option with a safe default.

| Variable                        | Type    | Default  | Description                                                         |
| ------------------------------- | ------- | -------- | ------------------------------------------------------------------- |
| `DATABASE_URL`                  | URL     | Required | Connection for the `api_app` role                                   |
| `PORT`                          | number  | `3000`   | Listen port                                                         |
| `LOG_LEVEL`                     | string  | `info`   | `debug`, `info`, `warn`, `error`, or `silent`                       |
| `DATABASE_STATEMENT_TIMEOUT_MS` | number  | `5000`   | Cancels slow queries                                                |
| `DATABASE_POOL_MAX`             | number  | `10`     | Most database connections each API process opens. At least 1        |
| `CORS_ORIGINS`                  | list    | Empty    | Comma-separated browser origins. Empty disables CORS                |
| `TRUST_PROXY_HOPS`              | number  | `0`      | How many proxies in front of the API append to `X-Forwarded-For`    |
| `SESSION_TTL_HOURS`             | number  | `168`    | Session lifetime                                                    |
| `RATE_LIMIT_PER_MINUTE`         | number  | `300`    | Per client, across `/v1`                                            |
| `AUTH_RATE_LIMIT_PER_MINUTE`    | number  | `10`     | Per client, on registration and login                               |
| `OTEL_EXPORTER_OTLP_ENDPOINT`   | URL     | Empty    | Turns on trace and error export                                     |

Set `TRUST_PROXY_HOPS` to the number of proxies you run, or every client behind a load balancer shares one rate limit:

- `0` ignores `X-Forwarded-For` and uses the connection's address.
- `1` or more takes that many addresses from the right of `X-Forwarded-For`, so `1` means one load balancer. With fewer addresses than hops, it takes the leftmost. If that entry isn't an IP address, it uses the connection's address.

Never set it higher than the number of proxies you run, because clients can write any addresses they like to the left of yours.

## Set up production roles

Replace the dev passwords in `docker/postgres/init.sql`. Run the file once as the role that owns the schema, so tables created by migrations are granted to `api_app`.

## Deploy

Pushing a `vX.Y.Z` tag publishes an image to `ghcr.io`. Deploy in this order:

1. Run `node src/db/migrate.ts` with `MIGRATION_DATABASE_URL` set to the owner role.
2. Roll out the new image with `DATABASE_URL` set to `api_app`.
3. Send traffic when `GET /readyz` returns 200.

Use `/healthz` for liveness. It stays 200 during a database outage, so restarts don't make an outage worse.

## Change the schema safely

Migrations are append-only and forward-only, because Drizzle has no down migrations. To undo one, write a new migration, or restore from a backup if data was lost.

- Rename or retype a column in steps: add the new one, backfill, switch the code, then drop the old one in a later deploy.
- Read the generated SQL before merging, because a small diff can take a long lock.
- `pnpm verify` fails if a migration that's already on `main` changed.

The migration runner applies every pending migration in one transaction. It sets `lock_timeout` to 5 seconds and `statement_timeout` to 5 minutes, so a migration stuck behind a lock fails and rolls back instead of blocking traffic. If that happens, rerun it when the table is quieter.

`CREATE INDEX CONCURRENTLY` can't run inside a transaction, so it fails in a migration. To index a large table without locking writes:

1. Add the index to `src/db/schema.ts`, run `pnpm db:generate`, and change the new migration's `CREATE INDEX` to `CREATE INDEX IF NOT EXISTS` before committing it.
2. Before you deploy, build the index outside the runner, as the owner role:

   ```sh
   psql "$MIGRATION_DATABASE_URL" -c 'CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_notes_title" ON "notes" ("title");'
   ```

3. Deploy as usual. The migration finds the index and skips it.

If a concurrent build fails, it leaves an invalid index. Drop it with `DROP INDEX CONCURRENTLY`, then build it again.

## Back up the database

Use your provider's point-in-time recovery. For a self-hosted database, schedule `pg_dump` and copy the output off the host:

```sh
pg_dump --format=custom --file=api.dump "$MIGRATION_DATABASE_URL"
```

Restore into a new database, then point the API at it, so a bad backup can't overwrite good data:

```sh
pg_restore --no-owner --dbname="$NEW_DATABASE_URL" api.dump
```

Test a restore regularly, because an untested backup isn't a backup.

## Trace requests and errors

Set `OTEL_EXPORTER_OTLP_ENDPOINT` to send traces to any OTLP backend. Each request gets a span with its database queries nested inside. Unexpected errors are recorded on the span, so backends with error tracking can group them.
