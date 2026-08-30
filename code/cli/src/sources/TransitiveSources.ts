// Expands the remote-source closure that cached catalogs declare in their own settings files.
import { existsSync, lstatSync, realpathSync, statSync } from 'node:fs';
import { isAbsolute, join, relative, sep } from 'node:path';

import { createSettingsLoadPlan, loadSettingsFiles } from '../settings/SettingsLoader.js';
import type { SourceReference } from '../settings/Settings.js';
import {
  encodeRemoteSourceSelection,
  formatRemoteSourceDisplay,
  isImmutableRef,
  isRemoteSource,
  resolveSourcePayloadRoot,
} from './SourceCache.js';
import type { RemoteSourceReference } from './SourceCache.js';
import type { ResolutionWarningDetail } from '../validation/ResolutionWarning.js';

/** A `github:` catalog dependency, pinned to an immutable ref, attributed to its declaring catalog. */
export interface DeclaredRemoteSource {
  readonly source: { readonly github: string; readonly ref: string };
  /** Display name of the declaring catalog, for warnings and provenance. */
  readonly declaredBy: string;
}

/** A catalog declaration with the settings file that contains it. */
export interface AttributedRemoteSource extends DeclaredRemoteSource {
  readonly sourcePath: string;
}

/** Drops the settings-file attribution for the callers that predate it. */
const unattributed = ({ source, declaredBy }: AttributedRemoteSource): DeclaredRemoteSource => ({
  source,
  declaredBy,
});

export interface DeclaredSourcesResult {
  readonly sources: readonly DeclaredRemoteSource[];
  readonly warnings: readonly string[];
}

// True when a filesystem entry exists at the path, *including a dangling symlink*. `existsSync`
// follows links and reports a dangling one as absent, which would silently drop (rather than warn
// about, per OFTR-004.6.8) a `settings.yml` committed as a broken symlink.
const entryExists = (path: string): boolean => {
  try {
    lstatSync(path);
    return true;
  } catch {
    return false;
  }
};

/** The settings file a catalog payload root may carry: `settings.yml`, else `.agents/settings.yml`. */
export const resolveCatalogSettingsPath = (payloadRoot: string): string | undefined => {
  const rootSettingsPath = join(payloadRoot, 'settings.yml');
  if (entryExists(rootSettingsPath)) return rootSettingsPath;

  const nestedSettingsPath = join(payloadRoot, '.agents', 'settings.yml');
  return entryExists(nestedSettingsPath) ? nestedSettingsPath : undefined;
};

/** One declared source resolved to either an accepted `github:` dependency or a skip reason. */
type ClassifiedSource =
  { readonly source: { readonly github: string; readonly ref: string } } | { readonly skip: string };

/** Applies the safe-subset rules to one declared source, yielding a dependency or a skip reason. */
const classifyDeclaredSource = (declared: SourceReference, declaredBy: string): ClassifiedSource => {
  if (!isRemoteSource(declared)) {
    return {
      skip: `Catalog '${declaredBy}' declares local path source '${declared.path}'; only 'github:' shorthands are resolved transitively, so it was skipped.`,
    };
  }
  if (declared.github === undefined) {
    return {
      skip: `Catalog '${declaredBy}' declares source '${formatRemoteSourceDisplay(declared)}' as a 'uri:'; only 'github:' shorthands are resolved transitively, so it was skipped.`,
    };
  }
  if (declared.path !== undefined) {
    return {
      skip: `Catalog '${declaredBy}' declares source '${formatRemoteSourceDisplay(declared)}' with a 'path:' subpath; transitive 'github:' sources must resolve their whole repository, so it was skipped.`,
    };
  }
  if (declared.ref === undefined || !isImmutableRef(declared.ref)) {
    return {
      skip: `Catalog '${declaredBy}' declares source '${formatRemoteSourceDisplay(declared)}' without an immutable ref (a full commit SHA or version tag); it was skipped.`,
    };
  }
  return { source: { github: declared.github, ref: declared.ref } };
};

/**
 * Loads a cached catalog's own settings file, guarding against a hostile `settings.yml` committed as
 * a symlink to a directory or a file outside the checkout (a `readFileSync` on a directory throws
 * `EISDIR` and would crash resolution). Returns the parsed sources list, or a skip warning.
 */
const loadCatalogSourceList = (
  payloadRoot: string,
  checkoutRoot: string,
  declaredBy: string,
):
  | { readonly sources: readonly SourceReference[]; readonly sourcePath?: string }
  | { readonly warning: ResolutionWarningDetail } => {
  const settingsPath = resolveCatalogSettingsPath(payloadRoot);
  if (settingsPath === undefined) return { sources: [] };

  try {
    if (!statSync(settingsPath).isFile()) throw new Error('settings.yml is not a regular file');
    // Anchor containment to the *checkout* root (the clone Outfitter created), not the payload root:
    // a `path:` selecting a symlinked subdirectory would make the payload root itself resolve
    // outside the clone, so anchoring there would accept an external settings.yml as "contained".
    const relativeToCheckout = relative(realpathSync(checkoutRoot), realpathSync(settingsPath));
    // Precise containment: a leading `..` segment (not a filename that merely starts with `..`, such
    // as a directory named `..catalog`) or an absolute result means the settings escaped the checkout.
    if (relativeToCheckout === '..' || relativeToCheckout.startsWith(`..${sep}`) || isAbsolute(relativeToCheckout)) {
      throw new Error('settings.yml resolves outside the checkout');
    }
    // Known-accepted TOCTOU: the checkout could be swapped between this stat/realpath check and the
    // read below. The checkout is a pinned immutable git ref that only Outfitter writes, and racing
    // local-filesystem writes already imply broader access, so closing this window is not warranted.
    const loaded = loadSettingsFiles(createSettingsLoadPlan([{ scope: 'remote', path: settingsPath }]));
    if (loaded.issues.length > 0) {
      return {
        warning: {
          message: `Catalog '${declaredBy}' declares invalid settings at '${settingsPath}'; its sources were skipped.`,
          resource: `source:${declaredBy}`,
          sourcePath: settingsPath,
        },
      };
    }
    return { sources: loaded.files[0].settings.sources ?? [], sourcePath: settingsPath };
  } catch {
    return {
      warning: {
        message: `Catalog '${declaredBy}' has an unreadable settings.yml (not a regular file inside the checkout); its sources were skipped.`,
        resource: `source:${declaredBy}`,
        sourcePath: settingsPath,
      },
    };
  }
};

interface AttributedDeclaredSourcesResult {
  readonly sources: readonly AttributedRemoteSource[];
  readonly warningDetails: readonly ResolutionWarningDetail[];
}

const readAttributedRemoteSources = (
  payloadRoot: string,
  checkoutRoot: string,
  declaredBy: string,
): AttributedDeclaredSourcesResult => {
  const loaded = loadCatalogSourceList(payloadRoot, checkoutRoot, declaredBy);
  if ('warning' in loaded) return { sources: [], warningDetails: [loaded.warning] };
  if (loaded.sourcePath === undefined) return { sources: [], warningDetails: [] };

  const sources: AttributedRemoteSource[] = [];
  const warningDetails: ResolutionWarningDetail[] = [];
  for (const declared of loaded.sources) {
    const classified = classifyDeclaredSource(declared, declaredBy);
    if ('skip' in classified) {
      warningDetails.push({
        message: classified.skip,
        resource: `source:${declaredBy}`,
        sourcePath: loaded.sourcePath,
      });
    } else {
      sources.push({ source: classified.source, declaredBy, sourcePath: loaded.sourcePath });
    }
  }

  return { sources, warningDetails };
};

/**
 * Reads the `github:` catalog dependencies a cached catalog declares (content, never policy —
 * OFTR-004.6.2). Transitive sources are deliberately the narrowest safe subset: a `github:`
 * shorthand pinned to an immutable ref. A `uri:` source, a local `path:` source, a `path:` subpath,
 * or a mutable ref is skipped with a warning naming the declaring catalog (OFTR-004.6.4,
 * OFTR-004.6.5). Restricting to `github:` means every transitive fetch during `outfitter sync`
 * passes through the private-catalog gate and can never select an arbitrary git transport (a `uri:`
 * could name `ext::<cmd>` or a filesystem path); forbidding `path:` means a declaration can never
 * escape its fetched checkout. An unreadable or invalid settings file skips the catalog's
 * declarations without failing resolution (OFTR-004.6.8). (First-party default-catalog bootstrap
 * fetches its declared closure without that interactive gate — see OFTR-004.6.10.) Broader
 * transports remain future work under the trust model in #212.
 */
export const readDeclaredRemoteSources = (
  payloadRoot: string,
  checkoutRoot: string,
  declaredBy: string,
): DeclaredSourcesResult => {
  const attributed = readAttributedRemoteSources(payloadRoot, checkoutRoot, declaredBy);
  return {
    sources: attributed.sources.map(unattributed),
    warnings: attributed.warningDetails.map(({ message }) => message),
  };
};

export interface TransitiveExpansionInput {
  /** The directly configured sources, which seed the visited set and the first frontier. */
  readonly directSources: readonly SourceReference[];
  /** Maps a remote source to its cached checkout (clone) root, or undefined when it is not cached. */
  readonly resolveCachedCheckoutRoot: (source: RemoteSourceReference) => string | undefined;
}

export interface TransitiveExpansionResult {
  /** Newly discovered remote sources, breadth-first by depth then declaration order (OFTR-004.6.3). */
  readonly sources: readonly DeclaredRemoteSource[];
  /** Every accepted declaration, including duplicates suppressed from the resolved source graph. */
  readonly declarations: readonly DeclaredRemoteSource[];
  /** Source declarations with their exact catalog settings file. */
  readonly attributedSources: readonly AttributedRemoteSource[];
  /** Every attributed declaration, including duplicates suppressed from the source graph. */
  readonly attributedDeclarations: readonly AttributedRemoteSource[];
  readonly warnings: readonly string[];
  readonly warningDetails: readonly ResolutionWarningDetail[];
}

/**
 * Walks declared sources breadth-first from the directly configured sources over the local cache.
 * A source already visited — directly configured or declared by an earlier catalog — is never
 * expanded again, so dependency cycles terminate (OFTR-004.6.6). An uncached source stays in the
 * result (the caller reports it) but its own declarations are unknowable until it is synced.
 */
// Reads one parent's cached checkout and returns the declarations it contributes. Returns `undefined`
// (skip this parent) when it is uncached or its `path:` is absolute/escaping — a throw here would
// otherwise crash resolution; only a directly configured source can carry such a path.
const declarationsFromParent = (
  parent: RemoteSourceReference,
  resolveCachedCheckoutRoot: TransitiveExpansionInput['resolveCachedCheckoutRoot'],
): AttributedDeclaredSourcesResult | undefined => {
  const checkoutRoot = resolveCachedCheckoutRoot(parent);
  if (checkoutRoot === undefined) return undefined;

  let payloadRoot: string;
  try {
    payloadRoot = resolveSourcePayloadRoot(checkoutRoot, parent);
  } catch {
    return undefined;
  }
  if (!existsSync(payloadRoot)) return undefined;

  return readAttributedRemoteSources(payloadRoot, checkoutRoot, formatRemoteSourceDisplay(parent));
};

export const expandTransitiveSources = (input: TransitiveExpansionInput): TransitiveExpansionResult => {
  const attributedSources: AttributedRemoteSource[] = [];
  const attributedDeclarations: AttributedRemoteSource[] = [];
  const warningDetails: ResolutionWarningDetail[] = [];
  const visited = new Set<string>();

  // Seed the visited set with each direct source's path-aware identity so a directly configured
  // subpath source does not suppress a transitive whole-repository source of the same repo+ref, and
  // so an exact duplicate direct source is expanded only once (OFTR-004.6.6).
  let frontier: RemoteSourceReference[] = [];
  for (const direct of input.directSources) {
    if (!isRemoteSource(direct)) continue;
    const key = encodeRemoteSourceSelection(direct);
    if (visited.has(key)) continue;
    visited.add(key);
    frontier.push(direct);
  }

  while (frontier.length > 0) {
    const next: RemoteSourceReference[] = [];

    for (const parent of frontier) {
      const declared = declarationsFromParent(parent, input.resolveCachedCheckoutRoot);
      if (declared === undefined) continue;
      warningDetails.push(...declared.warningDetails);

      for (const entry of declared.sources) {
        attributedDeclarations.push(entry);
        const key = encodeRemoteSourceSelection(entry.source);
        if (visited.has(key)) continue;
        visited.add(key);
        attributedSources.push(entry);
        next.push(entry.source);
      }
    }

    frontier = next;
  }

  return {
    sources: attributedSources.map(unattributed),
    declarations: attributedDeclarations.map(unattributed),
    attributedSources,
    attributedDeclarations,
    warnings: warningDetails.map(({ message }) => message),
    warningDetails,
  };
};
