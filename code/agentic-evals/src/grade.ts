import { cp, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { exec } from './exec.ts';
import type { AssertionResult, CoverageMetricSpec, EvalDefinition } from './types.ts';

const CHECK_TIMEOUT_MS = 300_000;
const DEFAULT_COVERAGE_PATTERN = /(\d+(?:\.\d+)?)\s*%/g;

const readWorkspaceFile = async (workspace: string, path: string): Promise<string | undefined> => {
  try {
    return await readFile(join(workspace, path), 'utf8');
  } catch {
    return undefined;
  }
};

export const gradeOutputs = async (definition: EvalDefinition, workspace: string): Promise<AssertionResult[]> => {
  const results: AssertionResult[] = [];
  for (const output of definition.outputs) {
    const content = await readWorkspaceFile(workspace, output.path);
    for (const assertion of output.assertions) {
      const name = `${output.path} ${assertion.kind}`;
      if (content === undefined) {
        results.push({ name, passed: false, detail: `${output.path} was not produced` });
        continue;
      }
      if (assertion.kind === 'exists') {
        results.push({ name, passed: true });
      } else if (assertion.kind === 'contains') {
        results.push({
          name: `${name} ${JSON.stringify(assertion.value)}`,
          passed: content.includes(assertion.value),
          detail: content.includes(assertion.value) ? undefined : 'value not found in output',
        });
      } else {
        const matched = new RegExp(assertion.pattern, 'im').test(content);
        results.push({
          name: `${name} /${assertion.pattern}/`,
          passed: matched,
          detail: matched ? undefined : 'pattern did not match output',
        });
      }
    }
  }
  return results;
};

export const gradeQuestions = async (definition: EvalDefinition, workspace: string): Promise<AssertionResult[]> => {
  if (definition.questions === undefined) {
    return [];
  }
  const answers = await readWorkspaceFile(workspace, definition.questions.answers_file);
  return definition.questions.items.map((question) => {
    const name = `question ${JSON.stringify(question.ask)}`;
    if (answers === undefined) {
      return { name, passed: false, detail: `${definition.questions?.answers_file} was not produced` };
    }
    const passed = answers.toLowerCase().includes(question.expect.toLowerCase());
    return { name, passed, detail: passed ? undefined : `expected ${JSON.stringify(question.expect)}` };
  });
};

export const runChecks = async (definition: EvalDefinition, workspace: string): Promise<AssertionResult[]> => {
  const results: AssertionResult[] = [];
  for (const check of definition.checks) {
    for (const inject of check.inject ?? []) {
      await cp(join(definition.directory, inject.from), join(workspace, inject.to), { recursive: true });
    }
    const result = await exec({
      command: check.command,
      cwd: workspace,
      shell: true,
      timeoutMs: CHECK_TIMEOUT_MS,
    });
    const passed = result.exitCode === 0 && !result.timedOut;
    results.push({
      name: `check ${check.name}`,
      passed,
      detail: passed
        ? undefined
        : `exit ${String(result.exitCode)}${result.timedOut ? ' (timed out)' : ''}: ${result.stderr.slice(0, 1000) || result.stdout.slice(-1000)}`,
    });
  }
  return results;
};

export interface CoverageResult {
  readonly percent: number | null;
  readonly assertion?: AssertionResult;
}

export const measureCoverage = async (coverage: CoverageMetricSpec, workspace: string): Promise<CoverageResult> => {
  const result = await exec({
    command: coverage.command,
    cwd: workspace,
    shell: true,
    timeoutMs: CHECK_TIMEOUT_MS,
  });
  const output = `${result.stdout}\n${result.stderr}`;
  let percent: number | null = null;
  if (coverage.pattern !== undefined) {
    const match = new RegExp(coverage.pattern, 'm').exec(output);
    percent = match?.[1] !== undefined ? Number(match[1]) : null;
  } else {
    let match: RegExpExecArray | null;
    const pattern = new RegExp(DEFAULT_COVERAGE_PATTERN.source, 'gm');
    while ((match = pattern.exec(output)) !== null) {
      percent = Number(match[1]);
    }
  }
  if (coverage.minimum === undefined) {
    return { percent };
  }
  const passed = percent !== null && percent >= coverage.minimum;
  return {
    percent,
    assertion: {
      name: `coverage >= ${String(coverage.minimum)}%`,
      passed,
      detail: passed ? undefined : `measured ${percent === null ? 'nothing' : `${String(percent)}%`}`,
    },
  };
};
