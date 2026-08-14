import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { Command } from 'commander';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { resolveTelemetryCommandName, runCli } from '../../src/cli.js';
import type { CommandObject } from '../../src/cli/commands/CommandObject.js';
import { createTelemetryCommand } from '../../src/cli/commands/TelemetryCommand.js';
import { createOutfitterProgram } from '../../src/cli/OutfitterCli.js';
import type { SettingsLoadResult } from '../../src/settings/SettingsLoader.js';
import { TELEMETRY_SHUTDOWN_BUDGET_MS } from '../../src/telemetry/TelemetryConstants.js';
import { createTelemetryContext } from '../../src/telemetry/TelemetryContext.js';
import { createBoundedTelemetryFetch, createTelemetryService } from '../../src/telemetry/TelemetryService.js';
import type { TelemetryCommandContext, TelemetryService } from '../../src/telemetry/TelemetryService.js';
import { resolveTelemetryStatePath } from '../../src/telemetry/TelemetryState.js';
import type { TelemetryStateStore } from '../../src/telemetry/TelemetryState.js';

const temporaryRoots: string[] = [];
const previousExitCode = process.exitCode;

const temporaryRoot = (): string => {
  const root = mkdtempSync(join(tmpdir(), 'outfitter-telemetry-hardening-'));
  temporaryRoots.push(root);
  return root;
};

const enabledSettings: SettingsLoadResult = {
  files: [
    {
      location: { scope: 'user', path: '/tmp/settings.yml' },
      settings: { telemetry: { enabled: true } },
    },
  ],
  issues: [],
};

const memoryStateStore = (noticeShown = false): TelemetryStateStore => ({
  readOrCreate: () => ({ installation_id: '00000000-0000-4000-8000-000000000001', notice_shown: noticeShown }),
  recordNoticeShown: (state) => ({ ...state, notice_shown: true }),
  delete: () => undefined,
});

const commandContext: TelemetryCommandContext = {
  command: 'run',
  outfitterVersion: '1.7.1',
  nodeVersion: '24.18.0',
  platform: 'linux',
  architecture: 'x64',
  interactive: false,
};

afterEach(() => {
  process.exitCode = previousExitCode;
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true });
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

// THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-011.1, OFTR-011.4, OFTR-011.5).
// YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
describe('telemetry failure and wiring hardening', () => {
  it('turns failed PostHog fetches into one silent success so the SDK does not log or retry', async () => {
    const fetch = vi.fn(() => Promise.reject(new Error('network unavailable')));
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.stubGlobal('fetch', fetch);
    const errors: string[] = [];
    const service = createTelemetryService({
      settingsReader: () => enabledSettings,
      stateStore: memoryStateStore(),
      env: {},
      writeError: (message) => errors.push(message),
      apiKey: 'phc_test',
      shutdownBudgetMs: 20,
    });

    await service.captureCommandStarted(commandContext);
    await service.shutdown();

    expect(fetch).toHaveBeenCalledOnce();
    expect(consoleError).not.toHaveBeenCalled();
    expect(errors).toHaveLength(1);
  });

  it('aborts a blackholed PostHog fetch and releases shutdown within the configured budget', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise<Response>(() => undefined)),
    );
    const service = createTelemetryService({
      settingsReader: () => enabledSettings,
      stateStore: memoryStateStore(true),
      env: {},
      writeError: vi.fn(),
      apiKey: 'phc_test',
      shutdownBudgetMs: 20,
    });

    const start = Date.now();
    await service.captureCommandStarted(commandContext);
    await service.shutdown();

    expect(Date.now() - start).toBeLessThan(200);
    expect(TELEMETRY_SHUTDOWN_BUDGET_MS).toBe(1000);
    expect(consoleError).not.toHaveBeenCalled();
  });

  it('maps non-success fetch responses to synthetic success responses', async () => {
    const fetch = createBoundedTelemetryFetch(
      vi.fn(() => Promise.resolve(new Response('unavailable', { status: 503 }))),
      20,
    );
    const response = await fetch('https://example.test/e', { method: 'POST', headers: {} });
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('');
    expect(await response.json()).toEqual({});
    expect(response.headers?.get('x-test')).toBeNull();
    expect(response.body).toBeNull();
  });

  it('wires temp-home consent through runCli without constructing a client for kill switches or opt-out', async () => {
    const root = temporaryRoot();
    const home = join(root, 'home');
    const project = join(root, 'project');
    const settingsPath = join(home, '.agents', 'settings.yml');
    mkdirSync(dirname(settingsPath), { recursive: true });
    const cases = [
      { env: { OUTFITTER_TELEMETRY: '0' }, settings: 'telemetry:\n  enabled: true\n' },
      { env: { DO_NOT_TRACK: '1' }, settings: 'telemetry:\n  enabled: true\n' },
      { env: { CI: 'true' }, settings: 'telemetry:\n  enabled: true\n' },
      { env: {}, settings: 'telemetry:\n  enabled: false\n' },
    ];

    for (const testCase of cases) {
      writeFileSync(settingsPath, testCase.settings);
      const context = createTelemetryContext({ homeDirectory: home, projectDirectory: project, env: testCase.env });
      const clientFactory = vi.fn();
      const telemetry = createTelemetryService({
        settingsReader: context.settingsReader,
        stateStore: context.stateStore,
        env: testCase.env,
        writeError: vi.fn(),
        apiKey: 'phc_test',
        clientFactory,
      });
      const program = createOutfitterProgram([
        createTelemetryCommand({
          homeDirectory: home,
          projectDirectory: project,
          env: testCase.env,
          writeLine: () => undefined,
        }),
      ]);

      await runCli(program, ['node', 'outfitter', 'telemetry', 'status'], { telemetry });

      expect(clientFactory).not.toHaveBeenCalled();
      expect(existsSync(resolveTelemetryStatePath(home, testCase.env))).toBe(false);
    }
  });

  it('captures process lifecycle metadata without public context overrides', async () => {
    process.exitCode = undefined;
    const calls: string[] = [];
    const started: TelemetryCommandContext[] = [];
    const completed: Array<TelemetryCommandContext & { readonly durationMs: number }> = [];
    const telemetry: TelemetryService = {
      captureCommandStarted: (context) => {
        started.push(context);
        calls.push(`start:${context.command}:${context.harness}:${context.strict}`);
        return Promise.resolve();
      },
      captureCommandCompleted: (context) => {
        completed.push(context);
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
    vi.spyOn(Date, 'now').mockReturnValueOnce(100).mockReturnValueOnce(110);

    await runCli(createOutfitterProgram([command]), ['node', 'outfitter', 'sample', '--harness', 'pi', '--strict'], {
      telemetry,
    });

    expect(calls).toEqual(['start:sample:pi:true', 'action', 'complete:success:0', 'shutdown']);
    expect(started).toEqual([
      expect.objectContaining({
        command: 'sample',
        nodeVersion: process.versions.node,
        platform: process.platform,
        architecture: process.arch,
        interactive: Boolean(process.stdin.isTTY && process.stdout.isTTY),
        harness: 'pi',
        strict: true,
      }),
    ]);
    expect(started[0]?.outfitterVersion).toMatch(/^\d+\.\d+\.\d+/u);
    expect(completed[0]?.durationMs).toBe(10);
    expect(process.exitCode).toBeUndefined();
  });

  it('maps unattached commands to unknown and skips completion when no action runs', async () => {
    const program = new Command('outfitter');
    const registered = new Command('known').action(() => undefined);
    program.addCommand(registered);
    expect(resolveTelemetryCommandName(program, registered)).toBe('known');
    expect(resolveTelemetryCommandName(program, new Command('private-user-value'))).toBe('unknown');
    const telemetry: TelemetryService = {
      captureCommandStarted: () => Promise.resolve(),
      captureCommandCompleted: vi.fn(() => Promise.resolve()),
      shutdown: () => Promise.resolve(),
    };

    await runCli(program, ['node', 'outfitter', 'known'], { telemetry });
    await runCli(new Command('outfitter'), ['node', 'outfitter'], { telemetry });

    // eslint-disable-next-line @typescript-eslint/unbound-method -- Vitest inspects the mock without invoking it.
    expect(telemetry.captureCommandCompleted).toHaveBeenCalledOnce();
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
    vi.spyOn(Date, 'now').mockReturnValueOnce(100).mockReturnValueOnce(120);

    await expect(
      runCli(createOutfitterProgram([command]), ['node', 'outfitter', 'fail'], { telemetry }),
    ).rejects.toThrow('original command error');
    expect(calls).toEqual(['error:1', 'shutdown']);
  });

  it('reports a numeric process exit code in command completion', async () => {
    const completed: number[] = [];
    const telemetry: TelemetryService = {
      captureCommandStarted: () => Promise.resolve(),
      captureCommandCompleted: (context) => {
        completed.push(context.exitCode);
        return Promise.resolve();
      },
      shutdown: () => Promise.resolve(),
    };
    const command: CommandObject = {
      name: 'nonzero',
      description: 'nonzero',
      register(program): void {
        program.command('nonzero').action(() => {
          process.exitCode = 7;
        });
      },
    };

    await runCli(createOutfitterProgram([command]), ['node', 'outfitter', 'nonzero'], { telemetry });

    expect(completed).toEqual([7]);
  });
});
