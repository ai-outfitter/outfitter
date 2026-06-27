// Provides helpers for copying and asserting integration fixture trees.
import { cpSync, mkdtempSync, rmSync, readFileSync, readlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { AgentLaunchPlan } from '../../src/agents/AgentAdapter.js';
import { executeRunCommand } from '../../src/cli/commands/RunCommand.js';
import type { AgentProcessLauncher, RunCommandInput, RunCommandResult } from '../../src/cli/commands/RunCommand.js';

export interface IntegrationFixture {
  readonly name: string;
  readonly root: string;
  readonly home: string;
  readonly project: string;
  readonly cache: string;
  readonly expected: string;
}

export interface RunFixtureOptions extends Omit<Partial<RunCommandInput>, 'homeDirectory' | 'projectDirectory'> {
  readonly launcher: AgentProcessLauncher;
  readonly warnings?: string[];
}

const temporaryRoots: string[] = [];

const fixturesRoot = fileURLToPath(new URL('../fixtures/integration/', import.meta.url));
const repositoryRoot = fileURLToPath(new URL('../..', import.meta.url));

export const copyFixtureToTemp = (name: string): IntegrationFixture => {
  const temporaryRoot = mkdtempSync(join(tmpdir(), `outfitter-fixture-${name}-`));
  temporaryRoots.push(temporaryRoot);
  const root = join(temporaryRoot, name);

  cpSync(join(fixturesRoot, name), root, { recursive: true });

  return {
    name,
    root,
    home: join(root, 'home'),
    project: join(root, 'project'),
    cache: join(root, 'cache'),
    expected: join(root, 'expected'),
  };
};

export const cleanupIntegrationFixtures = (): void => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
};

export const runFixture = async (
  fixture: IntegrationFixture,
  options: RunFixtureOptions,
): Promise<RunCommandResult> => {
  const warnings = options.warnings ?? [];

  return executeRunCommand(
    {
      homeDirectory: fixture.home,
      projectDirectory: fixture.project,
      profileId: options.profileId,
      agentId: options.agentId,
      strict: options.strict,
      passThroughArgs: options.passThroughArgs,
    },
    {
      launcher: options.launcher,
      writeError: (message) => warnings.push(message),
      writeLine: () => undefined,
    },
  );
};

export const readExpectedJson = <T>(fixture: IntegrationFixture, relativePath: string): T =>
  JSON.parse(readFileSync(join(fixture.expected, relativePath), 'utf8')) as T;

export const readFixtureText = (fixture: IntegrationFixture, relativePath: string): string =>
  readFileSync(join(fixture.root, relativePath), 'utf8');

export const compositeProfileRootFromLaunchPlan = (plan: AgentLaunchPlan): string => {
  const compositeProfileRoot = plan.env.PI_CODING_AGENT_DIR ?? plan.env.CLAUDE_CONFIG_DIR;

  if (compositeProfileRoot === undefined) {
    throw new Error('Launch plan did not include a known adapter config directory environment variable.');
  }

  return compositeProfileRoot;
};

export const summarizePiCompositeProfile = (fixture: IntegrationFixture, compositeProfileRoot: string): unknown => ({
  generatedProfile: JSON.parse(
    readFileSync(join(compositeProfileRoot, 'outfitter', 'profile.json'), 'utf8'),
  ) as unknown,
  stateTargets: {
    'auth.json': tokenizeFixturePath(
      fixture,
      readlinkSync(join(compositeProfileRoot, 'auth.json')),
      compositeProfileRoot,
    ),
    'settings.json': tokenizeFixturePath(
      fixture,
      readlinkSync(join(compositeProfileRoot, 'settings.json')),
      compositeProfileRoot,
    ),
    utilities: tokenizeFixturePath(
      fixture,
      readlinkSync(join(compositeProfileRoot, 'utilities')),
      compositeProfileRoot,
    ),
  },
});

export const summarizeClaudeCompositeProfile = (
  fixture: IntegrationFixture,
  compositeProfileRoot: string,
): unknown => ({
  generatedProfile: JSON.parse(
    readFileSync(join(compositeProfileRoot, 'outfitter', 'profile.json'), 'utf8'),
  ) as unknown,
  stateTargets: {
    'settings.json': tokenizeFixturePath(
      fixture,
      readlinkSync(join(compositeProfileRoot, 'settings.json')),
      compositeProfileRoot,
    ),
    agents: tokenizeFixturePath(fixture, readlinkSync(join(compositeProfileRoot, 'agents')), compositeProfileRoot),
    projects: tokenizeFixturePath(fixture, readlinkSync(join(compositeProfileRoot, 'projects')), compositeProfileRoot),
  },
});

export const tokenizeFixturePath = (
  fixture: IntegrationFixture,
  path: string,
  compositeProfileRoot?: string,
): string => {
  if (compositeProfileRoot !== undefined && path === compositeProfileRoot) {
    return '<composite-profile>';
  }

  return path
    .replaceAll(compositeProfileRoot ?? '\0', '<composite-profile>')
    .replaceAll(fixture.home, '<home>')
    .replaceAll(fixture.project, '<project>')
    .replaceAll(fixture.cache, '<cache>')
    .replaceAll(fixture.root, '<fixture>')
    .replaceAll(repositoryRoot, '<repo>/');
};
