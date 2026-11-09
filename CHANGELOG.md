# Changelog

All notable changes to this repo are recorded here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added

- `DATABASE_POOL_MAX` sets the API's database pool size. It defaults to 10, as before.
- Migration `0001` indexes `sessions.user_id`, so deleting a user doesn't scan every session.
- `urn:problem:forbidden` (403) and `urn:problem:timeout` (504), for Hono middleware such as CSRF protection and `hono/timeout`.

### Changed

- **Breaking:** `TRUST_PROXY_HOPS` replaces `TRUST_PROXY`. Set it to the number of proxies that append to `X-Forwarded-For`, and the API takes the client address that many entries from the right. It defaults to 0, which ignores the header. The API refuses to start while `TRUST_PROXY` is set, so replace `TRUST_PROXY=true` with `TRUST_PROXY_HOPS=1`.

### Fixed

- An `HTTPException` from Hono or its middleware becomes the problem type for its status, such as 401 `unauthorized`. Before, every 400 said the JSON was malformed, and any other status became a logged 500.
- CORS exposes `ETag`, `Location`, `X-Request-Id`, `Retry-After`, `RateLimit-Limit`, `RateLimit-Remaining`, `RateLimit-Reset`, and `Idempotency-Replayed`, so browser clients can read them.

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
