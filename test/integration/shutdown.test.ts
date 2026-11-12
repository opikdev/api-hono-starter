import type { AddressInfo } from 'node:net';
import { type ServerType, serve } from '@hono/node-server';
import { Hono } from 'hono';
import { describe, expect, inject, it } from 'vitest';
import { createApp } from '../../src/app.ts';
import { createPool } from '../../src/db/client.ts';
import { createLogger } from '../../src/platform/logger.ts';
import { onShutdown, type Readiness, shutdown } from '../../src/platform/shutdown.ts';
import { call, db, expectProblem, signUp, testConfig } from '../helpers.ts';

function listen(app: { fetch: Hono['fetch'] }): Promise<{ server: ServerType; url: string }> {
  return new Promise((resolve) => {
    const server = serve({ fetch: app.fetch, port: 0, hostname: '127.0.0.1' }, (info) => {
      resolve({ server, url: `http://127.0.0.1:${(info as AddressInfo).port}` });
    });
  });
}

describe('draining', () => {
  it('fails readiness while still serving requests', async () => {
    const readiness: Readiness = { draining: false };
    const app = createApp({ config: testConfig(), db, logger: createLogger('silent'), readiness });
    const { token } = await signUp(app);
    expect((await call(app, 'GET', '/readyz')).status).toBe(200);

    readiness.draining = true;
    await expectProblem(await call(app, 'GET', '/readyz'), 503, 'service-unavailable');
    expect((await call(app, 'GET', '/healthz')).status).toBe(200);
    expect((await call(app, 'GET', '/v1/users/me', { token })).status).toBe(200);
  });
});

describe('shutdown', () => {
  it('drains first, keeps serving, then stops accepting connections', async () => {
    const readiness: Readiness = { draining: false };
    const app = new Hono().get('/', (c) => c.text(readiness.draining ? 'draining' : 'ready'));
    const { server, url } = await listen(app);
    const pool = createPool(inject('databaseUrl'), 1000, 1);

    const stopped = shutdown({ server, pool, readiness, drainMs: 300, timeoutMs: 1000 });
    expect(readiness.draining).toBe(true);
    expect(await (await fetch(url)).text()).toBe('draining');
    await stopped;
    await expect(fetch(url)).rejects.toThrow();
  });

  it('cuts off a hung request at the timeout, then closes the pool, then runs final tasks', async () => {
    let arrived: () => void = () => {};
    const requestArrived = new Promise<void>((resolve) => {
      arrived = resolve;
    });
    const app = new Hono().get('/hang', () => {
      arrived();
      return new Promise<Response>(() => {});
    });
    const { server, url } = await listen(app);
    const pool = createPool(inject('databaseUrl'), 1000, 1);
    await pool.query('select 1');
    const steps: string[] = [];
    onShutdown(async () => {
      steps.push(pool.ended ? 'final task after pool' : 'final task before pool');
    });

    const hung = fetch(`${url}/hang`).then(
      () => 'answered',
      () => 'cut off',
    );
    await requestArrived;
    const startedAt = performance.now();
    await shutdown({ server, pool, readiness: { draining: false }, drainMs: 0, timeoutMs: 200 });

    expect(performance.now() - startedAt).toBeGreaterThanOrEqual(190);
    expect(await hung).toBe('cut off');
    expect(steps).toEqual(['final task after pool']);
    expect(server.listening).toBe(false);
  });

  it('stops at once when no request is in flight', async () => {
    const app = new Hono().get('/', (c) => c.text('ok'));
    const { server, url } = await listen(app);
    expect((await fetch(url)).status).toBe(200);
    const pool = createPool(inject('databaseUrl'), 1000, 1);

    const startedAt = performance.now();
    await shutdown({ server, pool, readiness: { draining: false }, drainMs: 0, timeoutMs: 10_000 });
    expect(performance.now() - startedAt).toBeLessThan(2_000);
  });
});
