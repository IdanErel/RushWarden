/**
 * A small validator for the subset of JSON Schema (draft 2020-12) that the content schemas use.
 * The repo has no JSON Schema dependency (ADR-009), so this interprets exactly the keywords
 * below and rejects any schema that uses something else. The same schema objects are written to
 * `schema/*.schema.json` for editor support, so the file and the validator cannot drift.
 */

export interface JsonSchema {
  readonly $schema?: string;
  readonly $id?: string;
  readonly $ref?: string;
  readonly $defs?: Readonly<Record<string, JsonSchema>>;
  readonly title?: string;
  readonly description?: string;
  readonly type?: 'object' | 'array' | 'integer' | 'string' | 'boolean';
  readonly properties?: Readonly<Record<string, JsonSchema>>;
  readonly required?: readonly string[];
  readonly additionalProperties?: false;
  readonly minProperties?: number;
  readonly items?: JsonSchema;
  readonly minItems?: number;
  readonly maxItems?: number;
  readonly uniqueItems?: boolean;
  readonly minimum?: number;
  readonly maximum?: number;
  readonly minLength?: number;
  readonly maxLength?: number;
  readonly pattern?: string;
  readonly const?: string | number | boolean;
  readonly enum?: readonly (string | number)[];
  readonly not?: JsonSchema;
  readonly oneOf?: readonly JsonSchema[];
}

/** One validation failure: a JSON pointer-ish path (`effects/0/percent`) and a message. */
export interface SchemaError {
  readonly path: string;
  readonly message: string;
}

const KNOWN_KEYWORDS = new Set([
  '$schema',
  '$id',
  '$ref',
  '$defs',
  'title',
  'description',
  'type',
  'properties',
  'required',
  'additionalProperties',
  'minProperties',
  'items',
  'minItems',
  'maxItems',
  'uniqueItems',
  'minimum',
  'maximum',
  'minLength',
  'maxLength',
  'pattern',
  'const',
  'enum',
  'not',
  'oneOf',
]);

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function describe(v: unknown): string {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  if (typeof v === 'number' && !Number.isInteger(v)) return 'non-integer number';
  return typeof v;
}

function join(path: string, key: string | number): string {
  return path === '' ? String(key) : `${path}/${key}`;
}

function resolve(schema: JsonSchema, root: JsonSchema): JsonSchema {
  if (schema.$ref === undefined) return schema;
  const prefix = '#/$defs/';
  if (!schema.$ref.startsWith(prefix)) throw new Error(`Unsupported $ref ${schema.$ref}`);
  const target = root.$defs?.[schema.$ref.slice(prefix.length)];
  if (target === undefined) throw new Error(`Unresolved $ref ${schema.$ref}`);
  return resolve(target, root);
}

/** The `kind` constant of an object branch, if it has one (used to dispatch `oneOf`). */
function branchKind(schema: JsonSchema, root: JsonSchema): unknown {
  return resolve(schema, root).properties?.['kind']?.const;
}

function check(
  schemaIn: JsonSchema,
  value: unknown,
  path: string,
  root: JsonSchema,
  errors: SchemaError[],
): void {
  for (const key of Object.keys(schemaIn)) {
    if (!KNOWN_KEYWORDS.has(key)) throw new Error(`Unsupported schema keyword "${key}"`);
  }
  const schema = resolve(schemaIn, root);
  const fail = (message: string): void => {
    errors.push({ path: path === '' ? '(root)' : path, message });
  };

  if (schema.const !== undefined && value !== schema.const) {
    fail(`must be ${JSON.stringify(schema.const)}`);
    return;
  }
  if (schema.enum !== undefined && !schema.enum.includes(value as string | number)) {
    fail(`must be one of ${schema.enum.map((e) => JSON.stringify(e)).join(', ')}`);
    return;
  }

  switch (schema.type) {
    case 'boolean':
      if (typeof value !== 'boolean') fail(`must be a boolean, got ${describe(value)}`);
      break;
    case 'integer':
      if (typeof value !== 'number' || !Number.isInteger(value)) {
        fail(`must be an integer, got ${describe(value)}`);
        return;
      }
      if (schema.minimum !== undefined && value < schema.minimum) {
        fail(`must be >= ${schema.minimum}`);
      }
      if (schema.maximum !== undefined && value > schema.maximum) {
        fail(`must be <= ${schema.maximum}`);
      }
      break;
    case 'string': {
      if (typeof value !== 'string') {
        fail(`must be a string, got ${describe(value)}`);
        return;
      }
      const length = [...value].length;
      if (schema.minLength !== undefined && length < schema.minLength) {
        fail(`must be at least ${schema.minLength} characters`);
      }
      if (schema.maxLength !== undefined && length > schema.maxLength) {
        fail(`must be at most ${schema.maxLength} characters, got ${length}`);
      }
      if (schema.pattern !== undefined && !new RegExp(schema.pattern, 'u').test(value)) {
        fail(`must match ${schema.pattern}`);
      }
      break;
    }
    case 'array': {
      if (!Array.isArray(value)) {
        fail(`must be an array, got ${describe(value)}`);
        return;
      }
      if (schema.minItems !== undefined && value.length < schema.minItems) {
        fail(`must have at least ${schema.minItems} items`);
      }
      if (schema.maxItems !== undefined && value.length > schema.maxItems) {
        fail(`must have at most ${schema.maxItems} items`);
      }
      if (schema.uniqueItems === true) {
        const seen = new Set(value.map((v) => JSON.stringify(v)));
        if (seen.size !== value.length) fail('must not contain duplicates');
      }
      if (schema.items !== undefined) {
        const items = schema.items;
        value.forEach((v, i) => check(items, v, join(path, i), root, errors));
      }
      break;
    }
    case 'object': {
      if (!isObject(value)) {
        fail(`must be an object, got ${describe(value)}`);
        return;
      }
      for (const key of schema.required ?? []) {
        if (!(key in value)) fail(`missing required property "${key}"`);
      }
      if (schema.minProperties !== undefined && Object.keys(value).length < schema.minProperties) {
        fail(`must have at least ${schema.minProperties} properties`);
      }
      const props = schema.properties ?? {};
      for (const [key, v] of Object.entries(value)) {
        const sub = props[key];
        if (sub !== undefined) check(sub, v, join(path, key), root, errors);
        else if (schema.additionalProperties === false) fail(`unknown property "${key}"`);
      }
      break;
    }
    case undefined:
      break;
  }

  if (schema.not !== undefined) {
    const sub: SchemaError[] = [];
    check(schema.not, value, path, root, sub);
    if (sub.length === 0) fail(`must not be ${JSON.stringify(schema.not.const ?? schema.not)}`);
  }

  if (schema.oneOf !== undefined) {
    const kinds = schema.oneOf.map((b) => branchKind(b, root));
    if (kinds.every((k) => typeof k === 'string')) {
      // Discriminated union on `kind`: report errors against the matching branch only.
      const kind = isObject(value) ? value['kind'] : undefined;
      const branch = schema.oneOf.find((_, i) => kinds[i] === kind);
      if (branch === undefined) {
        fail(`"kind" must be one of ${kinds.map((k) => JSON.stringify(k)).join(', ')}`);
      } else {
        check(branch, value, path, root, errors);
      }
    } else {
      const matches = schema.oneOf.filter((b) => {
        const sub: SchemaError[] = [];
        check(b, value, path, root, sub);
        return sub.length === 0;
      }).length;
      if (matches !== 1) fail(`must match exactly one schema in oneOf, matched ${matches}`);
    }
  }
}

/** Validates `value` against `schema` (whose `$defs` resolve `$ref`s). Returns all errors. */
export function validateSchema(schema: JsonSchema, value: unknown): SchemaError[] {
  const errors: SchemaError[] = [];
  check(schema, value, '', schema, errors);
  return errors;
}
