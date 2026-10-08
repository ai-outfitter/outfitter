// Read-only host assessment plus the explicit persistence boundary for self-hosted setup.
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { stringify } from 'yaml';

import { validateSchema } from '../validation/SchemaValidator.js';
import { parseYamlDocument } from '../validation/YamlDocument.js';

export type SelfHostedTarget = 'dgx-spark' | 'apple-silicon' | 'unsupported';
export type SupportedTarget = Exclude<SelfHostedTarget, 'unsupported'>;
export type OptionalService = 'forgejo' | 'stalwart' | 'identity' | 'password-manager';

export interface ProbeResult {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

export type ReadOnlyProbe = (command: string, args: readonly string[]) => ProbeResult;

export interface HostDetection {
  readonly platform: NodeJS.Platform;
  readonly architecture: string;
  readonly target: SelfHostedTarget;
  readonly gpu: string | null;
  readonly reasons: readonly string[];
}

export interface SelfHostedConfig {
  readonly version: 1;
  readonly target: SupportedTarget;
  readonly mode: 'inference-only' | 'inference-and-services';
  readonly inference: {
    readonly label: string;
    readonly model: string;
    readonly base_url: string;
    readonly credential_env: string;
    readonly make_default?: boolean;
    readonly setup_url?: string;
  };
  readonly optional_services?: readonly OptionalService[];
}

export interface EndpointHandoff {
  readonly schemaVersion: 1;
  readonly kind: 'openai_compatible';
  readonly label: string;
  readonly model: string;
  readonly baseUrl: string;
  readonly makeDefault: boolean;
  readonly credential: { readonly type: 'environment'; readonly name: string };
  readonly registration: { readonly method: 'manual'; readonly setupUrl?: string };
}

export interface SetupPlan {
  readonly target: SupportedTarget;
  readonly mode: SelfHostedConfig['mode'];
  readonly installerAvailable: false;
  readonly inference: {
    readonly status: 'reference-only';
    readonly runtime: string;
    readonly steps: readonly string[];
    readonly attribution: string;
    readonly licensing: string;
  };
  readonly optionalServices: readonly {
    readonly service: OptionalService;
    readonly installerAvailable: false;
    readonly reason: string;
  }[];
  readonly applyBoundary: string;
}

const inspectGpuArgs = ['--query-gpu=name', '--format=csv,noheader'] as const;
const isAppleSilicon = (platform: NodeJS.Platform, architecture: string): boolean =>
  platform === 'darwin' && architecture === 'arm64';
const isDgxSpark = (platform: NodeJS.Platform, architecture: string, gpu: string | null): boolean =>
  platform === 'linux' && architecture === 'arm64' && gpu !== null && /GB10|DGX Spark/i.test(gpu);

export const detectHost = (input: {
  readonly platform: NodeJS.Platform;
  readonly architecture: string;
  readonly probe: ReadOnlyProbe;
}): HostDetection => {
  if (isAppleSilicon(input.platform, input.architecture)) {
    return {
      platform: input.platform,
      architecture: input.architecture,
      target: 'apple-silicon',
      gpu: 'Apple Silicon',
      reasons: ['macOS arm64 routes to Apple Silicon; CUDA vLLM is not offered.'],
    };
  }

  const gpuProbe = input.platform === 'linux' ? input.probe('nvidia-smi', inspectGpuArgs) : undefined;
  const gpu = gpuProbe?.status === 0 ? gpuProbe.stdout.trim() || null : null;
  if (isDgxSpark(input.platform, input.architecture, gpu)) {
    return {
      platform: input.platform,
      architecture: input.architecture,
      target: 'dgx-spark',
      gpu,
      reasons: ['Linux arm64 and the reported NVIDIA GB10/DGX Spark GPU match the DGX Spark route.'],
    };
  }

  return {
    platform: input.platform,
    architecture: input.architecture,
    target: 'unsupported',
    gpu,
    reasons: ['This slice supports only NVIDIA DGX Spark and Apple Silicon hosts.'],
  };
};

export const doctorHost = (
  detection: HostDetection,
  probe: ReadOnlyProbe,
): readonly { readonly check: string; readonly ok: boolean; readonly detail: string }[] => {
  const checks = [{ check: 'host-route', ok: detection.target !== 'unsupported', detail: detection.reasons[0] }];
  if (detection.target === 'dgx-spark') {
    const docker = probe('docker', ['--version']);
    const ssh = probe('ssh', ['-V']);
    return [
      ...checks,
      { check: 'docker-client', ok: docker.status === 0, detail: redact(`${docker.stdout} ${docker.stderr}`).trim() },
      { check: 'ssh-client', ok: ssh.status === 0, detail: redact(`${ssh.stdout} ${ssh.stderr}`).trim() },
    ];
  }
  return checks;
};

const sparkSteps = [
  'Inspect Docker, SSH, disk capacity, and the paired worker before any mutation.',
  'Use the installed two-node TP2 kit at /home/ncrmro/GLM-5.3-Flash-EXL3-2x-DGX-Sparks; it is not a Git checkout.',
  'Keep the installed launcher sha256 4aba429df9dcd0b3c6a787d2d235c35fa64b3ddf901fb49b1e8cce9152477f3a and README sha256 d69824aa6be4ce90f108bca48ec9dae41ce4e7f2ff41485eaf19abce2d8c30de as review evidence.',
  'Keep the installed vLLM container image pinned to ghcr.io/miaai-lab/glm-5.3-flash-2x-dgx-sparks@sha256:9bb1557a4234fce63d59599e44d10747eabd742beb337eebf9e7070be8a0fd58.',
  'The reviewed spark-f838 head / spark-3b78 worker mechanism pulls and ships the image, downloads about 164 GiB of weights on the head, rsyncs the worker, then starts worker rank before head.',
  'Treat GET /health on port 8888 as readiness for model GLM-5.3-Flash-EXL3; this is two-node model serving, not a K3s join.',
] as const;

export const createSetupPlan = (
  target: SupportedTarget,
  mode: SelfHostedConfig['mode'],
  services: readonly OptionalService[] = [],
): SetupPlan => ({
  target,
  mode,
  installerAvailable: false,
  inference:
    target === 'dgx-spark'
      ? {
          status: 'reference-only',
          runtime: 'vLLM two-node tensor parallel (installed recipe)',
          steps: sparkSteps,
          attribution:
            'MiaAI-Lab/GLM-5.3-Flash-EXL3-2x-DGX-Sparks; preserve the installed recipe rather than silently substituting TensorFold.',
          licensing:
            'Weights are not bundled. The referenced weights are noted for research/evaluation; users must establish their own rights.',
        }
      : {
          status: 'reference-only',
          runtime: 'external OpenAI-compatible Apple Silicon runtime',
          steps: [
            'Verify an existing authenticated OpenAI-compatible endpoint.',
            'Do not use the CUDA vLLM DGX Spark recipe on macOS.',
          ],
          attribution: 'No portable Apple Silicon installer is pinned in this slice.',
          licensing: 'No model or weights are bundled; users must establish their own rights.',
        },
  optionalServices: services.map((service) => ({
    service,
    installerAvailable: false,
    reason: 'Forgejo, Stalwart, identity, and password-manager installers are outside this bounded slice.',
  })),
  applyBoundary:
    'Apply persists reviewed YAML only; handoff derives a key-free endpoint descriptor without persistence.',
});

const schemaFailure = (path: string, message: string): never => {
  throw new Error(`Invalid self-hosted config at ${path}: ${message}`);
};

const assertSafeUrl = (path: string, value: string): void => {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return schemaFailure(path, 'must be a valid URL');
  }
  if (url.username !== '' || url.password !== '') schemaFailure(path, 'must not contain credentials');
  const beforeFragment = value.split('#', 1)[0];
  if (beforeFragment.includes('?')) schemaFailure(path, 'must not contain a query string');
};

export const validateSelfHostedConfig = (document: unknown): SelfHostedConfig => {
  const result = validateSchema('self-hosted', document);
  if (!result.valid) schemaFailure(result.issues[0].path, result.issues[0].message);
  const config = document as SelfHostedConfig;
  assertSafeUrl('/inference/base_url', config.inference.base_url);
  if (config.inference.setup_url !== undefined) assertSafeUrl('/inference/setup_url', config.inference.setup_url);
  if (config.mode === 'inference-only' && (config.optional_services?.length ?? 0) > 0)
    schemaFailure('/optional_services', 'must be empty in inference-only mode');
  return config;
};

export const loadSelfHostedConfig = (path: string): SelfHostedConfig => {
  const parsed = parseYamlDocument(readFileSync(path, 'utf8'), path);
  if (!parsed.ok) return schemaFailure(parsed.issue.path, 'invalid YAML');
  return validateSelfHostedConfig(parsed.document);
};

export const createEndpointHandoff = (config: SelfHostedConfig): EndpointHandoff => ({
  schemaVersion: 1,
  kind: 'openai_compatible',
  label: config.inference.label,
  model: config.inference.model,
  baseUrl: config.inference.base_url,
  makeDefault: config.inference.make_default ?? false,
  credential: { type: 'environment', name: config.inference.credential_env },
  registration: {
    method: 'manual',
    ...(config.inference.setup_url === undefined ? {} : { setupUrl: config.inference.setup_url }),
  },
});

const atomicWrite = (path: string, content: string): void => {
  const temporary = `${path}.tmp-${process.pid}`;
  try {
    writeFileSync(temporary, content, { flag: 'wx', mode: 0o600 });
    renameSync(temporary, path);
  } finally {
    rmSync(temporary, { force: true });
  }
};

export const applySelfHostedConfig = (input: {
  readonly config: SelfHostedConfig;
  readonly outputDirectory: string;
}): { readonly configPath: string } => {
  const config = validateSelfHostedConfig(input.config);
  mkdirSync(input.outputDirectory, { recursive: true, mode: 0o700 });
  const configPath = join(input.outputDirectory, 'config.yml');
  atomicWrite(configPath, stringify(config));
  return { configPath };
};

export const redact = (value: string): string =>
  value
    .replace(/(https?:\/\/)[^\s/@:]+:[^\s/@]+@/giu, '$1[redacted]@')
    .replace(
      /["']?\b(api[_-]?key|access[_-]?token|client[_-]?secret|private[_-]?key|password|passphrase|token|authorization)["']?\s*[=:]\s*(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^\s,}]+)/giu,
      '$1=[redacted]',
    );
