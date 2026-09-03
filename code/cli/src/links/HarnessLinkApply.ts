// Reconciles a harness link plan against the harness home without touching anything unmanaged.
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  readdirSync,
  rmSync,
  rmdirSync,
  statSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import type { LinkHarness } from './HarnessHome.js';
import { mcpAddArgs, mcpGetArgs, mcpRemoveArgs } from './HarnessMcp.js';
import type { HarnessLinkPlan, LinkEntry } from './HarnessLinkPlan.js';

export type LinkStatus = 'created' | 'updated' | 'unchanged' | 'conflict' | 'skipped' | 'removed' | 'pruned';

export interface LinkAction {
  readonly entry: LinkEntry;
  readonly status: LinkStatus;
  readonly detail?: string;
}

export interface HarnessCommandResult {
  /** False when the harness CLI is not installed on PATH. */
  readonly found: boolean;
  readonly ok: boolean;
  readonly output: string;
}

export type HarnessCommandRunner = (harness: LinkHarness, args: readonly string[]) => HarnessCommandResult;

/* v8 ignore start -- spawning the real harness CLI is exercised by smoke tests; unit tests inject a runner. */
export const spawnHarnessCommand: HarnessCommandRunner = (harness, args) => {
  const result = spawnSync(harness, [...args], { encoding: 'utf8', timeout: 30_000 });
  const missing = result.error !== undefined && 'code' in result.error && result.error.code === 'ENOENT';
  return { found: !missing, ok: result.status === 0, output: `${result.stdout ?? ''}${result.stderr ?? ''}`.trim() };
};
/* v8 ignore stop */

interface ManifestEntry {
  readonly kind: LinkEntry['kind'];
  readonly path: string;
  readonly target?: string;
}

interface LinkManifest {
  readonly version: 1;
  readonly harness: LinkHarness;
  readonly entries: readonly ManifestEntry[];
}

const manifestPath = (home: string): string => join(home, '.outfitter', 'links.json');

const readManifest = (home: string, harness: LinkHarness): LinkManifest => {
  const path = manifestPath(home);
  if (!existsSync(path)) return { version: 1, harness, entries: [] };
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as Partial<LinkManifest>;
    return { version: 1, harness, entries: Array.isArray(parsed.entries) ? parsed.entries : [] };
  } catch {
    return { version: 1, harness, entries: [] };
  }
};

const writeManifest = (home: string, manifest: LinkManifest): void => {
  const path = manifestPath(home);
  if (manifest.entries.length === 0) {
    rmSync(path, { force: true });
    try {
      rmdirSync(dirname(path));
    } catch {
      // The directory is absent or holds other files; either way it is not ours to remove.
    }
    return;
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`);
};

const isSymlink = (path: string): boolean => {
  try {
    return lstatSync(path).isSymbolicLink();
  } catch {
    return false;
  }
};

const directoryTarget = (path: string): boolean => {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
};

const isRegularFile = (path: string): boolean => {
  try {
    return lstatSync(path).isFile();
  } catch {
    return false;
  }
};

/** A managed leaf must never be created through a link the user owns, so every ancestor is checked. */
const symlinkedAncestor = (home: string, relativePath: string): string | undefined => {
  const segments = relativePath.split('/').slice(0, -1);
  for (let depth = 1; depth <= segments.length; depth += 1) {
    const ancestor = segments.slice(0, depth).join('/');
    if (isSymlink(join(home, ancestor))) return ancestor;
  }
  return undefined;
};

interface Reconciliation {
  readonly status: LinkStatus;
  readonly detail?: string;
  readonly mutate?: () => void;
}

const firstLine = (output: string): string => output.split('\n')[0] ?? '';

const conflict = (detail: string): Reconciliation => ({ status: 'conflict', detail });

const reconcileSymlink = (home: string, entry: LinkEntry, managed: boolean): Reconciliation => {
  const path = join(home, entry.path);
  const target = entry.target!;
  const create = (): void => {
    mkdirSync(dirname(path), { recursive: true });
    // Windows needs the link type up front; a junction to a directory needs no privilege.
    symlinkSync(target, path, directoryTarget(target) ? (process.platform === 'win32' ? 'junction' : 'dir') : 'file');
  };
  if (!existsSync(path) && !isSymlink(path)) return { status: 'created', mutate: create };
  if (!isSymlink(path)) return conflict('an unmanaged file or directory already exists here');
  const current = resolve(dirname(path), readlinkSync(path));
  if (current === resolve(target)) return { status: 'unchanged' };
  if (!managed) return conflict(`an unmanaged symlink to ${current} already exists here`);
  return {
    status: 'updated',
    mutate: () => {
      unlinkSync(path);
      create();
    },
  };
};

const reconcileFile = (home: string, entry: LinkEntry, managed: boolean): Reconciliation => {
  const path = join(home, entry.path);
  const write = (): void => {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, entry.content!);
  };
  if (!existsSync(path) && !isSymlink(path)) return { status: 'created', mutate: write };
  if (!isRegularFile(path)) return conflict('an unmanaged symlink or directory already exists here');
  if (readFileSync(path, 'utf8') === entry.content) return { status: 'unchanged' };
  if (!managed) return conflict('an unmanaged file already exists here');
  return { status: 'updated', mutate: write };
};

const reconcileMcp = (harness: LinkHarness, entry: LinkEntry, run: HarnessCommandRunner): Reconciliation => {
  const { id, server } = entry.mcp!;
  const add = mcpAddArgs(harness, id, server);
  if (add.args === undefined) return { status: 'skipped', detail: add.warnings.join(' ') };
  const existing = run(harness, mcpGetArgs(id));
  if (!existing.found) return { status: 'skipped', detail: `${harness} CLI not found on PATH` };
  if (existing.ok) return { status: 'unchanged', detail: `already configured in ${harness}` };
  const detail = add.warnings.length === 0 ? undefined : add.warnings.join(' ');
  return {
    status: 'created',
    detail,
    mutate: () => {
      const added = run(harness, add.args!);
      // Codex may register the server and then fail a follow-up login; a registered server is a
      // success worth owning, so the post-add state decides rather than the exit code alone.
      if (!added.ok && !run(harness, mcpGetArgs(id)).ok) throw new Error(firstLine(added.output));
    },
  };
};

const reconcile = (
  plan: HarnessLinkPlan,
  home: string,
  entry: LinkEntry,
  managed: boolean,
  run: HarnessCommandRunner,
): Reconciliation => {
  if (entry.kind === 'mcp') return reconcileMcp(plan.harness, entry, run);
  const ancestor = symlinkedAncestor(home, entry.path);
  if (ancestor !== undefined) {
    return conflict(`'${ancestor}' is an unmanaged symlink; unlink it to let outfitter manage its entries`);
  }
  return entry.kind === 'symlink' ? reconcileSymlink(home, entry, managed) : reconcileFile(home, entry, managed);
};

const apply = (entry: LinkEntry, reconciliation: Reconciliation, dryRun: boolean): LinkAction => {
  if (dryRun || reconciliation.mutate === undefined) {
    return { entry, status: reconciliation.status, detail: reconciliation.detail };
  }
  try {
    reconciliation.mutate();
    return { entry, status: reconciliation.status, detail: reconciliation.detail };
  } catch (error) {
    return { entry, status: 'skipped', detail: error instanceof Error ? error.message : String(error) };
  }
};

const isManagedNow = (action: LinkAction): boolean =>
  action.status === 'created' || action.status === 'updated' || action.status === 'unchanged';

/** A managed symlink whose target vanished is pruned; anything else outside the plan is left alone. */
const pruneDangling = (home: string, stale: readonly ManifestEntry[], dryRun: boolean): readonly LinkAction[] =>
  stale.flatMap((previous) => {
    const path = join(home, previous.path);
    if (previous.kind !== 'symlink' || !isSymlink(path) || existsSync(path)) return [];
    if (!dryRun) unlinkSync(path);
    const entry: LinkEntry = { kind: 'symlink', path: previous.path, target: previous.target, resource: previous.path };
    return [{ entry, status: 'pruned' as const, detail: 'target no longer exists' }];
  });

export interface ApplyLinksOptions {
  readonly dryRun?: boolean;
}

export interface ApplyLinksResult {
  readonly actions: readonly LinkAction[];
}

/** Applies the plan idempotently, records ownership, and never rewrites anything it does not own. */
export const applyHarnessLinks = (
  plan: HarnessLinkPlan,
  home: string,
  options: ApplyLinksOptions = {},
  run: HarnessCommandRunner = spawnHarnessCommand,
): ApplyLinksResult => {
  const dryRun = options.dryRun === true;
  if (!dryRun) mkdirSync(home, { recursive: true });
  const manifest = readManifest(home, plan.harness);
  const managedPaths = new Set(manifest.entries.map((entry) => entry.path));
  const planned = new Set(plan.entries.map((entry) => entry.path));

  const actions = plan.entries.map((entry) =>
    apply(entry, reconcile(plan, home, entry, managedPaths.has(entry.path), run), dryRun),
  );
  const stale = manifest.entries.filter((entry) => !planned.has(entry.path));
  const pruned = pruneDangling(home, stale, dryRun);
  const prunedPaths = new Set(pruned.map((action) => action.entry.path));

  if (!dryRun) {
    const entries: ManifestEntry[] = [
      ...stale.filter((entry) => !prunedPaths.has(entry.path)),
      ...actions
        .filter(
          (action) =>
            isManagedNow(action) &&
            (action.status !== 'unchanged' || action.entry.kind !== 'mcp' || managedPaths.has(action.entry.path)),
        )
        .map(({ entry }) => ({
          kind: entry.kind,
          path: entry.path,
          ...(entry.target === undefined ? {} : { target: entry.target }),
        })),
    ];
    writeManifest(home, { version: 1, harness: plan.harness, entries });
  }
  return { actions: [...actions, ...pruned] };
};

const removeEntry = (
  harness: LinkHarness,
  home: string,
  previous: ManifestEntry,
  run: HarnessCommandRunner,
): LinkAction => {
  const entry: LinkEntry = {
    kind: previous.kind,
    path: previous.path,
    target: previous.target,
    resource: previous.path,
  };
  if (previous.kind === 'mcp') {
    const result = run(harness, mcpRemoveArgs(harness, previous.path.slice('mcp:'.length)));
    if (!result.found) return { entry, status: 'skipped', detail: `${harness} CLI not found on PATH` };
    return result.ok ? { entry, status: 'removed' } : { entry, status: 'skipped', detail: result.output };
  }
  const path = join(home, previous.path);
  const owned = previous.kind === 'symlink' ? isSymlink(path) : isRegularFile(path);
  if (!owned) return { entry, status: 'skipped', detail: 'no longer a managed entry' };
  unlinkSync(path);
  return { entry, status: 'removed' };
};

/** Removes exactly what the manifest records and forgets it; unmanaged neighbors are untouched. */
export const removeHarnessLinks = (
  harness: LinkHarness,
  home: string,
  run: HarnessCommandRunner = spawnHarnessCommand,
): ApplyLinksResult => {
  const manifest = readManifest(home, harness);
  const actions = manifest.entries.map((entry) => removeEntry(harness, home, entry, run));
  const remaining = manifest.entries.filter(
    (entry, index) => actions[index].status === 'skipped' && actions[index].detail?.includes('CLI not found'),
  );
  writeManifest(home, { version: 1, harness, entries: remaining });
  for (const container of ['skills', 'agents', 'commands', 'prompts']) {
    const directory = join(home, container);
    if (existsSync(directory) && !isSymlink(directory) && readdirSync(directory).length === 0) rmdirSync(directory);
  }
  return { actions };
};
