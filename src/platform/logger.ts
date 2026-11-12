import { isSpanContextValid, trace } from '@opentelemetry/api';
import { type DestinationStream, pino } from 'pino';

function traceContext() {
  const context = trace.getActiveSpan()?.spanContext();
  return context && isSpanContextValid(context)
    ? { trace_id: context.traceId, span_id: context.spanId }
    : {};
}

export function createLogger(level: string, destination?: DestinationStream) {
  return pino(
    {
      level,
      redact: ['authorization', 'password', 'token', '*.authorization', '*.password', '*.token'],
      mixin: traceContext,
    },
    destination,
  );
}

export type Logger = ReturnType<typeof createLogger>;
