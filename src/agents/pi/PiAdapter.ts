// Provides the pi adapter for tack generation and native pi launch plans.
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import type { AgentAdapter, AgentLaunchPlan, AgentTackPlan } from '../AgentAdapter.js';
import type { PiProfileControls, Profile, ProfileControls } from '../../profiles/Profile.js';
import type { Tack } from '../../tack/Tack.js';
import { createTack } from '../../tack/Tack.js';
import { createTackFile } from '../../tack/TackFile.js';
import type { StatePathDeclaration, StatePersistenceStrategy, TackStatePath } from '../../tack/StatePersistence.js';
import { ensureStateSourcePath } from '../../tack/StatePersistence.js';

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
]);

const piControlNames = new Set([...genericControlNames].filter((controlName) => controlName !== 'pi'));

const piStatePathDeclarations = {
  'auth.json': { defaultStrategy: 'symlink', allowedStrategies: ['symlink', 'error', 'prompt'] },
  'settings.json': { defaultStrategy: 'symlink', allowedStrategies: ['symlink', 'warn', 'error', 'prompt'] },
  'mcp.json': { defaultStrategy: 'symlink', allowedStrategies: ['symlink', 'warn', 'error', 'prompt'] },
  'plugins/': { defaultStrategy: 'symlink', allowedStrategies: ['symlink', 'discard', 'warn', 'error', 'prompt'] },
  'cache/': { defaultStrategy: 'symlink', allowedStrategies: ['symlink', 'discard', 'warn', 'error'] },
  'sessions/': { defaultStrategy: 'symlink', allowedStrategies: ['symlink', 'discard', 'warn', 'error'] },
  unknown: { defaultStrategy: 'warn', allowedStrategies: ['discard', 'warn', 'error', 'prompt'] },
} as const satisfies Readonly<Record<string, StatePathDeclaration>>;

export const createPiAdapter = (): AgentAdapter => ({
  id: 'pi',
  supportedControls: [...genericControlNames].filter((controlName) => !controlName.includes('_')),
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
  input: { readonly profileFolders?: readonly string[]; readonly homeDirectory?: string },
): readonly TackStatePath[] => {
  assertDeclaredStatePersistenceKeys(profile);

  return Object.entries(piStatePathDeclarations).map(([relativePath, declaration]) => {
    const strategy = resolveStateStrategy(profile, relativePath, declaration);
    const directory = relativePath.endsWith('/');

    return {
      relativePath,
      strategy,
      directory,
      sourcePath:
        strategy === 'symlink' && relativePath !== 'unknown'
          ? resolvePiStateSourcePath(input.profileFolders ?? [], input.homeDirectory, relativePath, directory)
          : undefined,
    };
  });
};

const assertDeclaredStatePersistenceKeys = (profile: Profile): void => {
  for (const relativePath of Object.keys(profile.statePersistence ?? {})) {
    if (!(relativePath in piStatePathDeclarations)) {
      throw new Error(`state_persistence path '${relativePath}' is not declared by the pi adapter`);
    }
  }
};

const resolveStateStrategy = (
  profile: Profile,
  relativePath: string,
  declaration: StatePathDeclaration,
): StatePersistenceStrategy => {
  const strategy = profile.statePersistence?.[relativePath] ?? declaration.defaultStrategy;

  /* v8 ignore next -- Pi declarations all define defaults; this guards future adapter declaration regressions. */
  if (strategy === undefined) {
    throw new Error(`missing state_persistence strategy for "${relativePath}"`);
  }

  if (!declaration.allowedStrategies.includes(strategy)) {
    throw new Error(`state_persistence strategy '${strategy}' is not allowed for "${relativePath}"`);
  }

  return strategy;
};

const resolvePiStateSourcePath = (
  profileFolders: readonly string[],
  homeDirectory: string | undefined,
  relativePath: string,
  directory: boolean,
): string => {
  const normalizedRelativePath = directory ? relativePath.slice(0, -1) : relativePath;
  const profileSource = [...profileFolders]
    .reverse()
    .map((profileFolder) => join(profileFolder, 'cli_specific', 'pi', normalizedRelativePath))
    .find((candidate) => existsSync(candidate));

  if (profileSource !== undefined) {
    return profileSource;
  }

  return ensureStateSourcePath(
    join(
      /* v8 ignore next -- run command always passes homeDirectory; environment fallbacks are defensive. */
      homeDirectory ?? process.env.HOME ?? '.',
      '.pi',
      'agent',
      normalizedRelativePath,
    ),
    directory,
  );
};

const mergePiControls = (controls: ProfileControls): PiProfileControls => ({
  ...controls,
  ...definedControls(controls.pi),
  environment: { ...controls.environment, ...controls.pi?.environment },
});

const definedControls = (controls: PiProfileControls | undefined): Partial<PiProfileControls> => {
  if (controls === undefined) {
    return {};
  }

  return Object.fromEntries(Object.entries(controls).filter((entry) => entry[1] !== undefined));
};

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

const flagValue = (flag: string, value: string | undefined): readonly string[] =>
  value === undefined ? [] : [flag, value];

const repeatFlag = (flag: string, values: readonly string[] | undefined): readonly string[] =>
  values === undefined ? [] : values.flatMap((value) => [flag, value]);

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
