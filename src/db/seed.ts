import { eq } from 'drizzle-orm';
import { hashPassword } from '../features/auth/password.ts';
import { createDb, createPool } from './client.ts';
import { notes, users } from './schema.ts';

const demoEmail = 'demo@example.com';
const demoPassword = 'demo-password-123';

if (process.env.NODE_ENV === 'production' && process.env.SEED_DEMO_DATA !== 'true') {
  throw new Error('Refusing to seed: NODE_ENV is production and SEED_DEMO_DATA is not true');
}

const connectionString = process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error('MIGRATION_DATABASE_URL or DATABASE_URL is required to seed');
}

const pool = createPool(connectionString, 30_000);
try {
  const db = createDb(pool);
  const [existing] = await db.select().from(users).where(eq(users.email, demoEmail));
  if (existing) {
    console.log(`Seed skipped: ${demoEmail} already exists`);
  } else {
    const passwordHash = await hashPassword(demoPassword);
    await db.transaction(async (tx) => {
      const [user] = await tx
        .insert(users)
        .values({ email: demoEmail, passwordHash })
        .returning({ id: users.id });
      if (!user) throw new Error('Seed failed: demo user was not created');
      await tx.insert(notes).values([
        { userId: user.id, title: 'Welcome', body: 'This is fake seed data.' },
        { userId: user.id, title: 'Try the API', body: 'See /docs for every endpoint.' },
      ]);
    });
    console.log(`Seeded ${demoEmail} with password ${demoPassword}`);
  }
} finally {
  await pool.end();
}
