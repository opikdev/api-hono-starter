export const fieldTypes = ['string', 'text', 'int', 'boolean', 'datetime', 'enum'] as const;
export type FieldType = (typeof fieldTypes)[number];
export const uniqueFieldTypes: readonly FieldType[] = ['string', 'int', 'datetime'];

export interface Field {
  name: string;
  column: string;
  type: FieldType;
  optional: boolean;
  unique: boolean;
  values: string[];
}

export interface FeatureSpec {
  name: string;
  table: string;
  plural: string;
  singular: string;
  Plural: string;
  Singular: string;
  title: string;
  prefix: string;
  fields: Field[];
}

export class SpecError extends Error {}

const reservedFeatures = new Set([
  'auth',
  'docs',
  'health',
  'me',
  'notes',
  'openapi',
  'sessions',
  'users',
]);
const reservedFields = new Set(['id', 'userId', 'version', 'createdAt', 'updatedAt']);
const reservedPrefixes = new Set(['note', 'usr']);
const reservedWords = new Set(
  'await break case catch class const continue debugger default delete do else enum export extends false finally for function if implements import in instanceof interface let new null package private protected public return static super switch this throw true try typeof var void while with yield'.split(
    ' ',
  ),
);
const maxIdentifierLength = 63;

const toCamel = (kebab: string) =>
  kebab.replace(/-([a-z0-9])/g, (_, char: string) => char.toUpperCase());
const toSnake = (camel: string) => camel.replace(/[A-Z]/g, (char) => `_${char.toLowerCase()}`);
const toPascal = (camel: string) => camel.charAt(0).toUpperCase() + camel.slice(1);

export function singularize(word: string): string {
  if (word.endsWith('ies')) return `${word.slice(0, -3)}y`;
  if (/(s|x|z|ch|sh)es$/.test(word)) return word.slice(0, -2);
  if (word.endsWith('s') && !word.endsWith('ss')) return word.slice(0, -1);
  return word;
}

export function parseField(raw: string): Field {
  const parts = raw.split(':');
  const modifiers = new Set<string>();
  while (parts.length > 2 && ['optional', 'unique'].includes(parts.at(-1) as string)) {
    const modifier = parts.pop() as string;
    if (modifiers.has(modifier)) throw new SpecError(`Field "${raw}" lists ${modifier} twice.`);
    modifiers.add(modifier);
  }
  const [name = '', type = '', values, ...rest] = parts;

  if (rest.length > 0 || !name || !type) {
    throw new SpecError(
      `Invalid field "${raw}". Use name:type, then :optional or :unique if needed, or name:enum:a,b, such as title:string.`,
    );
  }
  if (!/^[a-z][a-zA-Z0-9]{0,29}$/.test(name)) {
    throw new SpecError(
      `Invalid field name "${name}". Use camelCase, up to 30 characters, such as dueAt.`,
    );
  }
  if (reservedFields.has(name)) {
    throw new SpecError(`Field name "${name}" is reserved, because every feature already has it.`);
  }
  if (!fieldTypes.includes(type as FieldType)) {
    throw new SpecError(
      `Unknown type "${type}" for ${name}. Use one of: ${fieldTypes.join(', ')}.`,
    );
  }

  const fieldType = type as FieldType;
  if (fieldType !== 'enum' && values !== undefined) {
    throw new SpecError(`Only enum fields take values, but ${name} is ${fieldType}.`);
  }
  const unique = modifiers.has('unique');
  if (unique && !uniqueFieldTypes.includes(fieldType)) {
    throw new SpecError(
      `${name} can't be unique, because it's ${fieldType}. Use one of: ${uniqueFieldTypes.join(', ')}.`,
    );
  }

  return {
    name,
    column: toSnake(name),
    type: fieldType,
    optional: modifiers.has('optional'),
    unique,
    values: fieldType === 'enum' ? parseEnumValues(name, values) : [],
  };
}

function parseEnumValues(name: string, raw: string | undefined): string[] {
  const values = (raw ?? '').split(',').filter(Boolean);
  if (values.length === 0) {
    throw new SpecError(`Enum ${name} needs values, such as ${name}:enum:active,archived.`);
  }
  for (const value of values) {
    if (!/^[a-z][a-z0-9_-]{0,29}$/.test(value)) {
      throw new SpecError(
        `Invalid enum value "${value}" for ${name}. Use lowercase letters, digits, - or _.`,
      );
    }
  }
  if (new Set(values).size !== values.length) {
    throw new SpecError(`Enum ${name} lists a value twice.`);
  }
  return values;
}

interface SpecInput {
  name: string;
  fields: Field[];
  singular?: string | undefined;
  prefix?: string | undefined;
}

export function buildSpec({ name, fields, singular, prefix }: SpecInput): FeatureSpec {
  if (!/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/.test(name) || name.length > 30) {
    throw new SpecError(
      `Invalid feature name "${name}". Use plural kebab-case, up to 30 characters, such as projects.`,
    );
  }
  if (reservedFeatures.has(name)) {
    throw new SpecError(`Feature name "${name}" is already used by the starter.`);
  }

  const singularName = singular ?? singularize(name);
  if (!/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/.test(singularName)) {
    throw new SpecError(
      `Invalid singular name "${singularName}". Use kebab-case, such as time-entry.`,
    );
  }

  const plural = toCamel(name);
  const singularCamel = toCamel(singularName);
  for (const word of [plural, singularCamel]) {
    if (reservedWords.has(word)) throw new SpecError(`"${word}" is a reserved word in TypeScript.`);
  }
  if (plural === singularCamel) {
    throw new SpecError(
      `"${name}" has no distinct singular. Pass --singular, such as --singular datum.`,
    );
  }

  const idPrefix = prefix ?? singularCamel.toLowerCase();
  if (!/^[a-z]{2,16}$/.test(idPrefix)) {
    throw new SpecError(
      `Invalid ID prefix "${idPrefix}". Use 2–16 lowercase letters, such as proj.`,
    );
  }
  if (reservedPrefixes.has(idPrefix)) {
    throw new SpecError(`ID prefix "${idPrefix}" is already used. Pass --prefix.`);
  }

  if (fields.length === 0) throw new SpecError('Add at least one field, such as title:string.');
  if (fields.length > 20) throw new SpecError('Use at most 20 fields. Split the feature instead.');
  const names = fields.map((field) => field.name);
  const duplicate = names.find((fieldName, index) => names.indexOf(fieldName) !== index);
  if (duplicate) throw new SpecError(`Field ${duplicate} is listed twice.`);

  const table = toSnake(plural);
  for (const field of fields) {
    const constraint = field.unique
      ? `uq_${table}_user_id_${field.column}`
      : `chk_${table}_${field.column}_values`;
    if (constraint.length > maxIdentifierLength) {
      throw new SpecError(
        `${name}.${field.name} makes a database name over 63 characters. Shorten one of them.`,
      );
    }
  }

  return {
    name,
    table,
    plural,
    singular: singularCamel,
    Plural: toPascal(plural),
    Singular: toPascal(singularCamel),
    title: name.replaceAll('-', ' '),
    prefix: idPrefix,
    fields,
  };
}
