import { hc } from 'hono/client';
import { describe, expect, it } from 'vitest';
import type { AppType } from '../../src/app.ts';
import { signUp, testApp, uniqueIp } from '../helpers.ts';

const app = testApp();

function client(token?: string) {
  return hc<AppType>('http://localhost', {
    fetch: (input: string | URL | Request, init?: RequestInit) => app.request(input, init),
    headers: {
      'X-Forwarded-For': uniqueIp(),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
}

describe('typed RPC client', () => {
  it('creates, reads, and lists notes with inferred types', async () => {
    const { token } = await signUp(app);
    const api = client(token);

    const created = await api.v1.notes.$post({ header: {}, json: { title: 'Typed' } });
    expect(created.status).toBe(201);
    if (created.status !== 201) return;
    const note = await created.json();
    expect(note.title).toBe('Typed');

    const fetched = await api.v1.notes[':id'].$get({ param: { id: note.id } });
    if (fetched.status !== 200) throw new Error(`Expected 200, got ${fetched.status}`);
    expect((await fetched.json()).version).toBe(1);

    const list = await api.v1.notes.$get({ query: { limit: '5' } });
    if (list.status !== 200) throw new Error(`Expected 200, got ${list.status}`);
    const page = await list.json();
    expect(page.meta.limit).toBe(5);
    expect(page.data.map((item) => item.id)).toContain(note.id);
  });

  it('types the error responses too', async () => {
    const response = await client().v1.users.me.$get();
    expect(response.status).toBe(401);
    if (response.status === 401) {
      const problem = await response.json();
      expect(problem.type).toBe('urn:problem:unauthorized');
    }
  });

  it('rejects wrong input at compile time', () => {
    const api = client();
    // @ts-expect-error title is required
    void api.v1.notes.$post({ header: {}, json: {} });
    // @ts-expect-error unknown routes don't exist on the client
    void api.v1.nonexistent;
    expect(true).toBe(true);
  });
});
