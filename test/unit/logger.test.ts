import { describe, expect, it } from 'vitest';
import { createLogger } from '../../src/platform/logger.ts';

function capture(entry: Record<string, unknown>): string {
  let output = '';
  const logger = createLogger('info', {
    write: (line) => {
      output += line;
    },
  });
  logger.info(entry, 'test');
  return output;
}

describe('logger', () => {
  it.each(['password', 'token', 'authorization'])('redacts %s', (field) => {
    const output = capture({ [field]: 'super-secret' });
    expect(output).not.toContain('super-secret');
    expect(output).toContain('[Redacted]');
  });

  it('redacts one level deep', () => {
    expect(capture({ body: { password: 'super-secret' } })).not.toContain('super-secret');
  });

  it('keeps other fields', () => {
    expect(capture({ status: 200 })).toContain('"status":200');
  });
});
