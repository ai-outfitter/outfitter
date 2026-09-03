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
import { parse as parseToml, stringify as stringifyToml } from 'smol-toml';

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

const firstLine = (output: string): string => output.split('\n')[0];

const conflict = (detail: string): Reconciliation => ({ status: 'conflict', detail });

type SettingsDocument = Record<string, unknown>;

const settingLocation = (home: string, entry: LinkEntry): string => join(home, entry.setting!.file);

const readSettingsDocument = (path: string, file: string): SettingsDocument => {
  if (!existsSync(path)) return {};
  const parsed: unknown = file.endsWith('.toml')
    ? parseToml(readFileSync(path, 'utf8'))
    : JSON.parse(readFileSync(path, 'utf8'));
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed))
    throw new Error('settings document is not an object');
  return parsed as SettingsDocument;
};

const writeSettingsDocument = (path: string, file: string, document: SettingsDocument): void => {
  mkdirSync(dirname(path), { recursive: true });
  const content = file.endsWith('.toml') ? stringifyToml(document) : `${JSON.stringify(document, null, 2)}\n`;
  writeFileSync(path, content);
};

const valueAt = (document: SettingsDocument, keys: readonly string[]): unknown => {
  let value: unknown = document;
  for (const key of keys) {
    if (value === null || typeof value !== 'object' || Array.isArray(value) || !Object.hasOwn(value, key))
      return undefined;
    value = (value as Record<string, unknown>)[key];
  }
  return value;
};

const setValueAt = (document: SettingsDocument, keys: readonly string[], value: unknown): void => {
  let parent = document;
  for (const key of keys.slice(0, -1)) {
    const child = parent[key];
    if (child === null || typeof child !== 'object' || Array.isArray(child)) parent[key] = {};
    parent = parent[key] as SettingsDocument;
  }
  parent[keys.at(-1)!] = value;
};

const deleteValueAt = (document: SettingsDocument, keys: readonly string[]): void => {
  const parents: { parent: SettingsDocument; key: string }[] = [];
  let parent = document;
  for (const key of keys.slice(0, -1)) {
    const child = parent[key];
    if (child === null || typeof child !== 'object' || Array.isArray(child)) return;
    parents.push({ parent, key });
    parent = child as SettingsDocument;
  }
  delete parent[keys.at(-1)!];
  for (const item of parents.reverse()) {
    const value = item.parent[item.key];
    if (value !== null && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 0)
      delete item.parent[item.key];
    else break;
  }
};

const equalSetting = (left: unknown, right: unknown): boolean => JSON.stringify(left) === JSON.stringify(right);

const reconcileSetting = (home: string, entry: LinkEntry, previous: ManifestEntry | undefined): Reconciliation => {
  const { file, keys, value } = entry.setting!;
  const path = settingLocation(home, entry);
  let document: SettingsDocument;
  try {
    document = readSettingsDocument(path, file);
  } catch (error) {
    return conflict(`cannot parse ${file}: ${error instanceof Error ? error.message : String(error)}`);
  }
  const current = valueAt(document, keys);
  const mutate = (): void => {
    setValueAt(document, keys, value);
    writeSettingsDocument(path, file, document);
  };
  if (current === undefined) return { status: 'created', mutate };
  if (equalSetting(current, value)) return { status: 'unchanged' };
  if (previous === undefined) return conflict('an unmanaged native setting already exists here');
  const prior: unknown = previous.target === undefined ? undefined : JSON.parse(previous.target);
  return equalSetting(current, prior)
    ? { status: 'updated', mutate }
    : conflict('the previously managed native setting was changed outside Outfitter');
};

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
  previous: ManifestEntry | undefined,
  run: HarnessCommandRunner,
): Reconciliation => {
  if (entry.kind === 'mcp') return reconcileMcp(plan.harness, entry, run);
  if (entry.kind === 'setting') return reconcileSetting(home, entry, previous);
  const ancestor = symlinkedAncestor(home, entry.path);
  if (ancestor !== undefined) {
    return conflict(`'${ancestor}' is an unmanaged symlink; unlink it to let outfitter manage its entries`);
  }
  return entry.kind === 'symlink'
    ? reconcileSymlink(home, entry, previous !== undefined)
    : reconcileFile(home, entry, previous !== undefined);
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
  const managedEntries = new Map(manifest.entries.map((entry) => [entry.path, entry]));
  const planned = new Set(plan.entries.map((entry) => entry.path));

  const actions = plan.entries.map((entry) =>
    apply(entry, reconcile(plan, home, entry, managedEntries.get(entry.path), run), dryRun),
  );
  const stale = manifest.entries.filter((entry) => !planned.has(entry.path));
  const pruned = pruneDangling(home, stale, dryRun);
  const prunedPaths = new Set(pruned.map((action) => action.entry.path));

  if (!dryRun) {
    const entries: ManifestEntry[] = [
      ...stale.filter((entry) => !prunedPaths.has(entry.path)),
      ...actions
        .filter(
          (action) => isManagedNow(action) && (action.status !== 'unchanged' || managedEntries.has(action.entry.path)),
        )
        .map(({ entry }) => ({
          kind: entry.kind,
          path: entry.path,
          ...(entry.target === undefined ? {} : { target: entry.target }),
          ...(entry.kind === 'setting' ? { target: JSON.stringify(entry.setting!.value) } : {}),
        })),
    ];
    writeManifest(home, { version: 1, harness: plan.harness, entries });
  }
  return { actions: [...actions, ...pruned] };
};

const removeSetting = (home: string, previous: ManifestEntry, entry: LinkEntry): LinkAction => {
  const [, file, encodedKeys] = previous.path.split(':');
  const keys = encodedKeys.split('/').map(decodeURIComponent);
  const path = join(home, file);
  let document: SettingsDocument;
  try {
    document = readSettingsDocument(path, file);
  } catch (error) {
    return { entry, status: 'skipped', detail: error instanceof Error ? error.message : String(error) };
  }
  const expected: unknown = previous.target === undefined ? undefined : JSON.parse(previous.target);
  const current = valueAt(document, keys);
  if (current === undefined) return { entry, status: 'removed' };
  if (!equalSetting(current, expected))
    return { entry, status: 'skipped', detail: 'native setting no longer matches the managed value' };
  deleteValueAt(document, keys);
  writeSettingsDocument(path, file, document);
  return { entry, status: 'removed' };
};

const removeMcp = (
  harness: LinkHarness,
  previous: ManifestEntry,
  entry: LinkEntry,
  run: HarnessCommandRunner,
): LinkAction => {
  const result = run(harness, mcpRemoveArgs(harness, previous.path.slice('mcp:'.length)));
  if (!result.found) return { entry, status: 'skipped', detail: `${harness} CLI not found on PATH` };
  return result.ok ? { entry, status: 'removed' } : { entry, status: 'skipped', detail: result.output };
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
  if (previous.kind === 'mcp') return removeMcp(harness, previous, entry, run);
  if (previous.kind === 'setting') return removeSetting(home, previous, entry);
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
    (entry, index) =>
      actions[index].status === 'skipped' &&
      (entry.kind === 'setting' || actions[index].detail?.includes('CLI not found') === true),
  );
  writeManifest(home, { version: 1, harness, entries: remaining });
  for (const container of ['skills', 'agents', 'commands', 'prompts']) {
    const directory = join(home, container);
    if (existsSync(directory) && !isSymlink(directory) && readdirSync(directory).length === 0) rmdirSync(directory);
  }
  return { actions };
};
