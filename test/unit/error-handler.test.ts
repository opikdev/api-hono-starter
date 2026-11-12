import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { requestId } from 'hono/request-id';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { describe, expect, it, vi } from 'vitest';
import { createErrorHandler } from '../../src/platform/error-handler.ts';
import type { Logger } from '../../src/platform/logger.ts';
import type { AppEnv } from '../../src/platform/router.ts';

function appThrowing(error: Error) {
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const app = new Hono<AppEnv>()
    .use(requestId())
    .get('/', () => {
      throw error;
    })
    .onError(createErrorHandler(logger as unknown as Logger));
  return { app, logger };
}

async function problemFor(error: Error) {
  const { app, logger } = appThrowing(error);
  const response = await app.request('/');
  return { response, body: (await response.json()) as Record<string, unknown>, logger };
}

describe('error handler', () => {
  it.each([
    [400, 'validation-failed'],
    [401, 'unauthorized'],
    [403, 'forbidden'],
    [404, 'not-found'],
    [413, 'payload-too-large'],
    [415, 'unsupported-media-type'],
    [429, 'rate-limited'],
    [503, 'service-unavailable'],
    [504, 'timeout'],
  ] as const)('maps an HTTPException %i to %s without logging', async (status, slug) => {
    const { response, body, logger } = await problemFor(
      new HTTPException(status as ContentfulStatusCode, { message: 'internal detail' }),
    );
    expect(response.status).toBe(status);
    expect(response.headers.get('content-type')).toBe('application/problem+json');
    expect(body).toMatchObject({ type: `urn:problem:${slug}`, status });
    expect(body.detail).not.toContain('internal detail');
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('says the JSON is malformed only when it is', async () => {
    const malformed = await problemFor(
      new HTTPException(400, { message: 'Malformed JSON in request body' }),
    );
    const other = await problemFor(new HTTPException(400, { message: 'Malformed FormData' }));
    expect(malformed.body.detail).toBe(
      'The request body is not valid JSON. Fix the syntax and retry.',
    );
    expect(other.body.detail).not.toMatch(/JSON/);
  });

  it('logs an HTTPException with an unmapped status as a 500', async () => {
    const { response, body, logger } = await problemFor(new HTTPException(418));
    expect(response.status).toBe(500);
    expect(body.type).toBe('urn:problem:internal-error');
    expect(logger.error).toHaveBeenCalledOnce();
  });
});

class PostgresError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

function wrapped(code: string) {
  const cause = new PostgresError(code, 'violates constraint "uq_projects_user_id_slug"');
  return new Error('Failed query: insert into "projects" values ($1)', { cause });
}

describe('database errors', () => {
  it.each([
    ['23505', 409, 'conflict'],
    ['23503', 409, 'conflict'],
    ['23514', 400, 'validation-failed'],
  ] as const)('maps Postgres %s to %i %s without leaking it', async (code, status, slug) => {
    const { response, body, logger } = await problemFor(wrapped(code));
    expect(response.status).toBe(status);
    expect(body).toMatchObject({ type: `urn:problem:${slug}`, status });
    expect(JSON.stringify(body)).not.toMatch(/uq_projects|insert into|constraint/);
    expect(logger.error).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledOnce();
  });

  it('keeps other database errors as a logged 500', async () => {
    const { response, logger } = await problemFor(wrapped('42P01'));
    expect(response.status).toBe(500);
    expect(logger.error).toHaveBeenCalledOnce();
  });
});
