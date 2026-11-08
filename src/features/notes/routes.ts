import { createRoute, z } from '@hono/zod-openapi';
import type { Db } from '../../db/client.ts';
import { withIdempotency } from '../../platform/idempotency.ts';
import { ProblemError, problemResponses } from '../../platform/problem.ts';
import { fromPublicId, toPublicId } from '../../platform/public-id.ts';
import {
  bearerSecurity,
  etag,
  hasNoNul,
  idempotencyHeaders,
  idParams,
  ifMatchHeaders,
  jsonContent,
  listQuery,
  nulMessage,
  pageSchema,
  parseCursor,
  parseIfMatch,
  toPage,
} from '../../platform/resource.ts';
import { createRouter } from '../../platform/router.ts';
import type { RequireAuth } from '../auth/middleware.ts';
import {
  deleteNote,
  findNote,
  insertNote,
  listNotes,
  type NotePatch,
  type NoteRow,
  updateNote,
} from './store.ts';

const title = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .refine(hasNoNul, nulMessage)
  .openapi({ example: 'Launch checklist' });
const body = z
  .string()
  .max(10_000)
  .refine(hasNoNul, nulMessage)
  .openapi({ example: 'Ship the API.' });

const noteSchema = z
  .object({
    id: z.string().openapi({ example: 'note_0190a7e4c1f07c3e8d21b6f4a9e05d13' }),
    title: z.string().openapi({ example: 'Launch checklist' }),
    body: z.string().openapi({ example: 'Ship the API.' }),
    version: z.number().int().openapi({ example: 1 }),
    createdAt: z.iso.datetime().openapi({ example: '2026-11-07T15:20:30.000Z' }),
    updatedAt: z.iso.datetime().openapi({ example: '2026-11-07T15:20:30.000Z' }),
  })
  .openapi('Note');

const createNoteSchema = z.strictObject({ title, body: body.default('') }).openapi('CreateNote');

const updateNoteSchema = z
  .strictObject({ title: title.optional(), body: body.optional() })
  .refine((patch) => Object.keys(patch).length > 0, { message: 'Provide title, body, or both' })
  .openapi('UpdateNote');

const noteListSchema = pageSchema(noteSchema, 'NoteList');

function presentNote(note: NoteRow) {
  return {
    id: toPublicId('note', note.id),
    title: note.title,
    body: note.body,
    version: note.version,
    createdAt: note.createdAt.toISOString(),
    updatedAt: note.updatedAt.toISOString(),
  };
}

function notFound(publicId: string): ProblemError {
  return new ProblemError('not-found', `Note ${publicId} does not exist.`);
}

interface NotesRouterOptions {
  db: Db;
  requireAuth: RequireAuth;
}

export function createNotesRouter({ db, requireAuth }: NotesRouterOptions) {
  return createRouter()
    .openapi(
      createRoute({
        method: 'post',
        path: '/notes',
        operationId: 'createNote',
        summary: 'Create a note',
        tags: ['Notes'],
        security: bearerSecurity,
        middleware: [requireAuth],
        request: {
          headers: idempotencyHeaders,
          body: { ...jsonContent(createNoteSchema), required: true },
        },
        responses: {
          201: { description: 'Note created', ...jsonContent(noteSchema) },
          ...problemResponses(
            'validation-failed',
            'unauthorized',
            'idempotency-key-reused',
            'unsupported-media-type',
            'rate-limited',
          ),
        },
      }),
      async (c) => {
        const input = c.req.valid('json');
        const userId = c.get('user').id;
        const { body: note, replayed } = await withIdempotency(
          db,
          { userId, key: c.req.valid('header')['idempotency-key'], payload: input },
          async (tx) => presentNote(await insertNote(tx, userId, input)),
        );

        if (replayed) c.header('Idempotency-Replayed', 'true');
        c.header('ETag', etag(note.version));
        c.header('Location', `/v1/notes/${note.id}`);
        return c.json(note, 201);
      },
    )
    .openapi(
      createRoute({
        method: 'get',
        path: '/notes',
        operationId: 'listNotes',
        summary: 'List your notes, newest first',
        tags: ['Notes'],
        security: bearerSecurity,
        middleware: [requireAuth],
        request: { query: listQuery },
        responses: {
          200: { description: 'A page of notes', ...jsonContent(noteListSchema) },
          ...problemResponses('validation-failed', 'unauthorized', 'rate-limited'),
        },
      }),
      async (c) => {
        const { limit, cursor } = c.req.valid('query');
        const after = parseCursor('note', cursor);
        const rows = await listNotes(db, c.get('user').id, limit + 1, after);
        return c.json(toPage(rows, limit, presentNote), 200);
      },
    )
    .openapi(
      createRoute({
        method: 'get',
        path: '/notes/{id}',
        operationId: 'getNote',
        summary: 'Get a note',
        tags: ['Notes'],
        security: bearerSecurity,
        middleware: [requireAuth],
        request: { params: idParams },
        responses: {
          200: { description: 'The note', ...jsonContent(noteSchema) },
          ...problemResponses('unauthorized', 'not-found', 'rate-limited'),
        },
      }),
      async (c) => {
        const { id } = c.req.valid('param');
        const noteId = fromPublicId('note', id);
        const note = noteId ? await findNote(db, c.get('user').id, noteId) : null;
        if (!note) throw notFound(id);

        c.header('ETag', etag(note.version));
        return c.json(presentNote(note), 200);
      },
    )
    .openapi(
      createRoute({
        method: 'patch',
        path: '/notes/{id}',
        operationId: 'updateNote',
        summary: 'Update a note',
        tags: ['Notes'],
        security: bearerSecurity,
        middleware: [requireAuth],
        request: {
          params: idParams,
          headers: ifMatchHeaders,
          body: { ...jsonContent(updateNoteSchema), required: true },
        },
        responses: {
          200: { description: 'The updated note', ...jsonContent(noteSchema) },
          ...problemResponses(
            'validation-failed',
            'unauthorized',
            'not-found',
            'version-mismatch',
            'precondition-required',
            'unsupported-media-type',
            'rate-limited',
          ),
        },
      }),
      async (c) => {
        const { id } = c.req.valid('param');
        const version = parseIfMatch(c.req.valid('header')['if-match']);
        const userId = c.get('user').id;
        const noteId = fromPublicId('note', id);
        if (!noteId) throw notFound(id);

        const patch: NotePatch = {};
        const { title: newTitle, body: newBody } = c.req.valid('json');
        if (newTitle !== undefined) patch.title = newTitle;
        if (newBody !== undefined) patch.body = newBody;

        const note = await updateNote(db, userId, noteId, version, patch);
        if (!note) {
          const current = await findNote(db, userId, noteId);
          if (!current) throw notFound(id);
          throw new ProblemError(
            'version-mismatch',
            `Note ${id} is at version ${current.version}. Fetch it again, then retry.`,
          );
        }

        c.header('ETag', etag(note.version));
        return c.json(presentNote(note), 200);
      },
    )
    .openapi(
      createRoute({
        method: 'delete',
        path: '/notes/{id}',
        operationId: 'deleteNote',
        summary: 'Delete a note',
        tags: ['Notes'],
        security: bearerSecurity,
        middleware: [requireAuth],
        request: { params: idParams },
        responses: {
          204: { description: 'Note deleted' },
          ...problemResponses('unauthorized', 'not-found', 'rate-limited'),
        },
      }),
      async (c) => {
        const { id } = c.req.valid('param');
        const noteId = fromPublicId('note', id);
        const deleted = noteId ? await deleteNote(db, c.get('user').id, noteId) : false;
        if (!deleted) throw notFound(id);
        return c.body(null, 204);
      },
    );
}
