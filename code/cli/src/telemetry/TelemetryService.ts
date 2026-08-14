import { HARNESSES } from '../settings/Settings.js';
import type { SettingsLoadResult } from '../settings/SettingsLoader.js';
import { POSTHOG_API_KEY, POSTHOG_HOST, TELEMETRY_SHUTDOWN_BUDGET_MS } from './TelemetryConstants.js';
import { resolveTelemetryConsent } from './TelemetryConsent.js';
import type { TelemetryEnvironment } from './TelemetryConsent.js';
import type { TelemetryStateStore } from './TelemetryState.js';

const OS_FAMILIES = ['aix', 'android', 'darwin', 'freebsd', 'linux', 'openbsd', 'sunos', 'win32', 'unknown'] as const;
const ARCHITECTURES = [
  'arm',
  'arm64',
  'ia32',
  'loong64',
  'mips',
  'mipsel',
  'ppc',
  'ppc64',
  'riscv64',
  's390',
  's390x',
  'x64',
  'unknown',
] as const;

export type DurationBucket = '<1s' | '1-5s' | '5-30s' | '30s+';
export type WarningCountBucket = '0' | '1-5' | '5+' | 'unknown';
export type TelemetryOutcome = 'success' | 'error';

export interface TelemetryCommandContext {
  readonly command: string;
  readonly outfitterVersion: string;
  readonly nodeVersion: string;
  readonly platform: string;
  readonly architecture: string;
  readonly interactive: boolean;
  readonly harness?: string;
  readonly strict?: boolean;
}

export interface TelemetryCompletionContext extends TelemetryCommandContext {
  readonly outcome: TelemetryOutcome;
  readonly durationMs: number;
  readonly exitCode: number;
}

export interface TelemetryClient {
  capture(message: {
    readonly distinctId: string;
    readonly event: string;
    readonly properties: Record<string, unknown>;
  }): void | Promise<void>;
  shutdown(timeoutMs?: number): Promise<void>;
}

export interface TelemetryClientOptions {
  readonly host: string;
  readonly disableGeoip: true;
}

export type TelemetryClientFactory = (
  apiKey: string,
  options: TelemetryClientOptions,
) => TelemetryClient | Promise<TelemetryClient>;

export interface TelemetryService {
  captureCommandStarted(context: TelemetryCommandContext): Promise<void>;
  captureCommandCompleted(context: TelemetryCompletionContext): Promise<void>;
  shutdown(): Promise<void>;
}

export interface TelemetryServiceDependencies {
  readonly settingsReader: () => SettingsLoadResult;
  readonly stateStore: TelemetryStateStore;
  readonly env: TelemetryEnvironment;
  readonly writeError: (message: string) => void;
  readonly apiKey?: string;
  readonly host?: string;
  readonly clientFactory?: TelemetryClientFactory;
  readonly shutdownBudgetMs?: number;
}

/* v8 ignore next 4 -- tests inject a client factory so they never load the network SDK. */
const defaultClientFactory: TelemetryClientFactory = async (apiKey, options) => {
  const { PostHog } = await import('posthog-node');
  return new PostHog(apiKey, options);
};

const durationBucket = (milliseconds: number): DurationBucket => {
  if (milliseconds < 1000) return '<1s';
  if (milliseconds < 5000) return '1-5s';
  if (milliseconds < 30_000) return '5-30s';
  return '30s+';
};

const knownValue = <T extends string>(values: readonly T[], value: string): T | 'unknown' =>
  values.includes(value as T) ? (value as T) : 'unknown';

export const buildCommandStartedProperties = (context: TelemetryCommandContext): Record<string, unknown> => ({
  command: context.command,
  outfitter_version: context.outfitterVersion,
  node_major: Number.parseInt(context.nodeVersion.split('.')[0], 10),
  os_family: knownValue(OS_FAMILIES, context.platform),
  arch: knownValue(ARCHITECTURES, context.architecture),
  interactive: context.interactive,
  harness: knownValue(HARNESSES, context.harness ?? 'unknown'),
  strict: context.strict === true,
  $process_person_profile: false,
});

export const buildCommandCompletedProperties = (context: TelemetryCompletionContext): Record<string, unknown> => ({
  ...buildCommandStartedProperties(context),
  outcome: context.outcome,
  duration_bucket: durationBucket(context.durationMs),
  exit_code_class: context.exitCode === 0 ? 'success' : 'error',
  warning_count_bucket: 'unknown' satisfies WarningCountBucket,
});

const NOTICE =
  'Outfitter collects anonymous command adoption and reliability analytics. No content, paths, or arguments are collected. Disable with `outfitter telemetry disable`, `OUTFITTER_TELEMETRY=0`, or `DO_NOT_TRACK=1`.';

export const createTelemetryService = (dependencies: TelemetryServiceDependencies): TelemetryService => {
  const apiKey = dependencies.apiKey ?? POSTHOG_API_KEY;
  /* v8 ignore next -- tests inject a client factory so they never construct the network SDK. */
  const clientFactory = dependencies.clientFactory ?? defaultClientFactory;
  let client: TelemetryClient | undefined;
  let distinctId: string | undefined;
  let prepared: boolean | undefined;

  // Consent, client, and state are resolved once per process; captures never re-read settings from disk.
  const prepare = async (): Promise<boolean> => {
    if (prepared !== undefined) return prepared;
    prepared = false;
    if (apiKey === '') return false;
    if (!resolveTelemetryConsent(dependencies.settingsReader(), dependencies.env).enabled) return false;
    client = await clientFactory(apiKey, {
      host: dependencies.host ?? POSTHOG_HOST,
      disableGeoip: true,
    });
    const state = dependencies.stateStore.readOrCreate();
    distinctId = state.installation_id;
    if (!state.notice_shown) {
      dependencies.stateStore.recordNoticeShown(state);
      dependencies.writeError(NOTICE);
    }
    prepared = true;
    return true;
  };

  const capture = async (event: string, properties: Record<string, unknown>): Promise<void> => {
    try {
      if (!(await prepare())) return;
      const result = client!.capture({ distinctId: distinctId!, event, properties });
      // The SDK queues synchronously. A non-standard client promise is observed but never allowed to delay the CLI.
      void Promise.resolve(result).catch(() => undefined);
    } catch {
      // Analytics must never affect command behavior or emit diagnostics.
    }
  };

  return {
    captureCommandStarted: (context) => capture('cli command started', buildCommandStartedProperties(context)),
    captureCommandCompleted: (context) => capture('cli command completed', buildCommandCompletedProperties(context)),
    async shutdown(): Promise<void> {
      if (client === undefined) return;
      let timeout: ReturnType<typeof setTimeout> | undefined;
      try {
        const budget = dependencies.shutdownBudgetMs ?? TELEMETRY_SHUTDOWN_BUDGET_MS;
        const deadline = new Promise<void>((resolve) => {
          timeout = setTimeout(resolve, budget);
        });
        await Promise.race([Promise.resolve(client.shutdown(budget)).catch(() => undefined), deadline]);
      } catch {
        // Analytics must never affect command behavior or emit diagnostics.
      } finally {
        clearTimeout(timeout);
      }
    },
  };
};
