import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

const defaultCost = { N: 2 ** 15, r: 8, p: 1 };
const keyLength = 32;

interface Cost {
  N: number;
  r: number;
  p: number;
}

function deriveKey(password: string, salt: Buffer, { N, r, p }: Cost): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, keyLength, { N, r, p, maxmem: 256 * N * r }, (error, key) => {
      if (error) reject(error);
      else resolve(key);
    });
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await deriveKey(password, salt, defaultCost);
  const { N, r, p } = defaultCost;
  return `scrypt$${N}$${r}$${p}$${salt.toString('base64url')}$${key.toString('base64url')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, N, r, p, salt, key] = stored.split('$');
  if (scheme !== 'scrypt' || !N || !r || !p || !salt || !key) {
    throw new Error('Stored password hash has an unknown format');
  }
  const cost = { N: Number(N), r: Number(r), p: Number(p) };
  const actual = await deriveKey(password, Buffer.from(salt, 'base64url'), cost);
  return timingSafeEqual(actual, Buffer.from(key, 'base64url'));
}
