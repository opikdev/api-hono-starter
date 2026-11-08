# Changelog

All notable changes to this repo are recorded here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

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
