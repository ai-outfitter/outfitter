// Tracks which harness paths `outfitter link` owns.
//
// #187 requires that Outfitter never overwrite, adopt, or delete an unmanaged harness file. A
// manifest is how "unmanaged" stays decidable across runs: a path Outfitter did not record is
// never replaced or removed, no matter what it currently contains.
//
// The manifest is machine-local state, so it lives under XDG state rather than inside `~/.agents`
// — that tree is usually a git repository, and per-machine link bookkeeping does not belong in it.
// Losing the manifest is recoverable but not silent: reconcile then treats existing links as
// unmanaged and reports them as conflicts instead of clobbering them.
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import type { HarnessId, LinkableKind } from './HarnessLayout.js';

export const MANIFEST_VERSION = 1;

export interface ManifestEntry {
  /** Absolute path Outfitter created inside the harness config directory. */
  readonly target: string;
  readonly harness: HarnessId;
  readonly kind: LinkableKind;
  /** Absolute catalog path a symlink points at; absent for generated and settings entries. */
  readonly source?: string;
  readonly strategy: 'symlink' | 'generate' | 'settings';
}

export interface LinkManifest {
  readonly version: number;
  readonly entries: readonly ManifestEntry[];
}

export const emptyManifest = (): LinkManifest => ({ version: MANIFEST_VERSION, entries: [] });

/**
 * `$XDG_STATE_HOME/outfitter` when set, else `<home>/.local/state/outfitter`. Kept separate from
 * the cache root (paths/OutfitterCache.ts) because a cache clear must not orphan managed links.
 */
export const resolveOutfitterStateDir = (
  env: Readonly<Record<string, string | undefined>>,
  homeDirectory: string,
): string => {
  const xdgStateHome = env.XDG_STATE_HOME;

  if (xdgStateHome !== undefined && xdgStateHome.trim() !== '') {
    return join(xdgStateHome, 'outfitter');
  }

  return join(homeDirectory, '.local', 'state', 'outfitter');
};

export const resolveManifestPath = (env: Readonly<Record<string, string | undefined>>, homeDirectory: string): string =>
  join(resolveOutfitterStateDir(env, homeDirectory), 'links.json');

/** Reads the manifest, treating any unreadable or malformed file as "nothing is managed". */
export const readManifest = (manifestPath: string): LinkManifest => {
  if (!existsSync(manifestPath)) return emptyManifest();

  try {
    const parsed: unknown = JSON.parse(readFileSync(manifestPath, 'utf8'));

    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return emptyManifest();

    const { version, entries } = parsed as { readonly version?: unknown; readonly entries?: unknown };

    if (version !== MANIFEST_VERSION || !Array.isArray(entries)) return emptyManifest();

    return { version: MANIFEST_VERSION, entries: entries.filter(isManifestEntry) };
  } catch {
    return emptyManifest();
  }
};

const isManifestEntry = (value: unknown): value is ManifestEntry =>
  value !== null &&
  typeof value === 'object' &&
  typeof (value as ManifestEntry).target === 'string' &&
  typeof (value as ManifestEntry).harness === 'string' &&
  typeof (value as ManifestEntry).kind === 'string' &&
  typeof (value as ManifestEntry).strategy === 'string';

/** Writes the manifest deterministically: entries sorted by target so diffs stay reviewable. */
export const writeManifest = (manifestPath: string, manifest: LinkManifest): void => {
  const sorted = [...manifest.entries].sort((left, right) =>
    left.target < right.target ? -1 : left.target > right.target ? 1 : 0,
  );

  mkdirSync(dirname(manifestPath), { recursive: true });
  writeFileSync(manifestPath, `${JSON.stringify({ version: MANIFEST_VERSION, entries: sorted }, null, 2)}\n`, 'utf8');
};

export const removeManifest = (manifestPath: string): void => {
  rmSync(manifestPath, { force: true });
};

/** Index of managed targets, so the planner can ask "did we create this path?" in constant time. */
export const managedTargets = (manifest: LinkManifest): ReadonlyMap<string, ManifestEntry> =>
  new Map(manifest.entries.map((entry) => [entry.target, entry]));
