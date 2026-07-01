// Provides the Claude Code adapter for composite profile generation and native launch plans.
import { homedir } from 'node:os';
import { join } from 'node:path';

import type { AgentAdapter, AgentLaunchContext, AgentLaunchPlan, AgentCompositeProfilePlan } from '../AgentAdapter.js';
import {
  findUnsupportedControlNames,
  flagValue,
  mergeAgentSpecificControls,
  repeatFlag,
  repeatFlagValue,
  supportedControlNames,
} from '../AdapterProfileControls.js';
import { createDeclaredStatePaths, findProfileStateSource } from '../AdapterStatePaths.js';
import type { ClaudeProfileControls, Profile, ProfileControls } from '../../profiles/Profile.js';
import { resolveAppendSystemPromptControl } from '../../profiles/PromptIncludes.js';
import type { StatePathDeclaration, CompositeProfileStatePath } from '../../compositeProfile/StatePersistence.js';
import type { CompositeProfile } from '../../compositeProfile/CompositeProfile.js';
import { createCompositeProfile } from '../../compositeProfile/CompositeProfile.js';
import { createCompositeProfileFile } from '../../compositeProfile/CompositeProfileFile.js';

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
  createCompositeProfile(profile: Profile, input): AgentCompositeProfilePlan {
    const compositeProfile = createCompositeProfile(
      input.rootDirectory,
      [
        createCompositeProfileFile({
          rootDirectory: input.rootDirectory,
          relativePath: 'outfitter/profile.json',
          content: `${JSON.stringify({ id: profile.id, label: profile.label, controls: profile.controls }, null, 2)}\n`,
          sourceInputs: input.profilePaths,
          strategy: 'transform',
        }),
      ],
      createClaudeStatePaths(profile, input),
    );

    return {
      compositeProfile,
      warnings: [
        ...this.getUnsupportedControls(profile).map(
          (controlName) => `claude adapter cannot translate requested control '${controlName}'.`,
        ),
        ...resolveAppendSystemPromptControl({
          fallback: mergeClaudeControls(profile.controls).appendSystemPrompt,
          profileLayers: input.profileLayers,
          agentKey: 'claude',
          projectDirectory: input.projectDirectory,
        }).diagnostics.map((diagnostic) => `claude ${diagnostic.message} (${diagnostic.path})`),
      ],
    };
  },
  createLaunchPlan(
    compositeProfile: CompositeProfile,
    profile?: Profile,
    passThroughArgs: readonly string[] = [],
    context: AgentLaunchContext = {},
  ): AgentLaunchPlan {
    const controls = mergeClaudeControls(profile?.controls ?? {});
    const appendPrompt = resolveAppendSystemPromptControl({
      fallback: controls.appendSystemPrompt,
      profileLayers: context.profileLayers,
      agentKey: 'claude',
      projectDirectory: context.projectDirectory,
    });

    return {
      command: 'claude',
      args: [...createClaudeArgs({ ...controls, appendSystemPrompt: appendPrompt.prompts }), ...passThroughArgs],
      env: {
        ...controls.environment,
        CLAUDE_CONFIG_DIR: compositeProfile.rootDirectory,
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
): readonly CompositeProfileStatePath[] => {
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
    /* v8 ignore next -- run command always passes homeDirectory; the os fallback is defensive. */
    homeDirectory ?? homedir(),
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
  ...repeatFlagValue('--append-system-prompt', controls.appendSystemPrompt),
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
