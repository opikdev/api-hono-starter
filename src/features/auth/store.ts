import { createHash, randomBytes } from 'node:crypto';
import { and, eq, gt, sql } from 'drizzle-orm';
import type { Db } from '../../db/client.ts';
import { sessions, users } from '../../db/schema.ts';

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export async function createUser(db: Db, email: string, passwordHash: string) {
  const [user] = await db
    .insert(users)
    .values({ email, passwordHash })
    .onConflictDoNothing({ target: users.email })
    .returning();
  return user ?? null;
}

export async function findUserByEmail(db: Db, email: string) {
  const [user] = await db.select().from(users).where(eq(users.email, email));
  return user ?? null;
}

export async function createSession(db: Db, userId: string, ttlHours: number) {
  const token = randomBytes(32).toString('base64url');
  const [session] = await db
    .insert(sessions)
    .values({
      userId,
      tokenHash: hashToken(token),
      expiresAt: sql`now() + make_interval(hours => ${ttlHours}::int)`,
    })
    .returning({ expiresAt: sessions.expiresAt });
  if (!session) throw new Error(`Session insert returned no row for user: ${userId}`);
  return { token, expiresAt: session.expiresAt };
}

export async function findActiveSession(db: Db, token: string) {
  const [row] = await db
    .select({
      sessionId: sessions.id,
      id: users.id,
      email: users.email,
      createdAt: users.createdAt,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.tokenHash, hashToken(token)), gt(sessions.expiresAt, sql`now()`)));
  return row ?? null;
}

export async function deleteSession(db: Db, sessionId: string) {
  await db.delete(sessions).where(eq(sessions.id, sessionId));
}
