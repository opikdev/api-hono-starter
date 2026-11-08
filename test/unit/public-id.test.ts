import { describe, expect, it } from 'vitest';
import { fromPublicId, toPublicId } from '../../src/platform/public-id.ts';

const uuid = '0190a7e4-c1f0-7c3e-8d21-b6f4a9e05d13';

describe('public ids', () => {
  it('prefixes a uuid', () => {
    expect(toPublicId('note', uuid)).toBe('note_0190a7e4c1f07c3e8d21b6f4a9e05d13');
  });

  it('round-trips', () => {
    expect(fromPublicId('usr', 'usr_0190a7e4c1f07c3e8d21b6f4a9e05d13')).toBe(uuid);
  });

  it.each([
    ['the wrong prefix', 'usr_0190a7e4c1f07c3e8d21b6f4a9e05d13'],
    ['no prefix', '0190a7e4c1f07c3e8d21b6f4a9e05d13'],
    ['a short value', 'note_0190'],
    ['non-hex characters', 'note_zzzza7e4c1f07c3e8d21b6f4a9e05d13'],
    ['uppercase hex', 'note_0190A7E4C1F07C3E8D21B6F4A9E05D13'],
    ['an empty value', ''],
  ])('rejects %s', (_label, value) => {
    expect(fromPublicId('note', value)).toBeNull();
  });
});
