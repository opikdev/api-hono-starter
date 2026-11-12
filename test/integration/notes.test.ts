import { describe, expect, it } from 'vitest';
import { call, expectProblem, signUp, testApp } from '../helpers.ts';

const app = testApp();

interface Note {
  id: string;
  title: string;
  body: string;
  version: number;
}

async function createNote(token: string, title = 'A note') {
  const response = await call(app, 'POST', '/v1/notes', { token, body: { title } });
  return (await response.json()) as Note;
}

const missingId = 'note_00000000000070008000000000000000';

describe('creating notes', () => {
  it('returns the note with ETag and Location', async () => {
    const { token } = await signUp(app);
    const response = await call(app, 'POST', '/v1/notes', {
      token,
      body: { title: 'Hello', body: 'World' },
    });
    expect(response.status).toBe(201);
    const note = (await response.json()) as Note;
    expect(note).toMatchObject({ title: 'Hello', body: 'World', version: 1 });
    expect(note.id).toMatch(/^note_[0-9a-f]{32}$/);
    expect(response.headers.get('etag')).toBe('"1"');
    expect(response.headers.get('location')).toBe(`/v1/notes/${note.id}`);
  });

  it('requires authentication', async () => {
    const response = await call(app, 'POST', '/v1/notes', { body: { title: 'x' } });
    await expectProblem(response, 401, 'unauthorized');
  });

  it.each([
    ['an empty title', { title: '   ' }],
    ['a long title', { title: 'x'.repeat(201) }],
    ['a long body', { title: 'x', body: 'y'.repeat(10_001) }],
    ['a missing title', { body: 'y' }],
    ['an unknown field', { title: 'x', ownerId: 'usr_1' }],
    ['a NUL character in the title', { title: 'a\u0000b' }],
    ['a NUL character in the body', { title: 'x', body: 'a\u0000b' }],
  ])('rejects %s', async (_label, body) => {
    const { token } = await signUp(app);
    const response = await call(app, 'POST', '/v1/notes', { token, body });
    await expectProblem(response, 400, 'validation-failed');
  });

  it('accepts titles at the limit', async () => {
    const { token } = await signUp(app);
    const response = await call(app, 'POST', '/v1/notes', {
      token,
      body: { title: 'x'.repeat(200), body: 'y'.repeat(10_000) },
    });
    expect(response.status).toBe(201);
  });
});

describe('listing notes', () => {
  it('pages through every note exactly once, newest first', async () => {
    const { token } = await signUp(app);
    const created: string[] = [];
    for (let index = 0; index < 5; index += 1) {
      created.push((await createNote(token, `Note ${index}`)).id);
    }

    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const query: string = cursor ? `?limit=2&cursor=${cursor}` : '?limit=2';
      const response: Response = await call(app, 'GET', `/v1/notes${query}`, { token });
      const page = (await response.json()) as {
        data: Note[];
        meta: { nextCursor: string | null; limit: number };
      };
      expect(page.meta.limit).toBe(2);
      seen.push(...page.data.map((note) => note.id));
      cursor = page.meta.nextCursor;
    } while (cursor);

    expect(seen).toEqual(created.reverse());
  });

  it('has no next page when the results fit exactly', async () => {
    const { token } = await signUp(app);
    await createNote(token);
    await createNote(token);
    const response = await call(app, 'GET', '/v1/notes?limit=2', { token });
    expect(await response.json()).toMatchObject({ meta: { nextCursor: null } });
  });

  it('defaults to 20', async () => {
    const { token } = await signUp(app);
    const response = await call(app, 'GET', '/v1/notes', { token });
    expect(await response.json()).toEqual({ data: [], meta: { limit: 20, nextCursor: null } });
  });

  it.each(['limit=101', 'limit=0', 'limit=abc', 'cursor=bad'])('rejects %s', async (query) => {
    const { token } = await signUp(app);
    const response = await call(app, 'GET', `/v1/notes?${query}`, { token });
    await expectProblem(response, 400, 'validation-failed');
  });

  it('accepts the maximum limit', async () => {
    const { token } = await signUp(app);
    const response = await call(app, 'GET', '/v1/notes?limit=100', { token });
    expect(response.status).toBe(200);
  });
});

describe('ownership', () => {
  it("never reveals or changes another user's note", async () => {
    const owner = await signUp(app);
    const intruder = await signUp(app);
    const note = await createNote(owner.token);
    const path = `/v1/notes/${note.id}`;

    await expectProblem(await call(app, 'GET', path, { token: intruder.token }), 404, 'not-found');
    await expectProblem(
      await call(app, 'PATCH', path, {
        token: intruder.token,
        body: { title: 'Hacked' },
        headers: { 'If-Match': '"1"' },
      }),
      404,
      'not-found',
    );
    await expectProblem(
      await call(app, 'DELETE', path, { token: intruder.token }),
      404,
      'not-found',
    );

    const list = await call(app, 'GET', '/v1/notes', { token: intruder.token });
    expect(((await list.json()) as { data: Note[] }).data).toEqual([]);
    const unchanged = await call(app, 'GET', path, { token: owner.token });
    expect(await unchanged.json()).toMatchObject({ title: 'A note', version: 1 });
  });
});

describe('reading a note', () => {
  it('returns it with an ETag', async () => {
    const { token } = await signUp(app);
    const note = await createNote(token);
    const response = await call(app, 'GET', `/v1/notes/${note.id}`, { token });
    expect(response.status).toBe(200);
    expect(response.headers.get('etag')).toBe('"1"');
  });

  it.each([
    ['an unknown id', missingId],
    ['a malformed id', 'nope'],
    ['an id of another type', 'usr_00000000000070008000000000000000'],
  ])('returns 404 for %s', async (_label, id) => {
    const { token } = await signUp(app);
    const response = await call(app, 'GET', `/v1/notes/${id}`, { token });
    await expectProblem(response, 404, 'not-found');
  });
});

describe('updating a note', () => {
  it('updates only the given fields and bumps the version', async () => {
    const { token } = await signUp(app);
    const response0 = await call(app, 'POST', '/v1/notes', {
      token,
      body: { title: 'Old', body: 'Keep me' },
    });
    const note = (await response0.json()) as Note;
    const response = await call(app, 'PATCH', `/v1/notes/${note.id}`, {
      token,
      body: { title: 'New' },
      headers: { 'If-Match': '"1"' },
    });
    expect(response.status).toBe(200);
    expect(response.headers.get('etag')).toBe('"2"');
    expect(await response.json()).toMatchObject({ title: 'New', body: 'Keep me', version: 2 });
  });

  it('allows an empty body', async () => {
    const { token } = await signUp(app);
    const note = await createNote(token);
    const response = await call(app, 'PATCH', `/v1/notes/${note.id}`, {
      token,
      body: { body: '' },
      headers: { 'If-Match': '"1"' },
    });
    expect(response.status).toBe(200);
  });

  it('requires If-Match', async () => {
    const { token } = await signUp(app);
    const note = await createNote(token);
    const response = await call(app, 'PATCH', `/v1/notes/${note.id}`, {
      token,
      body: { title: 'New' },
    });
    await expectProblem(response, 428, 'precondition-required');
  });

  it.each(['"9"', 'nonsense', '*', '"99999999999999999999"'])(
    'rejects If-Match %s',
    async (ifMatch) => {
      const { token } = await signUp(app);
      const note = await createNote(token);
      const response = await call(app, 'PATCH', `/v1/notes/${note.id}`, {
        token,
        body: { title: 'New' },
        headers: { 'If-Match': ifMatch },
      });
      await expectProblem(response, 412, 'version-mismatch');
    },
  );

  it('lets only one of two concurrent updates win', async () => {
    const { token } = await signUp(app);
    const note = await createNote(token);
    const update = (title: string) =>
      call(app, 'PATCH', `/v1/notes/${note.id}`, {
        token,
        body: { title },
        headers: { 'If-Match': '"1"' },
      });
    const statuses = (await Promise.all([update('A'), update('B')])).map((r) => r.status);
    expect(statuses.sort()).toEqual([200, 412]);
  });

  it('rejects an empty patch', async () => {
    const { token } = await signUp(app);
    const note = await createNote(token);
    const response = await call(app, 'PATCH', `/v1/notes/${note.id}`, {
      token,
      body: {},
      headers: { 'If-Match': '"1"' },
    });
    const problem = await expectProblem(response, 400, 'validation-failed');
    expect(problem.errors).toEqual([{ field: '', detail: 'Provide title, body, or both' }]);
  });

  it.each([
    ['an unknown id', missingId],
    ['a malformed id', 'nope'],
  ])('returns 404 for %s', async (_label, id) => {
    const { token } = await signUp(app);
    const response = await call(app, 'PATCH', `/v1/notes/${id}`, {
      token,
      body: { title: 'New' },
      headers: { 'If-Match': '"1"' },
    });
    await expectProblem(response, 404, 'not-found');
  });
});

describe('deleting a note', () => {
  it('removes it', async () => {
    const { token } = await signUp(app);
    const note = await createNote(token);
    const path = `/v1/notes/${note.id}`;
    expect((await call(app, 'DELETE', path, { token })).status).toBe(204);
    await expectProblem(await call(app, 'GET', path, { token }), 404, 'not-found');
    await expectProblem(await call(app, 'DELETE', path, { token }), 404, 'not-found');
  });
});
