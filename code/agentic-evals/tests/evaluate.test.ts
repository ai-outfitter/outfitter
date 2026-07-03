import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildJudgePrompt, buildScoresSchema } from '../src/evaluate.ts';
import { loadEvalDefinition } from '../src/loadEval.ts';
import { runEval } from '../src/runner.ts';
import type { EvalRunOutcome } from '../src/runner.ts';
import type { EvaluationSpec } from '../src/types.ts';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const judgedEvalDirectory = join(packageRoot, 'tests', 'fixtures', 'judged-eval');

const evaluation: EvaluationSpec = {
  mode: 'rubric',
  evaluator_profile: 'judge-profile',
  inputs: [{ artifact: 'summary.md' }],
  rubric: [
    { criterion: 'accuracy', weight: 3 },
    { criterion: 'clarity', weight: 1 },
  ],
  blind: true,
  timeout_seconds: 30,
};

describe('buildScoresSchema / buildJudgePrompt', () => {
  it('requires every label and every rubric criterion in the schema', () => {
    const schema = buildScoresSchema(evaluation, ['artifact-a', 'artifact-b']) as {
      properties: { scores: { required: string[]; properties: Record<string, unknown> } };
    };
    expect(schema.properties.scores.required).toEqual(['artifact-a', 'artifact-b']);
    const artifact = schema.properties.scores.properties['artifact-a'] as {
      properties: { criteria: { required: string[] } };
    };
    expect(artifact.properties.criteria.required).toEqual(['accuracy', 'clarity']);
  });

  it('writes a blind prompt naming the labels, rubric, and schema file', () => {
    const prompt = buildJudgePrompt(evaluation, ['artifact-a', 'artifact-b']);
    expect(prompt).toContain('artifacts/artifact-a/');
    expect(prompt).toContain('accuracy (weight 3)');
    expect(prompt).toContain('scores.schema.json');
    expect(prompt).not.toContain('variant');
  });
});

describe('judged eval end-to-end (mock agent + mock judge)', () => {
  let resultsRoot: string;
  let outcome: EvalRunOutcome;

  beforeAll(async () => {
    resultsRoot = await mkdtemp(join(tmpdir(), 'agentic-evals-judged-'));
    const definition = await loadEvalDefinition(judgedEvalDirectory);
    outcome = await runEval(definition, { resultsRoot });
  });

  afterAll(async () => {
    await rm(resultsRoot, { recursive: true, force: true });
  });

  it('scores both variants and maps blind labels back to variants', () => {
    const scores = outcome.summary.evaluation?.scores ?? [];
    expect(scores.map((score) => score.variant)).toEqual(['strong', 'weak']);
    expect(scores[0]).toMatchObject({
      variant: 'strong',
      weighted_score: 8.75, // (9*3 + 8*1) / 4
      criteria: { accuracy: 9, clarity: 8 },
    });
    expect(scores[1]).toMatchObject({
      variant: 'weak',
      weighted_score: 2.5, // (2*3 + 4*1) / 4
      criteria: { accuracy: 2, clarity: 4 },
    });
  });

  it('captures the graded artifacts and persists judge scores in summary.json', async () => {
    const strongArtifact = await readFile(join(outcome.resultsDirectory, 'strong', 'artifacts', 'summary.md'), 'utf8');
    expect(strongArtifact).toContain('lattice');
    const summary = JSON.parse(await readFile(join(outcome.resultsDirectory, 'summary.json'), 'utf8')) as {
      evaluation?: { evaluator_profile: string; scores: { variant: string }[] };
    };
    expect(summary.evaluation?.evaluator_profile).toBe('judge-profile');
    expect(summary.evaluation?.scores).toHaveLength(2);
  });

  it('still grades mechanical assertions independently of the judge', () => {
    expect(outcome.runs.every((run) => run.passed)).toBe(true);
  });
});

describe('shipped pqc-summary eval', () => {
  it('loads with the thinking on/off matrix and a rubric evaluation', async () => {
    const definition = await loadEvalDefinition(join(packageRoot, 'evals', 'pqc-summary'));
    expect(definition.matrix?.variants.map((variant) => variant.id)).toEqual(['thinking-on', 'thinking-off']);
    expect(definition.evaluation?.mode).toBe('rubric');
    expect(definition.evaluation?.blind).toBe(true);
    expect(definition.evaluation?.rubric).toHaveLength(3);
  });
});
