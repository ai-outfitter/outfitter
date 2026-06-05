// Validates parsed ApplePi YAML documents against bundled JSON Schemas.
import { readFileSync } from 'node:fs';

import type { AnySchema, ErrorObject, ValidateFunction } from 'ajv';
import { Ajv2020 } from 'ajv/dist/2020.js';

export type SchemaName = 'settings' | 'profile' | 'profile-source';

export interface ValidationIssue {
  readonly path: string;
  readonly message: string;
}

export interface ValidationResult {
  readonly valid: boolean;
  readonly issues: readonly ValidationIssue[];
}

const readSchema = (schemaFileName: string): unknown =>
  JSON.parse(readFileSync(new URL(`../schemas/${schemaFileName}`, import.meta.url), 'utf8'));

const settingsSchema = readSchema('settings.schema.json');
const profileSchema = readSchema('profile.schema.json');
const profileSourceSchema = readSchema('profile-source.schema.json');

const createAjv = (): Ajv2020 => {
  const ajv = new Ajv2020({ allErrors: true });
  ajv.addSchema(profileSourceSchema as AnySchema, 'profile-source.schema.json');
  ajv.addSchema(profileSchema as AnySchema, 'profile.schema.json');
  ajv.addSchema(settingsSchema as AnySchema, 'settings.schema.json');
  return ajv;
};

const ajv = createAjv();

const validators: Record<SchemaName, ValidateFunction> = {
  settings: ajv.compile(settingsSchema as AnySchema),
  profile: ajv.compile(profileSchema as AnySchema),
  'profile-source': ajv.compile(profileSourceSchema as AnySchema),
};

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

const formatAjvError = (error: ErrorObject): ValidationIssue => ({
  path: error.instancePath === '' ? '/' : error.instancePath,
  message: String(error.message),
});
