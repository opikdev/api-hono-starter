import { SpanStatusCode, trace } from '@opentelemetry/api';
import type { Context, ErrorHandler } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { Logger } from './logger.ts';
import { ProblemError, type ProblemSlug, problemResponse } from './problem.ts';
import type { AppEnv } from './router.ts';

function reportError(error: Error, logger: Logger, requestId: string) {
  logger.error({ err: error, requestId }, 'Unhandled error');
  const span = trace.getActiveSpan();
  span?.recordException(error);
  span?.setStatus({ code: SpanStatusCode.ERROR });
}

/** Builds the response from scratch, so it copies the request ID the middleware already set. */
export function respond(c: Context<AppEnv>, error: ProblemError): Response {
  const response = problemResponse(error, c.req.path);
  response.headers.set('X-Request-Id', c.get('requestId'));
  return response;
}

const malformedJsonMessage = 'Malformed JSON in request body';

const httpExceptionProblems: Partial<Record<number, [ProblemSlug, string]>> = {
  400: ['validation-failed', 'The request is invalid. Fix it and retry.'],
  401: ['unauthorized', 'Send valid credentials in the Authorization header.'],
  403: ['forbidden', 'This request is not allowed.'],
  404: ['not-found', 'The resource does not exist.'],
  413: ['payload-too-large', 'The request body is too large.'],
  415: [
    'unsupported-media-type',
    'Send the body as JSON, with the header Content-Type: application/json.',
  ],
  429: ['rate-limited', 'Too many requests. Wait a minute, then retry.'],
  503: ['service-unavailable', 'The service is unavailable. Retry later.'],
  504: ['timeout', 'The request took too long. Retry later.'],
};

const constraintProblems: Partial<Record<string, () => ProblemError>> = {
  '23505': () =>
    new ProblemError(
      'conflict',
      'The request conflicts with data that already exists. Change the conflicting value, then retry.',
    ),
  '23503': () =>
    new ProblemError(
      'conflict',
      'The request refers to data that does not exist, or that other data still depends on.',
    ),
  '23514': () =>
    new ProblemError(
      'validation-failed',
      'A value is outside the allowed range. Fix it and retry.',
      {
        status: 422,
      },
    ),
};

function postgresCode(error: unknown): string | undefined {
  for (let current = error; current instanceof Error; current = current.cause) {
    const code = (current as { code?: unknown }).code;
    if (typeof code === 'string') return code;
  }
  return undefined;
}

function toConstraintProblem(error: Error): ProblemError | null {
  const code = postgresCode(error);
  return (code && constraintProblems[code]?.()) || null;
}

function toProblem(error: HTTPException): ProblemError | null {
  if (error.status === 400 && error.message === malformedJsonMessage) {
    return new ProblemError(
      'validation-failed',
      'The request body is not valid JSON. Fix the syntax and retry.',
    );
  }
  const problem = httpExceptionProblems[error.status];
  return problem ? new ProblemError(...problem) : null;
}

export function createErrorHandler(logger: Logger): ErrorHandler<AppEnv> {
  return (error, c) => {
    if (error instanceof ProblemError) {
      if (error.cause)
        logger.warn({ err: error.cause, requestId: c.get('requestId') }, error.message);
      return respond(c, error);
    }

    const problem = error instanceof HTTPException ? toProblem(error) : null;
    if (problem) return respond(c, problem);

    const constraintProblem = toConstraintProblem(error);
    if (constraintProblem) {
      logger.warn({ err: error, requestId: c.get('requestId') }, 'Constraint violation');
      return respond(c, constraintProblem);
    }

    reportError(error, logger, c.get('requestId'));
    const detail = `Something went wrong on our side. Retry, and quote request ${c.get('requestId')} if it persists.`;
    return respond(c, new ProblemError('internal-error', detail));
  };
}
