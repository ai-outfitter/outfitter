// Discovers and snapshots portable hooks from the active workspace only. A composition receives
// file bytes instead of source paths, so later workspace edits cannot change an active launch.
import { lstatSync, readFileSync, readdirSync } from 'node:fs';
import { join, posix, relative, resolve, sep } from 'node:path';

import { compareSlugs } from '../resolver/Resource.js';
import { formatValidationIssues, validateSchema } from '../validation/SchemaValidator.js';
import { parseYamlDocument } from '../validation/YamlDocument.js';

export type WorkspaceHookEventName = 'stop';

export interface WorkspaceHookCommand {
  readonly command: string;
  readonly args: readonly string[];
  readonly timeoutSeconds: number;
}

export interface WorkspaceHookFile {
  /** Portable, slash-separated path below the hook package root. */
  readonly path: string;
  readonly content: Uint8Array;
  readonly mode: number;
}

export interface WorkspaceHookSnapshot {
  readonly slug: string;
  readonly name: string;
  readonly description: string;
  readonly events: Readonly<Partial<Record<WorkspaceHookEventName, WorkspaceHookCommand>>>;
  readonly files: readonly WorkspaceHookFile[];
}

export interface WorkspaceHooksSnapshot {
  readonly workspaceDirectory: string;
  readonly hooks: readonly WorkspaceHookSnapshot[];
}

interface WorkspaceHookDocument {
  readonly version: 1;
  readonly name: string;
  readonly description: string;
  readonly events: Readonly<
    Partial<
      Record<
        WorkspaceHookEventName,
        { readonly command: string; readonly args: readonly string[]; readonly timeout_seconds: number }
      >
    >
  >;
}

const slugPattern = /^[a-z0-9][a-z0-9-]*$/u;

const assertDirectory = (path: string, label: string): void => {
  const entry = lstatSync(path, { throwIfNoEntry: false });
  if (entry?.isSymbolicLink()) throw new Error(`Invalid workspace hooks: ${label} '${path}' must not be a symlink.`);
  if (entry?.isDirectory() !== true)
    throw new Error(`Invalid workspace hooks: ${label} '${path}' must be a directory.`);
};

const snapshotDirectory = (root: string, directory: string, files: WorkspaceHookFile[]): void => {
  const entries = readdirSync(directory, { withFileTypes: true }).sort((left, right) =>
    compareSlugs(left.name, right.name),
  );

  for (const entry of entries) {
    const path = join(directory, entry.name);
    const stat = lstatSync(path);
    const portablePath = relative(root, path).split(sep).join('/');
    if (stat.isSymbolicLink()) {
      throw new Error(`Invalid workspace hook package '${root}': '${portablePath}' must not be a symlink.`);
    }
    if (stat.isDirectory()) {
      snapshotDirectory(root, path, files);
    } else if (stat.isFile()) {
      files.push({ path: portablePath, content: readFileSync(path), mode: stat.mode & 0o777 });
    } else {
      throw new Error(`Invalid workspace hook package '${root}': '${portablePath}' must be a regular file.`);
    }
  }
};

const readDocument = (manifestPath: string): WorkspaceHookDocument => {
  const parsed = parseYamlDocument(readFileSync(manifestPath, 'utf8'), manifestPath);
  if (!parsed.ok) throw new Error(`Invalid workspace hook '${manifestPath}': ${parsed.issue.message}`);
  const validation = validateSchema('workspace-hook', parsed.document);
  if (!validation.valid) {
    throw new Error(`Invalid workspace hook: ${formatValidationIssues(manifestPath, validation.issues)}`);
  }
  return parsed.document as WorkspaceHookDocument;
};

/** Maps a `./`-relative manifest command onto its portable package-relative path. */
const resolveCommandPath = (command: string): string => {
  const portable = posix.normalize(command.slice(2));
  if (portable === '.' || portable === '..' || portable.startsWith('../') || posix.isAbsolute(portable)) {
    throw new Error(`Invalid workspace hook command '${command}': command must stay inside the hook package.`);
  }
  return portable;
};

const readEvents = (
  slug: string,
  document: WorkspaceHookDocument,
  files: readonly WorkspaceHookFile[],
): Readonly<Partial<Record<WorkspaceHookEventName, WorkspaceHookCommand>>> => {
  const events: Partial<Record<WorkspaceHookEventName, WorkspaceHookCommand>> = {};
  for (const [eventName, command] of Object.entries(document.events) as [
    WorkspaceHookEventName,
    NonNullable<WorkspaceHookDocument['events']['stop']>,
  ][]) {
    const portable = resolveCommandPath(command.command);
    const commandFile = files.find((file) => file.path === portable);
    if (commandFile === undefined) {
      throw new Error(`Invalid workspace hook '${slug}': command '${command.command}' must name a regular file.`);
    }
    if ((commandFile.mode & 0o111) === 0) {
      throw new Error(`Invalid workspace hook '${slug}': command '${command.command}' must be executable.`);
    }
    events[eventName] = {
      command: portable,
      args: [...command.args],
      timeoutSeconds: command.timeout_seconds,
    };
  }
  return events;
};

const readHook = (hookDirectory: string, slug: string): WorkspaceHookSnapshot => {
  assertDirectory(hookDirectory, `hook '${slug}'`);
  const manifestPath = join(hookDirectory, 'hook.yml');
  const manifestStat = lstatSync(manifestPath, { throwIfNoEntry: false });
  if (manifestStat?.isSymbolicLink()) {
    throw new Error(`Invalid workspace hook '${slug}': '${manifestPath}' must not be a symlink.`);
  }
  if (manifestStat?.isFile() !== true) {
    throw new Error(`Invalid workspace hook '${slug}': '${manifestPath}' must be a regular file.`);
  }

  const document = readDocument(manifestPath);
  if (document.name !== slug) {
    throw new Error(`Invalid workspace hook '${slug}': manifest name '${document.name}' must match its directory.`);
  }

  const files: WorkspaceHookFile[] = [];
  snapshotDirectory(hookDirectory, hookDirectory, files);
  const events = readEvents(slug, document, files);

  return { slug, name: document.name, description: document.description, events, files };
};

/** Reads only `<workspace>/.agents/hooks/<slug>/hook.yml`, in deterministic slug order. */
export const readWorkspaceHooks = (workspaceDirectory: string): WorkspaceHooksSnapshot => {
  const hooksDirectory = join(workspaceDirectory, '.agents', 'hooks');
  const rootStat = lstatSync(hooksDirectory, { throwIfNoEntry: false });
  if (rootStat === undefined) return { workspaceDirectory: resolve(workspaceDirectory), hooks: [] };
  assertDirectory(hooksDirectory, 'directory');

  const hooks = readdirSync(hooksDirectory, { withFileTypes: true })
    .sort((left, right) => compareSlugs(left.name, right.name))
    .map((entry) => {
      if (!slugPattern.test(entry.name)) {
        throw new Error(`Invalid workspace hook slug '${entry.name}'. Use lowercase letters, digits, and hyphens.`);
      }
      return readHook(join(hooksDirectory, entry.name), entry.name);
    });

  return { workspaceDirectory: resolve(workspaceDirectory), hooks };
};
