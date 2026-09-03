// Encodes native Codex setting leaves for both ephemeral runs and persistent links.
import type { SettingsValue } from '../settings/Settings.js';

export const codexSettingKey = (path: readonly string[]): string =>
  path.map((key) => (/^[A-Za-z0-9_-]+$/.test(key) ? key : JSON.stringify(key))).join('.');

export const codexSettingValue = (value: SettingsValue): string | undefined => {
  if (value === null) return undefined;
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : undefined;
  if (typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) {
    const values = value.map(codexSettingValue);
    return values.every((item) => item !== undefined) ? `[${values.join(', ')}]` : undefined;
  }
  return undefined;
};
