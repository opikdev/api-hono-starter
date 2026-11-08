import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const sourceRoot = resolve('src');

function sourceFiles(): string[] {
  return readdirSync(sourceRoot, { recursive: true, encoding: 'utf8' })
    .filter((file) => file.endsWith('.ts'))
    .map((file) => join(sourceRoot, file));
}

function imports(file: string): string[] {
  const matches = readFileSync(file, 'utf8').matchAll(/(?:from|import) '([^']+)'/g);
  return [...matches].map((match) => match[1] as string);
}

function localImports(file: string): string[] {
  return imports(file)
    .filter((path) => path.startsWith('.'))
    .map((path) => relative(sourceRoot, resolve(dirname(file), path)));
}

function area(path: string): string {
  const [top, feature] = path.split('/');
  return top === 'features' ? `features/${feature}` : (top as string);
}

const allowedDependencies: Record<string, (target: string) => boolean> = {
  db: (target) => target.startsWith('db/'),
  platform: (target) => target.startsWith('db/') || target.startsWith('platform/'),
  features: (target) => !target.startsWith('features/') || target === 'features/auth/middleware.ts',
};

describe('architecture', () => {
  it('finds the source files', () => {
    expect(sourceFiles().length).toBeGreaterThan(10);
  });

  it('keeps dependencies pointing one way', () => {
    const violations: string[] = [];
    for (const file of sourceFiles()) {
      const from = relative(sourceRoot, file);
      const isAllowed = allowedDependencies[from.split('/')[0] as string];
      if (!isAllowed || from.startsWith('db/seed')) continue;
      for (const target of localImports(file)) {
        if (area(target) !== area(from) && !isAllowed(target)) {
          violations.push(`${from} -> ${target}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it('keeps stores free of HTTP', () => {
    const stores = sourceFiles().filter((file) => file.endsWith('store.ts'));
    expect(stores.length).toBeGreaterThan(0);
    for (const file of stores) {
      expect(imports(file).filter((path) => path.startsWith('hono'))).toEqual([]);
    }
  });

  it('only opens the database in the entry point and scripts', () => {
    const allowed = ['index.ts', 'db/client.ts', 'db/migrate.ts', 'db/seed.ts'];
    const opens = sourceFiles()
      .map((file) => relative(sourceRoot, file))
      .filter((file) => !allowed.includes(file))
      .filter((file) => imports(join(sourceRoot, file)).includes('pg'));
    expect(opens).toEqual([]);
  });
});
