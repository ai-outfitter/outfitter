// Provides the pi adapter for tack generation and native pi launch plans.
import { join } from 'node:path';

import type { AgentAdapter, AgentLaunchPlan, AgentTackPlan } from '../AgentAdapter.js';
import {
  flagValue,
  genericControlNames,
  mergeAgentSpecificControls,
  repeatFlag,
  supportedControlNames,
} from '../AdapterProfileControls.js';
import { createDeclaredStatePaths, findProfileStateSource } from '../AdapterStatePaths.js';
import type { PiProfileControls, Profile, ProfileControls } from '../../profiles/Profile.js';
import type { Tack } from '../../tack/Tack.js';
import { createTack } from '../../tack/Tack.js';
import { createTackFile } from '../../tack/TackFile.js';
import type { StatePathDeclaration, TackStatePath } from '../../tack/StatePersistence.js';

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
  // Persisting it keeps package updates across Bridl's temporary tack directories.
  'npm/': { defaultStrategy: 'symlink', allowedStrategies: ['symlink', 'discard', 'warn', 'error'] },
  // Pi clones git-sourced packages here for user-scoped `pi install git:...` entries.
  // Persisting it prevents every Bridl run from re-cloning or using stale temporary checkouts.
  'git/': { defaultStrategy: 'symlink', allowedStrategies: ['symlink', 'discard', 'warn', 'error'] },
  'utilities/': { defaultStrategy: 'symlink', allowedStrategies: ['symlink', 'discard', 'warn', 'error'] },
  'bin/': { defaultStrategy: 'symlink', allowedStrategies: ['symlink', 'discard', 'warn', 'error'] },
  unknown: { defaultStrategy: 'warn', allowedStrategies: ['discard', 'warn', 'error', 'prompt'] },
} as const satisfies Readonly<Record<string, StatePathDeclaration>>;

export const createPiAdapter = (): AgentAdapter => ({
  id: 'pi',
  supportedControls: supportedControlNames(genericControlNames),
  statePaths: piStatePathDeclarations,
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
      createPiStatePaths(profile, input),
    );

    return {
      tack,
      warnings: this.getUnsupportedControls(profile).map(
        (controlName) => `pi adapter cannot translate requested control '${controlName}'.`,
      ),
    };
  },
  createLaunchPlan(tack: Tack, profile?: Profile, passThroughArgs: readonly string[] = []): AgentLaunchPlan {
    const controls = mergePiControls(profile?.controls ?? {});

    return {
      command: 'pi',
      args: [...createPiArgs(controls), ...passThroughArgs],
      env: {
        ...controls.environment,
        PI_CODING_AGENT_DIR: tack.rootDirectory,
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
): readonly TackStatePath[] => {
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
      '.bridl',
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
