// Discovers, parses, validates, and converts Outfitter settings.yml files.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';

import { createRemoteRepositoryCachePath, resolveRemoteRepositorySubpath } from '../sources/SourceCache.js';
import type { ValidationIssue } from '../validation/SchemaValidator.js';
import { validateSchema } from '../validation/SchemaValidator.js';
import { parseYamlDocument } from '../validation/YamlDocument.js';
import type {
  CustomSettings,
  Harness,
  RemoteSettingsReference,
  Settings,
  SourceReference,
  StatePersistence,
} from './Settings.js';
import { mergeSettingsStack } from './SettingsMerger.js';

export interface SettingsLocation {
  readonly scope: 'user' | 'user-local' | 'project' | 'project-local' | 'remote';
  readonly path: string;
}

export interface SettingsLoadPlan {
  readonly locations: readonly SettingsLocation[];
}

export interface LoadedSettingsFile {
  readonly location: SettingsLocation;
  readonly settings: Settings;
}

export interface SettingsLoadResult {
  readonly files: readonly LoadedSettingsFile[];
  readonly issues: readonly SettingsLoadIssue[];
}

export interface LoadedSettings extends SettingsLoadResult {
  readonly settings: Settings;
}

export interface SettingsLoadIssue extends ValidationIssue {
  readonly filePath: string;
}

interface SettingsDocument {
  readonly default_agent?: string;
  readonly default_harness?: Harness;
  readonly sources?: readonly SourceDocument[];
  readonly remote_settings?: readonly RemoteSettingsDocument[];
  readonly cache_directory?: string;
  readonly state_persistence?: StatePersistence;
  readonly custom_settings?: CustomSettings;
  readonly startup?: StartupSettingsDocument;
  readonly enterprise?: EnterpriseSettingsDocument;
  readonly telemetry?: TelemetrySettingsDocument;
}

interface EnterpriseSettingsDocument {
  readonly private_catalogs?: boolean;
}

interface StartupSettingsDocument {
  readonly ascii_art?: boolean;
}

interface TelemetrySettingsDocument {
  readonly enabled?: boolean;
}

interface SourceDocument {
  readonly path?: string;
  readonly uri?: string;
  readonly github?: string;
  readonly ref?: string;
}

interface RemoteSettingsDocument {
  readonly path: string;
  readonly uri?: string;
  readonly github?: string;
  readonly ref?: string;
}

export interface SettingsDiscoveryInput {
  readonly homeDirectory: string;
  readonly projectDirectory: string;
}

export const createSettingsLoadPlan = (locations: readonly SettingsLocation[]): SettingsLoadPlan => ({
  locations,
});

/** The one rendering of a settings issue every command reports. */
export const formatSettingsIssue = (issue: SettingsLoadIssue): string =>
  `${issue.filePath}#${issue.path} ${issue.message}`;

const agentsSettings = (directory: string, ...rest: string[]): string => join(directory, '.agents', ...rest);

// Ordered lowest-to-highest precedence so later files fold over earlier ones during merge.
export const discoverSettingsLoadPlan = (input: SettingsDiscoveryInput): SettingsLoadPlan =>
  createSettingsLoadPlan([
    { scope: 'user', path: agentsSettings(input.homeDirectory, 'settings.yml') },
    { scope: 'user-local', path: agentsSettings(input.homeDirectory, 'settings.local.yml') },
    { scope: 'project', path: agentsSettings(input.projectDirectory, 'settings.yml') },
    { scope: 'project-local', path: agentsSettings(input.projectDirectory, 'settings.local.yml') },
  ]);

export const discoverRemoteSettingsLoadPlan = (
  homeDirectory: string,
  remoteSettings: readonly RemoteSettingsReference[],
  cacheDirectory?: string,
): SettingsLoadPlan => discoverRemoteSettingsLocations(homeDirectory, remoteSettings, cacheDirectory).plan;

export const resolveCachedRemoteSettingsPath = (
  homeDirectory: string,
  source: RemoteSettingsReference,
  cacheDirectory?: string,
): string => {
  const repositoryPath = createRemoteRepositoryCachePath(homeDirectory, source, cacheDirectory);
  return resolveRemoteSettingsPath(repositoryPath, source.path);
};

export const resolveRemoteSettingsPath = (repositoryPath: string, path: string): string => {
  const configuredPath = resolveRemoteRepositorySubpath(repositoryPath, path);

  if (existsSync(configuredPath) || path !== 'settings.yml') {
    return configuredPath;
  }

  const nestedAgentsSettingsPath = resolveRemoteRepositorySubpath(repositoryPath, '.agents/settings.yml');
  return existsSync(nestedAgentsSettingsPath) ? nestedAgentsSettingsPath : configuredPath;
};

export const loadSettingsFiles = (plan: SettingsLoadPlan): SettingsLoadResult => {
  const files: LoadedSettingsFile[] = [];
  const issues: SettingsLoadIssue[] = [];

  for (const location of plan.locations) {
    if (existsSync(location.path)) {
      addSettingsFile(location, files, issues);
    }
  }

  return { files, issues };
};

export const loadSettings = (plan: SettingsLoadPlan): LoadedSettings => {
  const result = loadSettingsFiles(plan);

  return {
    ...result,
    settings: mergeSettingsStack(result.files.map((file) => file.settings)),
  };
};

export interface CachedRemoteSettingsOptions {
  /** Remote settings to fold in instead of the ones the local settings declare. */
  readonly remoteSettingsReferences?: readonly RemoteSettingsReference[];
  /** An already-loaded local stack, so callers that just read it do not parse every file twice. */
  readonly localSettings?: LoadedSettings;
}

export const loadSettingsWithCachedRemoteSettings = (
  input: SettingsDiscoveryInput,
  options: CachedRemoteSettingsOptions = {},
): LoadedSettings => {
  const localSettings = options.localSettings ?? loadSettings(discoverSettingsLoadPlan(input));

  const remoteSettingsReferences = options.remoteSettingsReferences ?? localSettings.settings.remoteSettings!;

  if (localSettings.issues.length > 0 || remoteSettingsReferences.length === 0) {
    return localSettings;
  }

  const remoteSettingsLocations = discoverRemoteSettingsLocations(
    input.homeDirectory,
    remoteSettingsReferences,
    localSettings.settings.cacheDirectory,
  );
  const remoteSettings = loadSettings(remoteSettingsLocations.plan);
  const files = [...remoteSettings.files, ...localSettings.files];
  const issues = [...remoteSettingsLocations.issues, ...remoteSettings.issues, ...localSettings.issues];

  return {
    files,
    issues,
    settings: mergeSettingsStack(files.map((file) => file.settings)),
  };
};

const discoverRemoteSettingsLocations = (
  homeDirectory: string,
  remoteSettings: readonly RemoteSettingsReference[],
  cacheDirectory?: string,
): SettingsLocationDiscoveryResult => {
  const locations: SettingsLocation[] = [];
  const issues: SettingsLoadIssue[] = [];

  for (const [index, source] of remoteSettings.entries()) {
    try {
      const path = resolveCachedRemoteSettingsPath(homeDirectory, source, cacheDirectory);
      if (!existsSync(path)) {
        issues.push({
          filePath: `remote_settings[${index}]`,
          path: `/remote_settings/${index}`,
          message: `Cached remote settings '${path}' are missing. Run 'outfitter sync' to fetch configured remote settings.`,
        });
        continue;
      }
      locations.push({
        scope: 'remote',
        path,
      });
    } catch (error) {
      issues.push({
        filePath: `remote_settings[${index}]`,
        path: `/remote_settings/${index}/path`,
        message: formatRemoteSettingsPathError(error),
      });
    }
  }

  return { plan: createSettingsLoadPlan(locations), issues };
};

const formatRemoteSettingsPathError = (error: unknown): string => {
  /* v8 ignore next -- repository subpath validation throws Error instances. */
  if (!(error instanceof Error)) {
    return String(error);
  }

  return error.message;
};

interface SettingsLocationDiscoveryResult {
  readonly plan: SettingsLoadPlan;
  readonly issues: readonly SettingsLoadIssue[];
}

const addSettingsFile = (
  location: SettingsLocation,
  files: LoadedSettingsFile[],
  issues: SettingsLoadIssue[],
): void => {
  const parsed = parseYamlDocument(readFileSync(location.path, 'utf8'), location.path);

  if (!parsed.ok) {
    issues.push({ filePath: location.path, path: parsed.issue.path, message: parsed.issue.message });
    return;
  }

  const validation = validateSchema('settings', parsed.document);

  if (!validation.valid) {
    issues.push(...validation.issues.map((issue) => ({ filePath: location.path, ...issue })));
    return;
  }

  files.push({
    location,
    settings: convertSettingsDocument(parsed.document as SettingsDocument, dirname(location.path), location.scope),
  });
};

// Enterprise governance controls are honored only from the user's own ~/.agents settings so a
// checked-in project or remote catalog cannot enable private catalogs on the user's behalf.
const isHomeScope = (scope: SettingsLocation['scope']): boolean => scope === 'user' || scope === 'user-local';

const convertSettingsDocument = (
  document: SettingsDocument,
  settingsDirectory: string,
  scope: SettingsLocation['scope'],
): Settings => ({
  defaultAgent: document.default_agent,
  defaultHarness: document.default_harness,
  sources: document.sources?.map((source) => convertSource(source, settingsDirectory)),
  remoteSettings: document.remote_settings?.map(convertRemoteSettingsSource),
  cacheDirectory:
    document.cache_directory === undefined
      ? undefined
      : resolveConfigDirectory(document.cache_directory, settingsDirectory),
  statePersistence: document.state_persistence,
  customSettings: document.custom_settings,
  startup: convertStartupSettings(document.startup),
  enterprise: isHomeScope(scope) ? convertEnterpriseSettings(document.enterprise) : undefined,
  telemetry: convertTelemetrySettings(document.telemetry),
});

const convertStartupSettings = (startup: StartupSettingsDocument | undefined): Settings['startup'] =>
  startup === undefined ? undefined : { asciiArt: startup.ascii_art };

const convertEnterpriseSettings = (enterprise: EnterpriseSettingsDocument | undefined): Settings['enterprise'] =>
  enterprise === undefined ? undefined : { privateCatalogs: enterprise.private_catalogs };

const convertTelemetrySettings = (telemetry: TelemetrySettingsDocument | undefined): Settings['telemetry'] =>
  telemetry === undefined ? undefined : { enabled: telemetry.enabled };

const convertRemoteSettingsSource = (source: RemoteSettingsDocument): RemoteSettingsReference => {
  if (source.uri !== undefined) {
    return { uri: source.uri, ref: source.ref, path: source.path };
  }

  return { github: source.github!, ref: source.ref, path: source.path };
};

const convertSource = (source: SourceDocument, settingsDirectory: string): SourceReference => {
  if (source.uri !== undefined) {
    return { uri: source.uri, ref: source.ref, path: source.path };
  }

  if (source.github !== undefined) {
    return { github: source.github, ref: source.ref, path: source.path };
  }

  return { path: resolveConfigDirectory(source.path!, settingsDirectory) };
};

const resolveConfigDirectory = (configuredPath: string, settingsDirectory: string): string => {
  if (isAbsolute(configuredPath)) {
    return configuredPath;
  }

  return resolve(settingsDirectory, configuredPath);
};
