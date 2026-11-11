# Call the API from TypeScript

`src/app.ts` exports `AppType`, so a TypeScript client gets every route, input, and response type with no code generation. Error responses are typed as Problem Details.

```ts
import { hc } from 'hono/client';
import type { AppType } from 'api-hono-starter/src/app.ts';

const api = hc<AppType>('http://localhost:3000', {
  headers: { Authorization: `Bearer ${token}` },
});

const response = await api.v1.notes.$post({ header: {}, json: { title: 'Typed' } });
if (response.status === 201) {
  const note = await response.json();
  console.log(note.id);
} else {
  const problem = await response.json();
  console.error(problem.type, problem.detail);
}
```

Use the same `hono` version in the client and the API, or the types can fail to resolve. For other languages, generate a client from `openapi.json`.

## Keep a route in the client

A route only appears in `AppType` if it's chained. In a feature router, call `.openapi()` on the result of `createRouter()` or the previous `.openapi()`, then mount the router with `.route()` in `src/app.ts`. `test/integration/client.test.ts` shows the pattern.

## Log in from a browser

A browser app on the same origin as the API can keep the session in a cookie that JavaScript can't read. Serve the app and the API from one origin through a reverse proxy, such as `/api` to the API, because CORS doesn't allow credentials.

```ts
await fetch('/api/v1/sessions', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email, password, delivery: 'cookie' }),
});

const me = await fetch('/api/v1/users/me');
```

- The login response sets `__Host-session` with `HttpOnly`, `Secure`, and `SameSite=Strict`, and its body has only `expiresAt`.
- The browser sends the cookie with every same-origin request. A request with an `Authorization` header ignores it.
- `DELETE /v1/sessions/current` revokes the session and clears the cookie. A 401 for an invalid or expired cookie clears it too.
- Browsers treat `http://localhost` as secure, so the cookie works in local development in Chrome and Firefox. Other hosts need HTTPS.
- A request that changes data from another site gets 403 `forbidden`, however it authenticates. To let another origin send them with a bearer token, add it to `CORS_ORIGINS`.
