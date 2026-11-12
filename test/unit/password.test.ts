import { argon2Sync, randomBytes, scryptSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from '../../src/features/auth/password.ts';

const encode = (bytes: Buffer) => bytes.toString('base64').replace(/=+$/, '');

function argon2Hash(secret: string, memory: number, passes: number): string {
  const salt = randomBytes(16);
  const key = argon2Sync('argon2id', {
    message: secret,
    nonce: salt,
    memory,
    passes,
    parallelism: 1,
    tagLength: 32,
  });
  return `$argon2id$v=19$m=${memory},t=${passes},p=1$${encode(salt)}$${encode(key)}`;
}

function scryptHash(secret: string): string {
  const salt = randomBytes(16);
  const key = scryptSync(secret, salt, 32, { N: 2 ** 14, r: 8, p: 1 });
  return ['scrypt', 16384, 8, 1, salt.toString('base64url'), key.toString('base64url')].join('$');
}

describe('passwords', () => {
  it('hashes with Argon2id at the OWASP minimum', async () => {
    expect(await hashPassword('correct-horse-battery')).toMatch(
      /^\$argon2id\$v=19\$m=19456,t=2,p=1\$[A-Za-z0-9+/]{22}\$[A-Za-z0-9+/]{43}$/,
    );
  });

  it('verifies the right password without asking for a rehash', async () => {
    const stored = await hashPassword('correct-horse-battery');
    await expect(verifyPassword('correct-horse-battery', stored)).resolves.toEqual({
      valid: true,
      needsRehash: false,
    });
  });

  it('rejects the wrong password', async () => {
    const stored = await hashPassword('correct-horse-battery');
    await expect(verifyPassword('wrong-horse-battery', stored)).resolves.toEqual({
      valid: false,
      needsRehash: false,
    });
  });

  it('asks to rehash a hash with older parameters', async () => {
    const stored = argon2Hash('correct-horse-battery', 8192, 1);
    await expect(verifyPassword('correct-horse-battery', stored)).resolves.toEqual({
      valid: true,
      needsRehash: true,
    });
  });

  it('verifies a legacy scrypt hash and asks to rehash it', async () => {
    const stored = scryptHash('correct-horse-battery');
    await expect(verifyPassword('correct-horse-battery', stored)).resolves.toEqual({
      valid: true,
      needsRehash: true,
    });
    await expect(verifyPassword('wrong-horse-battery', stored)).resolves.toEqual({
      valid: false,
      needsRehash: false,
    });
  });

  it('salts each hash', async () => {
    const [first, second] = await Promise.all([hashPassword('same'), hashPassword('same')]);
    expect(first).not.toBe(second);
  });

  it('never stores the password', async () => {
    expect(await hashPassword('correct-horse-battery')).not.toContain('correct-horse');
  });

  it.each(['bcrypt$abc', 'scrypt$1$2'])('fails loudly on the unknown hash %j', async (stored) => {
    await expect(verifyPassword('x', stored)).rejects.toThrow(/unknown format|malformed/);
  });
});
