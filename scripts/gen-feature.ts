import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { parseArgs } from 'node:util';
import * as prompts from '@clack/prompts';
import { editApp, editChangelog, editPublicId, editSchema } from './gen-feature/edit.ts';
import { renderRoutes, renderStore, renderTest } from './gen-feature/render.ts';
import {
  buildSpec,
  type FeatureSpec,
  type Field,
  type FieldType,
  fieldTypes,
  parseField,
  SpecError,
  singularize,
  uniqueFieldTypes,
} from './gen-feature/spec.ts';

const usage = `Usage: pnpm gen:feature [name] [field:type[:optional][:unique] ...] [options]

Run with no arguments to answer prompts instead.

Field types: ${fieldTypes.join(', ')}. Enums list values: status:enum:active,archived.
Add :optional to allow null, and :unique to reject a value the same user already used
(${uniqueFieldTypes.join(', ')} only), such as slug:string:unique.

Options:
  --singular <name>  Singular name, when it isn't the name without its final s
  --prefix <prefix>  Public ID prefix, such as proj for proj_0190...
  --dry-run          List the files without writing anything
  --yes              Skip the confirmation prompt
  --json             Print a JSON result, for agents and scripts
  --skip-verify      Skip pnpm verify after generating
  --keep             Keep the files if pnpm verify fails, instead of rolling back
  -h, --help         Show this help

Example:
  pnpm gen:feature projects name:string:unique status:enum:active,archived dueAt:datetime:optional`;

const { values: options, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    singular: { type: 'string' },
    prefix: { type: 'string' },
    'dry-run': { type: 'boolean', default: false },
    yes: { type: 'boolean', default: false },
    json: { type: 'boolean', default: false },
    'skip-verify': { type: 'boolean', default: false },
    keep: { type: 'boolean', default: false },
    help: { type: 'boolean', short: 'h', default: false },
  },
});

interface Plan {
  created: Map<string, string>;
  changed: Map<string, string>;
}

const json = options.json;
const say = (message: string) => {
  if (!json) prompts.log.info(message);
};

function fail(message: string): never {
  if (json) console.log(JSON.stringify({ ok: false, error: message }));
  else prompts.log.error(message);
  process.exit(1);
}

function cancelled(value: unknown): void {
  if (prompts.isCancel(value)) {
    prompts.cancel('Nothing was generated.');
    process.exit(1);
  }
}

async function askForSpec(): Promise<FeatureSpec> {
  prompts.intro('Generate a feature');
  const name = await prompts.text({
    message: 'Feature name, plural kebab-case',
    placeholder: 'projects',
    validate: (value) =>
      /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/.test(value ?? '')
        ? undefined
        : 'Use kebab-case, such as projects',
  });
  cancelled(name);
  const singular = await prompts.text({
    message: 'Singular name',
    initialValue: singularize(name as string),
  });
  cancelled(singular);

  const fields: Field[] = [];
  while (true) {
    const fieldName = await prompts.text({
      message:
        fields.length === 0
          ? 'First field name, camelCase'
          : 'Next field name, or leave empty to finish',
      placeholder: fields.length === 0 ? 'title' : '',
      validate: (value) => (fields.length === 0 && !value ? 'Add at least one field' : undefined),
    });
    cancelled(fieldName);
    if (!fieldName) break;
    const fieldLabel = String(fieldName);

    const type = await prompts.select({
      message: `Type of ${fieldLabel}`,
      options: fieldTypes.map((value) => ({ value, label: value })),
    });
    cancelled(type);

    let enumValues = '';
    if (type === 'enum') {
      const answer = await prompts.text({
        message: 'Values, comma-separated',
        placeholder: 'active,archived',
      });
      cancelled(answer);
      enumValues = `:${answer as string}`;
    }

    const required = await prompts.confirm({
      message: `Is ${fieldLabel} required?`,
      initialValue: true,
    });
    cancelled(required);

    let unique = false;
    if (uniqueFieldTypes.includes(type as FieldType)) {
      const answer = await prompts.confirm({
        message: `Must each user's ${fieldLabel} be unique?`,
        initialValue: false,
      });
      cancelled(answer);
      unique = answer === true;
    }

    try {
      fields.push(
        parseField(
          `${fieldLabel}:${String(type)}${enumValues}${required ? '' : ':optional'}${unique ? ':unique' : ''}`,
        ),
      );
    } catch (error) {
      prompts.log.warn(error instanceof Error ? error.message : String(error));
    }
  }

  return buildSpec({
    name: name as string,
    singular: singular as string,
    fields,
    prefix: options.prefix,
  });
}

function specFromArgs(): FeatureSpec {
  const [name = '', ...rawFields] = positionals;
  return buildSpec({
    name,
    fields: rawFields.map(parseField),
    singular: options.singular,
    prefix: options.prefix,
  });
}

function plan(spec: FeatureSpec): Plan {
  const created = new Map([
    [`src/features/${spec.name}/store.ts`, renderStore(spec)],
    [`src/features/${spec.name}/routes.ts`, renderRoutes(spec)],
    [`test/integration/${spec.name}.test.ts`, renderTest(spec)],
  ]);
  for (const path of created.keys()) {
    if (existsSync(path))
      throw new SpecError(`${path} already exists, so the feature may already be there.`);
  }
  if (existsSync(`src/features/${spec.name}`)) {
    throw new SpecError(`src/features/${spec.name} already exists.`);
  }

  const edits: [string, (source: string, spec: FeatureSpec) => string][] = [
    ['src/db/schema.ts', editSchema],
    ['src/platform/public-id.ts', editPublicId],
    ['src/app.ts', editApp],
    ['CHANGELOG.md', editChangelog],
  ];
  const changed = new Map(
    edits.map(([path, edit]) => [path, edit(readFileSync(path, 'utf8'), spec)]),
  );
  return { created, changed };
}

const pnpmBinary = process.env.npm_execpath;
const pnpm: [string, string[]] = pnpmBinary
  ? /\.[cm]?js$/.test(pnpmBinary)
    ? [process.execPath, [pnpmBinary]]
    : [pnpmBinary, []]
  : ['pnpm', []];

function runPnpm(args: string[], quiet: boolean) {
  return run(pnpm[0], [...pnpm[1], ...args], { quiet });
}

function run(command: string, args: string[], { quiet }: { quiet: boolean }) {
  const result = spawnSync(command, args, {
    stdio: quiet || json ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    encoding: 'utf8',
  });
  if (result.error) throw result.error;
  return { ok: result.status === 0, output: `${result.stdout ?? ''}${result.stderr ?? ''}` };
}

function listFiles(dir: string): Set<string> {
  return new Set(
    readdirSync(dir, { recursive: true, encoding: 'utf8' }).map((file) => `${dir}/${file}`),
  );
}

const tracked = ['openapi.json', 'migrations/meta/_journal.json'];

async function main() {
  if (options.help) {
    console.log(usage);
    return;
  }

  let spec: FeatureSpec;
  if (positionals.length === 0) {
    if (!process.stdin.isTTY || json)
      fail(`Pass a name and fields, or run in a terminal to answer prompts.\n\n${usage}`);
    spec = await askForSpec();
  } else {
    spec = specFromArgs();
  }

  const { created, changed } = plan(spec);
  const summary = {
    feature: spec.name,
    endpoints: [
      `POST /v1/${spec.name}`,
      `GET /v1/${spec.name}`,
      `GET|PATCH|DELETE /v1/${spec.name}/{id}`,
    ],
    created: [...created.keys()],
    changed: [...changed.keys(), ...tracked],
  };

  if (!json) {
    prompts.note(
      [
        ...summary.endpoints,
        '',
        ...summary.created.map((path) => `+ ${path}`),
        ...summary.changed.map((path) => `~ ${path}`),
        '+ a new migration',
      ].join('\n'),
      `${spec.name}: ${spec.fields.map((field) => `${field.name} (${field.type}${field.optional ? ', optional' : ''}${field.unique ? ', unique' : ''})`).join(', ')}`,
    );
  }

  if (options['dry-run']) {
    if (json) console.log(JSON.stringify({ ok: true, dryRun: true, ...summary }));
    return;
  }

  const hasDatabase =
    Boolean(process.env.TEST_DATABASE_URL) ||
    spawnSync('docker', ['info'], { stdio: 'ignore' }).status === 0;
  if (!options['skip-verify'] && !hasDatabase) {
    fail(
      "Docker isn't running, and pnpm verify needs Postgres for the tests. Start Docker, set TEST_DATABASE_URL to a Postgres 18 server, or pass --skip-verify and run pnpm verify later.",
    );
  }

  if (!options.yes && !json) {
    if (!process.stdin.isTTY) fail('Pass --yes to generate without a prompt.');
    const confirmed = await prompts.confirm({ message: 'Generate these files?' });
    cancelled(confirmed);
    if (!confirmed) {
      prompts.cancel('Nothing was generated.');
      return;
    }
  }

  const originals = new Map(
    [...changed.keys(), ...tracked].map((path) => [path, readFileSync(path, 'utf8')] as const),
  );
  const migrationsBefore = listFiles('migrations');

  const rollback = () => {
    for (const path of created.keys()) rmSync(path, { force: true });
    rmSync(`src/features/${spec.name}`, { recursive: true, force: true });
    for (const file of listFiles('migrations')) {
      if (!migrationsBefore.has(file)) rmSync(file, { force: true });
    }
    for (const [path, content] of originals) writeFileSync(path, content);
  };

  try {
    for (const [path, content] of [...created, ...changed]) {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, content);
    }

    const steps: [string, string, string[]][] = [
      [
        'Format',
        'node_modules/.bin/biome',
        ['check', '--write', ...created.keys(), ...changed.keys()],
      ],
      [
        'Create the migration',
        'node_modules/.bin/drizzle-kit',
        ['generate', '--name', `add_${spec.table}`],
      ],
      ['Update openapi.json', process.execPath, ['scripts/generate-openapi.ts']],
    ];
    for (const [label, command, args] of steps) {
      say(label);
      const result = run(command, args, { quiet: true });
      if (!result.ok) throw new Error(`${label} failed:\n${result.output}`);
    }
  } catch (error) {
    rollback();
    fail(`${error instanceof Error ? error.message : String(error)}\nRolled back every change.`);
  }

  const migrations = [...listFiles('migrations')].filter((file) => !migrationsBefore.has(file));
  let verify: 'passed' | 'failed' | 'skipped' = 'skipped';
  let verifyOutput = '';
  if (!options['skip-verify']) {
    say('Run pnpm verify');
    const result = runPnpm(['verify'], false);
    verify = result.ok ? 'passed' : 'failed';
    verifyOutput = result.output;
  }

  if (verify === 'failed' && !options.keep) {
    rollback();
    const message =
      'pnpm verify failed, so every change was rolled back. Rerun with --keep to inspect the files.';
    if (json)
      console.log(
        JSON.stringify({ ok: false, error: message, verify, output: verifyOutput.slice(-4000) }),
      );
    else prompts.log.error(message);
    process.exit(1);
  }

  const result = { ok: verify !== 'failed', ...summary, migrations, verify };
  if (json) {
    console.log(JSON.stringify(result));
  } else {
    prompts.outro(
      verify === 'passed'
        ? `Generated ${spec.name}, and pnpm verify passed. Add your business logic in src/features/${spec.name}/.`
        : `Generated ${spec.name}. Run pnpm verify before committing.`,
    );
  }
  if (verify === 'failed') process.exit(1);
}

main().catch((error: unknown) => {
  fail(error instanceof SpecError || error instanceof Error ? error.message : String(error));
});
