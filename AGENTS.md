# Agent guide

A production-ready TypeScript API: Hono, Drizzle, Postgres, and OpenAPI, with auth, rate limits, and Problem Details errors. `notes` is the sample feature, and `pnpm gen:feature` creates new ones in the same shape.

| Path                                         | Purpose                                                      |
| -------------------------------------------- | ------------------------------------------------------------ |
| [docs/architecture.md](docs/architecture.md) | How requests flow and which layer does what                  |
| [docs/customize.md](docs/customize.md)       | How to add a feature, rename the project, or remove a module |
| [docs/client.md](docs/client.md) | How to call the API with the typed client |
| [docs/errors.md](docs/errors.md)             | Every problem type the API can return                        |
| [docs/operations.md](docs/operations.md)     | Settings, rate limits, migrations, backups, and telemetry    |
| [docs/deploy.md](docs/deploy.md)             | The go-live checklist: TLS, secrets, draining, and docs      |
| [docs/decisions/](docs/decisions/)           | Why it's built this way                                      |
| `.agents/skills/`                            | Step-by-step guides for recurring tasks                      |
| `.mcp.json`                                  | MCP servers for this project                                 |

## Commands

| Task                            | Command                                                |
| ------------------------------- | ------------------------------------------------------ |
| Run everything                  | `docker compose up --build --wait api`                     |
| Run the API on your machine, on :3001 | `docker compose run --build --rm migrate`, then `pnpm dev` |
| Run all gates                   | `pnpm verify`                                          |
| Test against real Docker images | `pnpm test:e2e`                                        |
| Generate a CRUD feature | `pnpm gen:feature <name> <field:type> ... --yes --json` |
| Create a migration              | `pnpm db:generate --name <what_it_does>`               |
| Regenerate the API contract     | `pnpm openapi:generate`                                |

## Rules

- Don't commit until `pnpm verify` passes. Tests need Docker, or `TEST_DATABASE_URL` set to a Postgres 18 server. If neither is available, stop and report that instead of committing.
- Run `pnpm verify` before calling work done. For changes to Docker, Compose, or startup, run `pnpm test:e2e` too.
- If the check blocks you, fix the cause. Never edit `.agents/check.sh`, `.githooks/`, or the harness workflow to get past it, and never use `--no-verify`. If the request can't be done without that, stop and ask.
- After cloning, run `git config core.hooksPath .githooks` once to turn on the hook. It runs `.agents/check.sh` only, not lint or tests, so still run `pnpm verify`.
- Start every new resource with `pnpm gen:feature`, then add business logic to the generated files. Run `pnpm gen:feature --help` for field types.
- Change the database by editing `src/db/schema.ts`, then running `pnpm db:generate --name <what_it_does>`. Migrations are append-only, so never edit one that's committed.
- When an endpoint changes, run `pnpm openapi:generate` and commit `openapi.json` in the same change.
- Chain each route with `.openapi()` on the router, and return `c.json()` with an explicit status, so it stays in `AppType`.
- Throw `ProblemError` for every failure, and add new types to `src/platform/problem.ts` and `docs/errors.md`.
- Scope every query on a resource to the caller's user ID. Return 404, not 403, for someone else's resource.
- Stores don't import Hono, and features don't import each other, except for `features/auth/middleware.ts`. Tests enforce this.
- Don't edit files listed in `.baseline.sha256`. They come from [opikdev/starters](https://github.com/opikdev/starters).
- Fix any doc your change makes wrong, in the same change.
- Record significant decisions with the `record-decision` skill.
- Back important rules with a lint rule, hook, or CI check.
