// Tests link application: what actually reaches the filesystem, and what is deliberately skipped.
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { OUTFITTER_HOOK_MARKER, mergeHookSettingsDocument, projectHooks } from '../../src/harness/HookAdapter.js';
import { applyLinkPlan } from '../../src/harness/LinkApply.js';
import { MANIFEST_VERSION, emptyManifest } from '../../src/harness/LinkManifest.js';
import type { LinkPlanResult, LinkStep } from '../../src/harness/LinkPlan.js';

/** Hook-bearing settings documents, so parsed JSON is typed instead of `any`. */
interface HookSettings {
  readonly hooks: Readonly<Record<string, readonly unknown[]>>;
  readonly [key: string]: unknown;
}

const temporaryRoots: string[] = [];

const createRoot = (): string => {
  const root = mkdtempSync(join(tmpdir(), 'outfitter-linkapply-'));
  temporaryRoots.push(root);
  return root;
};

const write = (path: string, content: string): void => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
};

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

const planOf = (...steps: readonly LinkStep[]): LinkPlanResult => ({ steps, unsupported: [], harnesses: ['claude'] });

const symlinkStep = (target: string, source: string, action: LinkStep['action'] = 'create'): LinkStep => ({
  harness: 'claude',
  kind: 'skills',
  action,
  target,
  strategy: 'symlink',
  source,
});

describe('link application', () => {
  it('creates symlinks and records them in the manifest', () => {
    const root = createRoot();
    const source = join(root, 'catalog', 'research');
    mkdirSync(source, { recursive: true });
    const target = join(root, 'home', '.claude', 'skills', 'research');

    const result = applyLinkPlan(planOf(symlinkStep(target, source)), emptyManifest());

    expect(readlinkSync(target)).toBe(source);
    expect(result).toMatchObject({ created: 1, updated: 0, removed: 0, unchanged: 0 });
    expect(result.manifest.entries).toEqual([
      { target, harness: 'claude', kind: 'skills', strategy: 'symlink', source },
    ]);
  });

  it('replaces an existing file or directory when repointing a managed link', () => {
    const root = createRoot();
    const target = join(root, '.claude', 'skills', 'research');
    mkdirSync(join(target, 'nested'), { recursive: true });
    write(join(target, 'nested', 'file.md'), 'stale');

    applyLinkPlan(planOf(symlinkStep(target, join(root, 'catalog'), 'update')), emptyManifest());

    expect(lstatSync(target).isSymbolicLink()).toBe(true);
  });

  it('writes generated content and tracks it as an update', () => {
    const root = createRoot();
    const target = join(root, '.gemini', 'commands', 'review.toml');

    const result = applyLinkPlan(
      planOf({
        harness: 'gemini',
        kind: 'commands',
        action: 'update',
        target,
        strategy: 'generate',
        content: 'prompt = "hi"\n',
      }),
      emptyManifest(),
    );

    expect(readFileSync(target, 'utf8')).toBe('prompt = "hi"\n');
    expect(result.updated).toBe(1);
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-011.2.3).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('writes nothing for a conflict and leaves the existing path intact', () => {
    const root = createRoot();
    const target = join(root, '.claude', 'skills', 'research');
    write(target, 'hand written');

    const result = applyLinkPlan(
      planOf({ ...symlinkStep(target, '/catalog/research'), action: 'conflict' }),
      emptyManifest(),
    );

    expect(readFileSync(target, 'utf8')).toBe('hand written');
    expect(result.conflicts).toHaveLength(1);
    expect(result.manifest.entries).toEqual([]);
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-011.3.4).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('writes nothing in dry-run mode while still reporting the counts', () => {
    const root = createRoot();
    const target = join(root, '.claude', 'skills', 'research');

    const result = applyLinkPlan(planOf(symlinkStep(target, '/catalog/research')), emptyManifest(), { dryRun: true });

    expect(existsSync(target)).toBe(false);
    expect(result.created).toBe(1);
  });

  it('counts unchanged steps without touching the filesystem', () => {
    const root = createRoot();
    const target = join(root, 'never-created');

    const result = applyLinkPlan(planOf({ ...symlinkStep(target, '/x'), action: 'unchanged' }), emptyManifest());

    expect(existsSync(target)).toBe(false);
    expect(result.unchanged).toBe(1);
  });

  it('removes managed paths and drops them from the manifest', () => {
    const root = createRoot();
    const target = join(root, '.claude', 'skills', 'gone');
    write(target, 'stale');

    const result = applyLinkPlan(planOf({ ...symlinkStep(target, '/x'), action: 'remove' }), {
      version: MANIFEST_VERSION,
      entries: [{ target, harness: 'claude', kind: 'skills', strategy: 'symlink' }],
    });

    expect(existsSync(target)).toBe(false);
    expect(result.removed).toBe(1);
    expect(result.manifest.entries).toEqual([]);
  });

  it('removes nothing from disk under dry-run while still reporting the count', () => {
    const root = createRoot();
    const target = join(root, '.claude', 'skills', 'gone');
    write(target, 'stale');

    const result = applyLinkPlan(planOf({ ...symlinkStep(target, '/x'), action: 'remove' }), emptyManifest(), {
      dryRun: true,
    });

    expect(existsSync(target)).toBe(true);
    expect(result.removed).toBe(1);
  });
});

describe('hook settings merge', () => {
  const hooksFor = (command: string) => projectHooks([{ event: 'before_tool', command }], 'claude').hooks;

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-011.2.8).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('preserves unrelated settings keys and hand-written hook entries', () => {
    const handWritten = { matcher: 'Bash', hooks: [{ type: 'command', command: 'mine' }] };
    const existing = JSON.stringify({
      model: 'opus',
      permissions: { allow: [] },
      hooks: { PreToolUse: [handWritten] },
    });

    const merged = mergeHookSettingsDocument(existing, hooksFor('guard'));

    expect(merged.error).toBeUndefined();
    const document = JSON.parse(merged.content ?? '{}') as HookSettings;
    expect(document.model).toBe('opus');
    expect(document.permissions).toEqual({ allow: [] });
    expect(document.hooks.PreToolUse[0]).toEqual(handWritten);
    expect(document.hooks.PreToolUse[1]).toMatchObject({ [OUTFITTER_HOOK_MARKER]: true });
  });

  it('produces a fresh document when the harness has no settings file yet', () => {
    const merged = mergeHookSettingsDocument(undefined, hooksFor('guard'));

    expect((JSON.parse(merged.content ?? '{}') as HookSettings).hooks.PreToolUse).toHaveLength(1);
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-011.2.9).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('refuses to write over an unparseable or non-object settings document', () => {
    expect(mergeHookSettingsDocument('{ not json', {})).toEqual({
      error: 'could not be parsed as JSON; hooks were not written',
    });
    expect(mergeHookSettingsDocument('[]', {})).toEqual({
      error: 'is not a JSON object; hooks were not written',
    });
  });

  it('ignores a non-object hooks value rather than merging into it', () => {
    const merged = mergeHookSettingsDocument(JSON.stringify({ hooks: 'unexpected' }), hooksFor('guard'));

    expect((JSON.parse(merged.content ?? '{}') as HookSettings).hooks.PreToolUse).toHaveLength(1);
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-011.3.1).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('is stable: merging its own output again reproduces it byte for byte', () => {
    const first = mergeHookSettingsDocument(undefined, hooksFor('guard'));
    const second = mergeHookSettingsDocument(first.content, hooksFor('guard'));

    expect(second.content).toBe(first.content);
  });

  it('records a settings merge in the manifest so --remove can find it later', () => {
    const root = createRoot();
    const target = join(root, '.claude', 'settings.json');
    const content = mergeHookSettingsDocument(undefined, hooksFor('guard')).content ?? '';

    const result = applyLinkPlan(
      planOf({ harness: 'claude', kind: 'hooks', action: 'update', target, strategy: 'settings', content }),
      emptyManifest(),
    );

    expect(readFileSync(target, 'utf8')).toBe(content);
    expect(result.manifest.entries).toEqual([{ target, harness: 'claude', kind: 'hooks', strategy: 'settings' }]);
  });

  it('stops tracking a settings file once its managed entries are stripped', () => {
    const root = createRoot();
    const target = join(root, '.claude', 'settings.json');
    const content = '{}\n';

    const result = applyLinkPlan(
      planOf({
        harness: 'claude',
        kind: 'hooks',
        action: 'update',
        target,
        strategy: 'settings',
        content,
        forget: true,
      }),
      { version: MANIFEST_VERSION, entries: [{ target, harness: 'claude', kind: 'hooks', strategy: 'settings' }] },
    );

    expect(readFileSync(target, 'utf8')).toBe(content);
    expect(result.manifest.entries).toEqual([]);
  });
});
