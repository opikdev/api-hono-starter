import { renderTable, schemaImports } from './render.ts';
import { type FeatureSpec, SpecError } from './spec.ts';

export function editSchema(source: string, spec: FeatureSpec): string {
  if (new RegExp(`export const ${spec.plural} = pgTable\\(`).test(source)) {
    throw new SpecError(`src/db/schema.ts already defines ${spec.plural}.`);
  }
  const importPattern = /import \{([^}]+)\} from 'drizzle-orm\/pg-core';/;
  const match = importPattern.exec(source);
  if (!match)
    throw new SpecError("Couldn't find the drizzle-orm/pg-core import in src/db/schema.ts.");

  const existing = (match[1] as string)
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean);
  const names = [...new Set([...existing, ...schemaImports(spec)])].sort();
  const withImports = source.replace(
    importPattern,
    `import { ${names.join(', ')} } from 'drizzle-orm/pg-core';`,
  );
  return `${withImports.trimEnd()}\n${renderTable(spec)}`;
}

export function editPublicId(source: string, spec: FeatureSpec): string {
  const pattern = /export type IdPrefix = ([^;]+);/;
  const match = pattern.exec(source);
  if (!match) throw new SpecError("Couldn't find IdPrefix in src/platform/public-id.ts.");
  if ((match[1] as string).includes(`'${spec.prefix}'`)) {
    throw new SpecError(`ID prefix ${spec.prefix} is already used. Pass --prefix.`);
  }
  return source.replace(pattern, `export type IdPrefix = ${match[1]} | '${spec.prefix}';`);
}

export function editApp(source: string, spec: FeatureSpec): string {
  const factory = `create${spec.Plural}Router`;
  if (source.includes(factory)) throw new SpecError(`src/app.ts already mounts ${factory}.`);

  const chainStart = source.indexOf('const routes = app');
  const chainEnd = source.indexOf(';', chainStart);
  if (chainStart === -1 || chainEnd === -1) {
    throw new SpecError(
      "Couldn't find `const routes = app` in src/app.ts, so mount the router by hand.",
    );
  }
  const mounted = `${source.slice(0, chainEnd)}\n    .route('/v1', ${factory}({ db, requireAuth }))${source.slice(chainEnd)}`;

  const imports = [...mounted.matchAll(/^import .*;$/gm)];
  const lastImport = imports.at(-1);
  if (!lastImport) throw new SpecError("Couldn't find the imports in src/app.ts.");
  const insertAt = (lastImport.index ?? 0) + lastImport[0].length;
  const line = `\nimport { ${factory} } from './features/${spec.name}/routes.ts';`;
  return `${mounted.slice(0, insertAt)}${line}${mounted.slice(insertAt)}`;
}

export function editChangelog(source: string, spec: FeatureSpec): string {
  const heading = '## [Unreleased]\n';
  const start = source.indexOf(heading);
  if (start === -1) return source;

  const entry = `- ${spec.title.charAt(0).toUpperCase()}${spec.title.slice(1)} feature, generated with \`pnpm gen:feature\`.\n`;
  const afterHeading = start + heading.length;
  const nextRelease = source.indexOf('\n## ', afterHeading);
  const section = source.slice(afterHeading, nextRelease === -1 ? undefined : nextRelease);
  const added = section.indexOf('### Added\n');
  if (added !== -1) {
    const listStart = afterHeading + added + '### Added\n\n'.length;
    return `${source.slice(0, listStart)}${entry}${source.slice(listStart)}`;
  }
  return `${source.slice(0, afterHeading)}\n### Added\n\n${entry}${source.slice(afterHeading)}`;
}
