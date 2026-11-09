import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { problemCatalog } from '../../src/platform/problem.ts';

function documentedProblems(): Record<string, number> {
  const rows = readFileSync('docs/errors.md', 'utf8').matchAll(
    /^\| `urn:problem:([a-z-]+)` +\| (\d+) /gm,
  );
  return Object.fromEntries([...rows].map(([, slug, status]) => [slug, Number(status)]));
}

describe('problem catalog', () => {
  it('matches docs/errors.md exactly, with the same statuses', () => {
    const catalog = Object.fromEntries(
      Object.entries(problemCatalog).map(([slug, { status }]) => [slug, status]),
    );
    expect(documentedProblems()).toEqual(catalog);
  });
});
