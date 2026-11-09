import type { AddressInfo } from 'node:net';
import { type ServerType, serve } from '@hono/node-server';
import { Hono } from 'hono';
import { describe, expect, inject, it } from 'vitest';
import { createPool } from '../../src/db/client.ts';
import { onShutdown, shutdown } from '../../src/platform/shutdown.ts';

function listen(app: Hono): Promise<{ server: ServerType; url: string }> {
  return new Promise((resolve) => {
    const server = serve({ fetch: app.fetch, port: 0, hostname: '127.0.0.1' }, (info) => {
      resolve({ server, url: `http://127.0.0.1:${(info as AddressInfo).port}` });
    });
  });
}

describe('shutdown', () => {
  it('cuts off a hung request at the deadline, then closes the pool, then runs final tasks', async () => {
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
    await shutdown({ server, pool, drainMs: 200 });

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
    await shutdown({ server, pool, drainMs: 10_000 });
    expect(performance.now() - startedAt).toBeLessThan(2_000);
  });
});
