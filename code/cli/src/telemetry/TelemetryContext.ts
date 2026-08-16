// Composes the process-level telemetry collaborators used by the CLI entrypoint.
import { discoverSettingsLoadPlan, loadSettingsFiles } from '../settings/SettingsLoader.js';
import type { SettingsLoadResult } from '../settings/SettingsLoader.js';
import type { TelemetryEnvironment } from './TelemetryConsent.js';
import { detectCi } from './CiEnvironment.js';
import type { DetectedCi } from './CiEnvironment.js';
import { createTelemetryStateStore, resolveTelemetryStatePath } from './TelemetryState.js';
import type { TelemetryStateStore } from './TelemetryState.js';

export interface TelemetryContextInput {
  readonly homeDirectory: string;
  readonly projectDirectory: string;
  readonly env: TelemetryEnvironment;
}

export interface TelemetryContext {
  readonly userSettingsPath: string;
  readonly settingsReader: () => SettingsLoadResult;
  readonly stateStore: TelemetryStateStore;
  readonly ci: DetectedCi;
}

export const createTelemetryContext = (input: TelemetryContextInput): TelemetryContext => {
  const plan = discoverSettingsLoadPlan(input);
  return {
    userSettingsPath: plan.locations.find((location) => location.scope === 'user')!.path,
    settingsReader: () => loadSettingsFiles(plan),
    stateStore: createTelemetryStateStore(resolveTelemetryStatePath(input.homeDirectory, input.env)),
    ci: detectCi(),
  };
};
