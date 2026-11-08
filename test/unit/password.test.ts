import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from '../../src/features/auth/password.ts';

describe('passwords', () => {
  it('verifies the right password', async () => {
    const stored = await hashPassword('correct-horse-battery');
    await expect(verifyPassword('correct-horse-battery', stored)).resolves.toBe(true);
  });

  it('rejects the wrong password', async () => {
    const stored = await hashPassword('correct-horse-battery');
    await expect(verifyPassword('wrong-horse-battery', stored)).resolves.toBe(false);
  });

  it('salts each hash', async () => {
    const [first, second] = await Promise.all([hashPassword('same'), hashPassword('same')]);
    expect(first).not.toBe(second);
  });

  it('never stores the password', async () => {
    expect(await hashPassword('correct-horse-battery')).not.toContain('correct-horse');
  });

  it('fails loudly on an unknown hash format', async () => {
    await expect(verifyPassword('x', 'bcrypt$abc')).rejects.toThrow('unknown format');
  });
});
