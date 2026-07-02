import { readFile, readdir, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { parse } from 'yaml';
import type {
  AdapterId,
  Assertion,
  CheckSpec,
  EvalDefinition,
  FileCopySpec,
  LauncherId,
  MatrixSpec,
  OutputSpec,
  QuestionsSpec,
} from './types.ts';

const ADAPTERS: readonly AdapterId[] = ['pi', 'claude', 'mock'];
const LAUNCHERS: readonly LauncherId[] = ['outfitter', 'direct'];
const DEFAULT_TIMEOUT_SECONDS = 900;

class EvalDefinitionError extends Error {}

const fail = (evalPath: string, message: string): never => {
  throw new EvalDefinitionError(`${evalPath}: ${message}`);
};

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;

const requireString = (evalPath: string, record: Record<string, unknown>, key: string): string => {
  const value = record[key];
  if (typeof value !== 'string' || value.length === 0) {
    fail(evalPath, `"${key}" must be a non-empty string`);
  }
  return value as string;
};

const parseCopySpecs = (evalPath: string, value: unknown, key: string): FileCopySpec[] => {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value)) {
    fail(evalPath, `"${key}" must be a list`);
  }
  return (value as unknown[]).map((entry, index) => {
    const record = asRecord(entry) ?? fail(evalPath, `"${key}[${index}]" must be a mapping`);
    return {
      from: requireString(evalPath, record as Record<string, unknown>, 'from'),
      to: requireString(evalPath, record as Record<string, unknown>, 'to'),
    };
  });
};

const parseAssertion = (evalPath: string, value: unknown, where: string): Assertion => {
  const record = asRecord(value) ?? fail(evalPath, `${where} must be a mapping`);
  const kind = (record as Record<string, unknown>)['kind'];
  if (kind === 'exists') {
    return { kind: 'exists' };
  }
  if (kind === 'contains') {
    return { kind: 'contains', value: requireString(evalPath, record as Record<string, unknown>, 'value') };
  }
  if (kind === 'matches') {
    return { kind: 'matches', pattern: requireString(evalPath, record as Record<string, unknown>, 'pattern') };
  }
  return fail(evalPath, `${where} has unknown assertion kind ${JSON.stringify(kind)}`);
};

const parseOutputs = (evalPath: string, value: unknown): OutputSpec[] => {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value)) {
    fail(evalPath, '"outputs" must be a list');
  }
  return (value as unknown[]).map((entry, index) => {
    const record = asRecord(entry) ?? fail(evalPath, `"outputs[${index}]" must be a mapping`);
    const path = requireString(evalPath, record as Record<string, unknown>, 'path');
    const assertionsValue = (record as Record<string, unknown>)['assertions'] ?? [{ kind: 'exists' }];
    if (!Array.isArray(assertionsValue) || assertionsValue.length === 0) {
      fail(evalPath, `"outputs[${index}].assertions" must be a non-empty list`);
    }
    const assertions = (assertionsValue as unknown[]).map((assertion, assertionIndex) =>
      parseAssertion(evalPath, assertion, `"outputs[${index}].assertions[${assertionIndex}]"`),
    );
    return { path, assertions };
  });
};

const parseChecks = (evalPath: string, value: unknown): CheckSpec[] => {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value)) {
    fail(evalPath, '"checks" must be a list');
  }
  return (value as unknown[]).map((entry, index) => {
    const record = asRecord(entry) ?? fail(evalPath, `"checks[${index}]" must be a mapping`);
    return {
      name: requireString(evalPath, record as Record<string, unknown>, 'name'),
      command: requireString(evalPath, record as Record<string, unknown>, 'command'),
      inject: parseCopySpecs(evalPath, (record as Record<string, unknown>)['inject'], `checks[${index}].inject`),
    };
  });
};

const parseQuestions = (evalPath: string, value: unknown): QuestionsSpec | undefined => {
  if (value === undefined) {
    return undefined;
  }
  const record = asRecord(value) ?? fail(evalPath, '"questions" must be a mapping');
  const itemsValue = (record as Record<string, unknown>)['items'];
  if (!Array.isArray(itemsValue) || itemsValue.length === 0) {
    fail(evalPath, '"questions.items" must be a non-empty list');
  }
  return {
    answers_file: requireString(evalPath, record as Record<string, unknown>, 'answers_file'),
    items: (itemsValue as unknown[]).map((item, index) => {
      const itemRecord = asRecord(item) ?? fail(evalPath, `"questions.items[${index}]" must be a mapping`);
      return {
        ask: requireString(evalPath, itemRecord as Record<string, unknown>, 'ask'),
        expect: requireString(evalPath, itemRecord as Record<string, unknown>, 'expect'),
      };
    }),
  };
};

const parseMatrix = (evalPath: string, value: unknown): MatrixSpec | undefined => {
  if (value === undefined) {
    return undefined;
  }
  const record = asRecord(value) ?? fail(evalPath, '"matrix" must be a mapping');
  const variantsValue = (record as Record<string, unknown>)['variants'];
  if (!Array.isArray(variantsValue) || variantsValue.length === 0) {
    fail(evalPath, '"matrix.variants" must be a non-empty list');
  }
  const variants = (variantsValue as unknown[]).map((variant, index) => {
    const variantRecord = asRecord(variant) ?? fail(evalPath, `"matrix.variants[${index}]" must be a mapping`);
    const overrides = asRecord((variantRecord as Record<string, unknown>)['overrides']);
    return {
      id: requireString(evalPath, variantRecord as Record<string, unknown>, 'id'),
      overrides,
    };
  });
  const seen = new Set<string>();
  for (const variant of variants) {
    if (seen.has(variant.id)) {
      fail(evalPath, `duplicate matrix variant id "${variant.id}"`);
    }
    seen.add(variant.id);
  }
  const repeat = (record as Record<string, unknown>)['repeat'];
  if (repeat !== undefined && (typeof repeat !== 'number' || !Number.isInteger(repeat) || repeat < 1)) {
    fail(evalPath, '"matrix.repeat" must be a positive integer');
  }
  const baseProfile = (record as Record<string, unknown>)['base_profile'];
  if (baseProfile !== undefined && typeof baseProfile !== 'string') {
    fail(evalPath, '"matrix.base_profile" must be a string');
  }
  return {
    base_profile: baseProfile as string | undefined,
    repeat: repeat as number | undefined,
    variants,
  };
};

export const loadEvalDefinition = async (evalDirectory: string): Promise<EvalDefinition> => {
  const directory = resolve(evalDirectory);
  const evalPath = join(directory, 'eval.yml');
  const raw = parse(await readFile(evalPath, 'utf8')) as unknown;
  const record = asRecord(raw) ?? fail(evalPath, 'top level must be a mapping');
  const doc = record as Record<string, unknown>;

  const agent = (doc['agent'] ?? 'pi') as AdapterId;
  if (!ADAPTERS.includes(agent)) {
    fail(evalPath, `"agent" must be one of ${ADAPTERS.join(', ')}`);
  }
  const launcher = (doc['launcher'] ?? (agent === 'mock' ? 'direct' : 'outfitter')) as LauncherId;
  if (!LAUNCHERS.includes(launcher)) {
    fail(evalPath, `"launcher" must be one of ${LAUNCHERS.join(', ')}`);
  }
  const mockRecord = asRecord(doc['mock']);
  if (agent === 'mock' && mockRecord === undefined) {
    fail(evalPath, '"mock.command" is required when agent is "mock"');
  }

  const workflowRecord = asRecord(doc['workflow']) ?? fail(evalPath, '"workflow" must be a mapping');
  const workflow = workflowRecord as Record<string, unknown>;
  const timeoutSeconds = workflow['timeout_seconds'] ?? DEFAULT_TIMEOUT_SECONDS;
  if (typeof timeoutSeconds !== 'number' || timeoutSeconds <= 0) {
    fail(evalPath, '"workflow.timeout_seconds" must be a positive number');
  }

  const outputs = parseOutputs(evalPath, doc['outputs']);
  const checks = parseChecks(evalPath, doc['checks']);
  const questions = parseQuestions(evalPath, doc['questions']);
  if (outputs.length === 0 && checks.length === 0 && questions === undefined) {
    fail(evalPath, 'an eval must declare at least one of "outputs", "checks", or "questions"');
  }

  const metricsRecord = asRecord(doc['metrics']);
  const coverageRecord = asRecord(metricsRecord?.['coverage']);

  return {
    id: requireString(evalPath, doc, 'id'),
    profile: requireString(evalPath, doc, 'profile'),
    agent,
    launcher,
    mock:
      mockRecord === undefined
        ? undefined
        : { command: requireString(evalPath, mockRecord as Record<string, unknown>, 'command') },
    workflow: {
      prompt: requireString(evalPath, workflow, 'prompt'),
      timeout_seconds: timeoutSeconds as number,
    },
    inputs: parseCopySpecs(evalPath, doc['inputs'], 'inputs'),
    outputs,
    checks,
    questions,
    matrix: parseMatrix(evalPath, doc['matrix']),
    metrics:
      coverageRecord === undefined
        ? undefined
        : {
            coverage: {
              command: requireString(evalPath, coverageRecord as Record<string, unknown>, 'command'),
              pattern: coverageRecord['pattern'] as string | undefined,
              minimum: coverageRecord['minimum'] as number | undefined,
            },
          },
    directory,
  };
};

export const listEvalDirectories = async (evalsRoot: string): Promise<string[]> => {
  const entries = await readdir(evalsRoot, { withFileTypes: true });
  const directories: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    const candidate = join(evalsRoot, entry.name);
    try {
      await stat(join(candidate, 'eval.yml'));
      directories.push(candidate);
    } catch {
      // not an eval directory
    }
  }
  return directories.sort();
};
