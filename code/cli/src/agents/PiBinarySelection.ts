// Resolves which pi binary a pi-harness launch uses: the OUTFITTER_PI_BIN environment override,
// the pi_binary/pi_binary_path settings keys, or the bundled pi resolved from Outfitter's own
// dependency closure.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { PiBinaryMode, Settings } from '../settings/Settings.js';

/** The launch-time selection: `auto` collapses to one of these modes during resolution. */
export interface PiBinarySelection {
  readonly mode: 'bundled' | 'path';
  readonly binaryPath?: string;
}

export interface PiBinaryResolution {
  readonly selection: PiBinarySelection;
  readonly warnings: readonly string[];
  /**
   * Set when a configured explicit binary does not exist on disk. The selection still names the
   * configured path, so a caller that ignores the error fails at spawn instead of silently
   * launching the bundled binary in its place.
   */
  readonly error?: Error;
}

/** Probe for whether the bundled pi resolves from the dependency closure; injected so `auto` stays pure. */
export type BundledPiResolvable = () => boolean;

export interface PiBinarySelectionDependencies {
  readonly bundledResolvable?: BundledPiResolvable;
}

export const OUTFITTER_PI_BIN = 'OUTFITTER_PI_BIN';

/** What a pi-harness run carries after resolution; non-pi harnesses carry the neutral value. */
export interface ScopedPiBinary {
  readonly selection?: PiBinarySelection;
  readonly warnings: readonly string[];
}

const neutralPiBinary: ScopedPiBinary = { warnings: [] };

// Whether the bundled pi resolves from Outfitter's dependency closure right now. The run command
// probes this when `pi_binary: auto` needs to decide between bundled and the PATH fallback, so the
// decision (and its warning) surfaces before launch rather than from inside the spawn boundary.
export const isBundledPiResolvable = (): boolean => resolveBundledPiBinPath() !== undefined;

const bundledResolvableFor = (input: { readonly bundledPiResolvable?: BundledPiResolvable }): BundledPiResolvable =>
  input.bundledPiResolvable ?? isBundledPiResolvable;

/**
 * Resolves the pi binary selection for one run, scoped to the pi harness: non-pi harness launches
 * never consult the control, so its warnings and pre-launch errors stay out of their runs entirely.
 * A configured explicit binary that does not exist throws — the run fails before launch rather than
 * silently launching the bundled binary the user opted out of.
 */
export const resolveScopedPiBinarySelection = (
  harness: string,
  settings: Settings,
  env: Readonly<Record<string, string | undefined>>,
  seam: { readonly bundledPiResolvable?: BundledPiResolvable } = {},
): ScopedPiBinary => {
  if (harness !== 'pi') {
    return neutralPiBinary;
  }

  const resolution = resolvePiBinarySelection(settings, env, {
    bundledResolvable: bundledResolvableFor(seam),
  });
  if (resolution.error !== undefined) {
    throw resolution.error;
  }

  return { selection: resolution.selection, warnings: resolution.warnings };
};

export const resolvePiBinarySelection = (
  settings: Settings,
  env: Readonly<Record<string, string | undefined>>,
  dependencies: PiBinarySelectionDependencies = {},
): PiBinaryResolution => {
  // The environment variable is the one-run override: a non-empty value names the binary directly,
  // taking precedence over every settings layer.
  const envBinary = env[OUTFITTER_PI_BIN]?.trim();
  if (envBinary !== undefined && envBinary !== '') {
    return explicitBinarySelection(envBinary, 'OUTFITTER_PI_BIN');
  }

  return selectionForMode(effectiveMode(settings), settings, dependencies);
};

// A path declared without a mode implies path mode — the least-surprise reading of an explicit
// binary pin, and the same intent the environment variable expresses.
const effectiveMode = (settings: Settings): PiBinaryMode =>
  settings.piBinary ?? (settings.piBinaryPath !== undefined ? 'path' : 'bundled');

const selectionForMode = (
  mode: PiBinaryMode,
  settings: Settings,
  dependencies: PiBinarySelectionDependencies,
): PiBinaryResolution => {
  if (mode === 'bundled') {
    return bundledSelection(settings);
  }
  if (mode === 'path') {
    return settings.piBinaryPath === undefined
      ? { selection: { mode: 'path' }, warnings: [] }
      : explicitBinarySelection(settings.piBinaryPath, "'pi_binary_path'");
  }
  return autoSelection(dependencies);
};

const bundledSelection = (settings: Settings): PiBinaryResolution => ({
  selection: { mode: 'bundled' },
  warnings:
    settings.piBinaryPath === undefined
      ? []
      : ["Warning: 'pi_binary_path' is ignored unless 'pi_binary: path' selects path mode."],
});

// auto: bundled first — mirroring the launcher's pre-selection fallback seam — with a PATH `pi`
// fallback only when bundled resolution fails. The fallback warns so the degraded reproducibility
// is visible, and --strict makes it fatal before launch.
const autoSelection = (dependencies: PiBinarySelectionDependencies): PiBinaryResolution => {
  const bundledResolvable = dependencies.bundledResolvable ?? (() => true);
  if (bundledResolvable()) {
    return { selection: { mode: 'bundled' }, warnings: [] };
  }
  return {
    selection: { mode: 'path' },
    warnings: ["Warning: 'pi_binary: auto' could not resolve the bundled pi; falling back to the PATH 'pi'."],
  };
};

// An explicitly named binary is a pin — the CI and vendored-binary use case — so a missing file
// fails the run with an actionable error instead of silently reverting to the bundled binary that
// the user just opted out of.
const explicitBinarySelection = (binaryPath: string, source: string): PiBinaryResolution => {
  if (!existsSync(binaryPath)) {
    return {
      selection: { mode: 'path', binaryPath },
      warnings: [],
      error: new Error(`Could not launch pi: ${source} names '${binaryPath}', which does not exist on disk.`),
    };
  }

  return { selection: { mode: 'path', binaryPath }, warnings: [] };
};
interface BundledPiLaunch {
  readonly command: string;
  readonly prefixArgs: readonly string[];
}

const piPackageName = '@earendil-works/pi-coding-agent';

export const resolveBundledPiLaunch = (): BundledPiLaunch | undefined => {
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
export const resolveBundledPiBinPath = (): string | undefined => {
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
