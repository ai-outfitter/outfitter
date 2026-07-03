import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadEvalDefinition } from '../src/loadEval.ts';
import { runEval } from '../src/runner.ts';
import type { EvalRunOutcome } from '../src/runner.ts';
import type { RunResult } from '../src/types.ts';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const e2eEvalDirectory = join(packageRoot, 'tests', 'fixtures', 'e2e-eval');

describe('runEval end-to-end (mock adapter)', () => {
  let resultsRoot: string;
  let outcome: EvalRunOutcome;

  beforeAll(async () => {
    resultsRoot = await mkdtemp(join(tmpdir(), 'agentic-evals-results-'));
    const definition = await loadEvalDefinition(e2eEvalDirectory);
    outcome = await runEval(definition, { resultsRoot });
  });

  afterAll(async () => {
    await rm(resultsRoot, { recursive: true, force: true });
  });

  const runsFor = (variant: string): RunResult[] => outcome.runs.filter((run) => run.variant === variant);

  it('runs the full matrix with the declared repeat count', () => {
    expect(outcome.runs).toHaveLength(4);
    expect(runsFor('good')).toHaveLength(2);
    expect(runsFor('bad')).toHaveLength(2);
  });

  it('passes the good variant on outputs, hidden-test check, and question', () => {
    for (const run of runsFor('good')) {
      expect(run.passed).toBe(true);
      expect(run.assertions.total).toBe(5);
      expect(run.assertions.passed).toBe(5);
    }
  });

  it('fails the bad variant on the hidden test and the question, not the outputs', () => {
    for (const run of runsFor('bad')) {
      expect(run.passed).toBe(false);
      const failed = run.assertions.results.filter((assertion) => !assertion.passed).map((a) => a.name);
      expect(failed).toEqual(['check hidden-tests', 'question "Which condition had the highest readmission rate?"']);
    }
  });

  it('records wall time and attributes every run to eval, variant, and run number', () => {
    for (const run of outcome.runs) {
      expect(run.eval).toBe('e2e-eval');
      expect(run.metrics.wall_time_seconds).toBeGreaterThan(0);
      expect([1, 2]).toContain(run.run);
    }
  });

  it('materializes an overridden variant as a generated profile id', () => {
    expect(runsFor('good')[0]?.profile).toBe('engineer');
    expect(runsFor('bad')[0]?.profile).toBe('e2e-eval--bad');
  });

  it('writes per-run JSON and a matrix summary to the results directory', async () => {
    const summary = JSON.parse(await readFile(join(outcome.resultsDirectory, 'summary.json'), 'utf8')) as {
      variants: { variant: string; pass_rate: number }[];
      passed: boolean;
    };
    expect(summary.passed).toBe(false);
    expect(summary.variants).toEqual([
      expect.objectContaining({ variant: 'good', runs: 2, passed: 2, pass_rate: 1 }),
      expect.objectContaining({ variant: 'bad', runs: 2, passed: 0, pass_rate: 0 }),
    ]);
    expect((await readdir(join(outcome.resultsDirectory, 'good'))).sort()).toEqual([
      'run-1.json',
      'run-1.transcript.log',
      'run-2.json',
      'run-2.transcript.log',
    ]);
    const run1 = JSON.parse(await readFile(join(outcome.resultsDirectory, 'good', 'run-1.json'), 'utf8')) as RunResult;
    expect(run1.variant).toBe('good');
    expect(run1.passed).toBe(true);
  });

  it('supports filtering to a single variant with a repeat override', async () => {
    const definition = await loadEvalDefinition(e2eEvalDirectory);
    const filtered = await runEval(definition, {
      resultsRoot,
      variantFilter: 'good',
      repeatOverride: 1,
    });
    expect(filtered.runs).toHaveLength(1);
    expect(filtered.summary.passed).toBe(true);
  });
});
