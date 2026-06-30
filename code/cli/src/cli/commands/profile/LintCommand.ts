// Implements `outfitter profile lint` diagnostics for profile resolution and prompt includes.
import { homedir } from 'node:os';

import type { Command } from 'commander';

import { createAgentAdapter } from '../../../agents/AgentRegistry.js';
import { createCompositeProfileRootDirectory } from '../../../compositeProfile/CompositeProfileAssembler.js';
import { createPromptIncludeDiagnostics } from '../../../profiles/PromptIncludes.js';
import { resolveProfile } from '../../../profiles/ProfileMerger.js';
import { loadSettingsWithCachedRemoteSettings } from '../../../settings/SettingsLoader.js';
import { createLaunchProfileLayers, loadProfileSources } from '../RunCommand.js';
import type { AgentLaunchProfileLayer } from '../../../agents/AgentAdapter.js';
import type { Profile, ProfileControls } from '../../../profiles/Profile.js';
import type { CommandObject } from '../CommandObject.js';
import type { ProfileCommandDependencies } from './Shared.js';
import { getOrCreateProfileCommander } from './Shared.js';

export interface ProfileLintCommandInput {
  readonly homeDirectory: string;
  readonly projectDirectory: string;
  readonly strict?: boolean;
  readonly json?: boolean;
}

export interface ProfileLintDiagnostic {
  readonly severity: 'error' | 'warning';
  readonly path: string;
  readonly message: string;
}

export interface ProfileLintCommandResult {
  readonly diagnostics: readonly ProfileLintDiagnostic[];
  readonly exitCode: number;
}

export const executeProfileLintCommand = (input: ProfileLintCommandInput): ProfileLintCommandResult => {
  const diagnostics = collectProfileLintDiagnostics(input);
  const hasErrors = diagnostics.some((diagnostic) => diagnostic.severity === 'error');
  const hasWarnings = diagnostics.some((diagnostic) => diagnostic.severity === 'warning');
  const exitCode = hasErrors || (input.strict === true && hasWarnings) ? 1 : 0;

  return { diagnostics, exitCode };
};

export const createProfileLintCommand = (dependencies: ProfileCommandDependencies = {}): CommandObject => ({
  name: 'profile lint',
  description: 'Validate profiles, inheritance, and typed prompt includes.',
  register(program: Command): void {
    getOrCreateProfileCommander(program)
      .command('lint')
      .description('Validate profiles, inheritance, and typed prompt includes.')
      .option('--strict', 'Exit non-zero when warnings are present')
      .option('--json', 'Print diagnostics as JSON')
      .action((options: { strict?: boolean; json?: boolean }) => {
        const result = executeProfileLintCommand({
          homeDirectory:
            /* v8 ignore next -- CLI defaults are exercised manually; tests inject stable temp roots. */
            dependencies.homeDirectory ?? homedir(),
          projectDirectory:
            /* v8 ignore next -- CLI defaults are exercised manually; tests inject stable temp roots. */
            dependencies.projectDirectory ?? process.cwd(),
          strict: options.strict,
          json: options.json,
        });
        writeLintResult(
          result,
          options.json === true,
          /* v8 ignore next -- CLI default writer is console.log; tests inject a collector. */
          dependencies.writeLine ?? console.log,
        );
        process.exitCode = result.exitCode;
      });
  },
});

const collectProfileLintDiagnostics = (input: ProfileLintCommandInput): readonly ProfileLintDiagnostic[] => {
  const settings = loadSettingsWithCachedRemoteSettings(input);
  const settingsDiagnostics = settings.issues.map((issue): ProfileLintDiagnostic => ({
    severity: 'error',
    path: `${issue.filePath}#${issue.path}`,
    message: issue.message,
  }));

  if (settingsDiagnostics.length > 0) {
    return settingsDiagnostics;
  }

  const loadedProfiles = loadProfileSources(input.homeDirectory, settings.settings.profileSources!);
  const loadDiagnostics = loadedProfiles.issues.map((issue): ProfileLintDiagnostic => ({
    severity: 'error',
    path: issue.path,
    message: issue.message,
  }));
  const inheritanceDiagnostics = lintProfileInheritance(loadedProfiles.profiles);
  const promptDiagnostics = createPromptIncludeDiagnostics(loadedProfiles.profiles, input.projectDirectory).map(
    (diagnostic) => ({
      severity: diagnostic.severity,
      path: diagnostic.path,
      message: diagnostic.message,
    }),
  );
  const adapterDiagnostics = lintAdapterWarnings(loadedProfiles.profiles, input.projectDirectory);

  return [...loadDiagnostics, ...inheritanceDiagnostics, ...promptDiagnostics, ...adapterDiagnostics];
};

const lintProfileInheritance = (
  profiles: Parameters<typeof createPromptIncludeDiagnostics>[0],
): readonly ProfileLintDiagnostic[] =>
  [...new Set(profiles.map((profile) => profile.profile.id))].flatMap((profileId) =>
    resolveProfile({ profiles, profileId }).issues.map((issue) => ({
      severity: 'error' as const,
      path: issue.path,
      message: issue.message,
    })),
  );

const lintAdapterWarnings = (
  profiles: Parameters<typeof createPromptIncludeDiagnostics>[0],
  projectDirectory: string,
): readonly ProfileLintDiagnostic[] => {
  const pi = createAgentAdapter('pi');

  return [...new Set(profiles.map((profile) => profile.profile.id))].flatMap((profileId) => {
    const resolution = resolveProfile({ profiles, profileId });

    if (resolution.profile === undefined || resolution.issues.length > 0) {
      return [];
    }

    const stackProfiles = profiles.filter((profile) =>
      resolution.profileStack.some((stackProfile) => stackProfile.id === profile.profile.id),
    );

    return pi
      .createCompositeProfile(omitPromptIncludes(resolution.profile), {
        rootDirectory: createCompositeProfileRootDirectory(resolution.profile.id, pi.id),
        profilePaths: profiles.map((profile) => profile.profilePath),
        profileFolders: profiles.flatMap((profile) =>
          profile.resourceRootPath === undefined ? [] : [profile.resourceRootPath],
        ),
        profileLayers: createLaunchProfileLayers(stackProfiles).map(omitPromptIncludesFromLayer),
        projectDirectory,
      })
      .warnings.map((message) => ({ severity: 'warning' as const, path: `/profiles/${profileId}`, message }));
  });
};

const omitPromptIncludesFromLayer = (layer: AgentLaunchProfileLayer): AgentLaunchProfileLayer => ({
  ...layer,
  profile: omitPromptIncludes(layer.profile),
});

const omitPromptIncludes = (profile: Profile): Profile => ({
  ...profile,
  controls: omitPromptIncludesFromControls(profile.controls),
});

const omitPromptIncludesFromControls = <Controls extends ProfileControls>(controls: Controls): Controls => {
  const { appendSystemPrompt, pi, claude, ...rest } = controls;
  void appendSystemPrompt;

  return {
    ...rest,
    ...(pi === undefined ? {} : { pi: omitPromptIncludesFromControls(pi) }),
    ...(claude === undefined ? {} : { claude: omitPromptIncludesFromControls(claude) }),
  } as Controls;
};

const writeLintResult = (
  result: ProfileLintCommandResult,
  json: boolean,
  writeLine: (message: string) => void,
): void => {
  if (json) {
    writeLine(JSON.stringify(result.diagnostics, null, 2));
    return;
  }

  if (result.diagnostics.length === 0) {
    writeLine('No profile lint diagnostics.');
    return;
  }

  for (const diagnostic of result.diagnostics) {
    writeLine(`${diagnostic.severity}: ${diagnostic.path} ${diagnostic.message}`);
  }
};
