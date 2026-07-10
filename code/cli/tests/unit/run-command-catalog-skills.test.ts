// Tests catalog skill ID resolution and reference materialization during run launches.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { executeRunCommand } from '../../src/cli/commands/RunCommand.js';
import { executeProfileLintCommand } from '../../src/cli/commands/profile/LintCommand.js';

const temporaryRoots: string[] = [];

const createTemporaryRoot = (): string => {
  const root = mkdtempSync(join(tmpdir(), 'outfitter-run-catalog-skills-'));
  temporaryRoots.push(root);
  return root;
};

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

const noopDependencies = {
  launcher: {
    launch() {
      return Promise.resolve(0);
    },
  },
  writeLine: () => undefined,
  writeError: () => undefined,
} as const;

const writeProjectFixture = (root: string, skillFrontmatter: string, profileSkillsYaml: string) => {
  const homeDirectory = join(root, 'home');
  const projectDirectory = join(root, 'project');
  mkdirSync(join(homeDirectory, '.outfitter'), { recursive: true });
  writeFileSync(
    join(homeDirectory, '.outfitter', 'settings.yml'),
    'default_profile: platform\nprofile_sources:\n  - path: ./profiles\n',
  );
  mkdirSync(join(homeDirectory, '.outfitter', 'profiles', 'platform'), { recursive: true });
  writeFileSync(
    join(homeDirectory, '.outfitter', 'profiles', 'platform', 'profile.yml'),
    `id: platform\ncontrols:\n  skills:\n${profileSkillsYaml}`,
  );
  const skillDirectory = join(projectDirectory, '.outfitter', 'skills', 'deploy-review');
  mkdirSync(skillDirectory, { recursive: true });
  writeFileSync(join(skillDirectory, 'SKILL.md'), `---\n${skillFrontmatter}\n---\n# Deploy Review\n`);
  mkdirSync(join(projectDirectory, 'docs'), { recursive: true });
  writeFileSync(join(projectDirectory, 'docs', 'runbook.md'), 'runbook\n');

  return { homeDirectory, projectDirectory };
};

describe('run command catalog skill selection', () => {
  it('resolves a bare skill ID to a generated skill with materialized references', async () => {
    const root = createTemporaryRoot();
    const { homeDirectory, projectDirectory } = writeProjectFixture(
      root,
      'name: deploy-review\nreferences:\n  - repo_file: docs/runbook.md',
      '    - deploy-review\n',
    );

    const result = await executeRunCommand(
      { homeDirectory, projectDirectory, passThroughArgs: ['--debug'] },
      noopDependencies,
    );

    const generatedDirectory = join(result.compositeProfileDirectory, 'outfitter', 'skills', 'deploy-review');
    expect(result.warnings).toEqual([]);
    expect(result.launchPlan.args).toContain('--skill');
    expect(result.launchPlan.args).toContain(generatedDirectory);
    expect(readFileSync(join(generatedDirectory, 'references', 'runbook.md'), 'utf8')).toBe('runbook\n');
  });

  it('materializes profile-added references from an { id, references } selection', async () => {
    const root = createTemporaryRoot();
    const { homeDirectory, projectDirectory } = writeProjectFixture(
      root,
      'name: deploy-review',
      '    - id: deploy-review\n      references:\n        - repo_file: docs/runbook.md\n',
    );

    const result = await executeRunCommand(
      { homeDirectory, projectDirectory, passThroughArgs: ['--debug'] },
      noopDependencies,
    );

    const generatedDirectory = join(result.compositeProfileDirectory, 'outfitter', 'skills', 'deploy-review');
    expect(readFileSync(join(generatedDirectory, 'references', 'runbook.md'), 'utf8')).toBe('runbook\n');
  });

  it('fails the launch when a selected skill has a broken catalog file reference', async () => {
    const root = createTemporaryRoot();
    const { homeDirectory, projectDirectory } = writeProjectFixture(
      root,
      'name: deploy-review\nreferences:\n  - file: docs/absent.md',
      '    - deploy-review\n',
    );

    await expect(executeRunCommand({ homeDirectory, projectDirectory }, noopDependencies)).rejects.toThrow(
      /Cannot resolve profile skills.*absent\.md/u,
    );
  });
});

describe('profile lint catalog skill diagnostics', () => {
  it('reports unresolved object selections and broken references without materializing', () => {
    const root = createTemporaryRoot();
    const { homeDirectory, projectDirectory } = writeProjectFixture(
      root,
      'name: deploy-review\nreferences:\n  - file: docs/absent.md',
      '    - deploy-review\n    - id: missing-skill\n',
    );

    const result = executeProfileLintCommand({ homeDirectory, projectDirectory });

    expect(result.exitCode).toBe(1);
    expect(result.diagnostics.some((diagnostic) => diagnostic.message.includes("'missing-skill'"))).toBe(true);
    expect(result.diagnostics.some((diagnostic) => diagnostic.message.includes('absent.md'))).toBe(true);
  });

  it('passes a valid catalog skill selection', () => {
    const root = createTemporaryRoot();
    const { homeDirectory, projectDirectory } = writeProjectFixture(
      root,
      'name: deploy-review\nreferences:\n  - repo_file: docs/runbook.md',
      '    - deploy-review\n',
    );

    const result = executeProfileLintCommand({ homeDirectory, projectDirectory });

    expect(result.diagnostics).toEqual([]);
    expect(result.exitCode).toBe(0);
  });
});
