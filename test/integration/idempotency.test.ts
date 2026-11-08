import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { notes } from '../../src/db/schema.ts';
import { fromPublicId } from '../../src/platform/public-id.ts';
import { call, db, expectProblem, signUp, testApp } from '../helpers.ts';

const app = testApp();

function post(token: string, key: string | undefined, title = 'Once') {
  return call(app, 'POST', '/v1/notes', {
    token,
    body: { title },
    ...(key ? { headers: { 'Idempotency-Key': key } } : {}),
  });
}

async function noteCount(userId: string) {
  const uuid = fromPublicId('usr', userId) as string;
  const rows = await db.select().from(notes).where(eq(notes.userId, uuid));
  return rows.length;
}

describe('idempotent creation', () => {
  it('returns the original note on replay', async () => {
    const { token, userId } = await signUp(app);
    const first = await post(token, 'key-1');
    const replay = await post(token, 'key-1');
    expect(replay.status).toBe(201);
    expect(replay.headers.get('idempotency-replayed')).toBe('true');
    expect(first.headers.get('idempotency-replayed')).toBeNull();
    expect(replay.headers.get('etag')).toBe(first.headers.get('etag'));
    expect(await replay.json()).toEqual(await first.json());
    expect(await noteCount(userId)).toBe(1);
  });

  it('creates one note from concurrent requests', async () => {
    const { token, userId } = await signUp(app);
    const responses = await Promise.all(Array.from({ length: 5 }, () => post(token, 'race')));
    const bodies = (await Promise.all(responses.map((r) => r.json()))) as { id: string }[];
    expect(new Set(bodies.map((body) => body.id)).size).toBe(1);
    expect(responses.every((response) => response.status === 201)).toBe(true);
    expect(await noteCount(userId)).toBe(1);
  });

  it('rejects a reused key with a different body', async () => {
    const { token, userId } = await signUp(app);
    await post(token, 'key-2', 'First');
    await expectProblem(await post(token, 'key-2', 'Second'), 422, 'idempotency-key-reused');
    expect(await noteCount(userId)).toBe(1);
  });

  it('keeps keys separate per user', async () => {
    const first = await signUp(app);
    const second = await signUp(app);
    const one = await post(first.token, 'shared');
    const two = await post(second.token, 'shared');
    const [a, b] = (await Promise.all([one.json(), two.json()])) as { id: string }[];
    expect(a?.id).not.toBe(b?.id);
  });

  it("never replays another user's note", async () => {
    const first = await signUp(app);
    const second = await signUp(app);
    const original = (await (await post(first.token, 'shared-replay')).json()) as { id: string };
    const other = (await (await post(second.token, 'shared-replay')).json()) as { id: string };

    const firstReplay = await post(first.token, 'shared-replay');
    const secondReplay = await post(second.token, 'shared-replay');
    expect(firstReplay.headers.get('idempotency-replayed')).toBe('true');
    expect(secondReplay.headers.get('idempotency-replayed')).toBe('true');
    expect(await firstReplay.json()).toMatchObject({ id: original.id });
    expect(await secondReplay.json()).toMatchObject({ id: other.id });
  });

  it('creates a new note each time without a key', async () => {
    const { token, userId } = await signUp(app);
    await post(token, undefined);
    await post(token, undefined);
    expect(await noteCount(userId)).toBe(2);
  });

  it('leaves no key behind when validation fails', async () => {
    const { token } = await signUp(app);
    const invalid = await call(app, 'POST', '/v1/notes', {
      token,
      body: {},
      headers: { 'Idempotency-Key': 'key-3' },
    });
    expect(invalid.status).toBe(400);
    expect((await post(token, 'key-3')).status).toBe(201);
  });
});
