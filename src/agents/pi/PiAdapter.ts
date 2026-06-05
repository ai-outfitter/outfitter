// Provides the pi adapter for composite profile generation and native pi launch plans.
import { join } from 'node:path';

import type { AgentAdapter, AgentLaunchPlan, AgentCompositeProfilePlan } from '../AgentAdapter.js';
import {
  flagValue,
  genericControlNames,
  mergeAgentSpecificControls,
  repeatFlag,
  supportedControlNames,
} from '../AdapterProfileControls.js';
import { createDeclaredStatePaths, findProfileStateSource } from '../AdapterStatePaths.js';
import type { PiProfileControls, Profile, ProfileControls } from '../../profiles/Profile.js';
import type { CompositeProfile } from '../../compositeProfile/CompositeProfile.js';
import { createCompositeProfile } from '../../compositeProfile/CompositeProfile.js';
import { createCompositeProfileFile } from '../../compositeProfile/CompositeProfileFile.js';
import type { StatePathDeclaration, CompositeProfileStatePath } from '../../compositeProfile/StatePersistence.js';

const piControlNames = new Set(
  [...genericControlNames].filter((controlName) => controlName !== 'pi' && controlName !== 'claude'),
);

const piStatePathDeclarations = {
  'auth.json': { defaultStrategy: 'symlink', allowedStrategies: ['symlink', 'error', 'prompt'] },
  'settings.json': { defaultStrategy: 'symlink', allowedStrategies: ['symlink', 'warn', 'error', 'prompt'] },
  'mcp.json': { defaultStrategy: 'symlink', allowedStrategies: ['symlink', 'warn', 'error', 'prompt'] },
  'plugins/': { defaultStrategy: 'symlink', allowedStrategies: ['symlink', 'discard', 'warn', 'error', 'prompt'] },
  'cache/': { defaultStrategy: 'symlink', allowedStrategies: ['symlink', 'discard', 'warn', 'error'] },
  'sessions/': { defaultStrategy: 'symlink', allowedStrategies: ['symlink', 'discard', 'warn', 'error'] },
  // Pi installs npm-sourced packages here for user-scoped `pi install npm:...` entries.
  // Persisting it keeps package updates across ApplePi's temporary composite profile directories.
  'npm/': { defaultStrategy: 'symlink', allowedStrategies: ['symlink', 'discard', 'warn', 'error'] },
  // Pi clones git-sourced packages here for user-scoped `pi install git:...` entries.
  // Persisting it prevents every ApplePi run from re-cloning or using stale temporary checkouts.
  'git/': { defaultStrategy: 'symlink', allowedStrategies: ['symlink', 'discard', 'warn', 'error'] },
  'utilities/': { defaultStrategy: 'symlink', allowedStrategies: ['symlink', 'discard', 'warn', 'error'] },
  'bin/': { defaultStrategy: 'symlink', allowedStrategies: ['symlink', 'discard', 'warn', 'error'] },
  unknown: { defaultStrategy: 'warn', allowedStrategies: ['discard', 'warn', 'error', 'prompt'] },
} as const satisfies Readonly<Record<string, StatePathDeclaration>>;

export const createPiAdapter = (): AgentAdapter => ({
  id: 'pi',
  supportedControls: supportedControlNames(genericControlNames),
  statePaths: piStatePathDeclarations,
  createCompositeProfile(profile: Profile, input): AgentCompositeProfilePlan {
    const compositeProfile = createCompositeProfile(
      input.rootDirectory,
      [
        createCompositeProfileFile({
          rootDirectory: input.rootDirectory,
          relativePath: 'applepi/profile.json',
          content: `${JSON.stringify({ id: profile.id, label: profile.label, controls: profile.controls }, null, 2)}\n`,
          sourceInputs: input.profilePaths,
          strategy: 'transform',
        }),
      ],
      createPiStatePaths(profile, input),
    );

    return {
      compositeProfile,
      warnings: this.getUnsupportedControls(profile).map(
        (controlName) => `pi adapter cannot translate requested control '${controlName}'.`,
      ),
    };
  },
  createLaunchPlan(
    compositeProfile: CompositeProfile,
    profile?: Profile,
    passThroughArgs: readonly string[] = [],
  ): AgentLaunchPlan {
    const controls = mergePiControls(profile?.controls ?? {});

    return {
      command: 'pi',
      args: [...createPiArgs(controls), ...passThroughArgs],
      env: {
        ...controls.environment,
        PI_CODING_AGENT_DIR: compositeProfile.rootDirectory,
      },
    };
  },
  getUnsupportedControls(profile: Profile): readonly string[] {
    return findUnsupportedControls(profile.controls);
  },
});

const createPiStatePaths = (
  profile: Profile,
  input: {
    readonly profileFolders?: readonly string[];
    readonly homeDirectory?: string;
    readonly cacheDirectory?: string;
  },
): readonly CompositeProfileStatePath[] => {
  return createDeclaredStatePaths({
    adapterId: 'pi',
    declarations: piStatePathDeclarations,
    profile,
    resolveSourcePath: (relativePath, directory) =>
      resolvePiStateSourcePath(
        input.profileFolders ?? [],
        input.homeDirectory,
        input.cacheDirectory,
        relativePath,
        directory,
      ),
  });
};

const resolvePiStateSourcePath = (
  profileFolders: readonly string[],
  homeDirectory: string | undefined,
  cacheDirectory: string | undefined,
  relativePath: string,
  directory: boolean,
): string => {
  const normalizedRelativePath = directory ? relativePath.slice(0, -1) : relativePath;
  const configuredCacheDirectory =
    cacheDirectory ??
    join(
      /* v8 ignore next -- run command always passes homeDirectory; environment fallbacks are defensive. */
      homeDirectory ?? process.env.HOME ?? '.',
      '.applepi',
      'cache',
    );

  if (relativePath === 'utilities/' || relativePath === 'bin/') {
    return join(configuredCacheDirectory, 'utilities');
  }

  const profileSource = findProfileStateSource(profileFolders, 'pi', relativePath, directory);

  if (profileSource !== undefined) {
    return profileSource;
  }

  return join(
    /* v8 ignore next -- run command always passes homeDirectory; environment fallbacks are defensive. */
    homeDirectory ?? process.env.HOME ?? '.',
    '.pi',
    'agent',
    normalizedRelativePath,
  );
};

const mergePiControls = (controls: ProfileControls): PiProfileControls =>
  mergeAgentSpecificControls<PiProfileControls>(controls, 'pi');

const createPiArgs = (controls: PiProfileControls): readonly string[] => [
  ...flagValue('--model', controls.model),
  ...flagValue('--provider', controls.provider),
  ...flagValue('--thinking', controls.thinking),
  ...flagValue('--session-dir', controls.sessionDirectory),
  ...flagValue('--prompt-template', controls.promptTemplate),
  ...flagValue('--system-prompt', controls.systemPrompt),
  ...flagValue('--append-system-prompt', controls.appendSystemPrompt),
  ...repeatFlag('--extension', controls.extensions),
  ...repeatFlag('--skill', controls.skills),
  ...(controls.args ?? []),
];

const findUnsupportedControls = (controls: ProfileControls): readonly string[] => {
  const unsupported = Object.keys(controls).filter((controlName) => !genericControlNames.has(controlName));

  if (controls.pi !== undefined) {
    unsupported.push(
      ...Object.keys(controls.pi)
        .filter((controlName) => !piControlNames.has(controlName))
        .map((controlName) => `pi.${controlName}`),
    );
  }

  return unsupported;
};
