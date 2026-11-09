import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import pg from 'pg';
import { describe, expect, inject, it } from 'vitest';

const run = promisify(execFile);

describe('migration runner', () => {
  it('gives up on a held lock instead of queueing behind it', async () => {
    const ownerUrl = inject('ownerDatabaseUrl');
    const blocker = new pg.Client({ connectionString: ownerUrl });
    await blocker.connect();
    try {
      await blocker.query('begin');
      await blocker.query('lock table drizzle.__drizzle_migrations in access exclusive mode');
      const migration = run('node', ['src/db/migrate.ts'], {
        env: { ...process.env, MIGRATION_DATABASE_URL: ownerUrl },
      });
      await expect(migration).rejects.toThrow(/lock timeout/);
    } finally {
      await blocker.query('rollback');
      await blocker.end();
    }
  });
});
