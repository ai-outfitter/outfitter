// Provides the Claude Code adapter for composite profile generation and native launch plans.
import { join } from 'node:path';

import { safeHomedir } from '../../fs/SafeHomedir.js';

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
import { createClaudeMcpConfigArgs, createClaudeMcpConfigFile } from './ClaudeMcpConfig.js';
import { materializeClaudeSkills } from './ClaudeSkills.js';

const supportedClaudeGenericControls = new Set([
  'model',
  'thinking',
  'environment',
  'args',
  'sessionDirectory',
  'session_directory',
  'extensions',
  'skills',
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
  'skills',
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
    const statePaths = createClaudeStatePaths(profile, input);
    const skillMaterialization = createClaudeSkillMaterialization(profile, input, statePaths);
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
        createClaudeMcpConfigFile(input.rootDirectory, input.profileFolders),
      ].filter((file) => file !== undefined),
      withClaudeSkillStatePaths(statePaths, skillMaterialization.statePaths),
    );

    return {
      compositeProfile,
      warnings: [
        ...this.getUnsupportedControls(profile).map(
          (controlName) => `claude adapter cannot translate requested control '${controlName}'.`,
        ),
        ...skillMaterialization.warnings,
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
      args: [
        ...createClaudeArgs(
          { ...controls, appendSystemPrompt: appendPrompt.prompts },
          createClaudeMcpConfigArgs(compositeProfile),
        ),
        ...passThroughArgs,
      ],
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

const createClaudeSkillMaterialization = (
  profile: Profile,
  input: {
    readonly profileFolders?: readonly string[];
    readonly projectDirectory?: string;
  },
  statePaths: readonly CompositeProfileStatePath[],
): ReturnType<typeof materializeClaudeSkills> =>
  materializeClaudeSkills({
    profileId: profile.id,
    skills: mergeClaudeControls(profile.controls).skills,
    profileFolders: input.profileFolders,
    projectDirectory: input.projectDirectory,
    nativeSkillsSourcePath: statePaths.find((statePath) => statePath.relativePath === 'skills/')?.sourcePath,
  });

// Profile skills are materialized as one symlink per skill inside `skills/`,
// so the whole-directory `skills/` symlink becomes a real directory whose
// undeclared writes warn instead of silently landing in a symlinked source.
const withClaudeSkillStatePaths = (
  statePaths: readonly CompositeProfileStatePath[],
  skillStatePaths: readonly CompositeProfileStatePath[],
): readonly CompositeProfileStatePath[] => {
  if (skillStatePaths.length === 0) {
    return statePaths;
  }

  return [
    ...statePaths.map((statePath) =>
      statePath.relativePath === 'skills/' && statePath.strategy === 'symlink'
        ? { relativePath: 'skills/', strategy: 'warn' as const, directory: true }
        : statePath,
    ),
    ...skillStatePaths,
  ];
};

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
    homeDirectory ?? safeHomedir(),
    '.claude',
    normalizedRelativePath,
  );
};

const mergeClaudeControls = (controls: ProfileControls): ClaudeProfileControls =>
  mergeAgentSpecificControls<ClaudeProfileControls>(controls, 'claude');

// Maps generic thinking levels (pi accepts off, minimal, low, medium, high,
// xhigh) onto Claude Code --effort levels (low, medium, high, xhigh, max).
// `off` and `minimal` approximate to `low` because Claude Code has no effort
// level that disables reasoning. Unknown values pass through unchanged so
// Claude-native levels and future additions keep working.
const claudeEffortByThinkingLevel: Readonly<Record<string, string>> = {
  off: 'low',
  minimal: 'low',
  low: 'low',
  medium: 'medium',
  high: 'high',
  xhigh: 'xhigh',
  max: 'max',
};

const mapThinkingToClaudeEffort = (thinking: string | undefined): string | undefined =>
  thinking === undefined ? undefined : (claudeEffortByThinkingLevel[thinking] ?? thinking);

const createClaudeArgs = (
  controls: ClaudeProfileControls,
  mcpConfigArgs: readonly string[] = [],
): readonly string[] => [
  ...flagValue('--model', controls.model),
  ...flagValue('--effort', mapThinkingToClaudeEffort(controls.thinking)),
  ...flagValue('--system-prompt', controls.systemPrompt),
  ...repeatFlagValue('--append-system-prompt', controls.appendSystemPrompt),
  ...repeatFlag('--plugin-dir', controls.extensions),
  ...mcpConfigArgs,
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
