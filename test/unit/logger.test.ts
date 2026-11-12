import { context, type SpanContext, TraceFlags, trace } from '@opentelemetry/api';
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createLogger } from '../../src/platform/logger.ts';

function capture(entry: Record<string, unknown>): string {
  let output = '';
  const logger = createLogger('info', {
    write: (line) => {
      output += line;
    },
  });
  logger.info(entry, 'test');
  return output;
}

describe('logger', () => {
  it.each(['password', 'token', 'authorization'])('redacts %s', (field) => {
    const output = capture({ [field]: 'super-secret' });
    expect(output).not.toContain('super-secret');
    expect(output).toContain('[Redacted]');
  });

  it('redacts one level deep', () => {
    expect(capture({ body: { password: 'super-secret' } })).not.toContain('super-secret');
  });

  it('keeps other fields', () => {
    expect(capture({ status: 200 })).toContain('"status":200');
  });
});

describe('trace context', () => {
  const contextManager = new AsyncLocalStorageContextManager();

  beforeAll(() => {
    context.setGlobalContextManager(contextManager.enable());
  });

  afterAll(() => {
    contextManager.disable();
    context.disable();
  });

  function captureInSpan(spanContext: SpanContext): string {
    const span = trace.wrapSpanContext(spanContext);
    return context.with(trace.setSpan(context.active(), span), () => capture({ status: 200 }));
  }

  it('adds the trace and span IDs of the active span', () => {
    const output = captureInSpan({
      traceId: '4bf92f3577b34da6a3ce929d0e0e4736',
      spanId: '00f067aa0ba902b7',
      traceFlags: TraceFlags.SAMPLED,
    });
    expect(output).toContain('"trace_id":"4bf92f3577b34da6a3ce929d0e0e4736"');
    expect(output).toContain('"span_id":"00f067aa0ba902b7"');
  });

  it('leaves them out without a valid span', () => {
    expect(capture({ status: 200 })).not.toContain('trace_id');
    const output = captureInSpan({
      traceId: '00000000000000000000000000000000',
      spanId: '0000000000000000',
      traceFlags: TraceFlags.NONE,
    });
    expect(output).not.toContain('trace_id');
  });
});
