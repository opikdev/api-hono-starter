import { serve } from '@hono/node-server';
import { createApp } from './app.ts';
import { loadConfig } from './config.ts';
import { createDb, createPool } from './db/client.ts';
import { deleteExpiredRows } from './platform/cleanup.ts';
import { createLogger } from './platform/logger.ts';

const cleanupIntervalMs = 60 * 60 * 1000;

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

function shutdown(signal: string) {
  logger.info({ signal }, 'Shutting down');
  clearInterval(cleanup);
  server.close(() => {
    pool.end().finally(() => process.exit(0));
  });
}

process.once('SIGTERM', () => shutdown('SIGTERM'));
process.once('SIGINT', () => shutdown('SIGINT'));
