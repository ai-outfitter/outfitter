import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { listEvalDirectories, loadEvalDefinition } from '../src/loadEval.ts';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const e2eEvalDirectory = join(packageRoot, 'tests', 'fixtures', 'e2e-eval');

const temporaryDirectories: string[] = [];

const writeEval = async (yaml: string): Promise<string> => {
  const directory = await mkdtemp(join(tmpdir(), 'agentic-evals-load-'));
  temporaryDirectories.push(directory);
  await writeFile(join(directory, 'eval.yml'), yaml, 'utf8');
  return directory;
};

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

describe('loadEvalDefinition', () => {
  it('loads the e2e fixture eval with matrix, checks, and questions', async () => {
    const definition = await loadEvalDefinition(e2eEvalDirectory);
    expect(definition.id).toBe('e2e-eval');
    expect(definition.agent).toBe('mock');
    expect(definition.launcher).toBe('direct');
    expect(definition.matrix?.variants.map((variant) => variant.id)).toEqual(['good', 'bad']);
    expect(definition.matrix?.repeat).toBe(2);
    expect(definition.checks[0]?.inject?.[0]).toEqual({ from: 'hidden-tests', to: 'hidden-tests' });
    expect(definition.questions?.items).toHaveLength(1);
  });

  it('defaults agent to pi with the outfitter launcher and a timeout', async () => {
    const directory = await writeEval(
      ['id: x', 'profile: engineer', 'workflow:', '  prompt: do the thing', 'outputs:', '  - path: out.md'].join('\n'),
    );
    const definition = await loadEvalDefinition(directory);
    expect(definition.agent).toBe('pi');
    expect(definition.launcher).toBe('outfitter');
    expect(definition.workflow.timeout_seconds).toBe(900);
    expect(definition.outputs[0]?.assertions).toEqual([{ kind: 'exists' }]);
  });

  it('rejects an eval with nothing to grade', async () => {
    const directory = await writeEval(['id: x', 'profile: engineer', 'workflow:', '  prompt: do the thing'].join('\n'));
    await expect(loadEvalDefinition(directory)).rejects.toThrow(/at least one of/);
  });

  it('rejects duplicate matrix variant ids', async () => {
    const directory = await writeEval(
      [
        'id: x',
        'profile: engineer',
        'workflow:',
        '  prompt: p',
        'outputs:',
        '  - path: out.md',
        'matrix:',
        '  variants:',
        '    - id: a',
        '    - id: a',
      ].join('\n'),
    );
    await expect(loadEvalDefinition(directory)).rejects.toThrow(/duplicate matrix variant/);
  });

  it('requires mock.command for the mock agent', async () => {
    const directory = await writeEval(
      ['id: x', 'profile: engineer', 'agent: mock', 'workflow:', '  prompt: p', 'outputs:', '  - path: o'].join('\n'),
    );
    await expect(loadEvalDefinition(directory)).rejects.toThrow(/mock\.command/);
  });
});

describe('listEvalDirectories', () => {
  it('finds only directories containing eval.yml', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agentic-evals-list-'));
    temporaryDirectories.push(root);
    await mkdir(join(root, 'real'));
    await writeFile(join(root, 'real', 'eval.yml'), 'id: real', 'utf8');
    await mkdir(join(root, 'not-an-eval'));
    const directories = await listEvalDirectories(root);
    expect(directories).toEqual([join(root, 'real')]);
  });

  it('finds the four shipped evals', async () => {
    const directories = await listEvalDirectories(join(packageRoot, 'evals'));
    const names = directories.map((directory) => directory.split('/').at(-1));
    expect(names).toEqual([
      'data-analyst-healthcare-report',
      'engineer-code-review',
      'engineer-hidden-tests',
      'founder-demo-video',
    ]);
    for (const directory of directories) {
      await expect(loadEvalDefinition(directory)).resolves.toBeDefined();
    }
  });
});
