import { randomUUID } from 'node:crypto';
import { afterAll, inject } from 'vitest';
import { createApp } from '../src/app.ts';
import { type Config, loadConfig } from '../src/config.ts';
import { createDb, createPool } from '../src/db/client.ts';
import { createLogger } from '../src/platform/logger.ts';

const pool = createPool(inject('databaseUrl'), 5000);
export const db = createDb(pool);

afterAll(async () => {
  await pool.end();
});

export const password = 'correct-horse-battery';

export function testConfig(overrides: Record<string, string> = {}): Config {
  return loadConfig({
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    DATABASE_URL: inject('databaseUrl'),
    TRUST_PROXY: 'true',
    RATE_LIMIT_PER_MINUTE: '100000',
    AUTH_RATE_LIMIT_PER_MINUTE: '100000',
    ...overrides,
  });
}

export function testApp(overrides: Record<string, string> = {}) {
  return createApp({ config: testConfig(overrides), db, logger: createLogger('silent') });
}

export type TestApp = ReturnType<typeof testApp>;

interface CallOptions {
  token?: string;
  body?: unknown;
  rawBody?: string;
  headers?: Record<string, string>;
  ip?: string;
}

export function call(app: TestApp, method: string, path: string, options: CallOptions = {}) {
  const headers: Record<string, string> = {
    'X-Forwarded-For': options.ip ?? uniqueIp(),
  };
  for (const [name, value] of Object.entries(options.headers ?? {})) {
    headers[name === 'content-type' ? 'Content-Type' : name] = value;
  }
  if (options.token) headers.Authorization = `Bearer ${options.token}`;
  const payload =
    options.rawBody ?? (options.body === undefined ? undefined : JSON.stringify(options.body));
  if (payload !== undefined) headers['Content-Type'] ??= 'application/json';
  return app.request(path, {
    method,
    headers,
    ...(payload === undefined ? {} : { body: payload }),
  });
}

export function uniqueIp(): string {
  return `test-${randomUUID()}`;
}

export function uniqueEmail(): string {
  return `user-${randomUUID()}@example.com`;
}

export async function signUp(app: TestApp) {
  const email = uniqueEmail();
  const created = await call(app, 'POST', '/v1/users', { body: { email, password } });
  const user = (await created.json()) as { id: string };
  const session = await call(app, 'POST', '/v1/sessions', { body: { email, password } });
  const { token } = (await session.json()) as { token: string };
  return { email, token, userId: user.id };
}

export async function expectProblem(response: Response, status: number, slug: string) {
  const body = (await response.json()) as Record<string, unknown>;
  if (response.status !== status || body.type !== `urn:problem:${slug}`) {
    throw new Error(`Expected ${status} ${slug}, got ${response.status}: ${JSON.stringify(body)}`);
  }
  if (!response.headers.get('content-type')?.startsWith('application/problem+json')) {
    throw new Error(`Wrong content type: ${response.headers.get('content-type')}`);
  }
  return body;
}
