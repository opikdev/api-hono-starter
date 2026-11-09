import { serve } from '@hono/node-server';
import { createApp } from './app.ts';
import { loadConfig } from './config.ts';
import { createDb, createPool } from './db/client.ts';
import { deleteExpiredRows } from './platform/cleanup.ts';
import { createLogger } from './platform/logger.ts';
import { shutdown } from './platform/shutdown.ts';

const cleanupIntervalMs = 60 * 60 * 1000;
const drainMs = 5_000;
const shutdownDeadlineMs = 9_000;

const config = loadConfig();
const logger = createLogger(config.LOG_LEVEL);
const pool = createPool(
  config.DATABASE_URL,
  config.DATABASE_STATEMENT_TIMEOUT_MS,
  config.DATABASE_POOL_MAX,
);
pool.on('error', (err) => logger.error({ err }, 'Idle database connection failed'));
const db = createDb(pool);
const app = createApp({ config, db, logger });

const server = serve({ fetch: app.fetch, port: config.PORT }, ({ port }) => {
  logger.info({ port }, 'Server listening');
});

const cleanup = setInterval(() => {
  deleteExpiredRows(db).catch((err) => logger.error({ err }, 'Cleanup failed'));
}, cleanupIntervalMs);
cleanup.unref();

let stopping = false;

function stop(signal: NodeJS.Signals) {
  if (stopping) return;
  stopping = true;
  logger.info({ signal }, 'Shutting down');
  clearInterval(cleanup);
  setTimeout(() => {
    logger.error({ deadlineMs: shutdownDeadlineMs }, 'Shutdown timed out');
    process.exit(1);
  }, shutdownDeadlineMs).unref();
  shutdown({ server, pool, drainMs }).then(
    () => process.exit(0),
    (err: unknown) => {
      logger.error({ err }, 'Shutdown failed');
      process.exit(1);
    },
  );
}

process.once('SIGTERM', stop);
process.once('SIGINT', stop);
