import { join } from 'node:path';
import { loadSettings, formatSettingsIssue } from '../settings/SettingsLoader.js';
import { hostedOrigin } from './HostedClient.js';

export const providerOptInMessage =
  'Enable experimental.outfitter_provider: true in ~/.agents/settings.yml to use Outfitter inference.';

export interface HostedSettings {
  readonly enabled: boolean;
  /** Validated origin; credentials are scoped to it. */
  readonly origin: string;
}

/** Only home settings can opt in or change the origin; catalogs and project settings are never read here. */
export const hostedSettings = (homeDirectory: string): HostedSettings => {
  const loaded = loadSettings({
    locations: [
      { scope: 'user', path: join(homeDirectory, '.agents/settings.yml') },
      { scope: 'user-local', path: join(homeDirectory, '.agents/settings.local.yml') },
    ],
  });
  if (loaded.issues.length) throw new Error(loaded.issues.map(formatSettingsIssue).join('\n'));
  return {
    enabled: loaded.settings.experimental?.outfitterProvider === true,
    origin: hostedOrigin(loaded.settings.experimental?.outfitterOrigin),
  };
};

export const experimentalProviderEnabled = (homeDirectory: string): boolean => hostedSettings(homeDirectory).enabled;
