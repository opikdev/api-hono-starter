# Changelog

All notable changes to this repo are recorded here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Security

- Rate limits count an IPv6 client by its /64 and an IPv4-mapped address as IPv4, so rotating addresses within one network no longer resets the budget.
- `POST /v1/sessions` allows `LOGIN_FAILURE_LIMIT` failed logins, default 5, per email in each `LOGIN_FAILURE_WINDOW_SECONDS`, default 900, whether or not the account exists. Past it, login returns 429 without checking the password.
- Every response sends `Content-Security-Policy: default-src 'none'; frame-ancestors 'none'`, except `/docs`, which allows only its own assets.
- Every `/v1` response sends `Cache-Control: no-store`, not just login.
- Passwords are hashed with Argon2id at OWASP's minimum, 19 MiB, 2 passes, and 1 lane, instead of scrypt. Existing scrypt hashes are rehashed on the next successful login. See [ADR 009](docs/decisions/009-hash-passwords-with-argon2id.md).
- The runtime image ships without npm and npx, runs on a read-only filesystem in Compose, and its base image is pinned by digest.
- Releases scan the image with Trivy before pushing it, and publish an SBOM, `mode=max` provenance, and a signed build attestation. CI scans the image on every pull request.

### Changed

- **Breaking:** rate limits send the IETF draft `RateLimit` and `RateLimit-Policy` headers, such as `"global";r=238;t=25`, instead of `RateLimit-Limit`, `RateLimit-Remaining`, and `RateLimit-Reset`. CORS exposes the new names. See [Rate limits](docs/operations.md#rate-limits).
- **Breaking:** `DOCS_ENABLED` defaults to `false`, so `/docs` and `/openapi.json` return 404 unless you turn it on. `.env.example`, Compose, and the tests turn it on. See [ADR 008](docs/decisions/008-turn-api-docs-off-by-default.md).
- **Breaking:** Compose publishes the API on `API_PORT` instead of `PORT`, and `.env.example` sets `PORT=3001`, so `pnpm dev` runs next to the Compose API.
- **Breaking:** `withIdempotency` takes a `fingerprint` instead of a `payload`, and `endpointOf` is now `idempotencyScope`, which returns both. Update features you generated as `src/features/notes/routes.ts` does.
- A validation error about the whole body, such as an empty `PATCH`, has an empty `field` instead of `body`, which clashed with the note's `body` field.
- OpenAPI `info.title` and `info.version` come from `package.json`. Problems and headers are shared components, and every operation documents the 403, 413, 415, 429, and 500 that middleware can return. Routes no longer list `rate-limited` or `unsupported-media-type` themselves.
- On `SIGTERM`, the API fails `/readyz` for `SHUTDOWN_DRAIN_SECONDS`, default 5, before it stops accepting connections, then gives requests in flight `SHUTDOWN_TIMEOUT_SECONDS`, default 30, instead of 5. Compose waits 45 seconds before killing it.
- Compose builds the image once, and `api` reuses it.
- `/healthz` and `/readyz` log at `debug` and aren't traced. The healthcheck uses `wget`, not a Node process.

### Added

- `pnpm gen:feature` takes a `:unique` field modifier, which adds a per-user unique constraint, documents 409, and generates tests for it.
- Postgres unique and foreign key violations return 409 `urn:problem:conflict`, and check violations return 400 `validation-failed`, without the constraint name. They were 500s.
- Log lines written during a traced request include `trace_id` and `span_id`. Metrics, including request duration and pool connections, export over OTLP with traces. The hourly cleanup is traced.
- [Go live](docs/deploy.md), a checklist for TLS, Postgres TLS, pool sizing, migrations, secrets, draining, docs, and telemetry.
- `docs/customize.md` shows how to add a join table and name a migration with `pnpm db:generate --name`.

### Fixed

- On a 429 from the auth limit, the global limit overwrote the rate-limit headers, so they described the wrong policy. A 429 now describes only the policy that was exceeded.
- Two migration runners started together could both apply the same migration. The runner now holds an advisory lock for the whole run.
- An idempotency key past its 24 hours could still replay until the hourly cleanup ran. An expired key is now replaced.
- The idempotency fingerprint covers the method, path, and whole body, with keys sorted, so a new field can't be missed.
- `Authorization: bearer <token>` is accepted, because the scheme is case-insensitive.
- `/docs` loaded Swagger UI from jsDelivr without a pinned version. It's now served from `swagger-ui-dist`, pinned in `package.json`.
- Projects created with `pik new` get their own README title, version 0.1.0, and an empty changelog.

## [0.4.0] - 2026-11-11

### Added

- The README explains how to start a project with `pik new` or GitHub's **Use this template**. `pik new` removes that section from the project it creates.
- `POST /v1/sessions` takes `delivery: "cookie"` to set the session in an `HttpOnly`, `Secure`, `SameSite=Strict` cookie named `__Host-session` instead of returning the token. The default, `delivery: "body"`, works as before. See [Log in from a browser](docs/client.md#log-in-from-a-browser).
- Protected routes accept the `__Host-session` cookie when no `Authorization` header is sent, and the OpenAPI document lists it as the `cookieAuth` scheme. A 401 for an invalid cookie, and every logout, clears it.

### Changed

- `bearerSecurity` in `src/platform/resource.ts` is now `sessionSecurity`, and lists both schemes. Rename it in features you generated.
- `SESSION_TTL_HOURS` is at most 9600, the 400 days a browser keeps a cookie. The API refuses to start with a larger value.

### Security

- `/v1` requests other than `GET`, `HEAD`, and `OPTIONS` pass a cross-origin check, the algorithm of Go's `CrossOriginProtection`, before auth runs. Bearer clients outside a browser are unaffected, but cross-site browser requests that change data now get 403 `forbidden` unless their origin is in `CORS_ORIGINS`.

## [0.3.0] - 2026-11-09

### Added

- `DATABASE_POOL_MAX` sets the API's database pool size. It defaults to 10, as before.
- Migration `0001` indexes `sessions.user_id`, so deleting a user doesn't scan every session.
- `urn:problem:forbidden` (403) and `urn:problem:timeout` (504), for Hono middleware such as CSRF protection and `hono/timeout`.

### Changed

- **Breaking:** `TRUST_PROXY_HOPS` replaces `TRUST_PROXY`. Set it to the number of proxies that append to `X-Forwarded-For`, and the API takes the client address that many entries from the right. It defaults to 0, which ignores the header. The API refuses to start while `TRUST_PROXY` is set, so replace `TRUST_PROXY=true` with `TRUST_PROXY_HOPS=1`.
- The agent harness is v0.3.0. Its check also fails when the harness workflow or pre-commit hook is missing or no longer runs the check.
- `renovate.json` belongs to the project and extends the shared baseline preset. Generated projects extend only `config:recommended`.

### Fixed

- An `HTTPException` from Hono or its middleware becomes the problem type for its status, such as 401 `unauthorized`. Before, every 400 said the JSON was malformed, and any other status became a logged 500.
- CORS exposes `ETag`, `Location`, `X-Request-Id`, `Retry-After`, `RateLimit-Limit`, `RateLimit-Remaining`, `RateLimit-Reset`, and `Idempotency-Replayed`, so browser clients can read them.
- Idempotency keys are scoped to the endpoint as well as the user, so reusing a key on another endpoint no longer replays that endpoint's response. Migration `0002` adds `idempotency_keys.endpoint`. Keys stored before it stop replaying and expire within 24 hours. Generated features pass the endpoint too.
- Shutdown on `SIGTERM` and `SIGINT` gives requests in flight 5 seconds, then closes their connections, closes the pool, and waits for traces to flush before exiting. Before, a slow request could stall it, the process could exit before traces were sent, and `SIGINT` didn't flush them.
- The release workflow runs the CI checks on the tagged commit and publishes the image only if they pass.
- `pnpm verify` checks that committed migrations are unchanged locally too, against the merge base with `origin/main`, or `main`. Before, only CI checked. With neither ref, it skips the check and says so.
- The migration runner sets `lock_timeout` to 5 seconds and `statement_timeout` to 5 minutes, so a migration can't queue behind a lock and block traffic.
- `docs/operations.md` explains how to build an index with `CREATE INDEX CONCURRENTLY`. It used to say to put it in a migration, which fails because the runner uses a transaction.
- `docs/customize.md` says to start every resource with `pnpm gen:feature`, as `AGENTS.md` does, instead of copying `notes` by hand. Its steps to remove idempotency now cover the generator template, CORS headers, and problem type.

## [0.2.3] - 2026-11-09

### Fixed

- Error responses, including 404s and 500s, return the `X-Request-Id` header, so the ID quoted in a 500 matches it.

## [0.2.2] - 2026-11-08

### Fixed

- Projects created with `pik new` are formatted after renaming, so a longer name can't fail `pnpm verify`.

## [0.2.1] - 2026-11-08

### Fixed

- The dev container installs `jq` and sets `TEST_DATABASE_URL`, so `.agents/check.sh` and `pnpm verify` work inside it.
- Projects created with `pik new` and an owner get README clone and `cd` commands with their own name.
- The SBOM job retries once after a GitHub download error.

## [0.2.0] - 2026-11-08

### Added

- `pik.yaml`, so `pik new api-hono-starter` can create projects from this starter.

## [0.1.1] - 2026-11-08

### Fixed

- Release images now include arm64, so Apple Silicon and ARM servers run them natively.

## [0.1.0] - 2026-11-08

### Added

- Hono API with OpenAPI 3.1, Problem Details errors, and a sample notes feature.
- Typed RPC client through the exported `AppType`.
- `pnpm gen:feature`, which generates CRUD features with prompts or one-line arguments.
- `TEST_DATABASE_URL`, which runs tests against an existing Postgres 18 server instead of Docker.
- Session auth, rate limits, idempotency keys, and optimistic concurrency.
- Postgres with Drizzle migrations, seed data, and separate app and owner roles.
- Docker image, Compose stack, and dev container.
- Structured logs, OpenTelemetry tracing, and error recording.
- Unit, integration, and end-to-end tests with CI, security scans, and image releases.
