// Resolves local-path pi extension specifiers (`./`, `../`, `~/`, absolute) declared in agent
// loadouts, expanding them against the declaring `.agents` layer root or the user home, and merges
// the resolved paths with the cached remote (`npm:`/`git:`) extension flow so one ordered,
// de-duplicated loadout drives both the `--extension` flags and the generated settings.json entries.
// Local paths never touch the extension cache: the files already exist on disk, so there is no
// install, no network, and no offline gating — only an existence check whose failure warns (fatal
// under `--strict`) and skips the extension.
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import type { EnsurePiExtensionsResult } from './PiExtensionCache.js';

/** One declared loadout extension and the directory its relative paths resolve against. */
export interface DeclaredExtension {
  readonly specifier: string;
  /** Absolute `.agents` root of the declaring layer; undefined for settings-layer defaults. */
  readonly declaringRoot?: string;
}

export interface PiExtensionLoadoutResult {
  /** Absolute load paths to pass as `--extension`, in declared order, de-duplicated. */
  readonly loadDirs: readonly string[];
  /**
   * Pi entry paths each load path contributes to the materialized `settings.json` `extensions:`
   * array, keyed by load path; a local path is its own entry because pi resolves directories and
   * files alike from the configured-path surface.
   */
  readonly settingsEntries: Readonly<Record<string, readonly string[]>>;
  /** One message per extension that could not be served. */
  readonly warnings: readonly string[];
}

// The loadout specifier grammar: a remote source the cache understands, or a local path. A bare
// name is deliberately not a form — it is ambiguous with resource slugs and is rejected at the
// schema/read boundary rather than silently warning at launch like it did before local paths existed.
const specifierPattern = /^(?:npm:|git:|~\/|\.\.\/|\.\/|\/).+$/u;

/** The grammar defect in one extension specifier, or undefined when it parses. Exported for the config.json read boundary. */
export const extensionSpecifierDefect = (specifier: string): string | undefined =>
  specifierPattern.test(specifier)
    ? undefined
    : `extension specifier '${specifier}' must start with npm:, git:, ./, ../, ~/ , or / to be loadable.`;

/** Whether a specifier is a local path (relative, home, or absolute) rather than a remote source. */
export const isLocalExtensionSpecifier = (specifier: string): boolean =>
  specifier.startsWith('./') || specifier.startsWith('../') || specifier.startsWith('~/') || specifier.startsWith('/');

export type LocalPathResolution = { readonly resolvedPath: string } | { readonly warning: string };

/**
 * Resolves one local specifier: `~/` expands against the run's home directory, `./`/`../` join the
 * declaring layer root, absolute paths pass through, and the result is canonicalized. A relative
 * specifier without a declaring root cannot resolve (settings-layer defaults are rejected at the
 * settings boundary, so this only guards plans built outside composition). Existence is checked
 * here so the launch never receives a dangling path.
 */
export const resolveLocalExtensionPath = (
  specifier: string,
  declaringRoot: string | undefined,
  homeDirectory: string,
): LocalPathResolution => {
  const resolveAgainst = (base: string, relative: string): LocalPathResolution => {
    const resolvedPath = resolve(base, relative);
    if (!existsSync(resolvedPath)) {
      return {
        warning: `extension '${specifier}' resolves to '${resolvedPath}', which does not exist; it will not be loaded.`,
      };
    }
    return { resolvedPath };
  };

  if (specifier.startsWith('~/')) return resolveAgainst(homeDirectory, specifier.slice(2));
  if (specifier.startsWith('/')) return resolveAgainst(homeDirectory, specifier);
  if (declaringRoot === undefined) {
    return {
      warning: `extension '${specifier}' is a relative path but has no declaring .agents layer to resolve against.`,
    };
  }
  return resolveAgainst(declaringRoot, specifier);
};

/** Ensures the remote subset through the cache flow, one unique specifier at a time for provenance. */
export type RemoteExtensionEnsurer = (specifiers: readonly string[]) => Promise<EnsurePiExtensionsResult>;

/**
 * Resolves the composed extension loadout for one pi run. Local declarations resolve to paths (or
 * warn and skip); remote declarations delegate to the cache flow per unique specifier so the
 * per-specifier outcomes map back onto the declared order. De-duplication happens on the resolved
 * path with first occurrence winning, and warnings stay in declaration order.
 */
export const resolvePiExtensionLoadout = async (
  declarations: readonly DeclaredExtension[],
  input: {
    readonly homeDirectory: string;
    readonly ensureRemote: RemoteExtensionEnsurer;
  },
): Promise<PiExtensionLoadoutResult> => {
  const warnings: string[] = [];
  const loadDirs: string[] = [];
  const settingsEntries: Record<string, readonly string[]> = {};
  // Keys already served: the resolved path for locals, the install dir (or the failing specifier)
  // for remotes — so repeated specifier texts and repeated install dirs record once, first occurrence.
  const served = new Set<string>();

  const serveOnce = (
    key: string,
    loadDir: string | undefined,
    entries: readonly string[] | undefined,
    outcomeWarnings: readonly string[],
  ): void => {
    if (served.has(key)) return;
    served.add(key);
    warnings.push(...outcomeWarnings);
    if (loadDir === undefined) return;
    loadDirs.push(loadDir);
    if (entries !== undefined) settingsEntries[loadDir] = entries;
  };

  const remoteOutcomes = new Map<string, EnsurePiExtensionsResult>();
  for (const declaration of declarations) {
    if (isLocalExtensionSpecifier(declaration.specifier) || remoteOutcomes.has(declaration.specifier)) continue;
    remoteOutcomes.set(declaration.specifier, await input.ensureRemote([declaration.specifier]));
  }

  for (const declaration of declarations) {
    const outcome = remoteOutcomes.get(declaration.specifier);
    if (outcome !== undefined) {
      const loadDir = outcome.loadDirs[0];
      serveOnce(
        loadDir ?? declaration.specifier,
        loadDir,
        loadDir === undefined ? undefined : outcome.settingsEntries[loadDir],
        outcome.warnings,
      );
      continue;
    }

    const resolution = resolveLocalExtensionPath(declaration.specifier, declaration.declaringRoot, input.homeDirectory);
    if ('warning' in resolution) warnings.push(resolution.warning);
    else serveOnce(resolution.resolvedPath, resolution.resolvedPath, [resolution.resolvedPath], []);
  }

  return { loadDirs, settingsEntries, warnings };
};
