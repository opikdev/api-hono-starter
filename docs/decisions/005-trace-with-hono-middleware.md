# 005. Trace with Hono middleware

- **Status**: accepted
- **Context**: `@opentelemetry/instrumentation-http` produced no HTTP spans under ES modules, so nothing was active when errors were recorded. Vendor SDKs such as Sentry would add a second tracing setup.
- **Decision**: Create request spans with `@hono/otel`, trace queries with `instrumentation-pg`, and record errors on the active span.
- **Consequences**:
  - Tracing works without module-loader hooks, and spans use route names.
  - Error tracking works with any OTLP backend, so there's no vendor SDK.
  - Backends without error grouping show exceptions only on traces.
  - The end-to-end test proves export against a real collector.
