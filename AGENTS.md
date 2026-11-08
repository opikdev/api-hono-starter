# Agent guide

A production-ready TypeScript API: Hono, Drizzle, Postgres, and OpenAPI, with auth, rate limits, and Problem Details errors. `notes` is the sample feature to copy or replace.

| Path                                         | Purpose                                                      |
| -------------------------------------------- | ------------------------------------------------------------ |
| [docs/architecture.md](docs/architecture.md) | How requests flow and which layer does what                  |
| [docs/customize.md](docs/customize.md)       | How to add a feature, rename the project, or remove a module |
| [docs/client.md](docs/client.md) | How to call the API with the typed client |
| [docs/errors.md](docs/errors.md)             | Every problem type the API can return                        |
| [docs/operations.md](docs/operations.md)     | Deploys, migrations, backups, and tracing                    |
| [docs/decisions/](docs/decisions/)           | Why it's built this way                                      |
| `.agents/skills/`                            | Step-by-step guides for recurring tasks                      |
| `.mcp.json`                                  | MCP servers for this project                                 |

## Commands

| Task                            | Command                                                |
| ------------------------------- | ------------------------------------------------------ |
| Run everything                  | `docker compose up --build --wait api`                     |
| Run the API on your machine     | `docker compose run --build --rm migrate`, then `pnpm dev` |
| Run all gates                   | `pnpm verify`                                          |
| Test against real Docker images | `pnpm test:e2e`                                        |
| Create a migration              | `pnpm db:generate`                                     |
| Regenerate the API contract     | `pnpm openapi:generate`                                |

## Rules

- Run `pnpm verify` before calling work done. For changes to Docker, Compose, or startup, run `pnpm test:e2e` too.
- If the check blocks you, fix the cause. Never edit `.agents/check.sh`, `.githooks/`, or the harness workflow to get past it, and never use `--no-verify`. If the request can't be done without that, stop and ask.
- After cloning, run `git config core.hooksPath .githooks` once to turn on the hook.
- Change the database by editing `src/db/schema.ts`, then running `pnpm db:generate`. Migrations are append-only, so never edit one that's committed.
- When an endpoint changes, run `pnpm openapi:generate` and commit `openapi.json` in the same change.
- Chain each route with `.openapi()` on the router, and return `c.json()` with an explicit status, so it stays in `AppType`.
- Throw `ProblemError` for every failure, and add new types to `src/platform/problem.ts` and `docs/errors.md`.
- Scope every query on a resource to the caller's user ID. Return 404, not 403, for someone else's resource.
- Stores don't import Hono, and features don't import each other, except for `features/auth/middleware.ts`. Tests enforce this.
- Don't edit files listed in `.baseline.sha256`. They come from [opikdev/starters](https://github.com/opikdev/starters).
- Fix any doc your change makes wrong, in the same change.
- Record significant decisions with the `record-decision` skill.
- Back important rules with a lint rule, hook, or CI check.
