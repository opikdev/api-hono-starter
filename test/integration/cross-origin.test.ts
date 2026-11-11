import { describe, expect, it } from 'vitest';
import { call, expectProblem, password, signUp, testApp } from '../helpers.ts';

const trusted = 'https://app.example';
const app = testApp({ CORS_ORIGINS: trusted });

const crossSite = { Origin: 'https://evil.example', 'Sec-Fetch-Site': 'cross-site' };

describe('cross-origin protection', () => {
  it.each([
    ['GET from another site', 'GET', crossSite],
    ['HEAD from another site', 'HEAD', crossSite],
    ['OPTIONS from another site', 'OPTIONS', crossSite],
    ['a trusted origin', 'POST', { Origin: trusted, 'Sec-Fetch-Site': 'cross-site' }],
    ['Sec-Fetch-Site: same-origin', 'POST', { ...crossSite, 'Sec-Fetch-Site': 'same-origin' }],
    ['Sec-Fetch-Site: none', 'POST', { 'Sec-Fetch-Site': 'none' }],
    ['a client that sends neither header', 'POST', {}],
    ['an Origin that matches Host', 'POST', { Origin: 'https://api.example', Host: 'api.example' }],
    [
      'an Origin that matches Host and port',
      'DELETE',
      { Origin: 'http://localhost:3000', Host: 'localhost:3000' },
    ],
  ])('allows %s', async (_label, method, headers) => {
    const response = await call(app, method, '/v1/notes', { headers });
    expect(response.status).not.toBe(403);
  });

  it.each([
    ['Sec-Fetch-Site: cross-site', 'POST', crossSite],
    ['Sec-Fetch-Site: same-site', 'PATCH', { 'Sec-Fetch-Site': 'same-site' }],
    ['Sec-Fetch-Site: cross-site without Origin', 'DELETE', { 'Sec-Fetch-Site': 'cross-site' }],
    [
      'an Origin that differs from Host',
      'POST',
      { Origin: 'https://evil.example', Host: 'api.example' },
    ],
    [
      'an Origin on another port',
      'PUT',
      { Origin: 'http://localhost:4000', Host: 'localhost:3000' },
    ],
    ['an opaque Origin', 'POST', { Origin: 'null', Host: 'api.example' }],
    ['an Origin without a Host', 'POST', { Origin: 'https://api.example' }],
  ])('blocks %s', async (_label, method, headers) => {
    const response = await call(app, method, '/v1/notes', { headers });
    const problem = await expectProblem(response, 403, 'forbidden');
    expect(problem.detail).toBe(
      'Cross-origin requests that change data are blocked. Send the request from the same origin, or add the origin to CORS_ORIGINS.',
    );
  });

  it('blocks a cross-site login', async () => {
    const { email } = await signUp(app);
    const response = await call(app, 'POST', '/v1/sessions', {
      body: { email, password, delivery: 'cookie' },
      headers: crossSite,
    });
    await expectProblem(response, 403, 'forbidden');
    expect(response.headers.get('set-cookie')).toBeNull();
  });

  it('blocks a cross-site write that carries the session cookie', async () => {
    const { email } = await signUp(app);
    const login = await call(app, 'POST', '/v1/sessions', {
      body: { email, password, delivery: 'cookie' },
      headers: { 'Sec-Fetch-Site': 'same-origin' },
    });
    const cookie = login.headers.get('set-cookie')?.split(';')[0] as string;
    const headers = { Cookie: cookie };

    const forged = await call(app, 'POST', '/v1/notes', {
      body: { title: 'Forged' },
      headers: { ...headers, ...crossSite },
    });
    await expectProblem(forged, 403, 'forbidden');

    const sameOrigin = await call(app, 'POST', '/v1/notes', {
      body: { title: 'Mine' },
      headers: { ...headers, 'Sec-Fetch-Site': 'same-origin' },
    });
    expect(sameOrigin.status).toBe(201);

    const list = await call(app, 'GET', '/v1/notes', { headers });
    const page = (await list.json()) as { data: { title: string }[] };
    expect(page.data.map((note) => note.title)).toEqual(['Mine']);
  });
});
