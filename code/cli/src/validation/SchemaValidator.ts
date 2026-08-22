// Validates parsed Outfitter YAML/JSON documents against bundled JSON Schemas.
import { readFileSync } from 'node:fs';

import type { AnySchema, ErrorObject, ValidateFunction } from 'ajv';
import { Ajv2020 } from 'ajv/dist/2020.js';

export type SchemaName = 'settings' | 'agent' | 'system-extension-hook' | 'workspace-hook';

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
const agentSchema = readSchema('agent.schema.json');
const systemExtensionHookSchema = readSchema('system-extension-hook.schema.json');
const workspaceHookSchema = readSchema('workspace-hook.schema.json');

const ajv = new Ajv2020({ allErrors: true });

const validators: Record<SchemaName, ValidateFunction> = {
  settings: ajv.compile(settingsSchema as AnySchema),
  agent: ajv.compile(agentSchema as AnySchema),
  'system-extension-hook': ajv.compile(systemExtensionHookSchema as AnySchema),
  'workspace-hook': ajv.compile(workspaceHookSchema as AnySchema),
};

export const createValidationResult = (issues: readonly ValidationIssue[]): ValidationResult => ({
  valid: issues.length === 0,
  issues,
});

/** Renders schema issues as one `<file>#<path> <message>` list for a read-boundary error. */
export const formatValidationIssues = (filePath: string, issues: readonly ValidationIssue[]): string =>
  issues.map((issue) => `${filePath}#${issue.path} ${issue.message}`).join('; ');

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
