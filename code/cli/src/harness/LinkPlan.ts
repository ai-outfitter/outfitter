// Builds the `outfitter link` plan: what would change in each harness config directory, and why.
//
// Planning is separated from applying so `--dry-run` shows exactly what a real run does, and so the
// conflict rules are testable without touching a filesystem beyond inspection. Every decision about
// an existing path is made here; LinkApply only executes.
import { existsSync, lstatSync, readFileSync, readlinkSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';

import { renderGeminiCommand, geminiCommandFileName, parseCommandDocument } from './CommandAdapter.js';
import type { HarnessId, HarnessLayout, HarnessSurface, LinkableKind } from './HarnessLayout.js';
import { HARNESS_LAYOUTS, findHarnessSurface, resolveHarnessConfigDirectory, supportedKinds } from './HarnessLayout.js';
import type { HarnessSettings } from './HarnessSettings.js';
import type { HookDeclaration } from './HookAdapter.js';
import { mergeHookSettingsDocument, projectHooks, stripManagedHooks } from './HookAdapter.js';
import type { LinkManifest } from './LinkManifest.js';
import { managedTargets } from './LinkManifest.js';

/** A catalog resource available for projection, already resolved to its winning definition. */
export interface LinkSource {
  readonly kind: LinkableKind;
  readonly slug: string;
  /** Absolute path of the resource: a skill directory, or a command/instructions file. */
  readonly path: string;
}

export type LinkAction =
  /** Path is absent, or is a stale managed link: create or repoint it. */
  | 'create'
  /** Managed path already resolves to the right source: nothing to do. */
  | 'unchanged'
  /** Managed path exists but points elsewhere or has stale content: rewrite it. */
  | 'update'
  /** Path exists and Outfitter does not own it: never touched without --force. */
  | 'conflict'
  /** Managed path whose source disappeared from the catalog: remove it. */
  | 'remove';

export interface LinkStep {
  readonly harness: HarnessId;
  readonly kind: LinkableKind;
  readonly action: LinkAction;
  readonly target: string;
  readonly strategy: HarnessSurface['strategy'];
  /** Catalog path for symlink steps. */
  readonly source?: string;
  /** Rendered file body for `generate` steps, or the whole document for `settings` steps. */
  readonly content?: string;
  readonly reason?: string;
  /**
   * Write this step, then stop tracking the target. Used when a settings file still has to be
   * rewritten to strip Outfitter's hook entries, but should no longer be recorded as managed.
   */
  readonly forget?: boolean;
}

export interface LinkPlanResult {
  readonly steps: readonly LinkStep[];
  /** Requested-but-unsupported combinations, reported so `--strict` can fail on them. */
  readonly unsupported: readonly string[];
  /** Harnesses selected for provisioning, in registry order. */
  readonly harnesses: readonly HarnessId[];
}

export interface LinkPlanInput {
  readonly homeDirectory: string;
  readonly settings: HarnessSettings;
  readonly sources: readonly LinkSource[];
  /** Absolute path to `~/.agents/AGENTS.md`, when it exists. */
  readonly instructionsPath?: string;
  readonly manifest: LinkManifest;
  /** Replace paths Outfitter does not own. Off by default; conflicts are reported instead. */
  readonly force?: boolean;
  /** Plan the removal of every managed path instead of reconciling. */
  readonly remove?: boolean;
}

/** Resolves `~`-prefixed and relative config directories against the user's home. */
export const resolveConfiguredDirectory = (configured: string, homeDirectory: string): string => {
  if (configured === '~') return homeDirectory;
  if (configured.startsWith('~/')) return join(homeDirectory, configured.slice(2));

  return isAbsolute(configured) ? configured : resolve(homeDirectory, configured);
};

/**
 * Applies `link` plus per-harness `enabled` overrides. An explicit override always wins over the
 * selection, so `link: none` with `claude: {enabled: true}` provisions exactly one harness.
 */
export const selectHarnesses = (settings: HarnessSettings, homeDirectory: string): readonly HarnessId[] => {
  const selection = settings.link ?? 'detected';

  return HARNESS_LAYOUTS.filter((layout) => {
    const override = settings.overrides?.[layout.id];

    if (override?.enabled !== undefined) return override.enabled;
    if (selection === 'none') return false;
    if (selection === 'detected') return existsSync(configDirectories(layout, settings, homeDirectory)[0]);

    return selection.includes(layout.id);
  }).map((layout) => layout.id);
};

const configDirectories = (
  layout: HarnessLayout,
  settings: HarnessSettings,
  homeDirectory: string,
): readonly string[] => {
  const configured = settings.overrides?.[layout.id]?.configDirectories;

  if (configured === undefined || configured.length === 0) {
    return [resolveHarnessConfigDirectory(layout, homeDirectory)];
  }

  return configured.map((directory) => resolveConfiguredDirectory(directory, homeDirectory));
};

/**
 * Kinds to attempt for a harness. An explicit `resources` list is honoured verbatim — including
 * kinds the harness does not support — so the planner can report the mismatch instead of silently
 * dropping something the user asked for.
 */
const selectedKinds = (layout: HarnessLayout, settings: HarnessSettings): readonly LinkableKind[] =>
  settings.overrides?.[layout.id]?.resources ?? supportedKinds(layout);

/** Reads a symlink without following it; undefined when the path is absent or not a link. */
const readLinkTarget = (path: string): string | undefined => {
  try {
    return lstatSync(path).isSymbolicLink() ? readlinkSync(path) : undefined;
  } catch {
    return undefined;
  }
};

const pathExists = (path: string): boolean => {
  try {
    lstatSync(path);
    return true;
  } catch {
    return false;
  }
};

/**
 * Classifies one target path.
 *
 * The ownership rule lives here: a path Outfitter did not record in the manifest is a `conflict`,
 * even when it happens to already point at the right place. Adopting it silently would make
 * `--remove` delete something the user created by hand.
 */
const classify = (
  target: string,
  isManaged: boolean,
  matches: boolean,
  force: boolean,
): { readonly action: LinkAction; readonly reason?: string } => {
  if (!pathExists(target)) return { action: 'create' };

  if (isManaged) return matches ? { action: 'unchanged' } : { action: 'update' };

  if (force) return { action: 'update', reason: 'replacing unmanaged path (--force)' };

  return { action: 'conflict', reason: 'path exists and is not managed by Outfitter' };
};

const symlinkStep = (
  harness: HarnessId,
  kind: LinkableKind,
  target: string,
  source: string,
  manifestTargets: ReadonlyMap<string, unknown>,
  force: boolean,
): LinkStep => {
  const { action, reason } = classify(target, manifestTargets.has(target), readLinkTarget(target) === source, force);

  return { harness, kind, action, target, strategy: 'symlink', source, ...(reason === undefined ? {} : { reason }) };
};

const generateStep = (
  harness: HarnessId,
  kind: LinkableKind,
  target: string,
  content: string,
  currentContent: string | undefined,
  manifestTargets: ReadonlyMap<string, unknown>,
  force: boolean,
): LinkStep => {
  const { action, reason } = classify(target, manifestTargets.has(target), currentContent === content, force);

  return { harness, kind, action, target, strategy: 'generate', content, ...(reason === undefined ? {} : { reason }) };
};

/** Reads a file, treating an absent or unreadable path as "no current content". */
const readFileIfPresent = (path: string): string | undefined => {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return undefined;
  }
};

const skillSteps = (
  harness: HarnessId,
  configDirectory: string,
  surface: HarnessSurface,
  sources: readonly LinkSource[],
  manifestTargets: ReadonlyMap<string, unknown>,
  force: boolean,
): readonly LinkStep[] =>
  sources
    .filter((source) => source.kind === 'skills')
    .map((source) =>
      symlinkStep(
        harness,
        'skills',
        join(configDirectory, surface.location, source.slug),
        source.path,
        manifestTargets,
        force,
      ),
    );

const commandSteps = (
  harness: HarnessId,
  configDirectory: string,
  surface: HarnessSurface,
  sources: readonly LinkSource[],
  manifestTargets: ReadonlyMap<string, unknown>,
  force: boolean,
): readonly LinkStep[] =>
  sources
    .filter((source) => source.kind === 'commands')
    .map((source) => {
      if (surface.strategy === 'symlink') {
        /* v8 ignore next -- every symlinked command surface in the registry declares an extension. */
        const fileName = `${source.slug}${surface.extension ?? ''}`;
        return symlinkStep(
          harness,
          'commands',
          join(configDirectory, surface.location, fileName),
          source.path,
          manifestTargets,
          force,
        );
      }

      const body = readFileIfPresent(source.path) ?? '';
      const content = renderGeminiCommand(parseCommandDocument(body, source.path));
      const target = join(configDirectory, surface.location, geminiCommandFileName(source.slug));

      return generateStep(harness, 'commands', target, content, readFileIfPresent(target), manifestTargets, force);
    });

const instructionsSteps = (
  harness: HarnessId,
  configDirectory: string,
  surface: HarnessSurface,
  instructionsPath: string | undefined,
  manifestTargets: ReadonlyMap<string, unknown>,
  force: boolean,
): readonly LinkStep[] =>
  instructionsPath === undefined
    ? []
    : [
        symlinkStep(
          harness,
          'instructions',
          join(configDirectory, surface.location),
          instructionsPath,
          manifestTargets,
          force,
        ),
      ];

/**
 * Hooks are a settings *merge*, not a path Outfitter owns, so the step carries the full resulting
 * document rather than a link. The classify() ownership rule does not apply — the harness settings
 * file is always unmanaged, and the merge preserves everything Outfitter did not generate.
 *
 * The merged document is compared against the file on disk here so an unchanged run reports
 * `unchanged` and writes nothing, rather than rewriting an identical settings.json every time.
 */
const hookSteps = (
  harness: HarnessId,
  configDirectory: string,
  surface: HarnessSurface,
  declarations: readonly HookDeclaration[],
): { readonly steps: readonly LinkStep[]; readonly unsupported: readonly string[] } => {
  if (declarations.length === 0) return { steps: [], unsupported: [] };

  const projection = projectHooks(declarations, harness);
  const target = join(configDirectory, surface.location);
  const unsupported = projection.unsupported.map((message) => `${harness}: ${message}`);
  const current = readFileIfPresent(target);
  const merged = mergeHookSettingsDocument(current, projection.hooks);

  if (merged.content === undefined) {
    return {
      steps: [{ harness, kind: 'hooks', action: 'conflict', target, strategy: 'settings', reason: merged.error }],
      unsupported,
    };
  }

  return {
    steps: [
      {
        harness,
        kind: 'hooks',
        action: merged.content === current ? 'unchanged' : 'update',
        target,
        strategy: 'settings',
        content: merged.content,
      },
    ],
    unsupported,
  };
};

/**
 * Plans removal of every manifest entry, deepest paths first so leaves precede their directories.
 *
 * A `settings` entry is not a path Outfitter may delete — the harness settings file belongs to the
 * user. It becomes a rewrite that strips only Outfitter's marked hook entries, and is skipped
 * entirely when the file has nothing of Outfitter's left in it.
 */
const removalPlan = (manifest: LinkManifest): LinkPlanResult => {
  const steps: LinkStep[] = [];

  for (const entry of manifest.entries) {
    if (entry.strategy !== 'settings') {
      steps.push({
        harness: entry.harness,
        kind: entry.kind,
        action: 'remove',
        target: entry.target,
        strategy: entry.strategy,
        ...(entry.source === undefined ? {} : { source: entry.source }),
      });
      continue;
    }

    const stripped = stripManagedHooks(readFileIfPresent(entry.target));

    if (stripped.error !== undefined) {
      steps.push({ ...settingsStepBase(entry), action: 'conflict', reason: stripped.error });
      continue;
    }

    if (stripped.content !== undefined) {
      steps.push({ ...settingsStepBase(entry), action: 'update', content: stripped.content });
    }
  }

  return {
    steps: steps.sort((left, right) => (left.target < right.target ? 1 : left.target > right.target ? -1 : 0)),
    unsupported: [],
    harnesses: [...new Set(manifest.entries.map((entry) => entry.harness))],
  };
};

const settingsStepBase = (entry: LinkManifest['entries'][number]): Omit<LinkStep, 'action'> => ({
  harness: entry.harness,
  kind: entry.kind,
  target: entry.target,
  strategy: 'settings',
});

/**
 * Reconciles managed targets the current plan no longer produces — a skill deleted from the catalog
 * leaves a dangling link otherwise. Only manifest-recorded paths are touched.
 *
 * A `settings` entry the plan no longer produces means the user removed their hook declarations, so
 * Outfitter's marked entries are stripped from that file rather than the file being deleted.
 */
const prunedSteps = (
  manifest: LinkManifest,
  planned: readonly LinkStep[],
  harnesses: readonly HarnessId[],
): readonly LinkStep[] => {
  const plannedTargets = new Set(planned.map((step) => step.target));
  const steps: LinkStep[] = [];

  for (const entry of manifest.entries) {
    if (!harnesses.includes(entry.harness) || plannedTargets.has(entry.target)) continue;

    if (entry.strategy !== 'settings') {
      steps.push({
        harness: entry.harness,
        kind: entry.kind,
        action: 'remove',
        target: entry.target,
        strategy: entry.strategy,
        reason: 'no longer present in the catalog',
      });
      continue;
    }

    const stripped = stripManagedHooks(readFileIfPresent(entry.target));

    if (stripped.content !== undefined) {
      steps.push({
        ...settingsStepBase(entry),
        action: 'update',
        content: stripped.content,
        reason: 'no hooks are declared any more',
        forget: true,
      });
    }
  }

  return steps;
};

export const planLinks = (input: LinkPlanInput): LinkPlanResult => {
  if (input.remove === true) return removalPlan(input.manifest);

  const harnesses = selectHarnesses(input.settings, input.homeDirectory);
  const manifestTargets = managedTargets(input.manifest);
  const force = input.force === true;
  const steps: LinkStep[] = [];
  const unsupported: string[] = [];

  for (const layout of HARNESS_LAYOUTS.filter((candidate) => harnesses.includes(candidate.id))) {
    const kinds = selectedKinds(layout, input.settings);

    for (const kind of kinds) {
      const surface = findHarnessSurface(layout, kind);

      if (surface === undefined) {
        unsupported.push(`${layout.id}: '${kind}' is not a supported surface`);
        continue;
      }

      for (const configDirectory of configDirectories(layout, input.settings, input.homeDirectory)) {
        if (kind === 'skills') {
          steps.push(...skillSteps(layout.id, configDirectory, surface, input.sources, manifestTargets, force));
        } else if (kind === 'commands') {
          steps.push(...commandSteps(layout.id, configDirectory, surface, input.sources, manifestTargets, force));
        } else if (kind === 'instructions') {
          steps.push(
            ...instructionsSteps(layout.id, configDirectory, surface, input.instructionsPath, manifestTargets, force),
          );
        } else {
          const hooks = hookSteps(layout.id, configDirectory, surface, input.settings.hooks ?? []);
          steps.push(...hooks.steps);
          unsupported.push(...hooks.unsupported);
        }
      }
    }
  }

  return { steps: [...steps, ...prunedSteps(input.manifest, steps, harnesses)], unsupported, harnesses };
};
