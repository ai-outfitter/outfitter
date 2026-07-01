// Turns a logical agent launch plan into an actual launched process: resolves the bundled pi
// binary, runs the launcher, and translates a missing agent CLI into actionable install guidance.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { AgentLaunchPlan } from './AgentAdapter.js';

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
