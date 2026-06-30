// Loads local profile folders and parses profile.yml documents.
import { existsSync, readdirSync, readFileSync, statSync, type Stats } from 'node:fs';
import { join } from 'node:path';

import type { ValidationIssue } from '../validation/SchemaValidator.js';
import { validateSchema } from '../validation/SchemaValidator.js';
import { parseYamlDocument } from '../validation/YamlDocument.js';
import type {
  AgentSpecificProfileControls,
  DeepWorkProfileControls,
  Profile,
  ProfileControls,
  StatePersistenceOverrides,
} from './Profile.js';
import type { ProfileSourceReference } from './ProfileSource.js';

const profileIdPattern = /^[a-z0-9][a-z0-9._-]*[a-z0-9]$|^[a-z0-9]$/u;
const flatProfileFilePattern = /^(?<slug>.+)\.ya?ml$/u;
const directoryProfileFileName = 'profile.yml';

export interface ProfileLoadPlan {
  readonly sources: readonly ProfileSourceReference[];
}

export type ProfileLoadIssue = ValidationIssue;

export type ProfileLayout = 'directory' | 'flat-file';

export interface LoadedProfile {
  readonly source: ProfileSourceReference;
  readonly folderPath: string;
  readonly profilePath: string;
  readonly profile: Profile;
  readonly sourceRootPath?: string;
  readonly resourceRootPath?: string;
  readonly layout?: ProfileLayout;
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

  const statePersistence = readStatePersistence(record.state_persistence);

  return omitUndefined({
    id,
    label: readOptionalString(record.label),
    description: readOptionalString(record.description),
    template: readOptionalBoolean(record.template),
    inherits: readStringArray(record.inherits),
    controls: readControls(record.controls),
    statePersistence: Object.keys(statePersistence).length > 0 ? statePersistence : undefined,
    profileExport: readOptionalBoolean(record.profile_export),
  });
};

export const parseProfileYaml = (content: string, fallbackId: string): Profile | ProfileLoadIssue => {
  const parsed = parseYamlDocument(content, '/profile.yml');

  if (!parsed.ok) {
    return parsed.issue;
  }

  return parseProfileDocument(parsed.document, fallbackId);
};

export const loadLocalProfileSource = (source: ProfileSourceReference): ProfileLoadResult => {
  if (source.path === undefined) {
    return {
      profiles: [],
      issues: [{ path: '<uri-source>', message: 'Only local profile sources can be loaded directly.' }],
    };
  }

  const sourceEntries = readProfileSourceEntries(source.path);

  if (!Array.isArray(sourceEntries)) {
    return { profiles: [], issues: [sourceEntries] };
  }

  const profiles: LoadedProfile[] = [];
  const issues: ProfileLoadIssue[] = [];

  for (const { entryName, entryPath, entry } of sourceEntries) {
    if (entry.isDirectory()) {
      const profilePath = join(entryPath, directoryProfileFileName);

      if (existsSync(profilePath)) {
        addProfileFromPath({
          source,
          sourceRootPath: source.path,
          fallbackId: entryName,
          folderPath: entryPath,
          profilePath,
          resourceRootPath: entryPath,
          layout: 'directory',
          profiles,
          issues,
        });
      }

      continue;
    }

    if (entry.isFile()) {
      const fallbackId = readFlatProfileSlug(entryName);

      /* v8 ignore next -- flat file fallback slug rejection is covered by schema-level profile-source validation. */
      if (fallbackId !== undefined) {
        addProfileFromPath({
          source,
          sourceRootPath: source.path,
          fallbackId,
          folderPath: source.path,
          profilePath: entryPath,
          layout: 'flat-file',
          profiles,
          issues,
        });
      }
    }
  }

  return { profiles, issues };
};

interface ProfileSourceEntry {
  readonly entryName: string;
  readonly entryPath: string;
  readonly entry: Stats;
}

const readProfileSourceEntries = (sourcePath: string): ProfileSourceEntry[] | ProfileLoadIssue => {
  let sourceDirectory;

  try {
    sourceDirectory = existsSync(sourcePath) ? statSync(sourcePath) : undefined;
  } catch (error) {
    return { path: sourcePath, message: `Could not inspect profile source: ${String(error)}` };
  }

  if (sourceDirectory === undefined || !sourceDirectory.isDirectory()) {
    return { path: sourcePath, message: 'Profile source must be an existing directory.' };
  }

  try {
    return readdirSync(sourcePath)
      .sort()
      .map((entryName): ProfileSourceEntry => {
        const entryPath = join(sourcePath, entryName);
        return { entryName, entryPath, entry: statSync(entryPath) };
      });
  } catch (error) {
    return { path: sourcePath, message: `Could not read profile source entries: ${String(error)}` };
  }
};

const readFlatProfileSlug = (entryName: string): string | undefined => {
  const match = flatProfileFilePattern.exec(entryName);

  if (match?.groups?.slug === undefined || match.groups.slug === 'profile') {
    return undefined;
  }

  return match.groups.slug;
};

const addProfileFromPath = (input: {
  readonly source: ProfileSourceReference;
  readonly sourceRootPath: string;
  readonly fallbackId: string;
  readonly folderPath: string;
  readonly profilePath: string;
  readonly resourceRootPath?: string;
  readonly layout: ProfileLayout;
  readonly profiles: LoadedProfile[];
  readonly issues: ProfileLoadIssue[];
}): void => {
  if (!isValidProfileId(input.fallbackId)) {
    input.issues.push({
      path: input.profilePath,
      message: `Profile slug '${input.fallbackId}' is not a filesystem-safe Outfitter profile id.`,
    });
    return;
  }

  let content: string;

  try {
    content = readFileSync(input.profilePath, 'utf8');
  } catch (error) {
    input.issues.push({ path: input.profilePath, message: `Could not read profile YAML: ${String(error)}` });
    return;
  }

  const profile = parseProfileYaml(content, input.fallbackId);

  if ('message' in profile) {
    input.issues.push({ path: `${input.profilePath}#${profile.path}`, message: profile.message });
  } else if (isProfileIncludedBySource(profile.id, input.source)) {
    input.profiles.push({
      source: input.source,
      folderPath: input.folderPath,
      profilePath: input.profilePath,
      profile,
      sourceRootPath: input.sourceRootPath,
      resourceRootPath: input.resourceRootPath,
      layout: input.layout,
    });
  }
};

const validateProfileRecord = (record: Readonly<Record<string, unknown>>): ProfileLoadIssue | undefined => {
  const validation = validateSchema('profile', record);

  if (validation.valid) {
    return undefined;
  }

  return validation.issues[0];
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

const readOptionalBoolean = (value: unknown): boolean | undefined => {
  if (typeof value === 'boolean') {
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

const readOptionalStringArray = (value: unknown): readonly string[] | undefined => {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === 'string');
  }

  return undefined;
};

const readOptionalStringOrStringArray = (value: unknown): string | readonly string[] | undefined => {
  if (typeof value === 'string') {
    return value;
  }

  return readOptionalStringArray(value);
};

const readControls = (value: unknown): ProfileControls => {
  const controls = readObject(value);

  if (controls === undefined) {
    return {};
  }

  return omitUndefined({
    ...controls,
    model: readOptionalString(controls.model),
    provider: readOptionalString(controls.provider),
    thinking: readOptionalString(controls.thinking),
    environment: readEnvironment(controls.environment),
    args: readOptionalStringArray(controls.args),
    sessionDirectory: readOptionalString(controls.session_directory),
    extensions: readOptionalStringArray(controls.extensions),
    skills: readOptionalStringArray(controls.skills),
    promptTemplate: readOptionalString(controls.prompt_template),
    systemPrompt: readOptionalString(controls.system_prompt),
    appendSystemPrompt: readOptionalStringOrStringArray(controls.append_system_prompt),
    deepwork: readDeepWorkControls(controls.deepwork),
    pi: readAgentSpecificControls(controls.pi),
    claude: readAgentSpecificControls(controls.claude),
  });
};

const readDeepWorkControls = (value: unknown): DeepWorkProfileControls | undefined => {
  const controls = readObject(value);

  if (controls === undefined) {
    return undefined;
  }

  return omitUndefined({
    ...controls,
    jobs: readOptionalStringArray(controls.jobs),
  });
};

const readAgentSpecificControls = (value: unknown): AgentSpecificProfileControls | undefined => {
  const controls = readObject(value);

  if (controls === undefined) {
    return undefined;
  }

  return omitUndefined({
    ...controls,
    model: readOptionalString(controls.model),
    provider: readOptionalString(controls.provider),
    thinking: readOptionalString(controls.thinking),
    environment: readEnvironment(controls.environment),
    args: readOptionalStringArray(controls.args),
    sessionDirectory: readOptionalString(controls.session_directory),
    extensions: readOptionalStringArray(controls.extensions),
    skills: readOptionalStringArray(controls.skills),
    promptTemplate: readOptionalString(controls.prompt_template),
    systemPrompt: readOptionalString(controls.system_prompt),
    appendSystemPrompt: readOptionalStringOrStringArray(controls.append_system_prompt),
  });
};

const omitUndefined = <T extends Readonly<Record<string, unknown>>>(record: T): T =>
  Object.fromEntries(Object.entries(record).filter((entry) => entry[1] !== undefined)) as T;

const readStatePersistence = (value: unknown): StatePersistenceOverrides => {
  const statePersistence = readObject(value);

  if (statePersistence === undefined) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(statePersistence).filter(
      (entry): entry is [string, StatePersistenceOverrides[string]] => typeof entry[1] === 'string',
    ),
  );
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
