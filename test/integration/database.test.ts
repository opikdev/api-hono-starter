import { sql } from 'drizzle-orm';
import { afterAll, describe, expect, inject, it } from 'vitest';
import { createDb, createPool } from '../../src/db/client.ts';
import { idempotencyKeys, notes, rateLimits, sessions, users } from '../../src/db/schema.ts';
import { deleteExpiredRows } from '../../src/platform/cleanup.ts';
import { fromPublicId } from '../../src/platform/public-id.ts';
import { db, signUp, testApp, uniqueIp } from '../helpers.ts';

const ownerPool = createPool(inject('ownerDatabaseUrl'), 5000);
const owner = createDb(ownerPool);

afterAll(async () => {
  await ownerPool.end();
});

const app = testApp();

describe('database roles', () => {
  it.each([
    ['DROP', sql`drop table notes`],
    ['TRUNCATE', sql`truncate notes`],
    ['ALTER', sql`alter table notes add column hacked text`],
    ['CREATE', sql`create table hacked (id int)`],
  ])('stops the app role from running %s', async (_label, statement) => {
    await expect(db.execute(statement)).rejects.toThrow();
  });

  it('lets the app role read and write', async () => {
    const { token } = await signUp(app);
    expect(token).toBeTruthy();
  });
});

describe('constraints', () => {
  it.each([
    ['an uppercase email', sql`insert into users (email, password_hash) values ('A@B.C', 'x')`],
  ])('rejects %s in the database', async (_label, statement) => {
    await expect(db.execute(statement)).rejects.toThrow();
  });

  it('rejects an orphaned note', async () => {
    await expect(
      db.insert(notes).values({ userId: '00000000-0000-7000-8000-000000000000', title: 'x' }),
    ).rejects.toThrow();
  });

  it('rejects an invalid note even if the API were bypassed', async () => {
    const { userId } = await signUp(app);
    const id = fromPublicId('usr', userId) as string;
    await expect(db.insert(notes).values({ userId: id, title: '' })).rejects.toThrow();
    await expect(
      db.insert(notes).values({ userId: id, title: 'x', body: 'y'.repeat(10_001) }),
    ).rejects.toThrow();
  });

  it('removes a user’s data with the user', async () => {
    const { token, userId } = await signUp(app);
    await testApp().request('/v1/notes', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'X-Forwarded-For': uniqueIp(),
      },
      body: JSON.stringify({ title: 'Mine' }),
    });
    const id = fromPublicId('usr', userId) as string;
    await db.delete(users).where(sql`${users.id} = ${id}`);
    const remaining = await db.select().from(notes).where(sql`${notes.userId} = ${id}`);
    const liveSessions = await db.select().from(sessions).where(sql`${sessions.userId} = ${id}`);
    expect(remaining).toEqual([]);
    expect(liveSessions).toEqual([]);
  });
});

describe('connection pool', () => {
  it('opens no more connections than its max', async () => {
    const pool = createPool(inject('databaseUrl'), 5000, 1);
    const queries = [pool.query('select pg_sleep(0.05)'), pool.query('select 1')];
    expect(pool.waitingCount).toBe(1);
    await Promise.all(queries);
    expect(pool.totalCount).toBe(1);
    await pool.end();
  });
});

describe('expired row cleanup', () => {
  it('removes expired rows and keeps live ones', async () => {
    const expired = await signUp(app);
    const live = await signUp(app);
    const expiredId = fromPublicId('usr', expired.userId) as string;
    const liveId = fromPublicId('usr', live.userId) as string;
    const past = new Date(Date.now() - 1000);
    const future = new Date(Date.now() + 60_000);

    await db
      .update(sessions)
      .set({ expiresAt: past })
      .where(sql`${sessions.userId} = ${expiredId}`);
    await db.insert(idempotencyKeys).values([
      {
        userId: expiredId,
        key: 'old',
        requestHash: 'x',

        responseBody: {},
        expiresAt: past,
      },
      {
        userId: liveId,
        key: 'new',
        requestHash: 'x',

        responseBody: {},
        expiresAt: future,
      },
    ]);
    await db.insert(rateLimits).values([
      { key: 'cleanup:old', resetAt: past },
      { key: 'cleanup:new', resetAt: future },
    ]);

    await deleteExpiredRows(db);

    const keys = await db.select({ key: idempotencyKeys.key }).from(idempotencyKeys);
    const limits = await db.select({ key: rateLimits.key }).from(rateLimits);
    const sessionUsers = await db.select({ userId: sessions.userId }).from(sessions);
    expect(keys.map((row) => row.key)).toContain('new');
    expect(keys.map((row) => row.key)).not.toContain('old');
    expect(limits.map((row) => row.key)).toContain('cleanup:new');
    expect(limits.map((row) => row.key)).not.toContain('cleanup:old');
    expect(sessionUsers.map((row) => row.userId)).toContain(liveId);
    expect(sessionUsers.map((row) => row.userId)).not.toContain(expiredId);
  });
});

describe('migrations', () => {
  it('names every constraint with the agreed prefixes', async () => {
    const { rows } = await owner.execute<{ conname: string }>(
      sql`select conname from pg_constraint where connamespace = 'public'::regnamespace and contype in ('p', 'u', 'f', 'c')`,
    );
    const names = rows.map((row) => row.conname);
    expect(names.length).toBeGreaterThan(10);
    expect(names.filter((name) => !/^(pk|uq|fk|chk)_/.test(name))).toEqual([]);
  });

  it('gives every table an id and timestamps', async () => {
    const { rows } = await owner.execute<{ table_name: string; column_name: string }>(
      sql`select c.table_name, c.column_name from information_schema.columns c join information_schema.tables t using (table_schema, table_name) where c.table_schema = 'public' and t.table_type = 'BASE TABLE' and c.column_name in ('id', 'created_at', 'updated_at')`,
    );
    const { rows: tables } = await owner.execute<{ table_name: string }>(
      sql`select table_name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE'`,
    );
    const columns = Object.groupBy(rows, (row) => row.table_name);
    const names = tables.map((table) => table.table_name);
    expect(names).toEqual(
      expect.arrayContaining(['idempotency_keys', 'notes', 'rate_limits', 'sessions', 'users']),
    );
    for (const name of names) expect(columns[name], name).toHaveLength(3);
  });
});
