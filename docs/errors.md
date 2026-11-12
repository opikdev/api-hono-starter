# Error reference

Every error is `application/problem+json` per [RFC 9457](https://www.rfc-editor.org/rfc/rfc9457). Switch on `type`, because the other fields can change.

```json
{
  "type": "urn:problem:validation-failed",
  "title": "Request validation failed",
  "status": 400,
  "detail": "The request has invalid fields. See `errors` for each one, then fix them and retry.",
  "instance": "/v1/users",
  "errors": [
    { "field": "password", "detail": "Too small: expected string to have >=12 characters" }
  ]
}
```

Each `errors` entry names the invalid input in `field`, as a dot-separated path such as `password` or `limit`. An empty `field` means the problem is with the whole body, such as an empty `PATCH`.

| Type                                 | Status | Meaning                                                           |
| ------------------------------------ | ------ | ----------------------------------------------------------------- |
| `urn:problem:validation-failed`      | 400    | A field is invalid, the JSON is malformed, `limit` is over 100, or a value breaks a database check constraint |
| `urn:problem:invalid-credentials`    | 401    | Wrong email or password                                           |
| `urn:problem:unauthorized`           | 401    | The token or session cookie is missing, invalid, expired, or revoked |
| `urn:problem:forbidden`              | 403    | A request that changes data came from another site whose origin isn't in `CORS_ORIGINS` |
| `urn:problem:not-found`              | 404    | The route or resource doesn't exist, or isn't yours               |
| `urn:problem:conflict`               | 409    | The request clashes with existing data, such as a value that must be unique, or refers to data that doesn't exist |
| `urn:problem:email-taken`            | 409    | The email is already registered                                   |
| `urn:problem:version-mismatch`       | 412    | `If-Match` doesn't match the note's current version               |
| `urn:problem:payload-too-large`      | 413    | The body is over 100 KiB                                          |
| `urn:problem:unsupported-media-type` | 415 | The body isn't sent as `application/json` |
| `urn:problem:idempotency-key-reused` | 422    | The `Idempotency-Key` was used on this endpoint with a different body |
| `urn:problem:precondition-required`  | 428    | `If-Match` is missing                                             |
| `urn:problem:rate-limited`           | 429    | Too many requests. Wait for `Retry-After` seconds                 |
| `urn:problem:internal-error`         | 500    | Unexpected failure. Quote the request ID in `detail`              |
| `urn:problem:service-unavailable`    | 503    | Postgres is unreachable                                           |
| `urn:problem:timeout`                | 504    | Middleware you add, such as `hono/timeout`, stopped the request   |

An `HTTPException` thrown by Hono or its middleware becomes the type with the same status. One with a status not listed here becomes `internal-error`, and it's logged.

A Postgres constraint violation that reaches the error handler becomes a problem without the constraint name or SQL: a unique or foreign key violation is `conflict`, and a check violation is `validation-failed`. Other database errors are `internal-error`.
