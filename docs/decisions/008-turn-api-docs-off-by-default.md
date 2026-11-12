# 008. Turn the API docs off by default

- **Status**: accepted
- **Context**: `/docs` and `/openapi.json` describe every route, which helps attackers map a private API, and Swagger UI loaded from a CDN put a third-party script on the API's origin.
- **Decision**: Serve the docs only when `DOCS_ENABLED=true`, from `swagger-ui-dist` pinned in `package.json`, under a CSP that allows only the API's own origin.
- **Consequences**:
  - A production deploy publishes nothing about the API unless someone turns the docs on.
  - `.env.example`, Compose, and the tests turn the docs on, so the quick start still shows them.
  - Swagger UI updates come through Renovate, and the image is about 12 MB bigger.
