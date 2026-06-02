// Provides the Claude Code adapter for tack generation and native launch plans.
import { join } from 'node:path';

import type { AgentAdapter, AgentLaunchPlan, AgentTackPlan } from '../AgentAdapter.js';
import {
  findUnsupportedControlNames,
  flagValue,
  mergeAgentSpecificControls,
  repeatFlag,
  supportedControlNames,
} from '../AdapterProfileControls.js';
import { createDeclaredStatePaths, findProfileStateSource } from '../AdapterStatePaths.js';
import type { ClaudeProfileControls, Profile, ProfileControls } from '../../profiles/Profile.js';
import type { StatePathDeclaration, TackStatePath } from '../../tack/StatePersistence.js';
import type { Tack } from '../../tack/Tack.js';
import { createTack } from '../../tack/Tack.js';
import { createTackFile } from '../../tack/TackFile.js';

const supportedClaudeGenericControls = new Set([
  'model',
  'thinking',
  'environment',
  'args',
  'sessionDirectory',
  'session_directory',
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
  'sessionDirectory',
  'session_directory',
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
  supportedControls: supportedControlNames(supportedClaudeGenericControls),
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
  const controls = mergeClaudeControls(profile.controls);

  return createDeclaredStatePaths({
    adapterId: 'claude',
    declarations: claudeStatePathDeclarations,
    profile,
    resolveSourcePath: (relativePath, directory) =>
      resolveClaudeStateSourcePath(
        input.profileFolders ?? [],
        input.homeDirectory,
        relativePath,
        directory,
        controls.sessionDirectory,
      ),
  });
};

const resolveClaudeStateSourcePath = (
  profileFolders: readonly string[],
  homeDirectory: string | undefined,
  relativePath: string,
  directory: boolean,
  sessionDirectory: string | undefined,
): string => {
  const normalizedRelativePath = directory ? relativePath.slice(0, -1) : relativePath;

  if (relativePath === 'projects/' && sessionDirectory !== undefined) {
    return sessionDirectory;
  }

  const profileSource = findProfileStateSource(profileFolders, 'claude', relativePath, directory);

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

const mergeClaudeControls = (controls: ProfileControls): ClaudeProfileControls =>
  mergeAgentSpecificControls<ClaudeProfileControls>(controls, 'claude');

const createClaudeArgs = (controls: ClaudeProfileControls): readonly string[] => [
  ...flagValue('--model', controls.model),
  ...flagValue('--effort', controls.thinking),
  ...flagValue('--system-prompt', controls.systemPrompt),
  ...flagValue('--append-system-prompt', controls.appendSystemPrompt),
  ...repeatFlag('--plugin-dir', controls.extensions),
  ...(controls.args ?? []),
];

const findUnsupportedControls = (controls: ProfileControls): readonly string[] => {
  const unsupported = findUnsupportedControlNames(controls, supportedClaudeGenericControls);

  if (controls.claude !== undefined) {
    unsupported.push(
      ...findUnsupportedControlNames(controls.claude, claudeControlNames).map((controlName) => `claude.${controlName}`),
    );
  }

  return unsupported;
};
