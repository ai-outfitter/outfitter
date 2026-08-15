import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { formatTelemetryStatus } from '../../src/cli/commands/TelemetryCommand.js';
import type { SettingsLoadResult } from '../../src/settings/SettingsLoader.js';
import { detectCi, normalizeCiVendorId } from '../../src/telemetry/CiEnvironment.js';
import { createTelemetryContext } from '../../src/telemetry/TelemetryContext.js';
import { createTelemetryService } from '../../src/telemetry/TelemetryService.js';
import type { TelemetryClient, TelemetryCommandContext } from '../../src/telemetry/TelemetryService.js';
import { createTelemetryStateStore, resolveTelemetryStatePath } from '../../src/telemetry/TelemetryState.js';

const temporaryRoots: string[] = [];
const temporaryRoot = (): string => {
  const root = mkdtempSync(join(tmpdir(), 'outfitter-telemetry-ci-'));
  temporaryRoots.push(root);
  return root;
};
const settings: SettingsLoadResult = { files: [], issues: [] };
const githubCi = { isCI: true, vendorId: 'github_actions' } as const;
const unknownCi = { isCI: true, vendorId: null } as const;
const nonCi = { isCI: false, vendorId: null } as const;
const commandContext: TelemetryCommandContext = {
  command: 'run',
  outfitterVersion: '1.7.1',
  nodeVersion: '24.18.0',
  platform: 'linux',
  architecture: 'x64',
  interactive: false,
};

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe('CI telemetry', () => {
  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-011.6).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('uses synthetic vendor identity without reading state or printing the notice', async () => {
    const root = temporaryRoot();
    const env = { GITHUB_ACTIONS: 'true' };
    const context = createTelemetryContext({ homeDirectory: join(root, 'home'), projectDirectory: root, env });
    const readOrCreate = vi.spyOn(context.stateStore, 'readOrCreate');
    const recordNoticeShown = vi.spyOn(context.stateStore, 'recordNoticeShown');
    const captures: Array<Parameters<TelemetryClient['capture']>[0]> = [];
    const notices: string[] = [];
    const service = createTelemetryService({
      settingsReader: context.settingsReader,
      stateStore: context.stateStore,
      ci: githubCi,
      env,
      writeError: (message) => notices.push(message),
      apiKey: 'phc_test',
      clientFactory: () => ({
        capture: (message) => {
          captures.push(message);
        },
        shutdown: () => Promise.resolve(),
      }),
    });

    await service.captureCommandStarted(commandContext);
    await service.captureCommandCompleted({ ...commandContext, outcome: 'success', durationMs: 20, exitCode: 0 });

    expect(captures).toHaveLength(2);
    for (const capture of captures) {
      expect(capture).toMatchObject({
        distinctId: 'ci.github_actions',
        properties: { is_ci: true, ci_name: 'github_actions' },
      });
    }
    expect(readOrCreate).not.toHaveBeenCalled();
    expect(recordNoticeShown).not.toHaveBeenCalled();
    expect(notices).toEqual([]);
    expect(readdirSync(root)).toEqual([]);
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-011.6).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('labels generic CI with an unknown vendor as ci.unknown', async () => {
    const root = temporaryRoot();
    const env = { BUILD_ID: 'generic' };
    const context = createTelemetryContext({ homeDirectory: join(root, 'home'), projectDirectory: root, env });
    const captures: Array<Parameters<TelemetryClient['capture']>[0]> = [];
    const service = createTelemetryService({
      settingsReader: context.settingsReader,
      stateStore: context.stateStore,
      ci: unknownCi,
      env,
      writeError: vi.fn(),
      apiKey: 'phc_test',
      clientFactory: () => ({
        capture: (message) => {
          captures.push(message);
        },
        shutdown: () => Promise.resolve(),
      }),
    });

    await service.captureCommandStarted(commandContext);

    expect(captures[0]).toMatchObject({
      distinctId: 'ci.unknown',
      properties: { is_ci: true, ci_name: 'unknown' },
    });
    expect(readdirSync(root)).toEqual([]);
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-011.6).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('treats CI=false as non-CI and follows the persistent UUID identity path', async () => {
    const root = temporaryRoot();
    const home = join(root, 'home');
    const env = { CI: 'false' };
    const statePath = resolveTelemetryStatePath(home, env);
    const captures: Array<Parameters<TelemetryClient['capture']>[0]> = [];
    const service = createTelemetryService({
      settingsReader: () => settings,
      stateStore: createTelemetryStateStore(statePath),
      ci: nonCi,
      env,
      writeError: vi.fn(),
      apiKey: 'phc_test',
      clientFactory: () => ({
        capture: (message) => {
          captures.push(message);
        },
        shutdown: () => Promise.resolve(),
      }),
    });

    await service.captureCommandStarted(commandContext);

    expect(captures[0]?.distinctId).toMatch(/^[0-9a-f-]{36}$/u);
    expect(captures[0]?.properties).toMatchObject({ is_ci: false, ci_name: 'none' });
    expect(existsSync(statePath)).toBe(true);
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-011.6).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('passes through ci-info public exports with a normalized vendor ID', () => {
    const detected = detectCi();
    expect(detected.isCI).toBeTypeOf('boolean');
    expect(detected.vendorId === null || detected.vendorId === detected.vendorId.toLowerCase()).toBe(true);
    expect(normalizeCiVendorId('GITHUB_ACTIONS')).toBe('github_actions');
    expect(normalizeCiVendorId(null)).toBeNull();
    expect(formatTelemetryStatus(settings, { CI: '1' }, unknownCi, 'phc_test')).toContain('ci_name: unknown.');
  });
});
