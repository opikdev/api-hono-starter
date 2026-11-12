import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { createApp } from '../../src/app.ts';
import { createDb, createPool } from '../../src/db/client.ts';
import type { Logger } from '../../src/platform/logger.ts';
import { call, db, expectProblem, signUp, testApp, testConfig } from '../helpers.ts';

const app = testApp();

function spyLogger() {
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  return { logger, asLogger: logger as unknown as Logger };
}

describe('error responses', () => {
  it('returns Problem Details for an unknown route', async () => {
    const problem = await expectProblem(await call(app, 'GET', '/v1/nope'), 404, 'not-found');
    expect(problem).toMatchObject({ status: 404, instance: '/v1/nope' });
  });

  it('rejects malformed JSON', async () => {
    const response = await call(app, 'POST', '/v1/users', { rawBody: '{ nope' });
    const problem = await expectProblem(response, 400, 'validation-failed');
    expect(problem.detail).toBe('The request body is not valid JSON. Fix the syntax and retry.');
  });

  it.each([
    ['text/plain', 'text/plain'],
    ['a form, as curl -d sends by default', 'application/x-www-form-urlencoded'],
  ])('rejects %s with 415, not 500', async (_label, contentType) => {
    const { logger, asLogger } = spyLogger();
    const logged = createApp({ config: testConfig(), db, logger: asLogger });
    const { token } = await signUp(app);
    const response = await call(logged, 'POST', '/v1/notes', {
      token,
      rawBody: 'title=x',
      headers: { 'Content-Type': contentType },
    });
    const problem = await expectProblem(response, 415, 'unsupported-media-type');
    expect(problem.detail).toContain('application/json');
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('answers HEAD like GET, without a body', async () => {
    const head = await call(app, 'HEAD', '/healthz');
    const get = await call(app, 'GET', '/healthz');
    expect(head.status).toBe(get.status);
    expect(head.headers.get('content-type')).toBe(get.headers.get('content-type'));
    expect(await head.text()).toBe('');
  });

  it('rejects an oversized body', async () => {
    const response = await call(app, 'POST', '/v1/users', { rawBody: 'x'.repeat(100 * 1024 + 1) });
    await expectProblem(response, 413, 'payload-too-large');
  });

  it('hides internals and logs the real error', async () => {
    const { logger, asLogger } = spyLogger();
    const pool = createPool('postgres://nobody:wrong-secret@127.0.0.1:1/none', 100);
    pool.on('error', () => {});
    const broken = createApp({ config: testConfig(), db: createDb(pool), logger: asLogger });
    const response = await call(broken, 'GET', '/v1/notes');
    const problem = await expectProblem(response, 500, 'internal-error');
    expect(problem.detail).toMatch(/^Something went wrong on our side\. Retry, and quote request /);
    expect(JSON.stringify(problem)).not.toMatch(/wrong-secret|ECONNREFUSED|stack|\.ts:\d|\n\s+at /);
    expect(logger.error).toHaveBeenCalledOnce();
    await pool.end();
  });
});

describe('security headers', () => {
  it('sets them on every response', async () => {
    const response = await call(app, 'GET', '/healthz');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('strict-transport-security')).toContain('max-age');
    expect(response.headers.get('x-powered-by')).toBeNull();
  });

  it('returns a request id', async () => {
    const response = await call(app, 'GET', '/healthz');
    expect(response.headers.get('x-request-id')).toBeTruthy();
  });

  it.each([
    ['an unknown route', 'GET', '/v1/nope', 404],
    ['a thrown problem', 'GET', '/v1/notes', 401],
    ['malformed JSON', 'POST', '/v1/users', 400],
  ] as const)('sets them on %s', async (_label, method, path, status) => {
    const response = await call(app, method, path, method === 'POST' ? { rawBody: '{ nope' } : {});
    expect(response.status).toBe(status);
    expect(response.headers.get('x-request-id')).toBeTruthy();
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
  });

  it('returns the request id quoted in a 500', async () => {
    const { asLogger } = spyLogger();
    const pool = createPool('postgres://nobody:wrong-secret@127.0.0.1:1/none', 100);
    pool.on('error', () => {});
    const broken = createApp({ config: testConfig(), db: createDb(pool), logger: asLogger });
    const response = await call(broken, 'GET', '/v1/notes');
    const problem = await expectProblem(response, 500, 'internal-error');
    const requestId = response.headers.get('x-request-id');
    expect(requestId).toBeTruthy();
    expect(problem.detail).toContain(`quote request ${requestId} `);
    await pool.end();
  });
});

describe('CORS', () => {
  const allowed = 'https://app.example';
  const withCors = testApp({ CORS_ORIGINS: allowed });

  it('allows a listed origin', async () => {
    const response = await call(withCors, 'GET', '/v1/notes', { headers: { Origin: allowed } });
    expect(response.headers.get('access-control-allow-origin')).toBe(allowed);
  });

  it('allows a listed origin to read an error', async () => {
    const response = await call(withCors, 'GET', '/v1/notes', { headers: { Origin: allowed } });
    expect(response.status).toBe(401);
    expect(response.headers.get('access-control-allow-origin')).toBe(allowed);
  });

  it('lets a listed origin read the headers clients need', async () => {
    const response = await call(withCors, 'GET', '/v1/notes', { headers: { Origin: allowed } });
    const exposed = response.headers.get('access-control-expose-headers')?.split(',');
    expect(exposed).toEqual([
      'ETag',
      'Location',
      'X-Request-Id',
      'Retry-After',
      'RateLimit',
      'RateLimit-Policy',
      'Idempotency-Replayed',
    ]);
  });

  it('never allows an unlisted origin', async () => {
    const response = await call(withCors, 'GET', '/v1/notes', {
      headers: { Origin: 'https://evil.example' },
    });
    expect(response.headers.get('access-control-allow-origin')).not.toBe('https://evil.example');
    expect(response.headers.get('access-control-allow-origin')).not.toBe('*');
  });

  it('sends no CORS headers by default', async () => {
    const response = await call(app, 'GET', '/v1/notes', { headers: { Origin: allowed } });
    expect(response.headers.get('access-control-allow-origin')).toBeNull();
  });
});

describe('health', () => {
  it('reports liveness', async () => {
    const response = await call(app, 'GET', '/healthz');
    expect(await response.json()).toEqual({ status: 'ok' });
  });

  it('reports readiness', async () => {
    expect((await call(app, 'GET', '/readyz')).status).toBe(200);
  });

  it('reports 503 and stays alive when Postgres is down', async () => {
    const { logger, asLogger } = spyLogger();
    const pool = createPool('postgres://nobody:nope@127.0.0.1:1/none', 100);
    pool.on('error', () => {});
    const broken = createApp({ config: testConfig(), db: createDb(pool), logger: asLogger });
    const ready = await call(broken, 'GET', '/readyz');
    await expectProblem(ready, 503, 'service-unavailable');
    expect(ready.headers.get('retry-after')).toBe('5');
    expect(logger.warn).toHaveBeenCalledOnce();
    expect((await call(broken, 'GET', '/healthz')).status).toBe(200);
    await pool.end();
  });
});

describe('logging', () => {
  it('never logs tokens or bodies', async () => {
    const { logger, asLogger } = spyLogger();
    const logged = createApp({
      config: testConfig(),
      db: (await import('../helpers.ts')).db,
      logger: asLogger,
    });
    const { token } = await signUp(testApp());
    await call(logged, 'GET', '/v1/users/me', { token });
    expect(logger.info).toHaveBeenCalledOnce();
    const entry = JSON.stringify(logger.info.mock.calls);
    expect(entry).not.toContain(token);
    expect(entry).toContain('"status":200');
  });
});

describe('OpenAPI', () => {
  const spec = async () => {
    const response = await call(app, 'GET', '/openapi.json');
    return (await response.json()) as {
      openapi: string;
      paths: Record<string, Record<string, Operation>>;
    };
  };

  interface Operation {
    operationId?: string;
    summary?: string;
    security?: unknown[];
    responses: Record<string, { content?: Record<string, unknown> }>;
  }

  const publicOperations = ['createUser', 'createSession'];

  it('is OpenAPI 3.1', async () => {
    expect((await spec()).openapi).toMatch(/^3\.1/);
  });

  it('matches the committed openapi.json', async () => {
    const committed = JSON.parse(readFileSync('openapi.json', 'utf8'));
    expect(await spec()).toEqual(committed);
  });

  it('documents every operation fully', async () => {
    const { paths } = await spec();
    const operations = Object.entries(paths).flatMap(([path, methods]) =>
      Object.values(methods).map((operation) => ({ path, operation })),
    );
    expect(operations.length).toBeGreaterThan(8);

    for (const { path, operation } of operations) {
      expect(operation.operationId, path).toBeTruthy();
      expect(operation.summary, path).toBeTruthy();
      if (!path.startsWith('/v1')) continue;

      expect(operation.responses['429'], `${path} documents 429`).toBeDefined();
      if (!publicOperations.includes(operation.operationId as string)) {
        expect(operation.security, `${path} declares auth`).toEqual([
          { bearerAuth: [] },
          { cookieAuth: [] },
        ]);
        expect(operation.responses['401'], `${path} documents 401`).toBeDefined();
      }
      for (const [status, response] of Object.entries(operation.responses)) {
        if (Number(status) >= 400) {
          expect(response.content, `${path} ${status}`).toHaveProperty([
            'application/problem+json',
          ]);
        }
      }
    }
  });

  it('serves the docs page', async () => {
    const response = await call(app, 'GET', '/docs');
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('swagger');
  });
});
