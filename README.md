# API Hono starter

A production-ready TypeScript API you can run with one command and customize with coding agents. It uses Hono, Drizzle, Postgres, and OpenAPI, and it's already wired with auth, rate limits, tests, and tracing.

[![CI](https://github.com/opikdev/api-hono-starter/actions/workflows/ci.yml/badge.svg)](https://github.com/opikdev/api-hono-starter/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

## Features

- **Contract first:** OpenAPI 3.1 is generated from the routes, with docs at `/docs`.
- **Feature generator:** `pnpm gen:feature` creates a full CRUD feature with tests that pass every gate. Answer prompts, or pass it all on one line.
- **Typed client:** `AppType` gives TypeScript callers every route and response type through Hono RPC. See [Call the API from TypeScript](docs/client.md).
- **Auth:** registration, login, and revocable session tokens, with per-user data access.
- **Reliable by default:** rate limits, idempotency keys, optimistic concurrency, and cursor pagination.
- **Consistent errors:** RFC 9457 Problem Details everywhere. See the [error reference](docs/errors.md).
- **Safe data layer:** Drizzle migrations, constraints in the database, and an app role that can't change the schema.
- **Ready to operate:** a non-root Docker image, health checks, JSON logs, and OpenTelemetry traces.
- **Agent-ready:** `AGENTS.md`, skills, and checks that run on every commit.
- **Strict gates:** strict types, lint, 90% coverage, architecture tests, and real end-to-end tests.

## Quick start

You only need Docker:

```sh
git clone https://github.com/opikdev/api-hono-starter
cd api-hono-starter
docker compose up --build --wait api
```

The API is now at <http://localhost:3000>, with interactive docs at <http://localhost:3000/docs>. Log in with the fake seed user:

```sh
curl -X POST localhost:3000/v1/sessions \
  -H 'Content-Type: application/json' \
  -d '{"email":"demo@example.com","password":"demo-password-123"}'
```

Send the returned token to list the seeded notes:

```sh
curl localhost:3000/v1/notes -H 'Authorization: Bearer <YOUR_TOKEN>'
```

If port 3000 or 5432 is taken, set `PORT` or `POSTGRES_PORT` before running Compose.

## Usage

To work on the code, you need Node 26 or later and pnpm:

```sh
pnpm install
cp .env.example .env
docker compose run --build --rm migrate
pnpm dev
```

| Task                                                      | Command                 |
| --------------------------------------------------------- | ----------------------- |
| Run lint, types, migrations check, tests, and repo checks | `pnpm verify`           |
| Test the real image end to end                            | `pnpm test:e2e`         |
| Generate a CRUD feature, with prompts | `pnpm gen:feature` |
| Generate a CRUD feature in one line | `pnpm gen:feature projects name:string dueAt:datetime:optional` |
| Create a migration after editing `src/db/schema.ts`       | `pnpm db:generate`      |
| Update `openapi.json` after changing a route              | `pnpm openapi:generate` |

Tests start their own Postgres, so Docker must be running. Without Docker, point them at a Postgres 18 server instead:

```sh
TEST_DATABASE_URL=postgres://<SUPERUSER>@localhost:5432/postgres pnpm verify
```

Each run creates a temporary database and drops it afterward, so existing data is never touched. The user needs permission to create databases and roles. To add a feature, rename the project, or remove a module, see [Customize the starter](docs/customize.md). Before you deploy, read [Operate the API](docs/operations.md).

## Project structure

| Path            | Purpose                                                                        |
| --------------- | ------------------------------------------------------------------------------ |
| `src/features/` | Routes and queries for each feature. `notes` is the sample to copy             |
| `src/platform/` | Errors, rate limits, idempotency, and logging                                  |
| `src/db/`       | Schema, connections, migration runner, and seed data                           |
| `migrations/`   | Generated SQL migrations, which are append-only                                |
| `test/`         | Unit, integration, and end-to-end tests                                        |
| `docs/`         | [Architecture](docs/architecture.md), guides, and [decisions](docs/decisions/) |

## Contributing

Read [CONTRIBUTING.md](CONTRIBUTING.md) before opening a pull request, and follow the [code of conduct](CODE_OF_CONDUCT.md).

## Security

Report vulnerabilities privately, as described in [SECURITY.md](SECURITY.md).

## License

Released under the [MIT License](LICENSE).
