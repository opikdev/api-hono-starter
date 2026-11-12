# Operate the API

## Configure it

Set these on the API process. `.env.example` lists every option with a safe default.

| Variable                        | Type    | Default  | Description                                                         |
| ------------------------------- | ------- | -------- | ------------------------------------------------------------------- |
| `DATABASE_URL`                  | URL     | Required | Connection for the `api_app` role                                   |
| `PORT`                          | number  | `3000`   | Listen port. `.env.example` sets `3001` for `pnpm dev`, and Compose publishes the container's port on `API_PORT`, default `3000` |
| `LOG_LEVEL`                     | string  | `info`   | `debug`, `info`, `warn`, `error`, or `silent`. Health checks log at `debug` |
| `DATABASE_STATEMENT_TIMEOUT_MS` | number  | `5000`   | Cancels slow queries                                                |
| `DATABASE_POOL_MAX`             | number  | `10`     | Most database connections each API process opens. At least 1        |
| `CORS_ORIGINS`                  | list    | Empty    | Comma-separated browser origins that may call the API, including requests that change data. Empty disables CORS |
| `TRUST_PROXY_HOPS`              | number  | `0`      | How many proxies in front of the API append to `X-Forwarded-For`    |
| `DOCS_ENABLED`                  | boolean | `false`  | Serves `/docs` and `/openapi.json`. Off, both return 404            |
| `SESSION_TTL_HOURS`             | number  | `168`    | Session lifetime. At most 9600, the 400 days a browser keeps a cookie |
| `RATE_LIMIT_PER_MINUTE`         | number  | `300`    | Per client, across `/v1`                                            |
| `AUTH_RATE_LIMIT_PER_MINUTE`    | number  | `10`     | Per client, on registration and login                               |
| `LOGIN_FAILURE_LIMIT`           | number  | `5`      | Failed logins per email in each window, whether or not the account exists |
| `LOGIN_FAILURE_WINDOW_SECONDS`  | number  | `900`    | Window for `LOGIN_FAILURE_LIMIT`                                    |
| `SHUTDOWN_DRAIN_SECONDS`        | number  | `5`      | How long `/readyz` returns 503 before the server stops accepting connections. `0` skips the drain |
| `SHUTDOWN_TIMEOUT_SECONDS`      | number  | `30`     | How long requests in flight get to finish. At least `DATABASE_STATEMENT_TIMEOUT_MS` |
| `OTEL_EXPORTER_OTLP_ENDPOINT`   | URL     | Empty    | Turns on trace, error, and metric export                            |

Set `TRUST_PROXY_HOPS` to the number of proxies you run, or every client behind a load balancer shares one rate limit:

- `0` ignores `X-Forwarded-For` and uses the connection's address.
- `1` or more takes that many addresses from the right of `X-Forwarded-For`, so `1` means one load balancer. With fewer addresses than hops, it takes the leftmost. If that entry isn't an IP address, it uses the connection's address.

Never set it higher than the number of proxies you run, because clients can write any addresses they like to the left of yours.

## Rate limits

| Policy | Counts | Limit |
|---|---|---|
| `global` | Every `/v1` request, per client network | `RATE_LIMIT_PER_MINUTE` per minute |
| `auth` | Registration and login, per client network | `AUTH_RATE_LIMIT_PER_MINUTE` per minute |
| `login` | Failed logins, per email | `LOGIN_FAILURE_LIMIT` per `LOGIN_FAILURE_WINDOW_SECONDS` |

A client network is an IPv4 address, or the /64 prefix of an IPv6 address, because one subscriber usually gets a whole /64. An IPv4-mapped IPv6 address counts as its IPv4 address. Counters live in Postgres, so they hold across instances. See [ADR 007](decisions/007-key-rate-limits-by-network-and-account.md).

Every `/v1` response carries the [IETF draft](https://datatracker.ietf.org/doc/draft-ietf-httpapi-ratelimit-headers/) headers:

```http
RateLimit-Policy: "global";q=300;w=60, "auth";q=10;w=60
RateLimit: "global";r=238;t=25, "auth";r=9;t=25
```

A 429 describes only the policy that was exceeded, and `Retry-After` equals its `t`. The `login` policy appears only on its own 429.

## Deploy

Pushing a `vX.Y.Z` tag runs the CI checks, then builds the image, scans it with Trivy, and publishes it to `ghcr.io` with an SBOM and a signed provenance attestation, only if everything passes. To cut a release, bump `version` in `package.json`, run `pnpm openapi:generate`, because the document's `info.version` comes from it, and move the changelog's Unreleased entries under the new version. Before you go live, work through [Go live](deploy.md): TLS, secrets, migrations, draining, and telemetry.

## Change the schema safely

Migrations are append-only and forward-only, because Drizzle has no down migrations. To undo one, write a new migration, or restore from a backup if data was lost.

- Rename or retype a column in steps: add the new one, backfill, switch the code, then drop the old one in a later deploy.
- Read the generated SQL before merging, because a small diff can take a long lock.
- `pnpm verify` fails if a migration that's already on `main` changed.

The migration runner holds a Postgres advisory lock for the whole run, so a second runner waits, then finds nothing to apply. It applies every pending migration in one transaction, with `lock_timeout` at 5 seconds and `statement_timeout` at 5 minutes, so a migration stuck behind a table lock fails and rolls back instead of blocking traffic. If that happens, rerun it when the table is quieter.

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

Set `OTEL_EXPORTER_OTLP_ENDPOINT` to send traces and metrics to any OTLP backend. Each request gets a span with its database queries nested inside, and the hourly cleanup of expired rows gets its own. Unexpected errors are recorded on the span, so backends with error tracking can group them. Health checks aren't traced.

Log lines written during a traced request include `trace_id` and `span_id`, so you can jump from a log to its trace.

Metrics include `http.server.request.duration` and `http.server.active_requests` from `@hono/otel`, and the pool's `db.client.connection.*` from `instrumentation-pg`. They're exported every `OTEL_METRIC_EXPORT_INTERVAL` milliseconds, 60000 by default, and flushed on shutdown.
