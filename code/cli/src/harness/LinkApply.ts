// Executes a link plan and records what it created.
//
// Everything here is deliberately mechanical: LinkPlan already decided which paths are safe to
// touch, so apply never re-derives ownership. A step whose action is `conflict` or `unchanged`
// writes nothing, which is what makes repeated runs idempotent.
import { mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

import type { LinkPlanResult, LinkStep } from './LinkPlan.js';
import type { LinkManifest, ManifestEntry } from './LinkManifest.js';
import { MANIFEST_VERSION } from './LinkManifest.js';

export interface ApplyResult {
  readonly manifest: LinkManifest;
  readonly created: number;
  readonly updated: number;
  readonly removed: number;
  readonly unchanged: number;
  readonly conflicts: readonly LinkStep[];
}

/** Replaces a path with a symlink. `rmSync` first so a stale link or file cannot block creation. */
const writeSymlink = (target: string, source: string): void => {
  mkdirSync(dirname(target), { recursive: true });
  rmSync(target, { recursive: true, force: true });
  symlinkSync(source, target);
};

/**
 * Writes a file Outfitter owns. `rmSync` first, because a target that is currently a directory or
 * a symlink cannot be overwritten by a plain write.
 */
const writeGenerated = (target: string, content: string): void => {
  mkdirSync(dirname(target), { recursive: true });
  rmSync(target, { recursive: true, force: true });
  writeFileSync(target, content, 'utf8');
};

/**
 * Writes a harness settings document Outfitter merged into but does not own.
 *
 * Deliberately does NOT unlink first. `~/.claude/settings.json` is frequently a symlink into a
 * dotfiles repo, a stow target, or a home-manager generation; unlinking it would silently detach
 * the user's configuration management and orphan the real file. `writeFileSync` follows the link
 * and updates the file the user actually maintains.
 */
const writeSettingsDocument = (target: string, content: string): void => {
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, content, 'utf8');
};

const toManifestEntry = (step: LinkStep): ManifestEntry => ({
  target: step.target,
  harness: step.harness,
  kind: step.kind,
  strategy: step.strategy,
  ...(step.source === undefined ? {} : { source: step.source }),
});

export interface ApplyOptions {
  /** Report what would happen without writing anything. */
  readonly dryRun?: boolean;
  readonly writeLine?: (message: string) => void;
}

export const applyLinkPlan = (
  plan: LinkPlanResult,
  previous: LinkManifest,
  options: ApplyOptions = {},
): ApplyResult => {
  const dryRun = options.dryRun === true;
  const entries = new Map(previous.entries.map((entry) => [entry.target, entry]));
  const conflicts: LinkStep[] = [];
  let created = 0;
  let updated = 0;
  let removed = 0;
  let unchanged = 0;

  for (const step of plan.steps) {
    if (step.action === 'conflict') {
      conflicts.push(step);
      continue;
    }

    if (step.action === 'unchanged') {
      unchanged += 1;
      continue;
    }

    if (step.action === 'remove') {
      if (!dryRun) rmSync(step.target, { recursive: true, force: true });
      entries.delete(step.target);
      removed += 1;
      continue;
    }

    if (!dryRun) applyStep(step);

    // A `settings` entry records that Outfitter merged into a file it does not own, so `--remove`
    // knows where to strip its marked hook entries. It never authorizes deleting that file — see
    // the `remove` branch above, which only ever runs for path-owning strategies.
    if (step.forget === true) entries.delete(step.target);
    else entries.set(step.target, toManifestEntry(step));

    if (step.action === 'create') created += 1;
    else updated += 1;
  }

  return {
    manifest: { version: MANIFEST_VERSION, entries: [...entries.values()] },
    created,
    updated,
    removed,
    unchanged,
    conflicts,
  };
};

const applyStep = (step: LinkStep): void => {
  if (step.strategy === 'symlink') {
    writeSymlink(step.target, step.source!);
    return;
  }

  if (step.strategy === 'settings') {
    writeSettingsDocument(step.target, step.content!);
    return;
  }

  writeGenerated(step.target, step.content!);
};
