# Architecture

```mermaid
flowchart LR
  C[Client] --> M["Middleware: tracing, request ID, logs, security headers, CORS, body limit, rate limit"]
  M --> R["Feature routes"]
  R --> S["Stores"]
  S --> P[(Postgres)]
  R -. "throw ProblemError" .-> E["Error handler"]
```

| Layer       | Path                       | Does                                        | Must not                                       |
| ----------- | -------------------------- | ------------------------------------------- | ---------------------------------------------- |
| Entry point | `src/index.ts`             | Starts the server, handles shutdown         | Hold business logic                            |
| App         | `src/app.ts`               | Wires middleware and routes                 | Touch the database directly                    |
| Features    | `src/features/*/routes.ts` | Define the HTTP contract and validate input | Import another feature, except auth middleware |
| Stores      | `src/features/*/store.ts`  | Run queries                                 | Import Hono                                    |
| Platform    | `src/platform/`            | Cross-cutting HTTP concerns                 | Import a feature                               |
| Database    | `src/db/`                  | Schema and connections                      | Import anything above it                       |

`test/unit/architecture.test.ts` fails the build when a dependency breaks these rules.

## Key behaviors

- **Contract:** route definitions generate `openapi.json`, and a test fails if the committed file is out of date. Chained routes also produce `AppType` for the typed client.
- **Errors:** every failure is RFC 9457 Problem Details. Unexpected errors are logged and recorded on the trace, and the client only sees a request ID.
- **Authorization:** every note query filters by the caller's user ID, so another user's note looks like it doesn't exist.
- **Concurrency:** updates need an `If-Match` version, and the check happens inside the `UPDATE` statement.
- **Idempotency:** keys are scoped to the user and the endpoint, such as `POST /v1/notes`. The key and the note are written in one transaction. A concurrent duplicate waits for the first to commit, then replays it.
- **Database roles:** the API connects as `api_app`, which can read and write rows but can't change the schema. Migrations run as `api_owner`.
