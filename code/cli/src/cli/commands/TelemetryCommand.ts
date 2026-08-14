import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { Command } from 'commander';
import { parseDocument } from 'yaml';

import { discoverSettingsLoadPlan, loadSettingsFiles } from '../../settings/SettingsLoader.js';
import type { SettingsLoadResult } from '../../settings/SettingsLoader.js';
import { resolveTelemetryConsent } from '../../telemetry/TelemetryConsent.js';
import type { TelemetryEnvironment } from '../../telemetry/TelemetryConsent.js';
import { createTelemetryStateStore, resolveTelemetryStatePath } from '../../telemetry/TelemetryState.js';
import type { TelemetryStateStore } from '../../telemetry/TelemetryState.js';
import type { CommandObject } from './CommandObject.js';
import { resolveHomeDirectory, resolveProjectDirectory } from './ProcessDefaults.js';

export interface TelemetryCommandDependencies {
  readonly homeDirectory?: string;
  readonly projectDirectory?: string;
  readonly env?: TelemetryEnvironment;
  readonly settingsReader?: () => SettingsLoadResult;
  readonly stateStore?: TelemetryStateStore;
  readonly writeLine?: (message: string) => void;
}

export const updateTelemetrySetting = (settingsPath: string, enabled: boolean): void => {
  const source = existsSync(settingsPath) ? readFileSync(settingsPath, 'utf8') : '';
  const document = parseDocument(source);
  if (document.errors.length > 0) throw new Error(`Cannot update invalid YAML in ${settingsPath}.`);
  document.setIn(['telemetry', 'enabled'], enabled);
  mkdirSync(dirname(settingsPath), { recursive: true });
  writeFileSync(settingsPath, document.toString());
};

const changeGuidance =
  'Change it with `outfitter telemetry enable|disable`, `OUTFITTER_TELEMETRY=0`, `DO_NOT_TRACK=1`, or `CI=true`.';

export const formatTelemetryStatus = (loaded: SettingsLoadResult, env: TelemetryEnvironment): string => {
  const consent = resolveTelemetryConsent(loaded, env);
  return `Telemetry is ${consent.enabled ? 'enabled' : 'disabled'} (source: ${consent.source}). ${changeGuidance}`;
};

export const createTelemetryCommand = (dependencies: TelemetryCommandDependencies = {}): CommandObject => ({
  name: 'telemetry',
  description: 'Inspect or change anonymous product analytics.',
  register(program: Command): void {
    const command = new Command('telemetry').description('Inspect or change anonymous product analytics.');

    const resolveDependencies = () => {
      const homeDirectory = resolveHomeDirectory(dependencies.homeDirectory);
      const projectDirectory = resolveProjectDirectory(dependencies.projectDirectory);
      const env = dependencies.env ?? process.env;
      const settingsPath = join(homeDirectory, '.agents', 'settings.yml');
      const settingsReader =
        dependencies.settingsReader ??
        (() => loadSettingsFiles(discoverSettingsLoadPlan({ homeDirectory, projectDirectory })));
      const stateStore =
        dependencies.stateStore ?? createTelemetryStateStore(resolveTelemetryStatePath(homeDirectory, env));
      return { env, settingsPath, settingsReader, stateStore };
    };

    command
      .command('status')
      .description('Show whether telemetry is enabled and why.')
      .action(() => {
        const resolved = resolveDependencies();
        /* v8 ignore next -- console fallback is direct CLI behavior; tests inject a writer. */
        (dependencies.writeLine ?? console.log)(formatTelemetryStatus(resolved.settingsReader(), resolved.env));
      });

    command
      .command('enable')
      .description('Enable telemetry in user settings.')
      .action(() => {
        const resolved = resolveDependencies();
        updateTelemetrySetting(resolved.settingsPath, true);
        /* v8 ignore next -- console fallback is direct CLI behavior; tests inject a writer. */
        (dependencies.writeLine ?? console.log)('Telemetry enabled in user settings.');
      });

    command
      .command('disable')
      .description('Disable telemetry in user settings and remove the installation identifier.')
      .action(() => {
        const resolved = resolveDependencies();
        updateTelemetrySetting(resolved.settingsPath, false);
        resolved.stateStore.delete();
        /* v8 ignore next -- console fallback is direct CLI behavior; tests inject a writer. */
        (dependencies.writeLine ?? console.log)('Telemetry disabled and installation identifier removed.');
      });

    program.addCommand(command);
  },
});
