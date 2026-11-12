import { execFile, execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const port = process.env.E2E_PORT ?? '3100';
const dbPort = process.env.E2E_DB_PORT ?? '5532';
const otlpPort = Number(process.env.E2E_OTLP_PORT ?? '4319');
const baseUrl = `http://127.0.0.1:${port}`;
const composeEnv = {
  ...process.env,
  API_PORT: port,
  POSTGRES_PORT: dbPort,
  OTEL_EXPORTER_OTLP_ENDPOINT: `http://host.docker.internal:${otlpPort}`,
  COMPOSE_PROJECT_NAME: 'api-hono-starter-e2e',
};

function compose(...args: string[]): string {
  return execFileSync('docker', ['compose', ...args], {
    env: composeEnv,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

const run = promisify(execFile);

/** Doesn't block, so the collector in this process can receive the traces flushed on shutdown. */
async function composeAsync(...args: string[]) {
  await run('docker', ['compose', ...args], { env: composeEnv });
}

let traceBytes = '';
let metricBytes = '';
let collector: Server;

async function waitFor(check: () => Promise<boolean> | boolean, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out after ${timeoutMs} ms`);
}

async function json(path: string, init: RequestInit = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init.headers },
  });
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

beforeAll(async () => {
  collector = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => {
      if (request.url === '/v1/traces') {
        traceBytes += Buffer.concat(chunks).toString('latin1');
      }
      if (request.url === '/v1/metrics') {
        metricBytes += Buffer.concat(chunks).toString('latin1');
      }
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end('{}');
    });
  });
  await new Promise<void>((resolve) => collector.listen(otlpPort, '0.0.0.0', resolve));

  compose('down', '--volumes', '--remove-orphans');
  compose('up', '--build', '--detach', '--wait', 'api');
});

afterAll(async () => {
  compose('down', '--volumes', '--remove-orphans');
  await new Promise((resolve) => collector.close(resolve));
});

describe('the running stack', () => {
  it('is ready after one command', async () => {
    expect((await json('/readyz')).status).toBe(200);
  });

  it('reports the API container as healthy', () => {
    const state = JSON.parse(compose('ps', 'api', '--format', 'json').trim());
    expect(state.Health).toBe('healthy');
  });

  it('runs on a read-only filesystem, without package managers', () => {
    expect(() => compose('exec', '-T', 'api', 'touch', '/app/written')).toThrow();
    for (const tool of ['npm', 'npx', 'corepack', 'yarn']) {
      expect(() => compose('exec', '-T', 'api', 'which', tool), tool).toThrow();
    }
  });

  it('runs as a non-root user', () => {
    expect(compose('exec', '-T', 'api', 'id', '-u').trim()).not.toBe('0');
  });

  it('ships no test files or dev dependencies', () => {
    const listing = compose('exec', '-T', 'api', 'ls', '-a', '/app');
    expect(listing).not.toMatch(/\btest\b/);
    expect(listing).not.toMatch(/\.env\b/);
    const modules = compose('exec', '-T', 'api', 'ls', '/app/node_modules');
    expect(modules).not.toContain('vitest');
  });

  it('logs in with the seeded demo user and reads fake notes', async () => {
    const login = await json('/v1/sessions', {
      method: 'POST',
      body: JSON.stringify({ email: 'demo@example.com', password: 'demo-password-123' }),
    });
    expect(login.status).toBe(201);
    const notes = await json('/v1/notes', {
      headers: { Authorization: `Bearer ${login.body.token}` },
    });
    expect((notes.body.data as unknown[]).length).toBe(2);
  });

  it('runs the whole note lifecycle over real HTTP', async () => {
    const email = `e2e-${Date.now()}@example.com`;
    const password = 'correct-horse-battery';
    const credentials = JSON.stringify({ email, password });
    expect((await json('/v1/users', { method: 'POST', body: credentials })).status).toBe(201);
    const login = await json('/v1/sessions', { method: 'POST', body: credentials });
    const headers = { Authorization: `Bearer ${login.body.token}` };

    const created = await json('/v1/notes', {
      method: 'POST',
      headers: { ...headers, 'Idempotency-Key': 'e2e' },
      body: JSON.stringify({ title: 'From the outside' }),
    });
    expect(created.status).toBe(201);

    const path = `/v1/notes/${created.body.id}`;
    const updated = await json(path, {
      method: 'PATCH',
      headers: { ...headers, 'If-Match': '"1"' },
      body: JSON.stringify({ title: 'Changed' }),
    });
    expect(updated.body).toMatchObject({ title: 'Changed', version: 2 });

    const deleted = await fetch(`${baseUrl}${path}`, { method: 'DELETE', headers });
    expect(deleted.status).toBe(204);
    expect((await json(path, { headers })).status).toBe(404);
  });

  it('keeps a browser session in a cookie and blocks cross-site writes', async () => {
    const sameOrigin = { 'Sec-Fetch-Site': 'same-origin' };
    const login = await fetch(`${baseUrl}/v1/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...sameOrigin },
      body: JSON.stringify({
        email: 'demo@example.com',
        password: 'demo-password-123',
        delivery: 'cookie',
      }),
    });
    expect(login.status).toBe(201);
    expect(Object.keys((await login.json()) as object)).toEqual(['expiresAt']);
    const setCookie = login.headers.get('set-cookie') ?? '';
    expect(setCookie).toMatch(
      /^__Host-session=[\w-]+; Max-Age=\d+; Path=\/; HttpOnly; Secure; SameSite=Strict$/,
    );
    const cookie = { Cookie: setCookie.split(';')[0] as string };

    const notes = await json('/v1/notes', { headers: cookie });
    expect((notes.body.data as unknown[]).length).toBe(2);

    const forged = await json('/v1/notes', {
      method: 'POST',
      headers: { ...cookie, Origin: 'https://evil.example', 'Sec-Fetch-Site': 'cross-site' },
      body: JSON.stringify({ title: 'Forged' }),
    });
    expect(forged).toMatchObject({ status: 403, body: { type: 'urn:problem:forbidden' } });

    const logout = await fetch(`${baseUrl}/v1/sessions/current`, {
      method: 'DELETE',
      headers: { ...cookie, ...sameOrigin },
    });
    expect(logout.status).toBe(204);
    expect(logout.headers.get('set-cookie')).toMatch(/^__Host-session=; Max-Age=0;/);
    expect((await json('/v1/notes', { headers: cookie })).status).toBe(401);
  });

  it('returns Problem Details with the right content type', async () => {
    const response = await fetch(`${baseUrl}/v1/nope`);
    expect(response.status).toBe(404);
    expect(response.headers.get('content-type')).toContain('application/problem+json');
  });

  it('serves the OpenAPI document', async () => {
    expect((await json('/openapi.json')).body.openapi).toMatch(/^3\.1/);
  });

  it('writes structured JSON logs', () => {
    const lines = compose('logs', '--no-log-prefix', 'api').trim().split('\n');
    const entries = lines.flatMap((line) => {
      try {
        return [JSON.parse(line) as Record<string, unknown>];
      } catch {
        return [];
      }
    });
    const requests = entries.filter((entry) => entry.msg === 'Request completed');
    expect(requests.some((entry) => entry.requestId)).toBe(true);
    expect(requests.some((entry) => /^[0-9a-f]{32}$/.test(String(entry.trace_id)))).toBe(true);
    expect(requests.some((entry) => /^[0-9a-f]{16}$/.test(String(entry.span_id)))).toBe(true);
    expect(requests.filter((entry) => entry.path === '/healthz')).toEqual([]);
  });

  it('never logs credentials', () => {
    const logs = compose('logs', 'api');
    expect(logs).not.toContain('demo-password-123');
    expect(logs).not.toContain('Bearer');
  });

  it('exports HTTP and database spans', async () => {
    await waitFor(() => traceBytes.includes('pg.query') && traceBytes.includes('GET /v1/notes'));
    expect(traceBytes).toContain('api-hono-starter');
  });

  it('reports a database outage, records the error, and recovers', async () => {
    compose('stop', 'db');
    expect((await fetch(`${baseUrl}/healthz`)).status).toBe(200);
    expect((await fetch(`${baseUrl}/readyz`)).status).toBe(503);
    const failed = await fetch(`${baseUrl}/v1/notes`);
    expect(failed.status).toBe(500);
    const body = await failed.text();
    expect(body).toContain('urn:problem:internal-error');
    expect(body).not.toMatch(/ECONN|ENOTFOUND|EAI_AGAIN|postgres:|api_app/);
    await waitFor(() => traceBytes.includes('"name":"exception"'));

    compose('start', 'db');
    await waitFor(async () => (await fetch(`${baseUrl}/readyz`)).ok, 30_000);
  });

  it('keeps data across a restart', async () => {
    await composeAsync('restart', 'api');
    await waitFor(async () => {
      try {
        return (await fetch(`${baseUrl}/readyz`)).ok;
      } catch {
        return false;
      }
    });
    const login = await json('/v1/sessions', {
      method: 'POST',
      body: JSON.stringify({ email: 'demo@example.com', password: 'demo-password-123' }),
    });
    expect(login.status).toBe(201);
  });

  it('leaves health checks out of traces', () => {
    expect(traceBytes).not.toContain('/healthz');
    expect(traceBytes).not.toContain('/readyz');
  });

  it('flushes traces and metrics and shuts down cleanly on SIGTERM', async () => {
    const marker = randomUUID();
    expect((await fetch(`${baseUrl}/v1/notes?marker=${marker}`)).status).toBe(401);
    await composeAsync('stop', 'api');
    expect(traceBytes).toContain(marker);
    expect(metricBytes).toContain('http.server.request.duration');
    expect(metricBytes).toContain('db.client.connection.count');
    const state = compose('ps', '--all', 'api', '--format', '{{.ExitCode}}').trim();
    expect(state).toBe('0');
  });
});
