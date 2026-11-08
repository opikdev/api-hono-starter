import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { PgInstrumentation } from '@opentelemetry/instrumentation-pg';
import { NodeSDK } from '@opentelemetry/sdk-node';

if (process.env.OTEL_EXPORTER_OTLP_ENDPOINT) {
  const sdk = new NodeSDK({
    serviceName: process.env.OTEL_SERVICE_NAME ?? 'api-hono-starter',
    traceExporter: new OTLPTraceExporter(),
    instrumentations: [new PgInstrumentation()],
  });
  sdk.start();
  process.once('SIGTERM', () => {
    sdk.shutdown().catch((err) => console.error('OpenTelemetry shutdown failed', err));
  });
}
