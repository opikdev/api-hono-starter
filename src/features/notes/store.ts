import { and, desc, eq, lt } from 'drizzle-orm';
import type { Db } from '../../db/client.ts';
import { notes } from '../../db/schema.ts';

type Writer = Pick<Db, 'insert'>;

export type NoteRow = typeof notes.$inferSelect;

export interface NoteInput {
  title: string;
  body: string;
}

export type NotePatch = Partial<NoteInput>;

export async function insertNote(db: Writer, userId: string, input: NoteInput) {
  const [note] = await db
    .insert(notes)
    .values({ userId, ...input })
    .returning();
  if (!note) throw new Error(`Note insert returned no row for user: ${userId}`);
  return note;
}

export async function findNote(db: Db, userId: string, noteId: string) {
  const [note] = await db
    .select()
    .from(notes)
    .where(and(eq(notes.id, noteId), eq(notes.userId, userId)));
  return note ?? null;
}

export function listNotes(db: Db, userId: string, limit: number, cursor: string | null) {
  return db
    .select()
    .from(notes)
    .where(and(eq(notes.userId, userId), cursor ? lt(notes.id, cursor) : undefined))
    .orderBy(desc(notes.id))
    .limit(limit);
}

export async function updateNote(
  db: Db,
  userId: string,
  noteId: string,
  version: number,
  patch: NotePatch,
) {
  const [note] = await db
    .update(notes)
    .set({ ...patch, version: version + 1 })
    .where(and(eq(notes.id, noteId), eq(notes.userId, userId), eq(notes.version, version)))
    .returning();
  return note ?? null;
}

export async function deleteNote(db: Db, userId: string, noteId: string) {
  const deleted = await db
    .delete(notes)
    .where(and(eq(notes.id, noteId), eq(notes.userId, userId)))
    .returning({ id: notes.id });
  return deleted.length > 0;
}
