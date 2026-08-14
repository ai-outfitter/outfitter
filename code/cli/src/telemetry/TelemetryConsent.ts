import type { LoadedSettingsFile, SettingsLoadResult } from '../settings/SettingsLoader.js';

export type TelemetryConsentSource =
  | 'default'
  | 'user settings'
  | 'user-local settings'
  | 'project settings'
  | 'project-local settings'
  | 'invalid settings'
  | 'OUTFITTER_TELEMETRY'
  | 'DO_NOT_TRACK'
  | 'CI';

export interface TelemetryConsent {
  readonly enabled: boolean;
  readonly source: TelemetryConsentSource;
}

export type TelemetryEnvironment = Readonly<Record<string, string | undefined>>;

const localSource = (file: LoadedSettingsFile): TelemetryConsentSource | undefined => {
  switch (file.location.scope) {
    case 'user':
      return 'user settings';
    case 'user-local':
      return 'user-local settings';
    case 'project':
      return 'project settings';
    case 'project-local':
      return 'project-local settings';
    case 'remote':
      return undefined;
  }
};

const environmentConsent = (env: TelemetryEnvironment): TelemetryConsent | undefined => {
  if (env.OUTFITTER_TELEMETRY === '0') return { enabled: false, source: 'OUTFITTER_TELEMETRY' };
  if (env.DO_NOT_TRACK === '1') return { enabled: false, source: 'DO_NOT_TRACK' };
  if (env.CI === 'true' || env.CI === '1') return { enabled: false, source: 'CI' };
  return undefined;
};

export const resolveTelemetryConsent = (loaded: SettingsLoadResult, env: TelemetryEnvironment): TelemetryConsent => {
  const killed = environmentConsent(env);
  if (killed !== undefined) return killed;
  if (loaded.issues.length > 0) return { enabled: false, source: 'invalid settings' };

  // Any local opt-out wins. Remote settings are deliberately excluded from consent.
  const disabled = loaded.files.findLast(
    (file) => localSource(file) !== undefined && file.settings.telemetry?.enabled === false,
  );
  if (disabled !== undefined) return { enabled: false, source: localSource(disabled)! };

  // Only settings owned by the user may explicitly enable collection.
  const enabled = loaded.files.findLast(
    (file) =>
      (file.location.scope === 'user' || file.location.scope === 'user-local') &&
      file.settings.telemetry?.enabled === true,
  );
  if (enabled !== undefined) return { enabled: true, source: localSource(enabled)! };

  return { enabled: true, source: 'default' };
};
