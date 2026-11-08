import { SpanStatusCode, trace } from '@opentelemetry/api';
import type { ErrorHandler } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { Logger } from './logger.ts';
import { ProblemError, problemResponse } from './problem.ts';
import type { AppEnv } from './router.ts';

function reportError(error: Error, logger: Logger, requestId: string) {
  logger.error({ err: error, requestId }, 'Unhandled error');
  const span = trace.getActiveSpan();
  span?.recordException(error);
  span?.setStatus({ code: SpanStatusCode.ERROR });
}

export function createErrorHandler(logger: Logger): ErrorHandler<AppEnv> {
  return (error, c) => {
    const instance = c.req.path;
    if (error instanceof ProblemError) {
      if (error.cause)
        logger.warn({ err: error.cause, requestId: c.get('requestId') }, error.message);
      return problemResponse(error, instance);
    }

    if (error instanceof HTTPException && error.status === 400) {
      const detail = 'The request body is not valid JSON. Fix the syntax and retry.';
      return problemResponse(new ProblemError('validation-failed', detail), instance);
    }

    if (error instanceof HTTPException && error.status === 415) {
      const detail = 'Send the body as JSON, with the header Content-Type: application/json.';
      return problemResponse(new ProblemError('unsupported-media-type', detail), instance);
    }

    reportError(error, logger, c.get('requestId'));
    const detail = `Something went wrong on our side. Retry, and quote request ${c.get('requestId')} if it persists.`;
    return problemResponse(new ProblemError('internal-error', detail), instance);
  };
}
