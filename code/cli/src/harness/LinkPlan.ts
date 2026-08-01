// Builds the `outfitter link` plan: what would change in each harness config directory, and why.
//
// Planning is separated from applying so `--dry-run` shows exactly what a real run does, and so the
// conflict rules are testable without touching a filesystem beyond inspection. Every decision about
// an existing path is made here; LinkApply only executes.
import { existsSync, lstatSync, readFileSync, readlinkSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';

import {
  collidingCommandSlugs,
  geminiCommandFileName,
  parseCommandDocument,
  renderGeminiCommand,
} from './CommandAdapter.js';
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
  /**
   * Harnesses an explicit `--harness` narrowed the run to. Removal uses it instead of the settings
   * selection: a harness the user has since uninstalled is no longer "detected", but Outfitter's
   * links in its config directory still exist and must still be retired.
   */
  readonly harnessFilter?: readonly HarnessId[];
}

/** Resolves `~`-prefixed and relative config directories against the user's home. */
export const resolveConfiguredDirectory = (configured: string, homeDirectory: string): string => {
  if (configured === '~') return homeDirectory;
  if (configured.startsWith('~/')) return join(homeDirectory, configured.slice(2));

  return isAbsolute(configured) ? configured : resolve(homeDirectory, configured);
};

/**
 * Resolves `harnesses.link` to the harnesses this run provisions.
 *
 * One mechanism, deliberately: `detected` (the default) takes every harness whose config directory
 * already exists, `none` takes nothing, and a list takes exactly what it names. Per-harness
 * overrides tune *how* a selected harness is provisioned, never *whether* it is.
 */
export const selectHarnesses = (settings: HarnessSettings, homeDirectory: string): readonly HarnessId[] => {
  const selection = settings.link ?? 'detected';

  return HARNESS_LAYOUTS.filter((layout) => {
    if (selection === 'none') return false;
    if (selection === 'detected')
      return configDirectories(layout, settings, homeDirectory).some((directory) => existsSync(directory));

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

/** True when the on-disk object is still the kind of thing the recorded strategy created. */
const matchesRecordedKind = (target: string, strategy: HarnessSurface['strategy']): boolean => {
  try {
    const stats = lstatSync(target);
    return strategy === 'symlink' ? stats.isSymbolicLink() : stats.isFile();
  } catch {
    /* v8 ignore next -- callers only reach this after pathExists() succeeded. */
    return false;
  }
};

/**
 * Classifies one target path.
 *
 * Two ownership rules live here. A path Outfitter did not record in the manifest is a `conflict`,
 * even when it happens to already point at the right place — adopting it silently would make
 * `--remove` delete something the user created by hand. And a path Outfitter *did* record is still
 * a conflict once its on-disk kind stops matching what was recorded: taking over a managed link by
 * replacing it with a real directory is a deliberate act, and repointing it would recursively
 * delete that directory's contents.
 */
const classify = (
  target: string,
  isManaged: boolean,
  matches: boolean,
  force: boolean,
  strategy: HarnessSurface['strategy'],
): { readonly action: LinkAction; readonly reason?: string } => {
  if (!pathExists(target)) return { action: 'create' };

  if (force) {
    return isManaged && matches
      ? { action: 'unchanged' }
      : { action: 'update', reason: 'replacing existing path (--force)' };
  }

  if (!isManaged) return { action: 'conflict', reason: 'path exists and is not managed by Outfitter' };

  if (!matchesRecordedKind(target, strategy)) {
    return { action: 'conflict', reason: 'managed path was replaced by a real file or directory' };
  }

  return matches ? { action: 'unchanged' } : { action: 'update' };
};

const symlinkStep = (
  harness: HarnessId,
  kind: LinkableKind,
  target: string,
  source: string,
  manifestTargets: ReadonlyMap<string, unknown>,
  force: boolean,
): LinkStep => {
  const { action, reason } = classify(
    target,
    manifestTargets.has(target),
    readLinkTarget(target) === source,
    force,
    'symlink',
  );

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
  const { action, reason } = classify(
    target,
    manifestTargets.has(target),
    currentContent === content,
    force,
    'generate',
  );

  return { harness, kind, action, target, strategy: 'generate', content, ...(reason === undefined ? {} : { reason }) };
};

/**
 * Reads a file that may legitimately be absent.
 *
 * `absent` and `unreadable` are kept apart deliberately: treating an existing-but-unreadable
 * settings.json as absent would build a fresh document and truncate the user's configuration, which
 * is exactly what OFTR-011.2.9 forbids.
 */
type FileRead =
  | { readonly kind: 'absent' }
  | { readonly kind: 'read'; readonly content: string }
  | { readonly kind: 'unreadable'; readonly message: string };

const readFile = (path: string): FileRead => {
  try {
    return { kind: 'read', content: readFileSync(path, 'utf8') };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { kind: 'absent' };

    return { kind: 'unreadable', message: `could not be read: ${(error as Error).message}` };
  }
};

/** Content of a file that exists and is readable; undefined when it is absent or unreadable. */
const readFileIfPresent = (path: string): string | undefined => {
  const read = readFile(path);
  return read.kind === 'read' ? read.content : undefined;
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
): readonly LinkStep[] => {
  const commands = sources.filter((source) => source.kind === 'commands');

  // Gemini flattens `/` to `.`, so `ks/dev` and `ks.dev` want the same file. Writing both would let
  // whichever runs last silently win, so neither is written and the clash is reported.
  const collisions: ReadonlyMap<string, readonly string[]> =
    surface.strategy === 'generate'
      ? collidingCommandSlugs(commands.map((command) => command.slug))
      : new Map<string, readonly string[]>();
  const collidingSlugs = new Set([...collisions.values()].flat());

  return commands.map((source) => {
    if (collidingSlugs.has(source.slug)) {
      const target = join(configDirectory, surface.location, geminiCommandFileName(source.slug));
      const competing = [...collisions.values()].find((slugs) => slugs.includes(source.slug)) ?? [];

      return {
        harness,
        kind: 'commands' as const,
        action: 'conflict' as const,
        target,
        strategy: surface.strategy,
        reason: `commands ${competing.map((slug) => `'${slug}'`).join(' and ')} both generate this file`,
      };
    }

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

    const target = join(configDirectory, surface.location, geminiCommandFileName(source.slug));
    const body = readFile(source.path);

    // Rendering an empty prompt would overwrite a previously good generated command with nothing.
    if (body.kind !== 'read') {
      return {
        harness,
        kind: 'commands' as const,
        action: 'conflict' as const,
        target,
        strategy: 'generate' as const,
        reason: `command source '${source.path}' ${body.kind === 'absent' ? 'no longer exists' : body.message}`,
      };
    }

    const content = renderGeminiCommand(parseCommandDocument(body.content, source.path));

    return generateStep(harness, 'commands', target, content, readFileIfPresent(target), manifestTargets, force);
  });
};

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

  // Every declaration was unsupported for this harness. Writing `"hooks": {}` and claiming the
  // settings file would be a change Outfitter made for no reason; pruning still retires any
  // entries a previous run left behind.
  if (Object.keys(projection.hooks).length === 0) return { steps: [], unsupported };

  const read = readFile(target);

  if (read.kind === 'unreadable') {
    return {
      steps: [{ harness, kind: 'hooks', action: 'conflict', target, strategy: 'settings', reason: read.message }],
      unsupported,
    };
  }

  const current = read.kind === 'read' ? read.content : undefined;
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
const removalPlan = (manifest: LinkManifest, harnesses: readonly HarnessId[]): LinkPlanResult => {
  const entries = manifest.entries.filter((entry) => harnesses.includes(entry.harness));
  const steps = entries.flatMap((entry) => retireEntry(entry, undefined));

  return {
    steps: [...steps].sort((left, right) => (left.target < right.target ? 1 : left.target > right.target ? -1 : 0)),
    unsupported: [],
    harnesses: [...new Set(entries.map((entry) => entry.harness))],
  };
};

/**
 * Turns one manifest entry into the step that stops Outfitter managing it.
 *
 * Shared by `--remove` and by pruning, so the settings-entry policy — strip Outfitter's marked hook
 * entries, never delete the file, and report a document that cannot be parsed — is written once.
 * Returning an empty array means there is nothing left to do for that entry.
 */
const retireEntry = (entry: LinkManifest['entries'][number], reason: string | undefined): readonly LinkStep[] =>
  entry.strategy === 'settings' ? retireSettingsEntry(entry, reason) : retirePathEntry(entry, reason);

const retirePathEntry = (entry: LinkManifest['entries'][number], reason: string | undefined): readonly LinkStep[] => {
  {
    // Same ownership rule as reconciliation: a managed path the user has taken over by replacing it
    // with a real file or directory is theirs now, and retiring it must not delete their work.
    if (pathExists(entry.target) && !matchesRecordedKind(entry.target, entry.strategy)) {
      return [
        {
          harness: entry.harness,
          kind: entry.kind,
          action: 'conflict',
          target: entry.target,
          strategy: entry.strategy,
          reason: 'managed path was replaced by a real file or directory',
        },
      ];
    }

    return [
      {
        harness: entry.harness,
        kind: entry.kind,
        action: 'remove',
        target: entry.target,
        strategy: entry.strategy,
        ...(entry.source === undefined ? {} : { source: entry.source }),
        ...(reason === undefined ? {} : { reason }),
      },
    ];
  }
};

const retireSettingsEntry = (
  entry: LinkManifest['entries'][number],
  reason: string | undefined,
): readonly LinkStep[] => {
  const read = readFile(entry.target);

  if (read.kind === 'unreadable') {
    return [{ ...settingsStepBase(entry), action: 'conflict', reason: read.message }];
  }

  const stripped = stripManagedHooks(read.kind === 'read' ? read.content : undefined);

  if (stripped.error !== undefined) {
    return [{ ...settingsStepBase(entry), action: 'conflict', reason: stripped.error }];
  }

  // Nothing of Outfitter's is left in the document, but the entry still claims otherwise. Forget it
  // without rewriting the file, so `--remove` can actually finish and drop the manifest.
  if (stripped.content === undefined) {
    return [
      {
        ...settingsStepBase(entry),
        action: 'unchanged',
        forget: true,
        ...(reason === undefined ? {} : { reason }),
      },
    ];
  }

  return [
    {
      ...settingsStepBase(entry),
      action: 'update',
      content: stripped.content,
      forget: true,
      ...(reason === undefined ? {} : { reason }),
    },
  ];
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

  return manifest.entries
    .filter((entry) => harnesses.includes(entry.harness) && !plannedTargets.has(entry.target))
    .flatMap((entry) =>
      retireEntry(
        entry,
        entry.strategy === 'settings' ? 'no hooks are declared any more' : 'no longer present in the catalog',
      ),
    );
};

/** Context threaded through surface planning, so the per-kind dispatch stays a lookup. */
interface SurfaceContext {
  readonly input: LinkPlanInput;
  readonly manifestTargets: ReadonlyMap<string, unknown>;
  readonly force: boolean;
}

/** Plans one harness surface in one config directory. Hooks also report untranslatable events. */
const surfaceSteps = (
  layout: HarnessLayout,
  surface: HarnessSurface,
  configDirectory: string,
  context: SurfaceContext,
): { readonly steps: readonly LinkStep[]; readonly unsupported: readonly string[] } => {
  const { input, manifestTargets, force } = context;

  if (surface.kind === 'skills') {
    return {
      steps: skillSteps(layout.id, configDirectory, surface, input.sources, manifestTargets, force),
      unsupported: [],
    };
  }

  if (surface.kind === 'commands') {
    return {
      steps: commandSteps(layout.id, configDirectory, surface, input.sources, manifestTargets, force),
      unsupported: [],
    };
  }

  if (surface.kind === 'instructions') {
    return {
      steps: instructionsSteps(layout.id, configDirectory, surface, input.instructionsPath, manifestTargets, force),
      unsupported: [],
    };
  }

  return hookSteps(layout.id, configDirectory, surface, input.settings.hooks ?? []);
};

/** Plans every selected kind for one harness, across each of its configured directories. */
const harnessSteps = (
  layout: HarnessLayout,
  context: SurfaceContext,
): { readonly steps: readonly LinkStep[]; readonly unsupported: readonly string[] } => {
  const steps: LinkStep[] = [];
  const unsupported: string[] = [];

  for (const kind of selectedKinds(layout, context.input.settings)) {
    const surface = findHarnessSurface(layout, kind);

    if (surface === undefined) {
      unsupported.push(`${layout.id}: '${kind}' is not a supported surface`);
      continue;
    }

    for (const configDirectory of configDirectories(layout, context.input.settings, context.input.homeDirectory)) {
      const planned = surfaceSteps(layout, surface, configDirectory, context);
      steps.push(...planned.steps);
      unsupported.push(...planned.unsupported);
    }
  }

  return { steps, unsupported };
};

export const planLinks = (input: LinkPlanInput): LinkPlanResult => {
  const harnesses = selectHarnesses(input.settings, input.homeDirectory);

  // `--remove` retires only the harnesses `--harness` named, so `--harness gemini --remove` cannot
  // unlink Claude and Codex as a side effect. Without the flag it retires everything the manifest
  // records — including a harness the user has since uninstalled, whose directory is no longer
  // "detected" but whose links are still on disk.
  if (input.remove === true) {
    const scope = input.harnessFilter ?? [...new Set(input.manifest.entries.map((entry) => entry.harness))];
    return removalPlan(input.manifest, scope);
  }

  const context: SurfaceContext = {
    input,
    manifestTargets: managedTargets(input.manifest),
    force: input.force === true,
  };
  const planned = HARNESS_LAYOUTS.filter((layout) => harnesses.includes(layout.id)).map((layout) =>
    harnessSteps(layout, context),
  );
  const steps = planned.flatMap((entry) => entry.steps);

  return {
    steps: [...steps, ...prunedSteps(input.manifest, steps, harnesses)],
    unsupported: planned.flatMap((entry) => entry.unsupported),
    harnesses,
  };
};
