import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runAgent } from './adapters.ts';
import type { EvalDefinition, EvaluationResult, EvaluationSpec, JudgeScore } from './types.ts';

const SCORES_FILE = 'scores.json';
const SCHEMA_FILE = 'scores.schema.json';

/** JSON schema the judge's scores.json response must conform to. */
export const buildScoresSchema = (evaluation: EvaluationSpec, labels: readonly string[]): Record<string, unknown> => ({
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  type: 'object',
  required: ['scores'],
  additionalProperties: false,
  properties: {
    scores: {
      type: 'object',
      required: [...labels],
      additionalProperties: false,
      properties: Object.fromEntries(
        labels.map((label) => [
          label,
          {
            type: 'object',
            required: ['criteria'],
            additionalProperties: false,
            properties: {
              criteria: {
                type: 'object',
                required: evaluation.rubric.map((entry) => entry.criterion),
                additionalProperties: false,
                properties: Object.fromEntries(
                  evaluation.rubric.map((entry) => [entry.criterion, { type: 'number', minimum: 0, maximum: 10 }]),
                ),
              },
              notes: { type: 'string' },
            },
          },
        ]),
      ),
    },
  },
});

export const buildJudgePrompt = (evaluation: EvaluationSpec, labels: readonly string[]): string => {
  const rubricLines = evaluation.rubric
    .map((entry) => `- ${entry.criterion} (weight ${String(entry.weight)})`)
    .join('\n');
  return [
    'You are grading anonymized artifacts produced by different runs of the same task.',
    'You must not guess or care which configuration produced which artifact.',
    '',
    `The artifacts are in these directories: ${labels.map((label) => `artifacts/${label}/`).join(', ')}.`,
    'Read every artifact, then score each one against this rubric, 0-10 per criterion:',
    rubricLines,
    '',
    `Write your scores to ${SCORES_FILE}, conforming exactly to the JSON schema in ${SCHEMA_FILE}:`,
    'top-level "scores" object keyed by artifact label, each with a "criteria" object mapping every',
    'rubric criterion to a number 0-10, plus an optional short "notes" string. Write nothing else.',
  ].join('\n');
};

interface RawScoreEntry {
  criteria?: Record<string, unknown>;
  notes?: unknown;
}

const parseScores = (
  raw: string,
  evaluation: EvaluationSpec,
  labelToVariant: ReadonlyMap<string, string>,
): JudgeScore[] => {
  const parsed = JSON.parse(raw) as { scores?: Record<string, RawScoreEntry> };
  if (parsed.scores === undefined) {
    throw new Error('scores.json is missing the top-level "scores" object');
  }
  const totalWeight = evaluation.rubric.reduce((total, entry) => total + entry.weight, 0);
  const results: JudgeScore[] = [];
  for (const [label, variant] of labelToVariant) {
    const entry = parsed.scores[label];
    if (entry?.criteria === undefined) {
      throw new Error(`scores.json has no criteria for ${label}`);
    }
    const criteria: Record<string, number> = {};
    let weighted = 0;
    for (const rubricEntry of evaluation.rubric) {
      const score = entry.criteria[rubricEntry.criterion];
      if (typeof score !== 'number' || score < 0 || score > 10) {
        throw new Error(`scores.json: ${label} has an invalid score for "${rubricEntry.criterion}"`);
      }
      criteria[rubricEntry.criterion] = score;
      weighted += score * rubricEntry.weight;
    }
    results.push({
      variant,
      weighted_score: Number((weighted / totalWeight).toFixed(2)),
      criteria,
      notes: typeof entry.notes === 'string' ? entry.notes : undefined,
    });
  }
  return results.sort((a, b) => b.weighted_score - a.weighted_score);
};

/**
 * Run the evaluator agent over one captured artifact directory per variant.
 * Variants are shuffled behind anonymous labels so the judge stays blind.
 */
export const runJudge = async (
  definition: EvalDefinition,
  variantArtifacts: ReadonlyMap<string, string>,
): Promise<EvaluationResult> => {
  const evaluation = definition.evaluation;
  if (evaluation === undefined) {
    throw new Error(`eval ${definition.id} has no evaluation block`);
  }
  const shuffled = [...variantArtifacts.entries()].sort(() => Math.random() - 0.5);
  const labelToVariant = new Map<string, string>();
  const workspace = await mkdtemp(join(tmpdir(), `agentic-eval-${definition.id}-judge-`));
  try {
    const labels: string[] = [];
    for (const [index, [variant, artifactDirectory]] of shuffled.entries()) {
      const label = `artifact-${String.fromCharCode(97 + index)}`;
      labels.push(label);
      labelToVariant.set(label, variant);
      await cp(artifactDirectory, join(workspace, 'artifacts', label), { recursive: true });
    }
    const schema = buildScoresSchema(evaluation, labels);
    await writeFile(join(workspace, SCHEMA_FILE), `${JSON.stringify(schema, null, 2)}\n`, 'utf8');

    const judgeDefinition: EvalDefinition = {
      ...definition,
      profile: evaluation.evaluator_profile,
      workflow: {
        prompt: buildJudgePrompt(evaluation, labels),
        timeout_seconds: evaluation.timeout_seconds,
      },
    };
    const result = await runAgent({
      definition: judgeDefinition,
      profileId: evaluation.evaluator_profile,
      variantId: 'judge',
      workspace,
      role: 'judge',
    });
    if (result.timedOut) {
      throw new Error('judge run timed out');
    }
    const scoresPath = join(workspace, SCORES_FILE);
    if (!existsSync(scoresPath)) {
      throw new Error(`judge did not produce ${SCORES_FILE} (exit ${String(result.exitCode)})`);
    }
    return {
      mode: 'rubric',
      evaluator_profile: evaluation.evaluator_profile,
      scores: parseScores(await readFile(scoresPath, 'utf8'), evaluation, labelToVariant),
    };
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
};
