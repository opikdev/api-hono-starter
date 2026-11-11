# 006. Cookie sessions for same-origin browser apps

- **Status**: accepted
- **Context**: A browser app that keeps a bearer token in JavaScript loses it to any XSS bug. Cookies fix that but bring CSRF, and the Go and FastAPI starters must offer the same contract so one frontend works against any of them.
- **Decision**: `POST /v1/sessions` with `delivery: "cookie"` sets the same opaque token in an `HttpOnly`, `Secure`, `SameSite=Strict` cookie named `__Host-session`, and the auth middleware accepts it when no `Authorization` header is sent. Every unsafe `/v1` request passes a cross-origin check, using `Sec-Fetch-Site` and falling back to `Origin` against `Host`, the algorithm of Go 1.25's `CrossOriginProtection`. Bearer tokens in the body stay the default.
- **Consequences**:
  - Scripts can't read the token, and the `__Host-` prefix stops subdomains and plain HTTP from setting or scoping it.
  - CSRF needs no token: `SameSite=Strict` keeps the cookie off cross-site requests, and the origin check also blocks login CSRF and browsers that ignore `SameSite`.
  - Cookie mode needs the app on the API's origin, through a reverse proxy, because CORS stays without credentials.
  - Cross-site browser requests that change data are rejected unless the origin is in `CORS_ORIGINS`.
  - CLIs, servers, and mobile apps keep using bearer tokens unchanged, with no cookie jar and no CSRF rules.
  - Sessions can last at most 400 days, the longest a browser keeps a cookie.
