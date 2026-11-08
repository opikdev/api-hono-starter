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
