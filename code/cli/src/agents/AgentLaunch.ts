// Turns a logical agent launch plan into an actual launched process: resolves the bundled pi
// binary, runs the launcher, and translates a missing agent CLI into actionable install guidance.
import { existsSync, readFileSync } from 'node:fs';
import { constants } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { AgentLaunchPlan } from '../projection/Projection.js';

export interface AgentSpawnOptions {
  readonly stdio: 'inherit';
  readonly env: NodeJS.ProcessEnv;
  readonly detached: boolean;
}

export const createAgentSpawnOptions = (plan: AgentLaunchPlan): AgentSpawnOptions => ({
  stdio: 'inherit',
  env: { ...process.env, ...plan.env },
  detached: process.platform !== 'win32',
});

export type AgentProcessResult =
  | { readonly status: 'exited'; readonly exitCode: number }
  | { readonly status: 'signaled'; readonly signal: NodeJS.Signals; readonly exitCode: number };

export interface AgentProcessLauncher {
  launch(plan: AgentLaunchPlan): Promise<AgentProcessResult>;
}

export const launchAgentProcess = async (
  launcher: AgentProcessLauncher,
  launchPlan: AgentLaunchPlan,
  agentId: string,
): Promise<number> => {
  try {
    return (await launcher.launch(launchPlan)).exitCode;
  } catch (error) {
    if (isCommandNotFoundError(error)) {
      throw new Error(formatMissingAgentCliMessage(agentId, launchPlan.command), { cause: error });
    }

    throw error;
  }
};

export const signalExitCode = (signal: NodeJS.Signals): number => 128 + constants.signals[signal];

export interface SpawnedAgentProcess {
  readonly pid?: number;
  once(event: 'error', listener: (error: Error) => void): this;
  once(event: 'close', listener: (code: number | null, signal: NodeJS.Signals | null) => void): this;
  kill(signal?: NodeJS.Signals): boolean;
}

export interface TerminationSignalSource {
  on(signal: 'SIGINT' | 'SIGTERM', listener: (signal: NodeJS.Signals) => void): this;
  off(signal: 'SIGINT' | 'SIGTERM', listener: (signal: NodeJS.Signals) => void): this;
}

export interface SpawnWaitDependencies {
  readonly signalSource?: TerminationSignalSource;
  readonly forwardSignal?: (child: SpawnedAgentProcess, signal: 'SIGINT' | 'SIGTERM') => void;
}

/* v8 ignore start -- real OS process-group signalling is exercised by smoke usage, not unit tests. */
const defaultForwardSignal = (child: SpawnedAgentProcess, signal: 'SIGINT' | 'SIGTERM'): void => {
  if (process.platform === 'win32' || child.pid === undefined) {
    child.kill(signal);
    return;
  }

  try {
    process.kill(-child.pid, signal);
  } catch {
    // A platform may reject process-group signalling even though the child is still addressable.
    child.kill(signal);
  }
};
/* v8 ignore stop */

/**
 * Waits for one foreground harness process, forwarding the first parent termination signal to the
 * whole child process group. Listeners exist only for the lifetime of this child.
 */
export const waitForSpawnedAgentProcess = (
  child: SpawnedAgentProcess,
  dependencies: SpawnWaitDependencies = {},
): Promise<AgentProcessResult> => {
  const signalSource = dependencies.signalSource ?? process;
  const forwardSignal = dependencies.forwardSignal ?? defaultForwardSignal;

  return new Promise<AgentProcessResult>((resolve, reject) => {
    let forwardedSignal: 'SIGINT' | 'SIGTERM' | undefined;
    let settled = false;

    const cleanup = (): void => {
      signalSource.off('SIGINT', onSignal);
      signalSource.off('SIGTERM', onSignal);
    };
    const settle = (result: AgentProcessResult): void => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(result);
    };
    const fail = (error: Error): void => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };
    function onSignal(signal: NodeJS.Signals): void {
      if (forwardedSignal !== undefined || (signal !== 'SIGINT' && signal !== 'SIGTERM')) return;
      forwardedSignal = signal;
      forwardSignal(child, signal);
    }

    signalSource.on('SIGINT', onSignal);
    signalSource.on('SIGTERM', onSignal);
    child.once('error', fail);
    child.once('close', (code, childSignal) => {
      const signal = childSignal ?? forwardedSignal;
      settle(
        signal === undefined
          ? { status: 'exited', exitCode: code ?? 0 }
          : { status: 'signaled', signal, exitCode: signalExitCode(signal) },
      );
    });
  });
};

// Pi is bundled with Outfitter, so prefer the bundled binary launched through the current Node
// runtime. This avoids the `spawn pi ENOENT` first-run crash when pi is not on PATH. Other agents
// (e.g. claude) are still resolved from PATH and fall back to actionable install guidance. This is
// a launch-mechanism detail applied by the real spawn launcher; the reported launch plan stays
// logical (`pi <args>`).
export const resolveAgentLaunchExecutable = (launchPlan: AgentLaunchPlan): AgentLaunchPlan => {
  if (launchPlan.command !== 'pi') {
    return launchPlan;
  }

  const bundledPiLaunch = resolveBundledPiLaunch();

  /* v8 ignore next 3 -- defensive: pi is a bundled dependency, so resolution succeeds in practice. */
  if (bundledPiLaunch === undefined) {
    return launchPlan;
  }

  return {
    ...launchPlan,
    command: bundledPiLaunch.command,
    args: [...bundledPiLaunch.prefixArgs, ...launchPlan.args],
    // The bundled pi is version-pinned by Outfitter's own dependency, so pi's startup self-update
    // notice ("Update Available … run pi update") is misleading here: `pi update` cannot update the
    // bundled copy, and right after updating Outfitter the pinned pi can still lag pi.dev's latest.
    // Skip pi's self-version check for bundled launches; profiles may override via environment.
    env: { PI_SKIP_VERSION_CHECK: '1', ...launchPlan.env },
  };
};

/* v8 ignore start -- real process spawn is covered by end-to-end smoke usage, not unit tests. */
export const spawnLauncher: AgentProcessLauncher = {
  async launch(plan: AgentLaunchPlan): Promise<AgentProcessResult> {
    const { default: spawn } = await import('cross-spawn');
    const child = spawn(plan.command, [...plan.args], createAgentSpawnOptions(plan));
    return await waitForSpawnedAgentProcess(child);
  },
};
/* v8 ignore stop */

/**
 * Launches a resolved plan through the given spawn boundary. The install-hint agentId is derived
 * from the logical launch command ('pi' | 'claude') so a missing-CLI failure always names the
 * harness actually being launched, regardless of how the harness was selected (flag, settings
 * default, or built-in fallback).
 */
export const launchThroughSpawn = (spawn: AgentProcessLauncher, plan: AgentLaunchPlan): Promise<number> =>
  launchAgentProcess(spawn, resolveAgentLaunchExecutable(plan), plan.command);

const isCommandNotFoundError = (error: unknown): boolean =>
  error !== null && typeof error === 'object' && 'code' in error && (error as { code?: unknown }).code === 'ENOENT';

const agentCliInstallHints: Readonly<Record<string, string>> = {
  pi: 'Install Pi with `npm install -g @earendil-works/pi-coding-agent` (see https://pi.dev).',
  claude: 'Install Claude Code from https://claude.com/claude-code, then rerun with `--agent claude`.',
};

const formatMissingAgentCliMessage = (agentId: string, command: string): string => {
  const installHint = agentCliInstallHints[agentId];
  const baseMessage = `Could not launch the '${agentId}' agent CLI: '${command}' is not installed or not on your PATH.`;

  return installHint === undefined ? baseMessage : `${baseMessage} ${installHint}`;
};

interface BundledPiLaunch {
  readonly command: string;
  readonly prefixArgs: readonly string[];
}

const piPackageName = '@earendil-works/pi-coding-agent';

const resolveBundledPiLaunch = (): BundledPiLaunch | undefined => {
  const binPath = resolveBundledPiBinPath();

  /* v8 ignore next 3 -- defensive: pi is a bundled dependency, so its bin resolves in practice. */
  if (binPath === undefined) {
    return undefined;
  }

  return { command: process.execPath, prefixArgs: [binPath] };
};

// Resolve the pi bin from its bundled package. Any failure (pi missing, malformed manifest, bin
// file absent) throws and is caught so the caller falls back to a PATH lookup. Pi is ESM-only with
// a restricted `exports` map, so the package directory is located by resolving its main entry and
// walking up to the nearest package.json; its `bin.pi` then names the launchable script.
const resolveBundledPiBinPath = (): string | undefined => {
  try {
    const packageRoot = findPiPackageRoot(fileURLToPath(import.meta.resolve(piPackageName)));
    const manifest = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8')) as {
      readonly bin: { readonly pi: string };
    };
    const binPath = join(packageRoot, manifest.bin.pi);

    /* v8 ignore next 3 -- defensive: a resolved pi bin path exists on disk. */
    if (!existsSync(binPath)) {
      throw new Error(`Bundled pi bin '${binPath}' is missing.`);
    }

    return binPath;
  } catch {
    /* v8 ignore next -- defensive: resolution falls back to a PATH lookup when pi cannot be located. */
    return undefined;
  }
};

// The resolved entry lives inside the pi package, so the nearest ancestor package.json is pi's own.
const findPiPackageRoot = (resolvedEntryPath: string): string => {
  let directory = dirname(resolvedEntryPath);

  while (!existsSync(join(directory, 'package.json'))) {
    const parentDirectory = dirname(directory);

    /* v8 ignore next 3 -- defensive: a resolved entry always has an ancestor package.json. */
    if (parentDirectory === directory) {
      throw new Error('Could not locate the bundled pi package root.');
    }

    directory = parentDirectory;
  }

  return directory;
};
