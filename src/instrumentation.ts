import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { PgInstrumentation } from '@opentelemetry/instrumentation-pg';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { onShutdown } from './platform/shutdown.ts';

if (process.env.OTEL_EXPORTER_OTLP_ENDPOINT) {
  const sdk = new NodeSDK({
    serviceName: process.env.OTEL_SERVICE_NAME ?? 'api-hono-starter',
    traceExporter: new OTLPTraceExporter(),
    instrumentations: [new PgInstrumentation()],
  });
  sdk.start();
  onShutdown(() => sdk.shutdown());
}
