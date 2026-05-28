// Discovers, parses, validates, and converts Bridl settings.yml files.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';

import type { ProfileSourceReference } from '../profiles/ProfileSource.js';
import type { ValidationIssue } from '../validation/SchemaValidator.js';
import { validateSchema } from '../validation/SchemaValidator.js';
import { parseYamlDocument } from '../validation/YamlDocument.js';
import type { Settings } from './Settings.js';
import { mergeSettingsStack } from './SettingsMerger.js';

export interface SettingsLocation {
  readonly scope: 'user' | 'project' | 'project-local';
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
  readonly profile_sources?: readonly ProfileSourceDocument[];
}

interface ProfileSourceDocument {
  readonly path?: string;
  readonly uri?: string;
  readonly only?: readonly string[];
  readonly except?: readonly string[];
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
    { scope: 'user', path: join(input.homeDirectory, '.bridl', 'settings.yml') },
    { scope: 'project', path: join(input.projectDirectory, '.bridl', 'settings.yml') },
    { scope: 'project-local', path: join(input.projectDirectory, '.bridl', 'local', 'settings.yml') },
  ]);

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

  files.push({ location, settings: convertSettingsDocument(parsed.document as SettingsDocument, dirname(location.path)) });
};

const convertSettingsDocument = (document: SettingsDocument, settingsDirectory: string): Settings => ({
  defaultProfile: document.default_profile,
  profileSources: (document.profile_sources ?? []).map((source) => convertProfileSource(source, settingsDirectory)),
});

const convertProfileSource = (
  source: ProfileSourceDocument,
  settingsDirectory: string,
): ProfileSourceReference => {
  const filters = {
    only: source.only,
    except: source.except,
  };

  if (source.path !== undefined) {
    return { ...filters, path: resolveProfileSourcePath(source.path, settingsDirectory) };
  }

  return { ...filters, uri: source.uri! };
};

const resolveProfileSourcePath = (sourcePath: string, settingsDirectory: string): string => {
  if (isAbsolute(sourcePath)) {
    return sourcePath;
  }

  return resolve(settingsDirectory, sourcePath);
};
