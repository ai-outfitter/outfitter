// Provides the Claude Code adapter for tack generation and native launch plans.
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import type { AgentAdapter, AgentLaunchPlan, AgentTackPlan } from '../AgentAdapter.js';
import type { ClaudeProfileControls, Profile, ProfileControls } from '../../profiles/Profile.js';
import type { StatePathDeclaration, StatePersistenceStrategy, TackStatePath } from '../../tack/StatePersistence.js';
import type { Tack } from '../../tack/Tack.js';
import { createTack } from '../../tack/Tack.js';
import { createTackFile } from '../../tack/TackFile.js';

const genericControlNames = new Set([
  'model',
  'provider',
  'thinking',
  'environment',
  'args',
  'sessionDirectory',
  'session_directory',
  'extensions',
  'skills',
  'promptTemplate',
  'prompt_template',
  'systemPrompt',
  'system_prompt',
  'appendSystemPrompt',
  'append_system_prompt',
  'pi',
  'claude',
]);

const supportedClaudeGenericControls = new Set([
  'model',
  'thinking',
  'environment',
  'args',
  'extensions',
  'systemPrompt',
  'system_prompt',
  'appendSystemPrompt',
  'append_system_prompt',
  'pi',
  'claude',
]);

const claudeControlNames = new Set([
  'model',
  'thinking',
  'environment',
  'args',
  'extensions',
  'systemPrompt',
  'system_prompt',
  'appendSystemPrompt',
  'append_system_prompt',
]);

const claudeStatePathDeclarations = {
  'settings.json': { defaultStrategy: 'symlink', allowedStrategies: ['symlink', 'warn', 'error', 'prompt'] },
  'agents/': { defaultStrategy: 'symlink', allowedStrategies: ['symlink', 'discard', 'warn', 'error', 'prompt'] },
  'skills/': { defaultStrategy: 'symlink', allowedStrategies: ['symlink', 'discard', 'warn', 'error', 'prompt'] },
  'commands/': { defaultStrategy: 'symlink', allowedStrategies: ['symlink', 'discard', 'warn', 'error', 'prompt'] },
  'plugins/': { defaultStrategy: 'symlink', allowedStrategies: ['symlink', 'discard', 'warn', 'error', 'prompt'] },
  'projects/': { defaultStrategy: 'symlink', allowedStrategies: ['symlink', 'discard', 'warn', 'error'] },
  'debug/': { defaultStrategy: 'symlink', allowedStrategies: ['symlink', 'discard', 'warn', 'error'] },
  unknown: { defaultStrategy: 'warn', allowedStrategies: ['discard', 'warn', 'error', 'prompt'] },
} as const satisfies Readonly<Record<string, StatePathDeclaration>>;

export const createClaudeAdapter = (): AgentAdapter => ({
  id: 'claude',
  supportedControls: [...supportedClaudeGenericControls].filter((controlName) => !controlName.includes('_')),
  statePaths: claudeStatePathDeclarations,
  createTack(profile: Profile, input): AgentTackPlan {
    const tack = createTack(
      input.rootDirectory,
      [
        createTackFile({
          rootDirectory: input.rootDirectory,
          relativePath: 'bridl/profile.json',
          content: `${JSON.stringify({ id: profile.id, label: profile.label, controls: profile.controls }, null, 2)}\n`,
          sourceInputs: input.profilePaths,
          strategy: 'transform',
        }),
      ],
      createClaudeStatePaths(profile, input),
    );

    return {
      tack,
      warnings: this.getUnsupportedControls(profile).map(
        (controlName) => `claude adapter cannot translate requested control '${controlName}'.`,
      ),
    };
  },
  createLaunchPlan(tack: Tack, profile?: Profile, passThroughArgs: readonly string[] = []): AgentLaunchPlan {
    const controls = mergeClaudeControls(profile?.controls ?? {});

    return {
      command: 'claude',
      args: [...createClaudeArgs(controls), ...passThroughArgs],
      env: {
        ...controls.environment,
        CLAUDE_CONFIG_DIR: tack.rootDirectory,
      },
    };
  },
  getUnsupportedControls(profile: Profile): readonly string[] {
    return findUnsupportedControls(profile.controls);
  },
});

const createClaudeStatePaths = (
  profile: Profile,
  input: {
    readonly profileFolders?: readonly string[];
    readonly homeDirectory?: string;
  },
): readonly TackStatePath[] => {
  assertDeclaredStatePersistenceKeys(profile);

  return Object.entries(claudeStatePathDeclarations).map(([relativePath, declaration]) => {
    const strategy = resolveStateStrategy(profile, relativePath, declaration);
    const directory = relativePath.endsWith('/');

    return {
      relativePath,
      strategy,
      directory,
      sourcePath:
        strategy === 'symlink' && relativePath !== 'unknown'
          ? resolveClaudeStateSourcePath(input.profileFolders ?? [], input.homeDirectory, relativePath, directory)
          : undefined,
    };
  });
};

const assertDeclaredStatePersistenceKeys = (profile: Profile): void => {
  for (const relativePath of Object.keys(profile.statePersistence ?? {})) {
    if (!Object.hasOwn(claudeStatePathDeclarations, relativePath)) {
      throw new Error(`state_persistence path '${relativePath}' is not declared by the claude adapter`);
    }
  }
};

const resolveStateStrategy = (
  profile: Profile,
  relativePath: string,
  declaration: StatePathDeclaration,
): StatePersistenceStrategy => {
  const strategy = profile.statePersistence?.[relativePath] ?? declaration.defaultStrategy;

  /* v8 ignore next -- Claude declarations all define defaults; this guards future adapter declaration regressions. */
  if (strategy === undefined) {
    throw new Error(`missing state_persistence strategy for "${relativePath}"`);
  }

  if (!declaration.allowedStrategies.includes(strategy)) {
    throw new Error(`state_persistence strategy '${strategy}' is not allowed for "${relativePath}"`);
  }

  return strategy;
};

const resolveClaudeStateSourcePath = (
  profileFolders: readonly string[],
  homeDirectory: string | undefined,
  relativePath: string,
  directory: boolean,
): string => {
  const normalizedRelativePath = directory ? relativePath.slice(0, -1) : relativePath;
  const profileSource = [...profileFolders]
    .reverse()
    .map((profileFolder) => join(profileFolder, 'cli_specific', 'claude', normalizedRelativePath))
    .find((candidate) => existsSync(candidate));

  if (profileSource !== undefined) {
    return profileSource;
  }

  return join(
    /* v8 ignore next -- run command always passes homeDirectory; environment fallbacks are defensive. */
    homeDirectory ?? process.env.HOME ?? '.',
    '.claude',
    normalizedRelativePath,
  );
};

const mergeClaudeControls = (controls: ProfileControls): ClaudeProfileControls => ({
  ...controls,
  ...definedControls(controls.claude),
  environment: { ...controls.environment, ...controls.claude?.environment },
});

const definedControls = (controls: ClaudeProfileControls | undefined): Partial<ClaudeProfileControls> => {
  if (controls === undefined) {
    return {};
  }

  return Object.fromEntries(Object.entries(controls).filter((entry) => entry[1] !== undefined));
};

const createClaudeArgs = (controls: ClaudeProfileControls): readonly string[] => [
  ...flagValue('--model', controls.model),
  ...flagValue('--effort', controls.thinking),
  ...flagValue('--system-prompt', controls.systemPrompt),
  ...flagValue('--append-system-prompt', controls.appendSystemPrompt),
  ...repeatFlag('--plugin-dir', controls.extensions),
  ...(controls.args ?? []),
];

const flagValue = (flag: string, value: string | undefined): readonly string[] =>
  value === undefined ? [] : [flag, value];

const repeatFlag = (flag: string, values: readonly string[] | undefined): readonly string[] =>
  values === undefined ? [] : values.flatMap((value) => [flag, value]);

const findUnsupportedControls = (controls: ProfileControls): readonly string[] => {
  const unsupported = findUnsupportedControlNames(controls, supportedClaudeGenericControls);

  if (controls.claude !== undefined) {
    unsupported.push(
      ...findUnsupportedControlNames(controls.claude, claudeControlNames).map((controlName) => `claude.${controlName}`),
    );
  }

  return unsupported;
};

const findUnsupportedControlNames = (
  controls: Readonly<Record<string, unknown>>,
  supportedControls: ReadonlySet<string>,
): string[] => {
  const controlNames = new Set(Object.keys(controls));
  const unsupported: string[] = [];

  for (const { camelCase, snakeCase } of controlAliases) {
    if (!controlNames.has(camelCase) && !controlNames.has(snakeCase)) {
      continue;
    }

    if (!supportedControls.has(camelCase) && !supportedControls.has(snakeCase)) {
      unsupported.push(controlNames.has(snakeCase) ? snakeCase : camelCase);
    }

    controlNames.delete(camelCase);
    controlNames.delete(snakeCase);
  }

  unsupported.push(
    ...[...controlNames].filter(
      (controlName) => !genericControlNames.has(controlName) || !supportedControls.has(controlName),
    ),
  );

  return unsupported;
};

const controlAliases = [
  { camelCase: 'sessionDirectory', snakeCase: 'session_directory' },
  { camelCase: 'promptTemplate', snakeCase: 'prompt_template' },
  { camelCase: 'systemPrompt', snakeCase: 'system_prompt' },
  { camelCase: 'appendSystemPrompt', snakeCase: 'append_system_prompt' },
] as const;
