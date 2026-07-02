import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { gradeOutputs, gradeQuestions, measureCoverage } from '../src/grade.ts';
import { parseClaudeJsonMetrics } from '../src/adapters.ts';
import { deepMerge } from '../src/runner.ts';
import type { EvalDefinition } from '../src/types.ts';

const temporaryDirectories: string[] = [];

const makeWorkspace = async (): Promise<string> => {
  const workspace = await mkdtemp(join(tmpdir(), 'agentic-evals-grade-'));
  temporaryDirectories.push(workspace);
  return workspace;
};

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

const baseDefinition = (overrides: Partial<EvalDefinition>): EvalDefinition => ({
  id: 'test',
  profile: 'engineer',
  agent: 'mock',
  launcher: 'direct',
  workflow: { prompt: 'p', timeout_seconds: 30 },
  inputs: [],
  outputs: [],
  checks: [],
  directory: '/nonexistent',
  ...overrides,
});

describe('gradeOutputs', () => {
  it('fails every assertion for a missing artifact and passes matching ones', async () => {
    const workspace = await makeWorkspace();
    await writeFile(join(workspace, 'report.html'), '<html>Readmission rates</html>', 'utf8');
    const definition = baseDefinition({
      outputs: [
        {
          path: 'report.html',
          assertions: [
            { kind: 'exists' },
            { kind: 'contains', value: '<html' },
            { kind: 'matches', pattern: 'READMISSION' },
          ],
        },
        { path: 'missing.md', assertions: [{ kind: 'exists' }, { kind: 'contains', value: 'x' }] },
      ],
    });
    const results = await gradeOutputs(definition, workspace);
    expect(results.map((result) => result.passed)).toEqual([true, true, true, false, false]);
  });
});

describe('gradeQuestions', () => {
  it('greps answers case-insensitively and fails when the file is missing', async () => {
    const workspace = await makeWorkspace();
    const definition = baseDefinition({
      questions: {
        answers_file: 'answers.md',
        items: [
          { ask: 'q1', expect: 'Heart Failure' },
          { ask: 'q2', expect: 'sepsis' },
        ],
      },
    });
    expect((await gradeQuestions(definition, workspace)).map((result) => result.passed)).toEqual([false, false]);
    await writeFile(join(workspace, 'answers.md'), '1. heart failure\n2. pneumonia\n', 'utf8');
    expect((await gradeQuestions(definition, workspace)).map((result) => result.passed)).toEqual([true, false]);
  });
});

describe('measureCoverage', () => {
  it('extracts a percentage and gates on the minimum', async () => {
    const workspace = await makeWorkspace();
    const passing = await measureCoverage({ command: 'echo "lines: 91.4%"', minimum: 80 }, workspace);
    expect(passing.percent).toBe(91.4);
    expect(passing.assertion?.passed).toBe(true);
    const failing = await measureCoverage({ command: 'echo "lines: 42%"', minimum: 80 }, workspace);
    expect(failing.assertion?.passed).toBe(false);
  });

  it('supports a custom capture pattern', async () => {
    const workspace = await makeWorkspace();
    const result = await measureCoverage(
      { command: 'echo "all files | 73.2 | 80"', pattern: 'all files \\| (\\d+(?:\\.\\d+)?)' },
      workspace,
    );
    expect(result.percent).toBe(73.2);
  });
});

describe('parseClaudeJsonMetrics', () => {
  it('parses usage from claude -p JSON output and tolerates garbage', () => {
    const metrics = parseClaudeJsonMetrics(
      JSON.stringify({ usage: { input_tokens: 10, output_tokens: 5 }, num_turns: 3, total_cost_usd: 0.02 }),
    );
    expect(metrics).toEqual({ tokens_in: 10, tokens_out: 5, turns: 3, cost_usd: 0.02 });
    expect(parseClaudeJsonMetrics('not json')).toEqual({});
  });
});

describe('deepMerge', () => {
  it('merges nested records and replaces scalars and arrays', () => {
    expect(
      deepMerge(
        { controls: { model: 'a', thinking: 'high' }, skills: ['x'] },
        { controls: { thinking: 'off' }, skills: [] },
      ),
    ).toEqual({ controls: { model: 'a', thinking: 'off' }, skills: [] });
  });
});
