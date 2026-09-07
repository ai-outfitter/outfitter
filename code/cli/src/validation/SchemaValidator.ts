// Validates parsed Outfitter YAML/JSON documents against bundled JSON Schemas.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import type { AnySchema, ErrorObject, ValidateFunction } from 'ajv';
import { Ajv2020 } from 'ajv/dist/2020.js';
import addFormatsModule from 'ajv-formats';

export type SchemaName = 'settings' | 'agent' | 'system-extension-hook' | 'workflow';

export interface ValidationIssue {
  readonly kind?: 'schema';
  readonly path: string;
  readonly message: string;
}

export interface ValidationResult {
  readonly valid: boolean;
  readonly issues: readonly ValidationIssue[];
}

export interface OutputTypeSchemaIssue {
  readonly kind: 'schema' | 'identity';
  readonly message: string;
}

export interface OutputTypeSchemaReadResult {
  readonly schema?: object;
  readonly id?: string;
  readonly sha256?: string;
  readonly issues: readonly OutputTypeSchemaIssue[];
}

const readSchema = (schemaFileName: string): unknown =>
  JSON.parse(readFileSync(new URL(`../schemas/${schemaFileName}`, import.meta.url), 'utf8'));

const settingsSchema = readSchema('settings.schema.json');
const agentSchema = readSchema('agent.schema.json');
const systemExtensionHookSchema = readSchema('system-extension-hook.schema.json');
const workflowSchema = readSchema('workflow.schema.json');
const addFormats = addFormatsModule.default;

const ajv = new Ajv2020({ allErrors: true });
const outputTypeAjv = new Ajv2020({ allErrors: true, addUsedSchema: false });
addFormats(outputTypeAjv);
// Retain Outfitter's intentionally laxer URI check, which accepts any scheme plus a non-whitespace suffix.
outputTypeAjv.addFormat('uri', /^[A-Za-z][A-Za-z0-9+.-]*:[^\s]*$/u);

const validators: Record<SchemaName, ValidateFunction> = {
  settings: ajv.compile(settingsSchema as AnySchema),
  agent: ajv.compile(agentSchema as AnySchema),
  'system-extension-hook': ajv.compile(systemExtensionHookSchema as AnySchema),
  workflow: ajv.compile(workflowSchema as AnySchema),
};

const outputValueValidators = new Map<string, ValidateFunction>();

export const createValidationResult = (issues: readonly ValidationIssue[]): ValidationResult => ({
  valid: issues.length === 0,
  issues,
});

export const validateSchema = (schemaName: SchemaName, document: unknown): ValidationResult => {
  const validate = validators[schemaName];

  if (validate(document)) {
    return createValidationResult([]);
  }

  return createValidationResult((validate.errors as readonly ErrorObject[]).map(formatAjvError));
};

const canonicalSchemaId = (schema: object): string | undefined => {
  const candidateId = (schema as { readonly $id?: unknown }).$id;
  if (typeof candidateId !== 'string') return undefined;
  try {
    new URL(candidateId);
    return candidateId;
  } catch {
    return undefined;
  }
};

const jsonSchemaIssue = (schema: object): OutputTypeSchemaIssue | undefined => {
  try {
    return ajv.validateSchema(schema)
      ? undefined
      : { kind: 'schema', message: `schema.json is not a valid JSON Schema: ${ajv.errorsText(ajv.errors)}` };
  } catch (error) {
    return { kind: 'schema', message: `schema.json is not a valid JSON Schema: ${String(error)}` };
  }
};

const canonicalJson = (schema: object): string =>
  JSON.stringify(schema, (_key, value: unknown) =>
    value !== null && typeof value === 'object' && !Array.isArray(value)
      ? Object.fromEntries(Object.entries(value).sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0)))
      : value,
  );

const compileOutputTypeSchema = (schema: object): { readonly validate?: ValidateFunction; readonly issue?: string } => {
  try {
    const digest = createHash('sha256').update(canonicalJson(schema)).digest('hex');
    const cacheKey = `${canonicalSchemaId(schema) ?? ''}\u0000${digest}`;
    let validate = outputValueValidators.get(cacheKey);
    if (validate === undefined) {
      validate = outputTypeAjv.compile(schema as AnySchema);
      outputValueValidators.set(cacheKey, validate);
    }
    return { validate };
  } catch (error) {
    return { issue: `schema.json cannot be compiled: ${String(error)}` };
  }
};

export const readOutputTypeSchema = (path: string): OutputTypeSchemaReadResult => {
  let bytes: Buffer;
  try {
    bytes = readFileSync(path);
  } catch (error) {
    return { issues: [{ kind: 'schema', message: `schema.json is not readable: ${String(error)}` }] };
  }

  const sha256 = createHash('sha256').update(bytes).digest('hex');

  let schema: unknown;
  try {
    schema = JSON.parse(bytes.toString('utf8'));
  } catch (error) {
    return {
      sha256,
      issues: [{ kind: 'schema', message: `schema.json is not valid JSON: ${String(error)}` }],
    };
  }

  if (schema === null || typeof schema !== 'object' || Array.isArray(schema)) {
    return { sha256, issues: [{ kind: 'schema', message: 'schema.json must contain a JSON object' }] };
  }

  const issues: OutputTypeSchemaIssue[] = [];
  const id = canonicalSchemaId(schema);
  if (id === undefined) issues.push({ kind: 'identity', message: 'missing canonical $id' });
  const schemaIssue = jsonSchemaIssue(schema);
  if (schemaIssue !== undefined) issues.push(schemaIssue);
  else {
    const compileResult = compileOutputTypeSchema(schema);
    if (compileResult.issue !== undefined) issues.push({ kind: 'schema', message: compileResult.issue });
  }

  return { schema, ...(id === undefined ? {} : { id }), sha256, issues };
};

/**
 * Validates a value with an isolated Ajv instance. Validators are cached by canonical `$id` plus
 * the SHA-256 digest of canonical JSON, so reparsed schemas reuse code while `$id` collisions do not.
 */
export const validateOutputValue = (schema: object, value: unknown): ValidationResult => {
  const compileResult = compileOutputTypeSchema(schema);
  if (compileResult.validate === undefined)
    return createValidationResult([{ kind: 'schema', path: '/', message: compileResult.issue! }]);
  const validate = compileResult.validate;

  if (validate(value)) return createValidationResult([]);

  return createValidationResult((validate.errors as readonly ErrorObject[]).map(formatAjvError));
};

const formatAjvError = (error: ErrorObject): ValidationIssue => ({
  path: error.instancePath === '' ? '/' : error.instancePath,
  message: String(error.message),
});
