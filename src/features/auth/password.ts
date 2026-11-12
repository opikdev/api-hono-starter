import { argon2, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

const argon2Cost = { memory: 19_456, passes: 2, parallelism: 1 };
const tagLength = 32;
const argon2Prefix = `$argon2id$v=19$m=${argon2Cost.memory},t=${argon2Cost.passes},p=${argon2Cost.parallelism}$`;
const argon2Pattern =
  /^\$argon2id\$v=19\$m=(\d+),t=(\d+),p=(\d+)\$([A-Za-z0-9+/]+)\$([A-Za-z0-9+/]+)$/;

interface Argon2Cost {
  memory: number;
  passes: number;
  parallelism: number;
}

export interface Verification {
  valid: boolean;
  needsRehash: boolean;
}

function deriveArgon2(password: string, salt: Buffer, cost: Argon2Cost, length: number) {
  return new Promise<Buffer>((resolve, reject) => {
    argon2(
      'argon2id',
      { message: password, nonce: salt, tagLength: length, ...cost },
      (error, key) => (error ? reject(error) : resolve(key)),
    );
  });
}

function deriveScrypt(password: string, salt: Buffer, N: number, r: number, p: number) {
  return new Promise<Buffer>((resolve, reject) => {
    scrypt(password, salt, 32, { N, r, p, maxmem: 256 * N * r }, (error, key) =>
      error ? reject(error) : resolve(key),
    );
  });
}

const encode = (bytes: Buffer) => bytes.toString('base64').replace(/=+$/, '');

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await deriveArgon2(password, salt, argon2Cost, tagLength);
  return `${argon2Prefix}${encode(salt)}$${encode(key)}`;
}

async function verifyArgon2(password: string, match: RegExpExecArray): Promise<Verification> {
  const [, memory, passes, parallelism, salt, key] = match as unknown as string[];
  const expected = Buffer.from(key as string, 'base64');
  const cost = { memory: Number(memory), passes: Number(passes), parallelism: Number(parallelism) };
  const actual = await deriveArgon2(
    password,
    Buffer.from(salt as string, 'base64'),
    cost,
    expected.length,
  );
  const valid = timingSafeEqual(actual, expected);
  const current =
    cost.memory === argon2Cost.memory &&
    cost.passes === argon2Cost.passes &&
    cost.parallelism === argon2Cost.parallelism &&
    expected.length === tagLength;
  return { valid, needsRehash: valid && !current };
}

async function verifyScrypt(password: string, stored: string): Promise<Verification> {
  const [, N, r, p, salt, key] = stored.split('$');
  if (!N || !r || !p || !salt || !key) {
    throw new Error('Stored scrypt password hash is malformed');
  }
  const actual = await deriveScrypt(
    password,
    Buffer.from(salt, 'base64url'),
    Number(N),
    Number(r),
    Number(p),
  );
  const valid = timingSafeEqual(actual, Buffer.from(key, 'base64url'));
  return { valid, needsRehash: valid };
}

/** Checks a password against an Argon2id hash, or a legacy scrypt one, and says whether to rehash it. */
export async function verifyPassword(password: string, stored: string): Promise<Verification> {
  const match = argon2Pattern.exec(stored);
  if (match) return verifyArgon2(password, match);
  if (stored.startsWith('scrypt$')) return verifyScrypt(password, stored);
  throw new Error('Stored password hash has an unknown format');
}
