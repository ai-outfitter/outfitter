import { join } from 'node:path';
import { loadSettings, formatSettingsIssue } from '../settings/SettingsLoader.js';

export const providerOptInMessage =
  'Enable experimental.outfitter_provider: true in ~/.agents/settings.yml to use internal Outfitter inference.';

/** Only home settings can opt in; catalogs and project settings are never read here. */
export const experimentalProviderEnabled = (homeDirectory: string): boolean => {
  const loaded = loadSettings({
    locations: [
      { scope: 'user', path: join(homeDirectory, '.agents/settings.yml') },
      { scope: 'user-local', path: join(homeDirectory, '.agents/settings.local.yml') },
    ],
  });
  if (loaded.issues.length) throw new Error(loaded.issues.map(formatSettingsIssue).join('\n'));
  return loaded.settings.experimental?.outfitterProvider === true;
};
