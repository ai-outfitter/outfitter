import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { Command } from 'commander';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { resolveTelemetryCommandName, runCli } from '../../src/cli.js';
import type { CommandObject } from '../../src/cli/commands/CommandObject.js';
import { createTelemetryCommand, formatTelemetryStatus } from '../../src/cli/commands/TelemetryCommand.js';
import { createOutfitterProgram } from '../../src/cli/OutfitterCli.js';
import type { LoadedSettingsFile, SettingsLoadResult, SettingsLocation } from '../../src/settings/SettingsLoader.js';
import { createSettingsLoadPlan, loadSettingsFiles } from '../../src/settings/SettingsLoader.js';
import { resolveTelemetryConsent } from '../../src/telemetry/TelemetryConsent.js';
import { TELEMETRY_SHUTDOWN_BUDGET_MS } from '../../src/telemetry/TelemetryConstants.js';
import {
  buildCommandCompletedProperties,
  buildCommandStartedProperties,
  createTelemetryService,
} from '../../src/telemetry/TelemetryService.js';
import type {
  TelemetryClient,
  TelemetryCommandContext,
  TelemetryService,
} from '../../src/telemetry/TelemetryService.js';
import { createTelemetryStateStore, resolveTelemetryStatePath } from '../../src/telemetry/TelemetryState.js';
import type { TelemetryStateStore } from '../../src/telemetry/TelemetryState.js';
import { validateSchema } from '../../src/validation/SchemaValidator.js';
import { allowTestConsoleOutput } from '../test-console.js';

const temporaryRoots: string[] = [];
const previousExitCode = process.exitCode;

const temporaryRoot = (): string => {
  const root = mkdtempSync(join(tmpdir(), 'outfitter-telemetry-'));
  temporaryRoots.push(root);
  return root;
};

const loaded = (...files: LoadedSettingsFile[]): SettingsLoadResult => ({ files, issues: [] });
const file = (scope: SettingsLocation['scope'], enabled: boolean): LoadedSettingsFile => ({
  location: { scope, path: `/${scope}/settings.yml` },
  settings: { telemetry: { enabled } },
});

const memoryStateStore = (noticeShown = false): TelemetryStateStore => {
  let state = { installation_id: '00000000-0000-4000-8000-000000000001', notice_shown: noticeShown };
  return {
    readOrCreate: vi.fn(() => state),
    recordNoticeShown: vi.fn(() => {
      state = { ...state, notice_shown: true };
      return state;
    }),
    delete: vi.fn(),
  };
};

afterEach(() => {
  process.exitCode = previousExitCode;
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true });
  vi.restoreAllMocks();
});

// THESE TESTS VALIDATE THE PRIVACY, CONSENT, CONTROL, AND RELIABILITY REQUIREMENTS IN ISSUE #295.
// DO NOT RELAX THE EXACT PAYLOAD OR NO-FAILURE ASSERTIONS WITHOUT CHANGING THAT CONTRACT.
describe('PostHog CLI telemetry (#295)', () => {
  it('validates telemetry.enabled as a boolean', () => {
    expect(validateSchema('settings', { telemetry: { enabled: true } }).valid).toBe(true);
    expect(validateSchema('settings', { telemetry: { enabled: false } }).valid).toBe(true);
    expect(validateSchema('settings', { telemetry: { enabled: 'yes' } }).valid).toBe(false);
  });

  it('loads and merges telemetry settings while retaining each source scope', () => {
    const root = temporaryRoot();
    const user = join(root, 'user.yml');
    const project = join(root, 'project.yml');
    writeFileSync(user, 'telemetry:\n  enabled: true\n');
    writeFileSync(project, 'telemetry:\n  enabled: false\n');
    const result = loadSettingsFiles(
      createSettingsLoadPlan([
        { scope: 'user', path: user },
        { scope: 'project', path: project },
      ]),
    );
    expect(result.files.map((entry) => entry.settings.telemetry)).toEqual([{ enabled: true }, { enabled: false }]);
  });

  it('enforces scope-aware consent precedence and environment kill switches', () => {
    expect(resolveTelemetryConsent(loaded(), {})).toEqual({ enabled: true, source: 'default' });
    expect(resolveTelemetryConsent(loaded(file('project', true), file('project-local', true)), {})).toEqual({
      enabled: true,
      source: 'default',
    });
    expect(resolveTelemetryConsent(loaded(file('remote', true)), {})).toEqual({ enabled: true, source: 'default' });
    expect(resolveTelemetryConsent(loaded(file('user', true)), {})).toEqual({
      enabled: true,
      source: 'user settings',
    });
    expect(resolveTelemetryConsent(loaded(file('user', true), file('user-local', true)), {})).toEqual({
      enabled: true,
      source: 'user-local settings',
    });
    for (const scope of ['user', 'user-local', 'project', 'project-local'] as const) {
      expect(resolveTelemetryConsent(loaded(file('user', true), file(scope, false)), {})).toEqual({
        enabled: false,
        source: `${scope} settings`,
      });
    }
    expect(resolveTelemetryConsent(loaded(file('remote', false)), {})).toEqual({ enabled: true, source: 'default' });
    expect(resolveTelemetryConsent(loaded(file('user', true)), { OUTFITTER_TELEMETRY: '0' })).toEqual({
      enabled: false,
      source: 'OUTFITTER_TELEMETRY',
    });
    expect(resolveTelemetryConsent(loaded(file('user', true)), { DO_NOT_TRACK: '1' })).toEqual({
      enabled: false,
      source: 'DO_NOT_TRACK',
    });
    expect(resolveTelemetryConsent(loaded(file('user', true)), { CI: 'true' })).toEqual({
      enabled: false,
      source: 'CI',
    });
    expect(resolveTelemetryConsent(loaded(file('user', true)), { CI: '1' })).toEqual({
      enabled: false,
      source: 'CI',
    });
  });

  it('is completely inert when disabled or when the compiled API key is empty', async () => {
    const clientFactory = vi.fn();
    const stateStore = memoryStateStore();
    const writeError = vi.fn();
    const disabled = createTelemetryService({
      settingsReader: () => loaded(file('project', false)),
      stateStore,
      env: {},
      writeError,
      apiKey: 'phc_test',
      clientFactory,
    });
    await disabled.captureCommandStarted(baseContext);
    await disabled.shutdown();

    const noKey = createTelemetryService({
      settingsReader: () => loaded(),
      stateStore,
      env: {},
      writeError,
      clientFactory,
    });
    await noKey.captureCommandStarted(baseContext);
    await noKey.shutdown();

    expect(clientFactory).not.toHaveBeenCalled();
    // eslint-disable-next-line @typescript-eslint/unbound-method -- Vitest inspects the mock without invoking it.
    expect(stateStore.readOrCreate).not.toHaveBeenCalled();
    expect(writeError).not.toHaveBeenCalled();
  });

  it('constructs no client under each process environment kill switch', async () => {
    for (const env of [{ OUTFITTER_TELEMETRY: '0' }, { DO_NOT_TRACK: '1' }, { CI: 'true' }, { CI: '1' }]) {
      const clientFactory = vi.fn();
      const service = createTelemetryService({
        settingsReader: () => loaded(file('user', true)),
        stateStore: memoryStateStore(),
        env,
        writeError: vi.fn(),
        apiKey: 'phc_test',
        clientFactory,
      });
      await service.captureCommandStarted(baseContext);
      expect(clientFactory).not.toHaveBeenCalled();
    }
  });

  it('sends only the two exact allowlisted events, disables GeoIP, and prints the notice once', async () => {
    const captures: unknown[] = [];
    const client: TelemetryClient = {
      capture: (message) => {
        captures.push(message);
      },
      shutdown: vi.fn(() => Promise.resolve()),
    };
    const clientFactory = vi.fn(() => client);
    const errors: string[] = [];
    const service = createTelemetryService({
      settingsReader: () => loaded(file('user', true)),
      stateStore: memoryStateStore(),
      env: {},
      writeError: (message) => errors.push(message),
      apiKey: 'phc_test',
      clientFactory,
    });
    await service.captureCommandStarted(baseContext);
    await service.captureCommandCompleted({ ...baseContext, outcome: 'success', durationMs: 1200, exitCode: 0 });
    await service.shutdown();

    expect(clientFactory).toHaveBeenCalledWith('phc_test', {
      host: 'https://us.i.posthog.com',
      disableGeoip: true,
    });
    expect(captures).toHaveLength(2);
    expect(captures).toEqual([
      {
        distinctId: '00000000-0000-4000-8000-000000000001',
        event: 'cli command started',
        properties: expectedStarted,
      },
      {
        distinctId: '00000000-0000-4000-8000-000000000001',
        event: 'cli command completed',
        properties: {
          ...expectedStarted,
          outcome: 'success',
          duration_bucket: '1-5s',
          exit_code_class: 'success',
          warning_count_bucket: 'unknown',
        },
      },
    ]);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('No content, paths, or arguments are collected');
  });

  it('selects every fixed duration bucket and maps unknown platform, architecture, and harness values', () => {
    expect(
      buildCommandCompletedProperties({ ...baseContext, outcome: 'error', durationMs: 999, exitCode: 9 }),
    ).toMatchObject({
      duration_bucket: '<1s',
      outcome: 'error',
      exit_code_class: 'error',
    });
    expect(
      buildCommandCompletedProperties({ ...baseContext, durationMs: 4999, outcome: 'success', exitCode: 0 }),
    ).toHaveProperty('duration_bucket', '1-5s');
    expect(
      buildCommandCompletedProperties({ ...baseContext, durationMs: 29_999, outcome: 'success', exitCode: 0 }),
    ).toHaveProperty('duration_bucket', '5-30s');
    expect(
      buildCommandCompletedProperties({ ...baseContext, durationMs: 30_000, outcome: 'success', exitCode: 0 }),
    ).toHaveProperty('duration_bucket', '30s+');
    expect(
      buildCommandStartedProperties({
        ...baseContext,
        platform: 'private-os',
        architecture: 'quantum',
        harness: 'secret-harness',
      }),
    ).toMatchObject({ os_family: 'unknown', arch: 'unknown', harness: 'unknown' });
    expect(buildCommandStartedProperties({ ...baseContext, harness: undefined })).toHaveProperty('harness', 'unknown');
  });

  it('cannot leak forbidden context data through the allowlist builder', () => {
    const sentinels = ['SECRET_ARG', '/private/path', 'TOKEN_VALUE', 'agent-private', 'sensitive error'];
    const hostile = {
      ...baseContext,
      args: sentinels[0],
      path: sentinels[1],
      environment: sentinels[2],
      agentName: sentinels[3],
      errorText: sentinels[4],
    };
    const properties = buildCommandStartedProperties(hostile);
    expect(Object.keys(properties).sort()).toEqual(Object.keys(expectedStarted).sort());
    for (const sentinel of sentinels) expect(JSON.stringify(properties)).not.toContain(sentinel);
  });

  it('swallows capture and shutdown failures and bounds a hanging shutdown', async () => {
    process.exitCode = 23;
    const stateStore = memoryStateStore(true);
    const writeError = vi.fn();
    const rejecting = createTelemetryService({
      settingsReader: () => loaded(),
      stateStore,
      env: {},
      writeError,
      apiKey: 'phc_test',
      clientFactory: () => ({
        capture: () => Promise.reject(new Error('capture failed')),
        shutdown: () => Promise.reject(new Error('shutdown failed')),
      }),
      shutdownBudgetMs: 20,
    });
    await rejecting.captureCommandStarted(baseContext);
    await rejecting.shutdown();

    const synchronouslyThrowing = createTelemetryService({
      settingsReader: () => loaded(),
      stateStore,
      env: {},
      writeError,
      apiKey: 'phc_test',
      clientFactory: () => ({
        capture: () => {
          throw new Error('capture failed synchronously');
        },
        shutdown: () => {
          throw new Error('shutdown failed synchronously');
        },
      }),
      shutdownBudgetMs: 20,
    });
    await synchronouslyThrowing.captureCommandStarted(baseContext);
    await synchronouslyThrowing.shutdown();

    const hanging = createTelemetryService({
      settingsReader: () => loaded(),
      stateStore,
      env: {},
      writeError,
      apiKey: 'phc_test',
      clientFactory: () => ({
        capture: () => new Promise<void>(() => undefined),
        shutdown: () => new Promise<void>(() => undefined),
      }),
      shutdownBudgetMs: 20,
    });
    const start = Date.now();
    await hanging.captureCommandStarted(baseContext);
    await hanging.shutdown();
    expect(Date.now() - start).toBeLessThan(200);
    expect(TELEMETRY_SHUTDOWN_BUDGET_MS).toBe(1000);
    expect(writeError).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(23);
  });

  it('creates state lazily, records the notice, honors XDG state, repairs invalid state, and deletes it', () => {
    const root = temporaryRoot();
    expect(resolveTelemetryStatePath('/home/person', {})).toBe('/home/person/.local/state/outfitter/telemetry.json');
    const statePath = resolveTelemetryStatePath('/home/person', { XDG_STATE_HOME: root });
    expect(statePath).toBe(join(root, 'outfitter', 'telemetry.json'));
    const store = createTelemetryStateStore(statePath, () => 'fixed-id');
    expect(store.readOrCreate()).toEqual({ installation_id: 'fixed-id', notice_shown: false });
    expect(store.recordNoticeShown(store.readOrCreate())).toEqual({ installation_id: 'fixed-id', notice_shown: true });
    expect(store.readOrCreate()).toEqual({ installation_id: 'fixed-id', notice_shown: true });
    writeFileSync(statePath, '{}\n');
    expect(store.readOrCreate()).toEqual({ installation_id: 'fixed-id', notice_shown: false });
    writeFileSync(statePath, 'null\n');
    expect(store.readOrCreate()).toEqual({ installation_id: 'fixed-id', notice_shown: false });
    store.delete();
    expect(existsSync(statePath)).toBe(false);
  });

  it('preserves YAML comments and unrelated keys across enable and disable, deletes state, and reports status source', async () => {
    const root = temporaryRoot();
    const home = join(root, 'home');
    const project = join(root, 'project');
    const settingsPath = join(home, '.agents', 'settings.yml');
    mkdirSync(dirname(settingsPath), { recursive: true });
    writeFileSync(settingsPath, '# keep this comment\ndefault_agent: engineer\n');
    const lines: string[] = [];
    const stateStore = memoryStateStore();
    const settingsReader = () =>
      loadSettingsFiles(createSettingsLoadPlan([{ scope: 'user' as const, path: settingsPath }]));
    const program = () =>
      createOutfitterProgram([
        createTelemetryCommand({
          homeDirectory: home,
          projectDirectory: project,
          env: {},
          settingsReader,
          stateStore,
          writeLine: (line) => lines.push(line),
        }),
      ]);

    await program().parseAsync(['node', 'outfitter', 'telemetry', 'enable']);
    expect(readFileSync(settingsPath, 'utf8')).toContain('# keep this comment');
    expect(readFileSync(settingsPath, 'utf8')).toContain('default_agent: engineer');
    expect(settingsReader().files[0]?.settings.telemetry).toEqual({ enabled: true });
    await program().parseAsync(['node', 'outfitter', 'telemetry', 'status']);
    expect(lines.at(-1)).toContain('enabled (source: user settings)');
    await program().parseAsync(['node', 'outfitter', 'telemetry', 'disable']);
    expect(settingsReader().files[0]?.settings.telemetry).toEqual({ enabled: false });
    // eslint-disable-next-line @typescript-eslint/unbound-method -- Vitest inspects the mock without invoking it.
    expect(stateStore.delete).toHaveBeenCalledOnce();
    expect(formatTelemetryStatus(loaded(file('project', false)), {})).toContain('disabled (source: project settings)');
  });

  it('creates an absent user settings file and refuses to overwrite invalid YAML', async () => {
    const root = temporaryRoot();
    const home = join(root, 'home');
    const lines: string[] = [];
    const build = () =>
      createOutfitterProgram([
        createTelemetryCommand({
          homeDirectory: home,
          projectDirectory: root,
          env: {},
          writeLine: (line) => lines.push(line),
        }),
      ]);
    await build().parseAsync(['node', 'outfitter', 'telemetry', 'enable']);
    const settingsPath = join(home, '.agents', 'settings.yml');
    expect(readFileSync(settingsPath, 'utf8')).toContain('enabled: true');
    writeFileSync(settingsPath, ': bad: yaml:');
    await expect(build().parseAsync(['node', 'outfitter', 'telemetry', 'disable'])).rejects.toThrow('invalid YAML');
  });

  it('captures lifecycle metadata at the executable boundary without changing output or exit status', async () => {
    process.exitCode = undefined;
    const calls: string[] = [];
    const telemetry: TelemetryService = {
      captureCommandStarted: (context) => {
        calls.push(`start:${context.command}:${context.harness}:${context.strict}`);
        return Promise.resolve();
      },
      captureCommandCompleted: (context) => {
        calls.push(`complete:${context.outcome}:${context.exitCode}`);
        return Promise.resolve();
      },
      shutdown: () => {
        calls.push('shutdown');
        return Promise.resolve();
      },
    };
    const command: CommandObject = {
      name: 'sample',
      description: 'sample',
      register(program): void {
        program.addCommand(
          new Command('sample')
            .option('--harness <harness>')
            .option('--strict')
            .action(() => {
              calls.push('action');
            }),
        );
      },
    };
    await runCli(createOutfitterProgram([command]), ['node', 'outfitter', 'sample', '--harness', 'pi', '--strict'], {
      telemetry,
      now: vi.fn().mockReturnValueOnce(100).mockReturnValueOnce(110),
      version: '9.9.9',
      nodeVersion: '24.1.0',
      platform: 'linux',
      architecture: 'x64',
      interactive: false,
    });
    expect(calls).toEqual(['start:sample:pi:true', 'action', 'complete:success:0', 'shutdown']);
    expect(process.exitCode).toBeUndefined();
  });

  it('uses process defaults safely, maps unattached commands to unknown, and skips completion without an action', async () => {
    process.exitCode = undefined;
    const program = new Command('outfitter');
    const registered = new Command('known').action(() => undefined);
    program.addCommand(registered);
    expect(resolveTelemetryCommandName(program, registered)).toBe('known');
    expect(resolveTelemetryCommandName(program, new Command('private-user-value'))).toBe('unknown');

    await runCli(program, ['node', 'outfitter', 'known']);

    const telemetry: TelemetryService = {
      captureCommandStarted: () => Promise.resolve(),
      captureCommandCompleted: vi.fn(() => Promise.resolve()),
      shutdown: () => Promise.resolve(),
    };
    const noActionProgram = new Command('outfitter');
    await runCli(noActionProgram, ['node', 'outfitter'], { telemetry });
    // eslint-disable-next-line @typescript-eslint/unbound-method -- Vitest inspects the mock without invoking it.
    expect(telemetry.captureCommandCompleted).not.toHaveBeenCalled();
  });

  it('uses default status dependencies without mutating settings', async () => {
    const root = temporaryRoot();
    allowTestConsoleOutput((message) => message.method === 'log' && message.text.startsWith('Telemetry is enabled'));
    await createOutfitterProgram([createTelemetryCommand({ homeDirectory: root, projectDirectory: root })]).parseAsync([
      'node',
      'outfitter',
      'telemetry',
      'status',
    ]);
  });

  it('captures thrown commands as errors, always shuts down, and rethrows the original error', async () => {
    const calls: string[] = [];
    const telemetry: TelemetryService = {
      captureCommandStarted: () => Promise.resolve(),
      captureCommandCompleted: (context) => {
        calls.push(`${context.outcome}:${context.exitCode}`);
        return Promise.resolve();
      },
      shutdown: () => {
        calls.push('shutdown');
        return Promise.resolve();
      },
    };
    const command: CommandObject = {
      name: 'fail',
      description: 'fail',
      register(program): void {
        program.command('fail').action(() => {
          throw new Error('original command error');
        });
      },
    };
    await expect(
      runCli(createOutfitterProgram([command]), ['node', 'outfitter', 'fail'], {
        telemetry,
        now: vi.fn().mockReturnValueOnce(100).mockReturnValueOnce(120),
        version: '1',
        nodeVersion: '24',
        platform: 'linux',
        architecture: 'x64',
        interactive: false,
      }),
    ).rejects.toThrow('original command error');
    expect(calls).toEqual(['error:1', 'shutdown']);
  });
});

const baseContext: TelemetryCommandContext = {
  command: 'run',
  outfitterVersion: '1.7.1',
  nodeVersion: '24.18.0',
  platform: 'linux',
  architecture: 'x64',
  interactive: true,
  harness: 'pi',
  strict: true,
};

const expectedStarted = {
  command: 'run',
  outfitter_version: '1.7.1',
  node_major: 24,
  os_family: 'linux',
  arch: 'x64',
  interactive: true,
  harness: 'pi',
  strict: true,
  $process_person_profile: false,
};
