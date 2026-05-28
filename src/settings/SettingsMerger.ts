// Provides deterministic Settings merge scaffolding for future config loading.
import { defu } from 'defu';

import type { Settings } from './Settings.js';
import { emptySettings } from './Settings.js';

export const mergeSettingsStack = (settingsStack: readonly Settings[]): Settings =>
  settingsStack.reduce<Settings>((mergedSettings, settings) => defu({}, settings, mergedSettings), emptySettings());
