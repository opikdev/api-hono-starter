import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const source = resolve('.');
let repo: string;

function git(...args: string[]) {
  return execFileSync('git', args, { cwd: repo, encoding: 'utf8' });
}

function generate(...args: string[]) {
  const result = spawnSync(
    process.execPath,
    ['scripts/gen-feature.ts', ...args, '--yes', '--json'],
    {
      cwd: repo,
      encoding: 'utf8',
    },
  );
  return {
    status: result.status,
    body: JSON.parse(result.stdout.trim().split('\n').at(-1) ?? '{}'),
  };
}

beforeAll(() => {
  repo = mkdtempSync(join(tmpdir(), 'gen-feature-'));
  const files = execFileSync('git', ['ls-files', '-co', '--exclude-standard', '-z'], {
    cwd: source,
    encoding: 'utf8',
  });
  execFileSync('tar', ['-cf', join(repo, 'source.tar'), '--null', '-T', '-'], {
    cwd: source,
    input: files,
  });
  execFileSync('tar', ['-xf', 'source.tar'], { cwd: repo });
  rmSync(join(repo, 'source.tar'));
  symlinkSync(join(source, 'node_modules'), join(repo, 'node_modules'));
  git('init', '--quiet', '--initial-branch=main');
  git('add', '--all');
  git(
    '-c',
    'user.name=test',
    '-c',
    'user.email=test@example.com',
    'commit',
    '--quiet',
    '-m',
    'base',
  );
});

afterAll(() => {
  rmSync(repo, { recursive: true, force: true });
});

describe('pnpm gen:feature', () => {
  it('previews without writing anything', () => {
    const { status, body } = generate('projects', 'name:string', '--dry-run');
    expect(status).toBe(0);
    expect(body.created).toContain('src/features/projects/routes.ts');
    expect(git('status', '--porcelain')).toBe('');
  });

  it('rejects bad input without writing anything', () => {
    const { status, body } = generate('projects', 'name:strng');
    expect(status).toBe(1);
    expect(body.error).toContain('Unknown type "strng"');
    expect(git('status', '--porcelain')).toBe('');
  });

  it('stops before writing anything when no database is available', () => {
    const result = spawnSync(
      process.execPath,
      ['scripts/gen-feature.ts', 'widgets', 'name:string', '--yes', '--json'],
      {
        cwd: repo,
        encoding: 'utf8',
        env: { ...process.env, PATH: repo, TEST_DATABASE_URL: '' },
      },
    );
    expect(result.status).toBe(1);
    expect(JSON.parse(result.stdout.trim()).error).toContain("Docker isn't running");
    expect(git('status', '--porcelain')).toBe('');
  });

  it('generates features that pass every gate', () => {
    const first = generate(
      'projects',
      'name:string',
      'status:enum:active,archived',
      'dueAt:datetime:optional',
      '--skip-verify',
    );
    expect(first.body).toMatchObject({ ok: true, verify: 'skipped' });

    const second = generate(
      'time-entries',
      'description:text',
      'minutes:int',
      'billable:boolean',
      'startedAt:datetime:unique',
      'label:string:optional',
      'kind:enum:work,break:optional',
      'code:string:unique',
      'position:int:optional:unique',
    );
    expect(second.body.output ?? '').toBe('');
    expect(second.body).toMatchObject({ ok: true, verify: 'passed' });
    expect(second.body.migrations).toContainEqual(
      expect.stringMatching(/^migrations\/\d{4}_add_time_entries\.sql$/),
    );
    expect(readFileSync(join(repo, 'openapi.json'), 'utf8')).toContain('/v1/time-entries/{id}');
    expect(readFileSync(join(repo, 'src/db/schema.ts'), 'utf8')).toContain(
      "unique('uq_time_entries_user_id_code').on(table.userId, table.code),",
    );
    expect(readFileSync(join(repo, 'test/integration/time-entries.test.ts'), 'utf8')).toContain(
      "await expectProblem(response, 409, 'conflict');",
    );
  });

  it('refuses to generate a feature twice', () => {
    const before = git('status', '--porcelain');
    const { status, body } = generate('projects', 'name:string');
    expect(status).toBe(1);
    expect(body.error).toContain('already');
    expect(git('status', '--porcelain')).toBe(before);
  });

  it('rolls everything back when pnpm verify fails', () => {
    git('add', '--all');
    git(
      '-c',
      'user.name=test',
      '-c',
      'user.email=test@example.com',
      'commit',
      '--quiet',
      '-m',
      'generated',
    );
    writeFileSync(
      join(repo, 'test/unit/always-fails.test.ts'),
      "import { it } from 'vitest';\nit('fails', () => {\n  throw new Error('boom');\n});\n",
    );

    const { status, body } = generate('invoices', 'amount:int');
    expect(status).toBe(1);
    expect(body.error).toContain('rolled back');
    expect(git('status', '--porcelain')).toBe('?? test/unit/always-fails.test.ts\n');
    expect(existsSync(join(repo, 'src/features/invoices'))).toBe(false);
  });
});
