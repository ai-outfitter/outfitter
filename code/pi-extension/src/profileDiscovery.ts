// Discovers profile choices from the synced default catalog for /outfitter onboarding.
import type { OnboardingFs, OutfitterPaths, ProfileChoice } from './types.js';

export const OUTFITTER_PROFILE_ID_PATTERN = /^[a-z0-9][a-z0-9._-]*[a-z0-9]$|^[a-z0-9]$/u;

export const readCurrentDefaultProfile = (
  settingsPath: string,
  existsSync: OnboardingFs['existsSync'],
  readFileSync: OnboardingFs['readFileSync'],
): string | undefined => {
  if (!existsSync(settingsPath)) {
    return undefined;
  }
  const match = /^default_profile:\s*([^\n#]+)/mu.exec(readFileSync(settingsPath, 'utf8'));
  return match?.[1]?.trim().replace(/^['"]|['"]$/gu, '');
};

export const discoverProfileChoices = (
  fs: OnboardingFs,
  paths: OutfitterPaths,
  currentDefault: string | undefined,
): ProfileChoice[] => {
  const discovered = new Map<string, ProfileChoice>();
  const addProfile = (profile: ProfileChoice): void => {
    if (profile.id === '' || !OUTFITTER_PROFILE_ID_PATTERN.test(profile.id)) {
      return;
    }
    const existing = discovered.get(profile.id);
    discovered.set(profile.id, {
      id: profile.id,
      label: profile.label ?? existing?.label,
      description: profile.description ?? existing?.description,
    });
  };

  for (const profile of readProfilesFromSource(fs, paths.defaultProfilesPath)) {
    addProfile(profile);
  }

  return [...discovered.values()].sort((left, right) => compareProfiles(left, right, currentDefault));
};

const readProfilesFromSource = (fs: OnboardingFs, sourcePath: string | undefined): ProfileChoice[] => {
  if (sourcePath === undefined || sourcePath === '' || !fs.existsSync(sourcePath)) {
    return [];
  }
  let entries: readonly string[];
  try {
    entries = [...fs.readdirSync(sourcePath)].sort();
  } catch {
    return [];
  }

  return entries
    .flatMap((entryName) => readProfilesFromEntry(fs, sourcePath, entryName))
    .filter((profile) => profile.template !== true);
};

const readProfilesFromEntry = (fs: OnboardingFs, sourcePath: string, entryName: string): ProfileChoice[] => {
  const entryPath = fs.join(sourcePath, entryName);
  let entryStat: { isDirectory(): boolean; isFile(): boolean };
  try {
    entryStat = fs.statSync(entryPath);
  } catch {
    return [];
  }

  if (entryStat.isDirectory()) {
    const profilePath = fs.join(entryPath, 'profile.yml');
    return fs.existsSync(profilePath) ? [readProfileYaml(fs.readFileSync(profilePath, 'utf8'), entryName)] : [];
  }

  if (!entryStat.isFile() || !/\.ya?ml$/u.test(entryName) || entryName === 'profile.yml') {
    return [];
  }
  return [readProfileYaml(fs.readFileSync(entryPath, 'utf8'), entryName.replace(/\.ya?ml$/u, ''))];
};

const readProfileYaml = (content: string, fallbackId: string): ProfileChoice => ({
  id: readYamlString(content, 'id') ?? fallbackId,
  label: readYamlString(content, 'label'),
  description: readYamlString(content, 'description'),
  template: readYamlString(content, 'template') === 'true',
});

const readYamlString = (content: string, key: string): string | undefined => {
  const match = new RegExp('^' + key + ':\\s*([^\\n#]+)', 'mu').exec(content);
  return match?.[1]?.trim().replace(/^['"]|['"]$/gu, '');
};

const compareProfiles = (left: ProfileChoice, right: ProfileChoice, currentDefault: string | undefined): number => {
  if (currentDefault !== undefined) {
    if (left.id === currentDefault) {
      return -1;
    }
    if (right.id === currentDefault) {
      return 1;
    }
  }
  if (left.id === 'founder') {
    return -1;
  }
  if (right.id === 'founder') {
    return 1;
  }
  return left.id.localeCompare(right.id);
};

export const formatProfileLabel = (profile: ProfileChoice, currentDefault: string | undefined): string => {
  const current = profile.id === currentDefault ? ' (current)' : '';
  const recommended = currentDefault === undefined && profile.id === 'founder' ? ' (Recommended)' : '';
  const label = profile.label !== undefined && profile.label !== '' ? ' — ' + profile.label : '';
  return profile.id + label + current + recommended;
};
