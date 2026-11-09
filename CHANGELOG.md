# Changelog

All notable changes to this repo are recorded here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

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
