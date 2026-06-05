// Discovers, parses, validates, and converts ApplePi settings.yml files.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';

import { createRemoteRepositoryCachePath, resolveRemoteRepositorySubpath } from '../profiles/ProfileCache.js';
import type { ProfileSourceReference } from '../profiles/ProfileSource.js';
import type { ValidationIssue } from '../validation/SchemaValidator.js';
import { validateSchema } from '../validation/SchemaValidator.js';
import { parseYamlDocument } from '../validation/YamlDocument.js';
import type { CustomSettings, RemoteSettingsReference, Settings } from './Settings.js';
import { mergeSettingsStack } from './SettingsMerger.js';

export interface SettingsLocation {
  readonly scope: 'user' | 'project' | 'project-local' | 'remote';
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
  readonly default_profile?: string;
  readonly default_agent?: string;
  readonly profile_sources?: readonly ProfileSourceDocument[];
  readonly remote_settings?: readonly RemoteSettingsDocument[];
  readonly cache_directory?: string;
  readonly custom_settings?: CustomSettings;
}

interface ProfileSourceDocument {
  readonly path?: string;
  readonly uri?: string;
  readonly github?: string;
  readonly ref?: string;
  readonly only?: readonly string[];
  readonly except?: readonly string[];
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

export const discoverSettingsLoadPlan = (input: SettingsDiscoveryInput): SettingsLoadPlan =>
  createSettingsLoadPlan([
    { scope: 'user', path: join(input.homeDirectory, '.applepi', 'settings.yml') },
    { scope: 'project', path: join(input.projectDirectory, '.applepi', 'settings.yml') },
    { scope: 'project-local', path: join(input.projectDirectory, '.applepi', 'local', 'settings.yml') },
  ]);

export const discoverRemoteSettingsLoadPlan = (
  homeDirectory: string,
  remoteSettings: readonly RemoteSettingsReference[],
): SettingsLoadPlan => discoverRemoteSettingsLocations(homeDirectory, remoteSettings).plan;

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

export const loadSettingsWithCachedRemoteSettings = (
  input: SettingsDiscoveryInput,
  remoteSettingsReferencesOverride?: readonly RemoteSettingsReference[],
): LoadedSettings => {
  const localSettings = loadSettings(discoverSettingsLoadPlan(input));

  const remoteSettingsReferences = remoteSettingsReferencesOverride ?? localSettings.settings.remoteSettings!;

  if (localSettings.issues.length > 0 || remoteSettingsReferences.length === 0) {
    return localSettings;
  }

  const remoteSettingsLocations = discoverRemoteSettingsLocations(input.homeDirectory, remoteSettingsReferences);
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
): SettingsLocationDiscoveryResult => {
  const locations: SettingsLocation[] = [];
  const issues: SettingsLoadIssue[] = [];

  for (const [index, source] of remoteSettings.entries()) {
    try {
      locations.push({
        scope: 'remote',
        path: resolveRemoteRepositorySubpath(createRemoteRepositoryCachePath(homeDirectory, source), source.path),
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
    settings: convertSettingsDocument(parsed.document as SettingsDocument, dirname(location.path)),
  });
};

const convertSettingsDocument = (document: SettingsDocument, settingsDirectory: string): Settings => ({
  defaultProfile: document.default_profile,
  defaultAgent: document.default_agent,
  profileSources: document.profile_sources?.map((source) => convertProfileSource(source, settingsDirectory)),
  remoteSettings: document.remote_settings?.map(convertRemoteSettingsSource),
  cacheDirectory:
    document.cache_directory === undefined
      ? undefined
      : resolveConfigDirectory(document.cache_directory, settingsDirectory),
  customSettings: document.custom_settings,
});

const convertRemoteSettingsSource = (source: RemoteSettingsDocument): RemoteSettingsReference => {
  if (source.uri !== undefined) {
    return { uri: source.uri, ref: source.ref, path: source.path };
  }

  return { github: source.github!, ref: source.ref, path: source.path };
};

const convertProfileSource = (source: ProfileSourceDocument, settingsDirectory: string): ProfileSourceReference => {
  const filters = {
    only: source.only,
    except: source.except,
  };

  if (source.uri !== undefined) {
    return { ...filters, uri: source.uri, ref: source.ref, path: source.path };
  }

  if (source.github !== undefined) {
    return { ...filters, github: source.github, ref: source.ref, path: source.path };
  }

  return { ...filters, path: resolveProfileSourcePath(source.path!, settingsDirectory) };
};

const resolveProfileSourcePath = (sourcePath: string, settingsDirectory: string): string =>
  resolveConfigDirectory(sourcePath, settingsDirectory);

const resolveConfigDirectory = (configuredPath: string, settingsDirectory: string): string => {
  if (isAbsolute(configuredPath)) {
    return configuredPath;
  }

  return resolve(settingsDirectory, configuredPath);
};
