import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { Ajv2020 } from 'ajv/dist/2020.js';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { readOutputTypeSchema, validateOutputValue } from '../../src/validation/SchemaValidator.js';

const temporaryRoots: string[] = [];

const createTemporaryRoot = (): string => {
  const root = mkdtempSync(join(tmpdir(), 'outfitter-output-type-schema-validation-'));
  temporaryRoots.push(root);
  return root;
};

const write = (path: string, content: string): void => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
};

const schemaId = (slug: string): string => `https://schemas.example.test/output-types/${slug}`;

const outputTypeSchema = `${JSON.stringify(
  {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $id: schemaId('issue'),
    type: 'object',
    required: ['number', 'html_url'],
    properties: {
      number: { type: 'integer', minimum: 1 },
      html_url: { type: 'string', format: 'uri' },
    },
  },
  null,
  2,
)}\n`;

afterEach(() => {
  vi.restoreAllMocks();
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('output type schema validation', () => {
  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-013.3.10).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('reports a cross-schema $ref as a schema issue without throwing', () => {
    const root = createTemporaryRoot();
    const catalog = join(root, '.agents');
    write(
      join(catalog, 'output-types', 'shared', 'schema.json'),
      `${JSON.stringify({ $id: schemaId('shared'), type: 'string' })}\n`,
    );
    const path = join(catalog, 'output-types', 'dependent', 'schema.json');
    write(path, `${JSON.stringify({ $id: schemaId('dependent'), $ref: schemaId('shared') })}\n`);

    let result: ReturnType<typeof readOutputTypeSchema> | undefined;
    expect(() => {
      result = readOutputTypeSchema(path);
    }).not.toThrow();
    expect(result?.issues).toHaveLength(1);
    expect(result?.issues[0]?.kind).toBe('schema');
    expect(result?.issues[0]?.message).toContain(`can't resolve reference ${schemaId('shared')}`);
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-001.5.11, OFTR-013.3.5).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it.each([
    ['date-time', '2026-09-07T12:34:56Z', 'not a date'],
    ['email', 'author@example.test', 'not an email'],
  ])('compiles and validates the standard %s format', (format, goodValue, badValue) => {
    const root = createTemporaryRoot();
    const path = join(root, 'output-types', format, 'schema.json');
    write(path, `${JSON.stringify({ $id: schemaId(format), type: 'string', format })}\n`);

    const result = readOutputTypeSchema(path);

    expect(result.issues).toEqual([]);
    expect(result.schema).toBeDefined();
    expect(validateOutputValue(result.schema!, goodValue).valid).toBe(true);
    expect(validateOutputValue(result.schema!, badValue).valid).toBe(false);
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-013.3.5).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('validates output values against a schema read from a catalog fixture', () => {
    const root = createTemporaryRoot();
    const path = join(root, 'output-types', 'issue', 'schema.json');
    write(path, outputTypeSchema);
    const result = readOutputTypeSchema(path);
    expect(result.issues).toEqual([]);
    expect(result.id).toBe(schemaId('issue'));
    if (result.schema === undefined) return;

    expect(validateOutputValue(result.schema, { number: 377, html_url: 'https://forge.example/issues/377' })).toEqual({
      valid: true,
      issues: [],
    });
    expect(validateOutputValue(result.schema, {}).valid).toBe(false);
    expect(validateOutputValue(result.schema, { number: 377, html_url: 'not a uri' }).valid).toBe(false);
  });

  it('reuses a validator for separately parsed copies of the same schema', () => {
    const root = createTemporaryRoot();
    const path = join(root, 'output-types', 'issue', 'schema.json');
    const id = schemaId('validator-cache');
    write(path, `${JSON.stringify({ $id: id, type: 'integer', minimum: 1 })}\n`);
    const compile = vi.spyOn(Ajv2020.prototype, 'compile');

    const first = readOutputTypeSchema(path);
    const second = readOutputTypeSchema(path);

    expect(first.issues).toEqual([]);
    expect(second.issues).toEqual([]);
    expect(first.schema).toBeDefined();
    expect(second.schema).toBeDefined();
    expect(validateOutputValue(first.schema!, 1).valid).toBe(true);
    expect(validateOutputValue(second.schema!, 2).valid).toBe(true);
    expect(compile).toHaveBeenCalledTimes(1);

    write(path, `${JSON.stringify({ $id: id, type: 'integer', minimum: 2 })}\n`);
    const changed = readOutputTypeSchema(path);
    expect(changed.issues).toEqual([]);
    expect(changed.schema).toBeDefined();
    expect(validateOutputValue(changed.schema!, 1).valid).toBe(false);
    expect(compile).toHaveBeenCalledTimes(2);
  });

  it('isolates different schemas that share a canonical id', () => {
    const id = schemaId('collision');
    const stringSchema = { $id: id, type: 'string' };
    const integerSchema = { $id: id, type: 'integer' };

    expect(validateOutputValue(stringSchema, 'value').valid).toBe(true);
    expect(validateOutputValue(stringSchema, 1).valid).toBe(false);
    expect(validateOutputValue(integerSchema, 1).valid).toBe(true);
    expect(validateOutputValue(integerSchema, 'value').valid).toBe(false);
  });

  it('reports unreadable, malformed, and non-object schema documents', () => {
    const root = createTemporaryRoot();
    const missing = readOutputTypeSchema(join(root, 'missing.json'));
    expect(missing.issues[0]?.message).toContain('readable');

    const brokenPath = join(root, 'output-types', 'broken', 'schema.json');
    write(brokenPath, '{');
    const broken = readOutputTypeSchema(brokenPath);
    expect(broken.issues[0]?.message).toContain('valid JSON');

    const arrayPath = join(root, 'output-types', 'array', 'schema.json');
    write(arrayPath, '[]\n');
    expect(readOutputTypeSchema(arrayPath).issues).toEqual([
      { kind: 'schema', message: 'schema.json must contain a JSON object' },
    ]);
  });
});
