import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';

const connectionString = process.env.MIGRATION_DATABASE_URL;
if (!connectionString) {
  throw new Error('MIGRATION_DATABASE_URL is required to run migrations');
}

const pool = new pg.Pool({ connectionString, max: 1 });
try {
  await migrate(drizzle({ client: pool }), { migrationsFolder: 'migrations' });
  console.log('Migrations applied');
} finally {
  await pool.end();
}
