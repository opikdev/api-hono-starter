import { setTimeout as sleep } from 'node:timers/promises';
import type { ServerType } from '@hono/node-server';

type Task = () => Promise<void>;

const finalTasks: Task[] = [];

/** Registers a task, such as flushing telemetry, to run after the server and database close. */
export function onShutdown(task: Task): void {
  finalTasks.push(task);
}

export interface Readiness {
  draining: boolean;
}

function closeServer(server: ServerType, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const forceClose = setTimeout(() => {
      if ('closeAllConnections' in server) server.closeAllConnections();
    }, timeoutMs);
    server.close((error) => {
      clearTimeout(forceClose);
      if (error) reject(error);
      else resolve();
    });
  });
}

interface ShutdownOptions {
  server: ServerType;
  pool: { end: () => Promise<void> };
  readiness: Readiness;
  drainMs: number;
  timeoutMs: number;
}

/**
 * Fails readiness and keeps serving for `drainMs`, so load balancers stop sending traffic. Then
 * stops accepting connections, gives requests in flight `timeoutMs`, and closes everything else.
 */
export async function shutdown({
  server,
  pool,
  readiness,
  drainMs,
  timeoutMs,
}: ShutdownOptions): Promise<void> {
  readiness.draining = true;
  await sleep(drainMs);
  await closeServer(server, timeoutMs);
  await pool.end();
  for (const task of finalTasks) await task();
}
