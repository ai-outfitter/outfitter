// Validates parsed Outfitter YAML/JSON documents against bundled JSON Schemas.
import { readFileSync } from 'node:fs';

import type { AnySchema, ErrorObject, ValidateFunction } from 'ajv';
import { Ajv2020 } from 'ajv/dist/2020.js';

export type SchemaName = 'settings' | 'agent' | 'system-extension-hook' | 'workflow';

export interface ValidationIssue {
  readonly path: string;
  readonly message: string;
}

export interface ValidationResult {
  readonly valid: boolean;
  readonly issues: readonly ValidationIssue[];
}

export type OutputTypeSchemaReadResult = { readonly schema: object } | { readonly issue: string };

const readSchema = (schemaFileName: string): unknown =>
  JSON.parse(readFileSync(new URL(`../schemas/${schemaFileName}`, import.meta.url), 'utf8'));

const settingsSchema = readSchema('settings.schema.json');
const agentSchema = readSchema('agent.schema.json');
const systemExtensionHookSchema = readSchema('system-extension-hook.schema.json');
const workflowSchema = readSchema('workflow.schema.json');

const ajv = new Ajv2020({ allErrors: true });
ajv.addFormat('uri', /^[A-Za-z][A-Za-z0-9+.-]*:[^\s]*$/u);

const validators: Record<SchemaName, ValidateFunction> = {
  settings: ajv.compile(settingsSchema as AnySchema),
  agent: ajv.compile(agentSchema as AnySchema),
  'system-extension-hook': ajv.compile(systemExtensionHookSchema as AnySchema),
  workflow: ajv.compile(workflowSchema as AnySchema),
};

const outputValueValidators = new WeakMap<object, ValidateFunction>();

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

export const readOutputTypeSchema = (path: string): OutputTypeSchemaReadResult => {
  let content: string;
  try {
    content = readFileSync(path, 'utf8');
  } catch (error) {
    return { issue: `schema.json is not readable: ${String(error)}` };
  }

  let schema: unknown;
  try {
    schema = JSON.parse(content);
  } catch (error) {
    return { issue: `schema.json is not valid JSON: ${String(error)}` };
  }

  if (schema === null || typeof schema !== 'object' || Array.isArray(schema)) {
    return { issue: 'schema.json must contain a JSON object' };
  }

  try {
    if (!ajv.validateSchema(schema)) {
      return { issue: `schema.json is not a valid JSON Schema: ${ajv.errorsText(ajv.errors)}` };
    }
  } catch (error) {
    return { issue: `schema.json is not a valid JSON Schema: ${String(error)}` };
  }

  return { schema };
};

export const validateOutputValue = (schema: object, value: unknown): ValidationResult => {
  let validate = outputValueValidators.get(schema);
  if (validate === undefined) {
    validate = ajv.compile(schema as AnySchema);
    outputValueValidators.set(schema, validate);
  }

  if (validate(value)) return createValidationResult([]);

  return createValidationResult((validate.errors as readonly ErrorObject[]).map(formatAjvError));
};

const formatAjvError = (error: ErrorObject): ValidationIssue => ({
  path: error.instancePath === '' ? '/' : error.instancePath,
  message: String(error.message),
});
