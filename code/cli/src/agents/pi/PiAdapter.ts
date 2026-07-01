// Provides the pi adapter for composite profile generation and native pi launch plans.
import { existsSync, readdirSync, readFileSync, statSync, type Dirent } from 'node:fs';
import { delimiter, dirname, isAbsolute, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import type {
  AgentAdapter,
  AgentLaunchPlan,
  AgentCompositeProfilePlan,
  AgentLaunchContext,
  AgentLaunchProfileLayer,
} from '../AgentAdapter.js';
import { genericControlNames, mergeAgentSpecificControls, supportedControlNames } from '../AdapterProfileControls.js';
import { createDeclaredStatePaths, findProfileStateSource } from '../AdapterStatePaths.js';
import { filterPiSettingsPackagesDuplicatingExtensions } from './PiSettingsMergePolicy.js';
import type { PiProfileControls, Profile, ProfileControls } from '../../profiles/Profile.js';
import { resolveAppendSystemPromptControl } from '../../profiles/PromptIncludes.js';
import type { CompositeProfile } from '../../compositeProfile/CompositeProfile.js';
import { createCompositeProfile } from '../../compositeProfile/CompositeProfile.js';
import { createCompositeProfileFile } from '../../compositeProfile/CompositeProfileFile.js';
import type { StatePathDeclaration, CompositeProfileStatePath } from '../../compositeProfile/StatePersistence.js';
import { createPiArgs } from './PiArgs.js';
import { createPiMcpConfigFile } from './PiMcpConfig.js';
import { materializePiExtensionSources } from './PiExtensionCache.js';

const piControlNames = new Set([
  ...[...genericControlNames].filter((controlName) => controlName !== 'pi' && controlName !== 'claude'),
  'allowExternalDeepWorkJobs',
  'allow_external_deepwork_jobs',
]);

const piStatePathDeclarations = {
  'auth.json': { defaultStrategy: 'symlink', allowedStrategies: ['symlink', 'error', 'prompt'] },
  'settings.json': { defaultStrategy: 'symlink', allowedStrategies: ['symlink', 'warn', 'error', 'prompt'] },
  'keybindings.json': { defaultStrategy: 'symlink', allowedStrategies: ['symlink', 'warn', 'error', 'prompt'] },
  'mcp.json': { defaultStrategy: 'symlink', allowedStrategies: ['symlink', 'warn', 'error', 'prompt'] },
  'models.json': { defaultStrategy: 'symlink', allowedStrategies: ['symlink', 'warn', 'error', 'prompt'] },
  'trust.json': { defaultStrategy: 'symlink', allowedStrategies: ['symlink', 'warn', 'error', 'prompt'] },
  'plugins/': { defaultStrategy: 'symlink', allowedStrategies: ['symlink', 'discard', 'warn', 'error', 'prompt'] },
  'cache/': { defaultStrategy: 'symlink', allowedStrategies: ['symlink', 'discard', 'warn', 'error'] },
  'sessions/': { defaultStrategy: 'symlink', allowedStrategies: ['symlink', 'discard', 'warn', 'error'] },
  'npm/': { defaultStrategy: 'symlink', allowedStrategies: ['symlink', 'discard', 'warn', 'error'] },
  'git/': { defaultStrategy: 'symlink', allowedStrategies: ['symlink', 'discard', 'warn', 'error'] },
  'tmp/': { defaultStrategy: 'symlink', allowedStrategies: ['symlink', 'discard'] },
  'utilities/': { defaultStrategy: 'symlink', allowedStrategies: ['symlink', 'discard', 'warn', 'error'] },
  'bin/': { defaultStrategy: 'symlink', allowedStrategies: ['symlink', 'discard', 'warn', 'error'] },
  unknown: { defaultStrategy: 'warn', allowedStrategies: ['discard', 'warn', 'error', 'prompt'] },
} as const satisfies Readonly<Record<string, StatePathDeclaration>>;

export const createPiAdapter = (): AgentAdapter => ({
  id: 'pi',
  supportedControls: supportedControlNames(piControlNames),
  statePaths: piStatePathDeclarations,
  createCompositeProfile(profile: Profile, input): AgentCompositeProfilePlan {
    const statePaths = createPiStatePaths(profile, input);
    const transformedSettingsFile = createPiSettingsTransformFile(profile, input, statePaths);
    const transformedKeybindingsFile = createPiKeybindingsTransformFile(input, statePaths);
    const transformedStatePaths = markPiTransformedStatePathsDiscarded(statePaths, [
      ...(transformedSettingsFile === undefined ? [] : ['settings.json']),
      'keybindings.json',
    ]);
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
        createPiMcpConfigFile(input.rootDirectory, input.profileFolders),
        transformedSettingsFile,
        transformedKeybindingsFile,
      ].filter((file) => file !== undefined),
      transformedStatePaths,
    );

    return {
      compositeProfile,
      warnings: [
        ...this.getUnsupportedControls(profile).map(
          (controlName) => `pi adapter cannot translate requested control '${controlName}'.`,
        ),
        ...createMissingNamedDeepWorkJobWarnings(input.profileLayers ?? []),
        ...resolveAppendSystemPromptControl({
          fallback: mergePiControls(profile.controls).appendSystemPrompt,
          profileLayers: input.profileLayers,
          agentKey: 'pi',
          projectDirectory: input.projectDirectory,
        }).diagnostics.map((diagnostic) => `pi ${diagnostic.message} (${diagnostic.path})`),
      ],
    };
  },
  createLaunchPlan(
    compositeProfile: CompositeProfile,
    profile?: Profile,
    passThroughArgs: readonly string[] = [],
    context: AgentLaunchContext = {},
  ): AgentLaunchPlan {
    const controls = mergePiControls(profile?.controls ?? {});
    const profileFolders = context.profileFolders ?? [];
    const deepWorkJobsFolders = createDeepWorkAdditionalJobsFolders(
      controls,
      profileFolders,
      context.profileLayers ?? [],
    );
    const skillSources = createPiSkillSources(controls, profileFolders);
    const appendPrompt = resolveAppendSystemPromptControl({
      fallback: controls.appendSystemPrompt,
      profileLayers: context.profileLayers,
      agentKey: 'pi',
      projectDirectory: context.projectDirectory,
    });

    return {
      command: 'pi',
      args: [
        ...createPiArgs({
          ...controls,
          extensions: materializePiExtensionSources(controls.extensions, { cacheDirectory: context.cacheDirectory }),
          skills: skillSources,
          appendSystemPrompt: appendPrompt.prompts,
        }),
        ...passThroughArgs,
      ],
      env: {
        ...controls.environment,
        ...(deepWorkJobsFolders === undefined ? {} : { DEEPWORK_ADDITIONAL_JOBS_FOLDERS: deepWorkJobsFolders }),
        PI_CODING_AGENT_DIR: compositeProfile.rootDirectory,
      },
    };
  },
  getUnsupportedControls(profile: Profile): readonly string[] {
    return findUnsupportedControls(profile.controls);
  },
});

type PiSettingsDocument = Readonly<Record<string, unknown>> & {
  readonly packages?: unknown;
};

const markPiTransformedStatePathsDiscarded = (
  statePaths: readonly CompositeProfileStatePath[],
  transformedRelativePaths: readonly string[],
): readonly CompositeProfileStatePath[] => {
  const transformedRelativePathSet = new Set(transformedRelativePaths);

  return statePaths.map((statePath) =>
    transformedRelativePathSet.has(statePath.relativePath)
      ? { relativePath: statePath.relativePath, strategy: 'discard', directory: statePath.directory }
      : statePath,
  );
};

const createPiSettingsTransformFile = (
  profile: Profile,
  input: {
    readonly rootDirectory: string;
    readonly profilePaths: readonly string[];
    readonly homeDirectory?: string;
  },
  statePaths: readonly CompositeProfileStatePath[],
): ReturnType<typeof createCompositeProfileFile> | undefined => {
  if (input.homeDirectory === undefined) {
    return undefined;
  }

  const controls = mergePiControls(profile.controls);
  const extensionSources = controls.extensions ?? [];

  if (extensionSources.length === 0) {
    return undefined;
  }

  const settingsStatePath = statePaths.find((statePath) => statePath.relativePath === 'settings.json');

  if (settingsStatePath?.sourcePath === undefined || !existsSync(settingsStatePath.sourcePath)) {
    return undefined;
  }

  const settings = readPiSettingsDocument(settingsStatePath.sourcePath);

  if (settings === undefined || !Array.isArray(settings.packages)) {
    return undefined;
  }

  const filteredPackages = filterPiSettingsPackagesDuplicatingExtensions(settings.packages, extensionSources);

  if (filteredPackages.length === settings.packages.length) {
    return undefined;
  }

  return createCompositeProfileFile({
    rootDirectory: input.rootDirectory,
    relativePath: 'settings.json',
    content: `${JSON.stringify({ ...settings, packages: filteredPackages }, null, 2)}\n`,
    sourceInputs: [settingsStatePath.sourcePath, ...input.profilePaths],
    strategy: 'transform',
  });
};

const readPiSettingsDocument = (settingsPath: string): PiSettingsDocument | undefined => {
  let content: string;

  try {
    content = readFileSync(settingsPath, 'utf8');
  } catch (error) {
    throw new Error(`Could not read pi settings file '${settingsPath}': ${String(error)}`, { cause: error });
  }

  try {
    const parsed: unknown = JSON.parse(content);
    return isPiSettingsDocument(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
};

const isPiSettingsDocument = (value: unknown): value is PiSettingsDocument =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

type PiKeybindingsDocument = Readonly<Record<string, unknown>>;

const piModeCycleKey = 'shift+tab';
const piThinkingCycleKey = 'ctrl+shift+t';
const piThinkingCycleKeybindingId = 'app.thinking.cycle';
const legacyPiKeybindingIds = {
  cycleThinkingLevel: piThinkingCycleKeybindingId,
} as const satisfies Readonly<Record<string, string>>;

const createPiKeybindingsTransformFile = (
  input: {
    readonly rootDirectory: string;
    readonly profilePaths: readonly string[];
    readonly profileFolders?: readonly string[];
    readonly homeDirectory?: string;
  },
  statePaths: readonly CompositeProfileStatePath[],
): ReturnType<typeof createCompositeProfileFile> => {
  const keybindingsStatePath = statePaths.find((statePath) => statePath.relativePath === 'keybindings.json');
  const sourcePath = keybindingsStatePath?.sourcePath;
  const shouldReadSource =
    sourcePath !== undefined && existsSync(sourcePath) && shouldReadPiKeybindingsSource(sourcePath, input);
  const sourceInputs = [...(shouldReadSource ? [sourcePath] : []), ...input.profilePaths];
  const keybindings = rewritePiKeybindingsForOutfitterModeSwitch(
    shouldReadSource ? readPiKeybindingsDocument(sourcePath) : {},
  );

  return createCompositeProfileFile({
    rootDirectory: input.rootDirectory,
    relativePath: 'keybindings.json',
    content: `${JSON.stringify(keybindings, null, 2)}\n`,
    sourceInputs,
    strategy: 'transform',
  });
};

/* v8 ignore next -- fallback source discovery is exercised by adapter integration fixtures. */
const shouldReadPiKeybindingsSource = (
  sourcePath: string,
  input: { readonly homeDirectory?: string; readonly profileFolders?: readonly string[] },
): boolean =>
  input.homeDirectory !== undefined || (input.profileFolders ?? []).some((folder) => isPathInside(sourcePath, folder));

const isPathInside = (path: string, directory: string): boolean => {
  const relativePath = relative(directory, path);
  return relativePath === '' || (!relativePath.startsWith('..') && !isAbsolute(relativePath));
};

const readPiKeybindingsDocument = (keybindingsPath: string): PiKeybindingsDocument => {
  let content: string;

  try {
    content = readFileSync(keybindingsPath, 'utf8');
  } catch (error) {
    throw new Error(`Could not read pi keybindings file '${keybindingsPath}': ${String(error)}`, { cause: error });
  }

  try {
    const parsed: unknown = JSON.parse(content);

    if (!isPiKeybindingsDocument(parsed)) {
      throw new Error(`Pi keybindings file '${keybindingsPath}' must contain a JSON object.`);
    }

    return parsed;
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error(`Could not parse pi keybindings file '${keybindingsPath}': ${error.message}`, { cause: error });
    }

    throw error;
  }
};

const isPiKeybindingsDocument = (value: unknown): value is PiKeybindingsDocument =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const rewritePiKeybindingsForOutfitterModeSwitch = (
  keybindings: PiKeybindingsDocument,
): Record<string, string | string[]> => {
  const rewritten: Record<string, string | string[]> = {};

  for (const [keybindingId, binding] of Object.entries(keybindings)) {
    if (!isPiKeybindingValue(binding)) {
      continue;
    }

    const normalizedKeybindingId = normalizePiKeybindingId(keybindingId);
    rewritten[normalizedKeybindingId] = appendUniquePiKeys(
      toPiKeybindingArray(rewritten[normalizedKeybindingId] ?? []),
      filterReservedOutfitterKeys(toPiKeybindingArray(binding)),
    );
  }

  rewritten[piThinkingCycleKeybindingId] = appendUniquePiKeys(
    filterReservedOutfitterKeys(toPiKeybindingArray(rewritten[piThinkingCycleKeybindingId] ?? [])),
    [piThinkingCycleKey],
  );

  return rewritten;
};

const normalizePiKeybindingId = (keybindingId: string): string =>
  keybindingId in legacyPiKeybindingIds
    ? legacyPiKeybindingIds[keybindingId as keyof typeof legacyPiKeybindingIds]
    : keybindingId;

const isPiKeybindingValue = (value: unknown): value is string | readonly string[] =>
  typeof value === 'string' || (Array.isArray(value) && value.every((entry) => typeof entry === 'string'));

const toPiKeybindingArray = (value: string | readonly string[]): string[] =>
  typeof value === 'string' ? [value] : [...value];

const filterReservedOutfitterKeys = (keys: readonly string[]): string[] =>
  keys.filter(
    (key) =>
      !keysMatchIgnoringModifierOrder(key, piModeCycleKey) && !keysMatchIgnoringModifierOrder(key, piThinkingCycleKey),
  );

const appendUniquePiKeys = (existingKeys: readonly string[], nextKeys: readonly string[]): string[] => {
  const existingKeySet = new Set(existingKeys.map(normalizePiKey));
  const mergedKeys = [...existingKeys];

  for (const key of nextKeys) {
    const normalizedKey = normalizePiKey(key);

    if (existingKeySet.has(normalizedKey)) {
      continue;
    }

    existingKeySet.add(normalizedKey);
    mergedKeys.push(key);
  }

  return mergedKeys;
};

const keysMatchIgnoringModifierOrder = (left: string, right: string): boolean =>
  normalizePiKey(left) === normalizePiKey(right);

const normalizePiKey = (key: string): string => {
  const parts = key
    .toLowerCase()
    .split('+')
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  /* v8 ignore next -- empty keybinding strings are schema-invalid defensive input. */
  const keyName = parts.at(-1) ?? '';
  const modifiers = new Set(parts.slice(0, -1));
  const sortedModifiers = ['ctrl', 'shift', 'alt'].filter((modifier) => modifiers.has(modifier));

  return [...sortedModifiers, keyName].join('+');
};

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
      '.outfitter',
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

const deepWorkAdditionalJobsFoldersEnv = 'DEEPWORK_ADDITIONAL_JOBS_FOLDERS';
const packageRootDirectory = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const builtInOutfitterSkill = join(packageRootDirectory, 'skills', 'outfitter');

const createPiSkillSources = (controls: PiProfileControls, profileFolders: readonly string[]): readonly string[] => [
  ...new Set([builtInOutfitterSkill, ...(controls.skills ?? []), ...profileFolders.flatMap(skillSourcesForProfile)]),
];

const skillSourcesForProfile = (profileFolder: string): readonly string[] => [
  ...skillSourcesForFolder(join(profileFolder, 'skills'), 'profile skills folder'),
  ...skillSourcesForFolder(join(profileFolder, 'cli_specific', 'pi', 'skills'), 'profile Pi skills folder'),
];

const skillSourcesForFolder = (skillsFolder: string, description: string): readonly string[] =>
  readOptionalDirectoryEntries(skillsFolder, description)
    .filter(isPiSkillEntry(skillsFolder))
    .map((entry) => join(skillsFolder, entry.name))
    .sort();

const isPiSkillEntry =
  (folderPath: string) =>
  (entry: Dirent): boolean =>
    entry.isDirectory() && isFile(join(folderPath, entry.name, 'SKILL.md'));

const createDeepWorkAdditionalJobsFolders = (
  controls: PiProfileControls,
  profileFolders: readonly string[],
  profileLayers: readonly AgentLaunchProfileLayer[],
): string | undefined => {
  const profileJobFolders = [
    ...new Set(profileFolders.flatMap(deepWorkJobsFoldersForProfile).filter(isExistingDeepWorkJobsFolder)),
  ];
  const namedJobFolders = resolveNamedDeepWorkJobFolders(profileLayers);
  const existingValue = allowExternalDeepWorkJobs(controls)
    ? (controls.environment?.[deepWorkAdditionalJobsFoldersEnv] ?? process.env[deepWorkAdditionalJobsFoldersEnv])
    : undefined;
  const jobFolders = [...new Set([...splitPathList(existingValue), ...namedJobFolders, ...profileJobFolders])];

  return jobFolders.length === 0 ? undefined : jobFolders.join(delimiter);
};

const resolveNamedDeepWorkJobFolders = (profileLayers: readonly AgentLaunchProfileLayer[]): readonly string[] => [
  ...new Set(
    profileLayers.flatMap((profileLayer) =>
      (profileLayer.profile.controls.deepwork?.jobs ?? []).flatMap((jobName) =>
        resolveNamedDeepWorkJobFolder(profileLayer, jobName),
      ),
    ),
  ),
];

const resolveNamedDeepWorkJobFolder = (profileLayer: AgentLaunchProfileLayer, jobName: string): readonly string[] =>
  sharedDeepWorkJobRootsForLayer(profileLayer).filter((jobsFolder) => isFile(join(jobsFolder, jobName, 'job.yml')));

/* v8 ignore next -- warning-only DeepWork job absence is covered by higher-level run command behavior. */
const createMissingNamedDeepWorkJobWarnings = (profileLayers: readonly AgentLaunchProfileLayer[]): readonly string[] =>
  profileLayers.flatMap((profileLayer) =>
    (profileLayer.profile.controls.deepwork?.jobs ?? []).flatMap((jobName) =>
      resolveNamedDeepWorkJobFolder(profileLayer, jobName).length === 0
        ? [`pi adapter could not find DeepWork job '${jobName}' for profile '${profileLayer.profile.id}'.`]
        : [],
    ),
  );

const sharedDeepWorkJobRootsForLayer = (profileLayer: AgentLaunchProfileLayer): readonly string[] => {
  /* v8 ignore next -- source-less synthetic layers do not expose shared DeepWork jobs. */
  if (profileLayer.sourceRootPath === undefined) {
    return [];
  }

  return [
    join(dirname(profileLayer.sourceRootPath), 'deepwork', 'jobs'),
    join(profileLayer.sourceRootPath, 'deepwork', 'jobs'),
    join(profileLayer.sourceRootPath, '.outfitter', 'deepwork', 'jobs'),
  ];
};

const allowExternalDeepWorkJobs = (controls: PiProfileControls): boolean =>
  controls.allowExternalDeepWorkJobs === true || controls.allow_external_deepwork_jobs === true;

const deepWorkJobsFoldersForProfile = (profileFolder: string): readonly string[] => [
  join(profileFolder, 'deepwork', 'jobs'),
  join(profileFolder, 'cli_specific', 'pi', 'deepwork', 'jobs'),
];

const isExistingDeepWorkJobsFolder = (folderPath: string): boolean =>
  readOptionalDirectoryEntries(folderPath, 'profile DeepWork jobs folder').some(isDeepWorkJobEntry(folderPath));

const isDeepWorkJobEntry =
  (folderPath: string) =>
  (entry: Dirent): boolean =>
    entry.isDirectory() && isFile(join(folderPath, entry.name, 'job.yml'));

const readOptionalDirectoryEntries = (folderPath: string, description: string): readonly Dirent[] => {
  try {
    return readdirSync(folderPath, { withFileTypes: true });
  } catch (error) {
    if (isMissingPathError(error)) {
      return [];
    }

    throw new Error(`Could not read ${description} '${folderPath}': ${formatFilesystemError(error)}`, {
      cause: error,
    });
  }
};

const isFile = (path: string): boolean => {
  try {
    return statSync(path).isFile();
  } catch (error) {
    if (isMissingPathError(error)) {
      return false;
    }

    throw new Error(`Could not inspect file '${path}': ${formatFilesystemError(error)}`, { cause: error });
  }
};

const isMissingPathError = (error: unknown): boolean =>
  error !== null && typeof error === 'object' && 'code' in error && error.code === 'ENOENT';

const formatFilesystemError = (error: unknown): string => String(error);

const splitPathList = (value: string | undefined): readonly string[] =>
  value === undefined || value === '' ? [] : value.split(delimiter).filter((entry) => entry !== '');

const mergePiControls = (controls: ProfileControls): PiProfileControls =>
  mergeAgentSpecificControls<PiProfileControls>(controls, 'pi');

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
