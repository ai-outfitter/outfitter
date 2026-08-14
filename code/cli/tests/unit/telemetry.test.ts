import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { createTelemetryCommand, formatTelemetryStatus } from '../../src/cli/commands/TelemetryCommand.js';
import { createOutfitterProgram } from '../../src/cli/OutfitterCli.js';
import type { LoadedSettingsFile, SettingsLoadResult, SettingsLocation } from '../../src/settings/SettingsLoader.js';
import { createSettingsLoadPlan, loadSettingsFiles } from '../../src/settings/SettingsLoader.js';
import { resolveTelemetryConsent } from '../../src/telemetry/TelemetryConsent.js';
import {
  buildCommandCompletedProperties,
  buildCommandStartedProperties,
  createTelemetryService,
} from '../../src/telemetry/TelemetryService.js';
import type {
  TelemetryClient,
  TelemetryClientFactory,
  TelemetryCommandContext,
} from '../../src/telemetry/TelemetryService.js';
import { createTelemetryStateStore, resolveTelemetryStatePath } from '../../src/telemetry/TelemetryState.js';
import type { TelemetryStateStore } from '../../src/telemetry/TelemetryState.js';
import { validateSchema } from '../../src/validation/SchemaValidator.js';

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
  vi.unstubAllGlobals();
});

// THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-011.1, OFTR-011.2, OFTR-011.3, OFTR-011.4, OFTR-011.5).
// YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
describe('PostHog CLI telemetry', () => {
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

  it('fails closed with an explicit source when any loaded settings file is invalid', async () => {
    const invalid: SettingsLoadResult = {
      files: [file('user', true)],
      issues: [{ filePath: '/home/test/.agents/settings.yml', path: '/startup/ascii_art', message: 'must be boolean' }],
    };
    expect(resolveTelemetryConsent(invalid, {})).toEqual({ enabled: false, source: 'invalid settings' });
    expect(formatTelemetryStatus(invalid, {})).toContain('disabled (source: invalid settings)');
    const clientFactory = vi.fn();
    const service = createTelemetryService({
      settingsReader: () => invalid,
      stateStore: memoryStateStore(),
      env: {},
      writeError: vi.fn(),
      apiKey: 'phc_test',
      clientFactory,
    });
    await service.captureCommandStarted(baseContext);
    expect(clientFactory).not.toHaveBeenCalled();
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
      apiKey: '',
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
    const clientFactory = vi.fn<TelemetryClientFactory>(() => client);
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

    expect(clientFactory).toHaveBeenCalledOnce();
    expect(clientFactory.mock.calls[0]?.[0]).toBe('phc_test');
    expect(clientFactory.mock.calls[0]?.[1]).toMatchObject({
      host: 'https://us.i.posthog.com',
      disableGeoip: true,
    });
    expect(typeof clientFactory.mock.calls[0]?.[1].fetch).toBe('function');
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
    expect(errors[0]).toContain('pseudonymous');
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

  it('swallows client capture and shutdown failures without changing process state', async () => {
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
    expect(writeError).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(23);
  });

  it('creates state lazily, records the notice, honors XDG state, repairs invalid state, and deletes it', () => {
    const root = temporaryRoot();
    expect(resolveTelemetryStatePath('/home/person', {})).toBe('/home/person/.local/state/outfitter/telemetry.json');
    const statePath = resolveTelemetryStatePath('/home/person', { XDG_STATE_HOME: root });
    expect(statePath).toBe(join(root, 'outfitter', 'telemetry.json'));
    expect(resolveTelemetryStatePath('/home/person', { XDG_STATE_HOME: '   ' })).toBe(
      '/home/person/.local/state/outfitter/telemetry.json',
    );
    const store = createTelemetryStateStore(statePath, () => 'fixed-id');
    expect(store.readOrCreate()).toEqual({ installation_id: 'fixed-id', notice_shown: false });
    expect(store.recordNoticeShown(store.readOrCreate())).toEqual({ installation_id: 'fixed-id', notice_shown: true });
    expect(store.readOrCreate()).toEqual({ installation_id: 'fixed-id', notice_shown: true });
    writeFileSync(statePath, '{}\n');
    expect(store.readOrCreate()).toEqual({ installation_id: 'fixed-id', notice_shown: false });
    writeFileSync(statePath, 'null\n');
    expect(store.readOrCreate()).toEqual({ installation_id: 'fixed-id', notice_shown: false });
    writeFileSync(statePath, '{"installation_id":');
    expect(store.readOrCreate()).toEqual({ installation_id: 'fixed-id', notice_shown: false });
    expect(JSON.parse(readFileSync(statePath, 'utf8'))).toEqual({
      installation_id: 'fixed-id',
      notice_shown: false,
    });
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

  it('enables and disables a settings file containing a bare telemetry key', async () => {
    const root = temporaryRoot();
    const home = join(root, 'home');
    const settingsPath = join(home, '.agents', 'settings.yml');
    mkdirSync(dirname(settingsPath), { recursive: true });
    const lines: string[] = [];
    const build = () =>
      createOutfitterProgram([
        createTelemetryCommand({
          homeDirectory: home,
          projectDirectory: root,
          env: {},
          stateStore: memoryStateStore(),
          writeLine: (line) => lines.push(line),
        }),
      ]);

    writeFileSync(settingsPath, '# preserved\ntelemetry:\n');
    await build().parseAsync(['node', 'outfitter', 'telemetry', 'enable']);
    expect(readFileSync(settingsPath, 'utf8')).toContain('enabled: true');
    expect(readFileSync(settingsPath, 'utf8')).toContain('# preserved');

    writeFileSync(settingsPath, 'telemetry:\n');
    await build().parseAsync(['node', 'outfitter', 'telemetry', 'disable']);
    expect(readFileSync(settingsPath, 'utf8')).toContain('enabled: false');
  });

  it('reports invalid settings through the telemetry status command', async () => {
    const lines: string[] = [];
    const invalid: SettingsLoadResult = {
      files: [],
      issues: [{ filePath: '/tmp/settings.yml', path: '/telemetry/enabled', message: 'must be boolean' }],
    };
    await createOutfitterProgram([
      createTelemetryCommand({
        homeDirectory: temporaryRoot(),
        projectDirectory: temporaryRoot(),
        env: {},
        settingsReader: () => invalid,
        stateStore: memoryStateStore(),
        writeLine: (line) => lines.push(line),
      }),
    ]).parseAsync(['node', 'outfitter', 'telemetry', 'status']);
    expect(lines).toEqual([expect.stringContaining('disabled (source: invalid settings)')]);
  });

  it('uses default status dependencies without mutating settings', async () => {
    const root = temporaryRoot();
    const writeLine = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    await createOutfitterProgram([
      createTelemetryCommand({
        homeDirectory: root,
        projectDirectory: root,
        env: {},
      }),
    ]).parseAsync(['node', 'outfitter', 'telemetry', 'status']);
    expect(writeLine).toHaveBeenCalledWith(expect.stringContaining('Telemetry is enabled (source: default).'));
  });

  it('reads the process environment by default without using a real home', async () => {
    const root = temporaryRoot();
    const lines: string[] = [];
    vi.stubEnv('OUTFITTER_TELEMETRY', '');
    vi.stubEnv('DO_NOT_TRACK', '');
    vi.stubEnv('CI', '');
    await createOutfitterProgram([
      createTelemetryCommand({
        homeDirectory: root,
        projectDirectory: root,
        writeLine: (line) => lines.push(line),
      }),
    ]).parseAsync(['node', 'outfitter', 'telemetry', 'status']);
    expect(lines).toEqual([expect.stringContaining('Telemetry is enabled (source: default).')]);
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
