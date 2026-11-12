import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';

const migrationLockKey = 72_616_394_211;

const connectionString = process.env.MIGRATION_DATABASE_URL;
if (!connectionString) {
  throw new Error('MIGRATION_DATABASE_URL is required to run migrations');
}

const client = new pg.Client({ connectionString, statement_timeout: 300_000 });
await client.connect();
try {
  await client.query('select pg_advisory_lock($1)', [migrationLockKey]);
  await client.query("set lock_timeout = '5s'");
  await migrate(drizzle({ client }), { migrationsFolder: 'migrations' });
  console.log('Migrations applied');
} finally {
  await client.end();
}
