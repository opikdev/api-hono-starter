import { writeFileSync } from 'node:fs';
import { createApp } from '../src/app.ts';
import { loadConfig } from '../src/config.ts';
import { createDb, createPool } from '../src/db/client.ts';
import { createLogger } from '../src/platform/logger.ts';

const databaseUrl = 'postgres://unused@127.0.0.1/unused';
const config = loadConfig({ DATABASE_URL: databaseUrl, LOG_LEVEL: 'silent', DOCS_ENABLED: 'true' });
const pool = createPool(databaseUrl, 1000);
const app = createApp({ config, db: createDb(pool), logger: createLogger('silent') });

const response = await app.request('/openapi.json');
writeFileSync('openapi.json', `${JSON.stringify(await response.json(), null, 2)}\n`);
await pool.end();
