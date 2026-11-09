import type { ServerType } from '@hono/node-server';

type Task = () => Promise<void>;

const finalTasks: Task[] = [];

/** Registers a task, such as flushing traces, to run after the server and database close. */
export function onShutdown(task: Task): void {
  finalTasks.push(task);
}

function closeServer(server: ServerType, drainMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const forceClose = setTimeout(() => {
      if ('closeAllConnections' in server) server.closeAllConnections();
    }, drainMs);
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
  drainMs: number;
}

export async function shutdown({ server, pool, drainMs }: ShutdownOptions): Promise<void> {
  await closeServer(server, drainMs);
  await pool.end();
  for (const task of finalTasks) await task();
}
