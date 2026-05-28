// Loads local profile folders and parses profile.yml documents.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import type { AnySchema } from 'ajv';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { parse } from 'yaml';

import type { Profile, ProfileControls } from './Profile.js';
import type { ProfileSourceReference } from './ProfileSource.js';

const profileIdPattern = /^[a-z0-9][a-z0-9._-]*[a-z0-9]$|^[a-z0-9]$/u;
const profileSchema = JSON.parse(
  readFileSync(new URL('../schemas/profile.schema.json', import.meta.url), 'utf8'),
) as AnySchema;
const profileValidator = new Ajv2020().compile(profileSchema);

export interface ProfileLoadPlan {
  readonly sources: readonly ProfileSourceReference[];
}

export interface ProfileLoadIssue {
  readonly path: string;
  readonly message: string;
}

export interface LoadedProfile {
  readonly source: ProfileSourceReference;
  readonly folderPath: string;
  readonly profilePath: string;
  readonly profile: Profile;
}

export interface ProfileLoadResult {
  readonly profiles: readonly LoadedProfile[];
  readonly issues: readonly ProfileLoadIssue[];
}

export const createProfileLoadPlan = (sources: readonly ProfileSourceReference[]): ProfileLoadPlan => ({
  sources,
});

export const isValidProfileId = (profileId: string): boolean => profileIdPattern.test(profileId);

export const isProfileIncludedBySource = (profileId: string, source: ProfileSourceReference): boolean =>
  (source.only === undefined || source.only.includes(profileId)) &&
  (source.except === undefined || !source.except.includes(profileId));

export const parseProfileDocument = (document: unknown, fallbackId: string): Profile | ProfileLoadIssue => {
  const record = readObject(document);

  if (record === undefined) {
    return { path: '/', message: 'Profile document must be a mapping.' };
  }

  const id = readString(record.id, fallbackId);
  const validationIssue = validateProfileRecord({ ...record, id });

  if (validationIssue !== undefined) {
    return validationIssue;
  }

  return {
    id,
    label: readOptionalString(record.label),
    inherits: readStringArray(record.inherits),
    controls: readControls(record.controls),
  };
};

export const parseProfileYaml = (content: string, fallbackId: string): Profile | ProfileLoadIssue => {
  try {
    return parseProfileDocument(parse(content), fallbackId);
  } catch (error) {
    return { path: '/profile.yml', message: readErrorMessage(error) };
  }
};

export const loadLocalProfileSource = (source: ProfileSourceReference): ProfileLoadResult => {
  if (source.path === undefined) {
    return { profiles: [], issues: [{ path: '<uri-source>', message: 'Only local profile sources can be loaded directly.' }] };
  }

  if (!existsSync(source.path) || !statSync(source.path).isDirectory()) {
    return { profiles: [], issues: [{ path: source.path, message: 'Profile source must be an existing directory.' }] };
  }

  const profiles: LoadedProfile[] = [];
  const issues: ProfileLoadIssue[] = [];

  for (const entryName of readdirSync(source.path).sort()) {
    const folderPath = join(source.path, entryName);
    const profilePath = join(folderPath, 'profile.yml');

    if (statSync(folderPath).isDirectory() && existsSync(profilePath)) {
      addProfileFromFolder(source, entryName, folderPath, profilePath, profiles, issues);
    }
  }

  return { profiles, issues };
};

const addProfileFromFolder = (
  source: ProfileSourceReference,
  fallbackId: string,
  folderPath: string,
  profilePath: string,
  profiles: LoadedProfile[],
  issues: ProfileLoadIssue[],
): void => {
  const profile = parseProfileYaml(readFileSync(profilePath, 'utf8'), fallbackId);

  if ('message' in profile) {
    issues.push({ path: `${profilePath}#${profile.path}`, message: profile.message });
  } else if (isProfileIncludedBySource(profile.id, source)) {
    profiles.push({ source, folderPath, profilePath, profile });
  }
};

const validateProfileRecord = (record: Readonly<Record<string, unknown>>): ProfileLoadIssue | undefined => {
  if (profileValidator(record)) {
    return undefined;
  }

  const error = profileValidator.errors![0] as { readonly instancePath: string; readonly message: string };

  return {
    path: error.instancePath,
    message: error.message,
  };
};

const readObject = (value: unknown): Readonly<Record<string, unknown>> | undefined => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return undefined;
  }

  return value as Readonly<Record<string, unknown>>;
};

const readString = (value: unknown, fallback: string): string => {
  if (typeof value === 'string') {
    return value;
  }

  return fallback;
};

const readOptionalString = (value: unknown): string | undefined => {
  if (typeof value === 'string') {
    return value;
  }

  return undefined;
};

const readStringArray = (value: unknown): readonly string[] => {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === 'string');
  }

  return [];
};

const readControls = (value: unknown): ProfileControls => {
  const controls = readObject(value);

  if (controls === undefined) {
    return {};
  }

  return {
    model: readOptionalString(controls.model),
    environment: readEnvironment(controls.environment),
  };
};

const readEnvironment = (value: unknown): Readonly<Record<string, string>> | undefined => {
  const environment = readObject(value);

  if (environment === undefined) {
    return undefined;
  }

  return Object.fromEntries(
    Object.entries(environment).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
  );
};

export const readErrorMessage = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
};
