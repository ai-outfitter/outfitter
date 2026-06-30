// Persists first-run welcome choices as a local profile used before launching Pi.
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { parse, stringify } from 'yaml';

import type { WelcomeCommandResult } from './WelcomeCommand.js';

export interface PersistedFirstRunWelcomeProfile {
  readonly profileId: string;
  readonly createdProfile: boolean;
  readonly messages?: readonly string[];
}

export interface FirstRunWelcomeProfileOptions {
  readonly sourceProfileDirectory?: string;
}

export const persistFirstRunWelcomeProfile = (
  homeDirectory: string,
  settingsPath: string,
  welcomeResult: WelcomeCommandResult | undefined,
  options: FirstRunWelcomeProfileOptions = {},
): PersistedFirstRunWelcomeProfile | undefined => {
  if (welcomeResult === undefined || !welcomeResult.answered || welcomeResult.selectedRole === undefined) {
    return undefined;
  }

  const welcomeProfile = createFirstRunWelcomeProfile(welcomeResult, welcomeResult.selectedRole);
  const profileDirectory = join(homeDirectory, '.outfitter', 'profiles', welcomeProfile.id);
  const profilePath = join(profileDirectory, 'profile.yml');
  const createdProfile = !existsSync(profilePath);
  const messages: string[] = [];

  if (createdProfile) {
    if (options.sourceProfileDirectory !== undefined && existsSync(options.sourceProfileDirectory)) {
      cpSync(options.sourceProfileDirectory, profileDirectory, { recursive: true, force: false });
      updateCopiedProfile(profilePath, welcomeProfile.description, welcomeProfile.extensions);
      excludeDefaultProfileSources(settingsPath, welcomeProfile.id);
      messages.push(
        `Copied the ${welcomeProfile.label} profile locally so your extension choices can be edited at ${profilePath}.`,
      );
    } else {
      mkdirSync(profileDirectory, { recursive: true });
      writeFileSync(profilePath, welcomeProfile.content);
    }
  }

  updateSettingsDefaultProfile(settingsPath, welcomeProfile.id);
  return {
    profileId: welcomeProfile.id,
    createdProfile,
    ...(messages.length === 0 ? {} : { messages }),
  };
};

const createFirstRunWelcomeProfile = (
  welcomeResult: WelcomeCommandResult,
  selectedRole: NonNullable<WelcomeCommandResult['selectedRole']>,
): {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly content: string;
  readonly extensions: readonly string[];
} => {
  const profileId = selectedRole.id;
  const extensions = welcomeResult.selectedLoadout?.selectedItems.map((item) => item.source) ?? [];
  const rolePrompt = firstRunWelcomeRolePrompts[selectedRole.id];

  return {
    id: profileId,
    label: selectedRole.label,
    description: selectedRole.description,
    content: createFirstRunWelcomeProfileContent(
      profileId,
      selectedRole.label,
      selectedRole.description,
      rolePrompt,
      extensions,
    ),
    extensions,
  };
};

const firstRunWelcomeRolePrompts = {
  founder:
    "You are operating as a founder-operator agent: builder, product thinker, research auditor, dense-prose editor, and careful operator. Do not behave like a generic senior engineer or a pure project manager.\n\nThe repo is the brain. Chat history is transient. Durable facts, decisions, requirements, plans, review outcomes, and lessons belong in project files when the work is substantive.\n\nIf the user's intent and acceptance criteria are clear, proceed without needless confirmation. Ask briefly when missing information would materially change the artifact, risk profile, or implementation path.\n\nFor nontrivial work, keep a visible task list with one in-progress item and checkable completion conditions. Requirements and milestone specs should use RFC 2119 keywords and acceptance criteria that can be checked from repo state or named external evidence.\n\nUse DeepWork, reviews, tests, browser evidence, source checks, or human-meaningful validation before calling substantive work done.\n\nOptimize substantive prose for density. Remove filler, keep every sentence load-bearing, preserve nuance, and avoid summaries that erase interesting claims.\n\nNumbers, market claims, schedules, legal or regulatory claims, current facts, prices, and recommendations require source checks when there is a meaningful chance of drift or high-stakes error.\n\nNever push, tag, merge, publish, deploy, send external messages, type credentials, make payments, perform legal filings, mutate production, or make irreversible data changes without explicit user approval.",
  engineer:
    'You are operating as an engineering-focused coding agent.\nPrioritize maintainable implementation, clear tests, concise diffs, and verification evidence.\nBefore changing code, inspect the existing project conventions and reuse established patterns.',
  data_analyst:
    'You are operating as a data-analysis-focused agent.\nPrioritize careful data inspection, reproducible analysis steps, clear assumptions, and actionable summaries.\nWhen data or methodology is uncertain, call out limitations and validation checks explicitly.',
} as const;

const createFirstRunWelcomeProfileContent = (
  profileId: string,
  roleLabel: string,
  roleDescription: string,
  rolePrompt: string,
  extensions: readonly string[],
): string => {
  const lines = [`id: ${profileId}`, `label: ${roleLabel}`, `description: ${roleDescription}`, 'controls:'];

  if (extensions.length > 0) {
    lines.push('  pi:', '    extensions:', ...extensions.map((extension) => `      - ${extension}`));
  }

  lines.push('  append_system_prompt: |', ...rolePrompt.split('\n').map((line) => `    ${line}`), '');
  return lines.join('\n');
};

const updateCopiedProfile = (profilePath: string, description: string, extensions: readonly string[]): void => {
  const profile = readRecord(parse(readFileSync(profilePath, 'utf8')) as unknown);
  const controls = readRecord(profile.controls);
  const piControls = readRecord(controls.pi);

  profile.description ??= description;
  controls.extensions = [];
  piControls.extensions = [...extensions];
  controls.pi = piControls;
  profile.controls = controls;

  mkdirSync(dirname(profilePath), { recursive: true });
  writeFileSync(profilePath, stringify(profile));
};

const readRecord = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? { ...(value as Record<string, unknown>) } : {};

const defaultProfilesSourceGithub = 'ai-outfitter/default-profiles';
const defaultProfilesSourcePath = 'profiles';
const defaultProfilesSourceUri = 'https://github.com/ai-outfitter/default-profiles';

const excludeDefaultProfileSources = (settingsPath: string, profileId: string): void => {
  const document = readRecord(parse(readFileSync(settingsPath, 'utf8')) as unknown);
  const rawProfileSources = document.profile_sources;
  const profileSources: readonly unknown[] = Array.isArray(rawProfileSources) ? rawProfileSources : [];
  const nextProfileSources = profileSources.map((source): unknown => {
    const record = readRecord(source);

    if (!isDefaultProfilesSource(record)) {
      return source;
    }

    const except = Array.isArray(record.except)
      ? record.except.filter((item): item is string => typeof item === 'string')
      : [];
    return { ...record, except: [...new Set([...except, profileId])] };
  });

  writeFileSync(settingsPath, stringify({ ...document, profile_sources: nextProfileSources }));
};

const isDefaultProfilesSource = (source: Record<string, unknown>): boolean => {
  if (source.path !== defaultProfilesSourcePath) {
    return false;
  }

  if (source.github === defaultProfilesSourceGithub) {
    return true;
  }

  return typeof source.uri === 'string' && normalizeDefaultProfilesSourceUri(source.uri) === defaultProfilesSourceUri;
};

const normalizeDefaultProfilesSourceUri = (uri: string): string =>
  uri
    .replace(/^git\+/u, '')
    .replace(/\/$/u, '')
    .replace(/\.git$/u, '');

export const updateSettingsDefaultProfile = (settingsPath: string, profileId: string): void => {
  const content = readFileSync(settingsPath, 'utf8');
  const nextContent = /^default_profile:.*$/mu.test(content)
    ? content.replace(/^default_profile:.*$/gmu, `default_profile: ${profileId}`)
    : `${content.replace(/\s*$/u, '\n')}default_profile: ${profileId}\n`;

  writeFileSync(settingsPath, nextContent);
};
