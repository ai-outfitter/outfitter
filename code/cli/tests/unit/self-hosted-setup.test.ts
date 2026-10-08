// Covers issue #431's bounded self-hosted detection, planning, persistence, and handoff slice.
import { mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Command } from 'commander';
import { parse } from 'yaml';
import { describe, expect, it, vi } from 'vitest';

import { runCli } from '../../src/cli.js';
import { createSelfHostedCommand } from '../../src/cli/commands/SelfHostedCommand.js';
import { createOutfitterProgram } from '../../src/cli/OutfitterCli.js';
import {
  applySelfHostedConfig,
  createEndpointHandoff,
  createSetupPlan,
  detectHost,
  doctorHost,
  loadSelfHostedConfig,
  redact,
  validateSelfHostedConfig,
} from '../../src/self-hosted/SelfHostedSetup.js';
import type { ReadOnlyProbe, SelfHostedConfig } from '../../src/self-hosted/SelfHostedSetup.js';
import type { TelemetryService } from '../../src/telemetry/TelemetryService.js';

const root = (): string => mkdtempSync(join(tmpdir(), 'outfitter-self-hosted-'));

const config = (overrides: Partial<SelfHostedConfig> = {}): SelfHostedConfig => ({
  version: 1,
  target: 'dgx-spark',
  mode: 'inference-only',
  inference: {
    label: 'Workshop Spark',
    model: 'GLM-5.3-Flash-EXL3',
    base_url: 'https://inference.example.test/v1',
    credential_env: 'OUTFITTER_INFERENCE_API_KEY',
    make_default: true,
    setup_url: 'https://app.example.test/settings/inference',
  },
  ...overrides,
});

describe('self-hosted host routing and doctor', () => {
  it('routes Apple Silicon without probing NVIDIA or offering CUDA', () => {
    const probe = vi.fn<ReadOnlyProbe>();
    const detected = detectHost({ platform: 'darwin', architecture: 'arm64', probe });
    expect(detected.target).toBe('apple-silicon');
    expect(detected.reasons[0]).toContain('CUDA vLLM is not offered');
    expect(probe).not.toHaveBeenCalled();
    expect(doctorHost(detected, probe)).toHaveLength(1);
  });

  it('routes a Linux GB10 host and uses safe argument arrays for read-only probes', () => {
    const calls: [string, readonly string[]][] = [];
    const probe: ReadOnlyProbe = (command, args) => {
      calls.push([command, args]);
      if (command === 'nvidia-smi') return { status: 0, stdout: 'NVIDIA GB10\n', stderr: '' };
      return { status: 0, stdout: `${command} ok`, stderr: '' };
    };
    const detected = detectHost({ platform: 'linux', architecture: 'arm64', probe });
    expect(detected.target).toBe('dgx-spark');
    expect(doctorHost(detected, probe).every((check) => check.ok)).toBe(true);
    expect(calls).toEqual([
      ['nvidia-smi', ['--query-gpu=name', '--format=csv,noheader']],
      ['docker', ['--version']],
      ['ssh', ['-V']],
    ]);
  });

  it('reports unsupported hosts and failed GPU probes without mutation', () => {
    const failed: ReadOnlyProbe = () => ({ status: 1, stdout: '', stderr: 'not found' });
    expect(detectHost({ platform: 'linux', architecture: 'x64', probe: failed })).toMatchObject({
      target: 'unsupported',
      gpu: null,
    });
    expect(detectHost({ platform: 'win32', architecture: 'x64', probe: failed }).target).toBe('unsupported');
    expect(
      detectHost({
        platform: 'linux',
        architecture: 'arm64',
        probe: () => ({ status: 0, stdout: '  ', stderr: '' }),
      }).gpu,
    ).toBeNull();
  });
});

describe('self-hosted planning and validation', () => {
  it('keeps the recovered Spark recipe reference-only and separates optional services', () => {
    const plan = createSetupPlan('dgx-spark', 'inference-and-services', ['forgejo', 'stalwart']);
    expect(plan.installerAvailable).toBe(false);
    expect(plan.inference.runtime).toContain('vLLM');
    expect(plan.inference.steps.join(' ')).toContain('not a K3s join');
    expect(plan.inference.steps.join(' ')).toContain('4aba429d');
    expect(plan.inference.attribution).toContain('MiaAI-Lab');
    expect(plan.optionalServices).toHaveLength(2);
    expect(plan.optionalServices.every((service) => !service.installerAvailable)).toBe(true);
  });

  it('routes Apple Silicon to an external runtime and never CUDA vLLM', () => {
    const plan = createSetupPlan('apple-silicon', 'inference-only');
    expect(plan.inference.runtime).toContain('Apple Silicon');
    expect(plan.inference.steps.join(' ')).toContain('Do not use the CUDA vLLM');
  });

  it('rejects schema errors, credential-bearing URLs, URL queries, and services in inference-only mode', () => {
    expect(() => validateSelfHostedConfig({})).toThrow('Invalid self-hosted config');
    expect(() =>
      validateSelfHostedConfig(
        config({ inference: { ...config().inference, base_url: 'https://user:secret@example.test/v1' } }),
      ),
    ).toThrow('must not contain credentials');
    expect(() => validateSelfHostedConfig(config({ mode: 'inference-only', optional_services: ['forgejo'] }))).toThrow(
      'must be empty',
    );
    expect(() =>
      validateSelfHostedConfig(config({ inference: { ...config().inference, base_url: 'http://' } })),
    ).toThrow('Invalid self-hosted config');
    for (const field of ['base_url', 'setup_url'] as const) {
      for (const query of ['page=1', 'api_key=value', 'secret=value', 'signature=value']) {
        expect(() =>
          validateSelfHostedConfig(
            config({ inference: { ...config().inference, [field]: `https://app.example.test/setup?${query}` } }),
          ),
        ).toThrow('must not contain a query string');
      }
    }
  });

  it('reports a static invalid-YAML error without echoing multiline credential source', () => {
    const path = join(root(), 'bad.yml');
    const credentials = [
      'password-value',
      'passphrase-value',
      'client-secret-value',
      'private-key-line-one',
      'private-key-line-two',
    ];
    writeFileSync(
      path,
      [
        'version: 1',
        `password: ${credentials[0]}`,
        `passphrase: ${credentials[1]}`,
        `client_secret: ${credentials[2]}`,
        'private_key: |',
        `  ${credentials[3]}`,
        `  ${credentials[4]}`,
        'malformed: [',
      ].join('\n'),
    );

    let message = '';
    try {
      loadSelfHostedConfig(path);
    } catch (error) {
      message = String(error);
    }

    expect(message).toBe(`Error: Invalid self-hosted config at ${path}: invalid YAML`);
    for (const credential of credentials) expect(message).not.toContain(credential);
  });
});

describe('self-hosted apply and endpoint handoff', () => {
  it('atomically persists only canonical validated YAML at the explicit apply boundary', () => {
    const outputDirectory = join(root(), 'state');
    const result = applySelfHostedConfig({ config: config(), outputDirectory });
    const persisted = parse(readFileSync(result.configPath, 'utf8')) as SelfHostedConfig;
    expect(persisted).toEqual(config());
    expect(createEndpointHandoff(loadSelfHostedConfig(result.configPath))).toEqual(createEndpointHandoff(config()));
    expect(readdirSync(outputDirectory)).toEqual(['config.yml']);
    expect(statSync(result.configPath).mode & 0o777).toBe(0o600);
  });

  it('omits optional handoff fields and defaults makeDefault to false', () => {
    const minimal = config({
      inference: {
        label: 'Local',
        model: 'model',
        base_url: 'http://127.0.0.1:8888/v1',
        credential_env: 'LOCAL_API_KEY',
      },
    });
    expect(createEndpointHandoff(minimal)).toEqual({
      schemaVersion: 1,
      kind: 'openai_compatible',
      label: 'Local',
      model: 'model',
      baseUrl: 'http://127.0.0.1:8888/v1',
      makeDefault: false,
      credential: { type: 'environment', name: 'LOCAL_API_KEY' },
      registration: { method: 'manual' },
    });
  });

  it('redacts URL credentials and credential-like diagnostic values', () => {
    expect(
      redact(
        'https://alice:secret@example.test token=abc api_key:xyz password=hunter2 passphrase:phrase client_secret=client private-key:key',
      ),
    ).toBe(
      'https://[redacted]@example.test token=[redacted] api_key=[redacted] password=[redacted] passphrase=[redacted] client_secret=[redacted] private-key=[redacted]',
    );
  });
});

describe('self-hosted command object', () => {
  const program = (writes: string[], directory: string): Command => {
    const command = new Command();
    createSelfHostedCommand({
      homeDirectory: directory,
      platform: 'darwin',
      architecture: 'arm64',
      probe: () => ({ status: 0, stdout: '', stderr: '' }),
      writeLine: (line) => writes.push(line),
    }).register(command);
    return command;
  };

  it('keeps detect, doctor, and plan read-only', async () => {
    const directory = root();
    const writes: string[] = [];
    await program(writes, directory).parseAsync(['node', 'outfitter', 'self-hosted', 'detect']);
    await program(writes, directory).parseAsync(['node', 'outfitter', 'self-hosted', 'doctor']);
    await program(writes, directory).parseAsync([
      'node',
      'outfitter',
      'self-hosted',
      'plan',
      '--target',
      'apple-silicon',
      '--mode',
      'inference-and-services',
      '--service',
      'identity',
      'password-manager',
    ]);
    await program(writes, directory).parseAsync([
      'node',
      'outfitter',
      'self-hosted',
      'plan',
      '--target',
      'apple-silicon',
    ]);
    expect(writes).toHaveLength(4);
    expect(JSON.parse(writes[0])).toMatchObject({ target: 'apple-silicon' });
    expect(JSON.parse(writes[2])).toMatchObject({ installerAvailable: false });
    expect(() => statSync(join(directory, '.outfitter'))).toThrow();
  });

  it('applies reviewed config and emits the same handoff without credentials', async () => {
    const directory = root();
    const input = join(directory, 'reviewed.yml');
    writeFileSync(input, stringifyConfig(config()));
    const writes: string[] = [];
    await program(writes, directory).parseAsync(['node', 'outfitter', 'self-hosted', 'apply', '--config', input]);
    await program(writes, directory).parseAsync(['node', 'outfitter', 'self-hosted', 'handoff', '--config', input]);
    expect(JSON.parse(writes[0])).toMatchObject({ applied: true, installed: false });
    expect(JSON.parse(writes[1])).toEqual(createEndpointHandoff(config()));
  });

  it('redacts a credential-bearing config error from handoff', async () => {
    const directory = root();
    const input = join(directory, 'bad.yml');
    writeFileSync(
      input,
      stringifyConfig(config({ inference: { ...config().inference, base_url: 'https://u:p@example.test/v1' } })),
    );
    await expect(
      program([], directory).parseAsync(['node', 'outfitter', 'self-hosted', 'handoff', '--config', input]),
    ).rejects.not.toThrow(/u:p/);
  });

  it('bypasses telemetry initialization for every read-only action but not apply', async () => {
    const directory = root();
    const input = join(directory, 'reviewed.yml');
    writeFileSync(input, stringifyConfig(config()));
    const telemetry: TelemetryService = {
      captureCommandStarted: vi.fn(() => Promise.resolve()),
      captureCommandCompleted: vi.fn(() => Promise.resolve()),
      shutdown: vi.fn(() => Promise.resolve()),
    };
    const createTelemetry = vi.fn(() => telemetry);
    const dependencies = {
      homeDirectory: directory,
      platform: 'darwin' as const,
      architecture: 'arm64',
      probe: () => ({ status: 0, stdout: '', stderr: '' }),
      writeLine: vi.fn(),
    };
    const readOnlyArguments = [
      ['detect'],
      ['doctor'],
      ['plan', '--target', 'apple-silicon'],
      ['handoff', '--config', input],
    ];

    for (const arguments_ of readOnlyArguments) {
      await runCli(
        createOutfitterProgram([createSelfHostedCommand(dependencies)]),
        ['node', 'outfitter', 'self-hosted', ...arguments_],
        { createTelemetry },
      );
    }

    expect(createTelemetry).not.toHaveBeenCalled();
    // eslint-disable-next-line @typescript-eslint/unbound-method -- Vitest inspects the mock without invoking it.
    expect(telemetry.captureCommandStarted).not.toHaveBeenCalled();
    // eslint-disable-next-line @typescript-eslint/unbound-method -- Vitest inspects the mock without invoking it.
    expect(telemetry.shutdown).not.toHaveBeenCalled();

    await runCli(
      createOutfitterProgram([createSelfHostedCommand(dependencies)]),
      ['node', 'outfitter', 'self-hosted', 'apply', '--config', input],
      { createTelemetry },
    );

    expect(createTelemetry).toHaveBeenCalledOnce();
    // eslint-disable-next-line @typescript-eslint/unbound-method -- Vitest inspects the mock without invoking it.
    expect(telemetry.captureCommandStarted).toHaveBeenCalledOnce();
    // eslint-disable-next-line @typescript-eslint/unbound-method -- Vitest inspects the mock without invoking it.
    expect(telemetry.shutdown).toHaveBeenCalledOnce();
  });
});

it('redacts quoted credential diagnostics including spaces and escapes', () => {
  for (const label of ['password', 'passphrase', 'client_secret', 'private_key']) {
    const diagnostic = JSON.stringify({ [label]: 'sensitive with "quotes" and spaces' });
    expect(redact(diagnostic)).not.toContain('sensitive');
    expect(redact(diagnostic)).not.toContain('quotes');
    expect(redact(diagnostic)).toContain('[redacted]');
    expect(redact(`'${label}': 'sensitive value'`)).not.toContain('sensitive');
  }
});

const stringifyConfig = (value: SelfHostedConfig): string =>
  [
    `version: ${value.version}`,
    `target: ${value.target}`,
    `mode: ${value.mode}`,
    'inference:',
    `  label: ${value.inference.label}`,
    `  model: ${value.inference.model}`,
    `  base_url: ${value.inference.base_url}`,
    `  credential_env: ${value.inference.credential_env}`,
    ...(value.inference.make_default === undefined ? [] : [`  make_default: ${String(value.inference.make_default)}`]),
    ...(value.inference.setup_url === undefined ? [] : [`  setup_url: ${value.inference.setup_url}`]),
  ].join('\n');
