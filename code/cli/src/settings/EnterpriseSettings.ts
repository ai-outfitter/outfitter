// Reads and writes Outfitter enterprise settings that must live in user-home settings.yml.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

import { parse, stringify } from 'yaml';

export interface EnterpriseSettingsDocument {
  readonly enterprise?: {
    readonly private_profile_catalogs?: boolean;
  };
}

export const isPrivateProfileCatalogsEnabled = (settingsPath: string): boolean => {
  if (!existsSync(settingsPath)) {
    return false;
  }

  try {
    const parsed: unknown = parse(readFileSync(settingsPath, 'utf8'));
    return readPrivateProfileCatalogsSetting(parsed) === true;
  } catch {
    return false;
  }
};

export const enablePrivateProfileCatalogs = (settingsPath: string): void => {
  const document = readSettingsRecord(settingsPath);
  const enterprise = readMutableRecord(document.enterprise);

  mkdirSync(dirname(settingsPath), { recursive: true });
  writeFileSync(
    settingsPath,
    stringify({
      ...document,
      enterprise: {
        ...enterprise,
        private_profile_catalogs: true,
      },
    }),
  );
};

const readPrivateProfileCatalogsSetting = (value: unknown): boolean | undefined => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }

  const enterprise = (value as EnterpriseSettingsDocument).enterprise;
  return enterprise?.private_profile_catalogs;
};

const readSettingsRecord = (settingsPath: string): Record<string, unknown> => {
  if (!existsSync(settingsPath)) {
    return {};
  }

  const parsed: unknown = parse(readFileSync(settingsPath, 'utf8'));
  return readMutableRecord(parsed);
};

const readMutableRecord = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? { ...(value as Record<string, unknown>) } : {};
