// Persists first-run welcome choices as a local profile used before launching Pi.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import type { WelcomeCommandResult } from './WelcomeCommand.js';

export interface PersistedFirstRunWelcomeProfile {
  readonly profileId: string;
  readonly createdProfile: boolean;
}

export const persistFirstRunWelcomeProfile = (
  homeDirectory: string,
  settingsPath: string,
  welcomeResult: WelcomeCommandResult | undefined,
): PersistedFirstRunWelcomeProfile | undefined => {
  if (welcomeResult === undefined || !welcomeResult.answered || welcomeResult.selectedRole === undefined) {
    return undefined;
  }

  const welcomeProfile = createFirstRunWelcomeProfile(welcomeResult, welcomeResult.selectedRole);
  const profilePath = join(homeDirectory, '.outfitter', 'profiles', welcomeProfile.id, 'profile.yml');
  const createdProfile = !existsSync(profilePath);

  if (createdProfile) {
    mkdirSync(join(homeDirectory, '.outfitter', 'profiles', welcomeProfile.id), { recursive: true });
    writeFileSync(profilePath, welcomeProfile.content);
  }

  updateSettingsDefaultProfile(settingsPath, welcomeProfile.id);
  return { profileId: welcomeProfile.id, createdProfile };
};

const createFirstRunWelcomeProfile = (
  welcomeResult: WelcomeCommandResult,
  selectedRole: NonNullable<WelcomeCommandResult['selectedRole']>,
): {
  readonly id: string;
  readonly content: string;
} => {
  const profileId = selectedRole.id;
  const extensions = welcomeResult.selectedLoadout?.selectedItems.map((item) => item.source) ?? [];
  const rolePrompt = firstRunWelcomeRolePrompts[selectedRole.id];

  return {
    id: profileId,
    content: createFirstRunWelcomeProfileContent(profileId, selectedRole.label, rolePrompt, extensions),
  };
};

const firstRunWelcomeRolePrompts = {
  engineer:
    'You are operating as an engineering-focused coding agent.\nPrioritize maintainable implementation, clear tests, concise diffs, and verification evidence.\nBefore changing code, inspect the existing project conventions and reuse established patterns.',
  data_analyst:
    'You are operating as a data-analysis-focused agent.\nPrioritize careful data inspection, reproducible analysis steps, clear assumptions, and actionable summaries.\nWhen data or methodology is uncertain, call out limitations and validation checks explicitly.',
} as const;

const createFirstRunWelcomeProfileContent = (
  profileId: string,
  roleLabel: string,
  rolePrompt: string,
  extensions: readonly string[],
): string => {
  const lines = [`id: ${profileId}`, `label: ${roleLabel}`, 'controls:'];

  if (extensions.length > 0) {
    lines.push('  pi:', '    extensions:', ...extensions.map((extension) => `      - ${extension}`));
  }

  lines.push('  append_system_prompt: |', ...rolePrompt.split('\n').map((line) => `    ${line}`), '');
  return lines.join('\n');
};

const updateSettingsDefaultProfile = (settingsPath: string, profileId: string): void => {
  const content = readFileSync(settingsPath, 'utf8');
  const nextContent = /^default_profile:.*$/mu.test(content)
    ? content.replace(/^default_profile:.*$/gmu, `default_profile: ${profileId}`)
    : `${content.replace(/\s*$/u, '\n')}default_profile: ${profileId}\n`;

  writeFileSync(settingsPath, nextContent);
};
