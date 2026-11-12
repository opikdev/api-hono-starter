# Go live

A checklist for running the API in production. [Operate the API](operations.md) lists every setting.

## Put it behind TLS

- Terminate TLS at a load balancer or reverse proxy, and forward plain HTTP to the API's `PORT`.
- Set `TRUST_PROXY_HOPS` to the number of proxies that append to `X-Forwarded-For`, usually `1`. Left at `0`, every client shares the proxy's rate limit. Set too high, clients can pick their own address.
- The API sends `Strict-Transport-Security` on every response. Serve it only over HTTPS, because browsers then refuse plain HTTP to that host for 180 days.

## Connect to Postgres over TLS

Verify the server's certificate, not just encryption:

```sh
DATABASE_URL='postgres://api_app:<PASSWORD>@db.example.com:5432/api?sslmode=verify-full&sslrootcert=/etc/ssl/certs/db-ca.pem'
```

Mount your provider's CA bundle at the `sslrootcert` path. Use the same options in `MIGRATION_DATABASE_URL`.

## Size the pool

Keep `DATABASE_POOL_MAX` × replicas, plus the migration job's one connection, below Postgres's `max_connections`, with room for admin sessions. With 10 replicas, a pool of 10, and `max_connections` of 200, you use 101.

To run more replicas than that, put PgBouncer in front in transaction mode. node-postgres sends unnamed statements, which transaction pooling supports. Two caveats:

- The API sets `statement_timeout` as a startup parameter, so add it to PgBouncer's `ignore_startup_parameters` and set the timeout on the `api_app` role instead: `ALTER ROLE api_app SET statement_timeout = '5s'`.
- Point `MIGRATION_DATABASE_URL` straight at Postgres, because the migration lock is a session-level advisory lock.

## Run migrations once per deploy

Run the migrations as one job before the new version takes traffic:

1. Run `node src/db/migrate.ts` from the new image, with `MIGRATION_DATABASE_URL` set to the owner role.
2. Roll out the new image with `DATABASE_URL` set to `api_app`.
3. Send traffic once `GET /readyz` returns 200.

The runner holds a Postgres advisory lock for the whole run, so running it in every replica is also safe: the others wait, then find nothing to apply.

## Keep secrets out of images

- Read `DATABASE_URL` and `MIGRATION_DATABASE_URL` from your platform's secret store, such as Kubernetes Secrets or AWS Secrets Manager. Never bake them into an image or commit them.
- `docker/postgres/init.sql` creates `api_app` with a dev password. Run it once as the owner role, then set the real password without editing the file. psql reads it from the environment, so it stays out of files, shell history and the process list:

  ```sh
  psql "$MIGRATION_DATABASE_URL" -v ON_ERROR_STOP=1 <<'SQL'
  \getenv password API_APP_PASSWORD
  ALTER ROLE api_app PASSWORD :'password';
  SQL
  ```

- Set the owner role's password in your provider's console, or the same way. Rotate either by changing the role, then the secret, then restarting.

## Drain before shutdown

On `SIGTERM`, the API fails `/readyz` and keeps serving for `SHUTDOWN_DRAIN_SECONDS`, so the load balancer stops sending new requests. It then stops accepting connections, gives requests in flight up to `SHUTDOWN_TIMEOUT_SECONDS`, and closes the pool and flushes telemetry. It exits with code 1 if all of that takes 10 seconds longer than the drain plus the timeout.

| Setting | Set it to |
|---|---|
| `SHUTDOWN_DRAIN_SECONDS` | At least the load balancer's health-check interval × its unhealthy threshold. Default `5` |
| `SHUTDOWN_TIMEOUT_SECONDS` | At least your longest request. It can't be below `DATABASE_STATEMENT_TIMEOUT_MS`. Default `30` |
| Kubernetes `terminationGracePeriodSeconds`, ECS `stopTimeout`, or Compose `stop_grace_period` | Over drain + timeout + 10, such as `45` |
| Load balancer deregistration delay, such as the AWS target group's | At least drain + timeout, such as `35` |

Use `/readyz` for readiness and `/healthz` for liveness. `/healthz` stays 200 during a database outage and while draining, so restarts don't make an outage worse.

## Leave the docs off

`DOCS_ENABLED` defaults to `false`, so `/docs` and `/openapi.json` return 404. Turn it on only if you mean to publish the API's contract. The docs page loads nothing from other origins.

## Send telemetry

Set `OTEL_EXPORTER_OTLP_ENDPOINT` to your collector to export traces and metrics over OTLP/HTTP. The standard `OTEL_*` variables apply, such as `OTEL_SERVICE_NAME`, `OTEL_EXPORTER_OTLP_HEADERS` for an API key, and `OTEL_METRIC_EXPORT_INTERVAL`, which defaults to 60000 ms. Log lines written during a request carry its `trace_id` and `span_id`.

## Back up the database

Turn on your provider's point-in-time recovery. See [Back up the database](operations.md#back-up-the-database) to self-host.
