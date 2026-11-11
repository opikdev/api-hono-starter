import type { Context } from 'hono';
import { deleteCookie, generateCookie, getCookie, setCookie } from 'hono/cookie';

const name = 'session';

const options = {
  prefix: 'host',
  path: '/',
  httpOnly: true,
  secure: true,
  sameSite: 'Strict',
} as const;

export const clearedSessionCookie = generateCookie(name, '', { ...options, maxAge: 0 });

export function readSessionCookie(c: Context): string | undefined {
  return getCookie(c, name, 'host');
}

export function setSessionCookie(c: Context, token: string, maxAgeSeconds: number) {
  setCookie(c, name, token, { ...options, maxAge: maxAgeSeconds });
}

export function clearSessionCookie(c: Context) {
  deleteCookie(c, name, options);
}
