// Turns a logical agent launch plan into an actual launched process: applies the selected pi binary
// resolution, runs the launcher, and translates a missing agent CLI into actionable install guidance.
import os from 'node:os';

import { resolveBundledPiLaunch } from './PiBinarySelection.js';
import type { PiBinarySelection } from './PiBinarySelection.js';
import type { AgentLaunchPlan } from '../projection/Projection.js';

export interface AgentProcessLauncher {
  launch(plan: AgentLaunchPlan): Promise<number>;
}

export const launchAgentProcess = async (
  launcher: AgentProcessLauncher,
  launchPlan: AgentLaunchPlan,
  agentId: string,
): Promise<number> => {
  try {
    return await launcher.launch(launchPlan);
  } catch (error) {
    if (isCommandNotFoundError(error)) {
      throw new Error(formatMissingAgentCliMessage(agentId, launchPlan.command), { cause: error });
    }

    throw error;
  }
};

// Pi is bundled with Outfitter, so prefer the bundled binary launched through the current Node
// runtime. This avoids the `spawn pi ENOENT` first-run crash when pi is not on PATH. Other agents
// (e.g. claude) are still resolved from PATH and fall back to actionable install guidance. This is
// a launch-mechanism detail applied by the real spawn launcher; the reported launch plan stays
// logical (`pi <args>`).
export const resolveAgentLaunchExecutable = (
  launchPlan: AgentLaunchPlan,
  piBinary: PiBinarySelection = { mode: 'bundled' },
): AgentLaunchPlan => {
  if (launchPlan.command !== 'pi') {
    return launchPlan;
  }

  // A path-mode selection with an explicit binary replaces the command wholesale. No version-check
  // suppression is injected: a user-selected binary is updatable with `pi update`, so pi's own
  // self-update notice stays actionable, and any launch-environment value passes through unchanged.
  if (piBinary.mode === 'path') {
    return piBinary.binaryPath === undefined ? launchPlan : { ...launchPlan, command: piBinary.binaryPath };
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
    // Skip pi's self-version check for bundled launches only; profiles may override via environment.
    env: { PI_SKIP_VERSION_CHECK: '1', ...launchPlan.env },
  };
};

// Whether the bundled pi resolves from Outfitter's dependency closure right now. The run command
// probes this when `pi_binary: auto` needs to decide between bundled and the PATH fallback, so the
// decision (and its warning) surfaces before launch rather than from inside the spawn boundary.
export { isBundledPiResolvable } from './PiBinarySelection.js';

// Signals we forward to the harness. SIGKILL is deliberately absent: it cannot be caught, and the
// kernel delivers it to us directly.
const FORWARDED_SIGNALS: readonly NodeJS.Signals[] = ['SIGTERM', 'SIGINT', 'SIGHUP'];

// How long the harness gets to exit after a forwarded signal before we stop being polite. Kubernetes
// defaults to a 30s grace period and SIGKILLs the pod afterwards, so this has to be comfortably
// shorter or the escalation never runs.
const TERMINATION_GRACE_MS = 10_000;

/**
 * Forwards termination signals from this process to a spawned harness, resolving once the harness
 * actually exits.
 *
 * Without this, a resident agent cannot shut down. Node installs no default forwarding, so the
 * harness never learns the session is ending: under Kubernetes it is SIGKILLed when the grace period
 * expires, skipping credential persistence and projection cleanup. The same gap shows up outside
 * containers — Ctrl-C in a terminal, or a cancelled CI job — which is why this belongs here rather
 * than in a container init.
 *
 * Installing a handler suppresses Node's default termination, so every path must resolve, and the
 * listeners must come off afterwards or repeated launches in one process leak them.
 */
export const attachSignalForwarding = (
  child: { kill(signal?: NodeJS.Signals): boolean; killed: boolean },
  emitter: NodeJS.EventEmitter = process,
  graceMs: number = TERMINATION_GRACE_MS,
): (() => void) => {
  let escalation: NodeJS.Timeout | undefined;

  const forward = (signal: NodeJS.Signals) => (): void => {
    if (child.killed) return;
    child.kill(signal);
    // A harness that ignores or hangs on the signal would otherwise keep us alive until the
    // orchestrator's own SIGKILL, losing the chance to exit cleanly first.
    escalation ??= setTimeout(() => child.kill('SIGKILL'), graceMs);
    escalation.unref?.();
  };

  const handlers = FORWARDED_SIGNALS.map((signal) => [signal, forward(signal)] as const);
  for (const [signal, handler] of handlers) emitter.on(signal, handler);

  return () => {
    for (const [signal, handler] of handlers) emitter.removeListener(signal, handler);
    if (escalation) clearTimeout(escalation);
  };
};

/* v8 ignore start -- real process spawn is covered by end-to-end smoke usage, not unit tests. */
export const createSpawnLauncher = (stdio: 'inherit' | 'ignore'): AgentProcessLauncher => ({
  async launch(plan: AgentLaunchPlan): Promise<number> {
    const { default: spawn } = await import('cross-spawn');
    return await new Promise<number>((resolve, reject) => {
      const child = spawn(plan.command, [...plan.args], { stdio, env: { ...process.env, ...plan.env } });
      const detach = attachSignalForwarding(child);
      child.on('error', (error) => {
        detach();
        reject(error); // ENOENT surfaces as an actionable install message
      });
      child.on('close', (code, signal) => {
        detach();
        // 128+n is the shell convention for "died on signal n", and it is what a caller inspecting
        // our exit status expects to see when the harness was terminated rather than returning.
        resolve(code ?? (signal ? 128 + (os.constants.signals[signal] ?? 0) : 0));
      });
    });
  },
});

export const spawnLauncher: AgentProcessLauncher = createSpawnLauncher('inherit');
/* v8 ignore stop */

/**
 * Launches a resolved plan through the given spawn boundary. The install-hint agentId is derived
 * from the logical launch command ('pi' | 'claude' | 'codex') so a missing-CLI failure always names
 * the harness actually being launched, regardless of how the harness was selected (flag, settings
 * default, or built-in fallback).
 */
export const launchThroughSpawn = (
  spawn: AgentProcessLauncher,
  plan: AgentLaunchPlan,
  piBinary?: PiBinarySelection,
): Promise<number> => launchAgentProcess(spawn, resolveAgentLaunchExecutable(plan, piBinary), plan.command);

const isCommandNotFoundError = (error: unknown): boolean =>
  error !== null && typeof error === 'object' && 'code' in error && (error as { code?: unknown }).code === 'ENOENT';

const agentCliInstallHints: Readonly<Record<string, string>> = {
  pi: 'Install Pi with `npm install -g @earendil-works/pi-coding-agent` (see https://pi.dev).',
  claude: 'Install Claude Code from https://claude.com/claude-code, then rerun with `--harness claude`.',
  codex: 'Install Codex CLI from https://developers.openai.com/codex/cli, then rerun with `--harness codex`.',
};

const formatMissingAgentCliMessage = (agentId: string, command: string): string => {
  const installHint = agentCliInstallHints[agentId];
  const baseMessage = `Could not launch the '${agentId}' agent CLI: '${command}' is not installed or not on your PATH.`;

  return installHint === undefined ? baseMessage : `${baseMessage} ${installHint}`;
};
