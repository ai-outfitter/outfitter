// Tests link planning: harness selection, conflict safety, reconciliation, and pruning.
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import type { HarnessSettings } from '../../src/harness/HarnessSettings.js';
import { MANIFEST_VERSION } from '../../src/harness/LinkManifest.js';
import type { LinkManifest } from '../../src/harness/LinkManifest.js';
import type { LinkSource, LinkStep } from '../../src/harness/LinkPlan.js';
import { planLinks, resolveConfiguredDirectory, selectHarnesses } from '../../src/harness/LinkPlan.js';

const temporaryRoots: string[] = [];

const createHome = (): string => {
  const root = mkdtempSync(join(tmpdir(), 'outfitter-linkplan-'));
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

const manifestOf = (...targets: readonly string[]): LinkManifest => ({
  version: MANIFEST_VERSION,
  entries: targets.map((target) => ({
    target,
    harness: 'claude' as const,
    kind: 'skills' as const,
    strategy: 'symlink' as const,
  })),
});

const skill = (path: string, slug = 'research'): LinkSource => ({ kind: 'skills', slug, path });

const stepFor = (steps: readonly LinkStep[], target: string): LinkStep | undefined =>
  steps.find((step) => step.target === target);

describe('harness selection', () => {
  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-011.5.2).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('defaults to harnesses whose config directory already exists', () => {
    const home = createHome();
    mkdirSync(join(home, '.claude'));
    mkdirSync(join(home, '.gemini'));

    expect(selectHarnesses({}, home)).toEqual(['claude', 'gemini']);
  });

  it('honors an explicit list and the none selection', () => {
    const home = createHome();

    expect(selectHarnesses({ link: ['codex', 'copilot'] }, home)).toEqual(['codex', 'copilot']);
    expect(selectHarnesses({ link: 'none' }, home)).toEqual([]);
  });

  it('ignores per-harness overrides when deciding which harnesses are selected', () => {
    const home = createHome();

    // Overrides tune how a selected harness is provisioned, never whether it is.
    expect(selectHarnesses({ link: 'none', overrides: { claude: { resources: ['skills'] } } }, home)).toEqual([]);
    expect(selectHarnesses({ link: ['claude'], overrides: { codex: { resources: ['skills'] } } }, home)).toEqual([
      'claude',
    ]);
  });

  it('detects a harness through a configured config directory rather than the default', () => {
    const home = createHome();
    mkdirSync(join(home, 'work-claude'));

    expect(selectHarnesses({ overrides: { claude: { configDirectories: ['~/work-claude'] } } }, home)).toEqual([
      'claude',
    ]);
  });

  it('resolves tilde, absolute, and relative configured directories', () => {
    expect(resolveConfiguredDirectory('~', '/home/me')).toBe('/home/me');
    expect(resolveConfiguredDirectory('~/.claude-work', '/home/me')).toBe(join('/home/me', '.claude-work'));
    expect(resolveConfiguredDirectory('/etc/claude', '/home/me')).toBe('/etc/claude');
    expect(resolveConfiguredDirectory('nested/dir', '/home/me')).toBe(join('/home/me', 'nested', 'dir'));
  });
});

describe('link planning', () => {
  const settings: HarnessSettings = { link: ['claude'], overrides: { claude: { resources: ['skills'] } } };

  it('creates a step for a skill that has no existing target', () => {
    const home = createHome();
    const plan = planLinks({
      homeDirectory: home,
      settings,
      sources: [skill('/catalog/research')],
      manifest: manifestOf(),
    });

    expect(plan.harnesses).toEqual(['claude']);
    expect(plan.steps).toHaveLength(1);
    expect(plan.steps[0]).toMatchObject({
      action: 'create',
      harness: 'claude',
      kind: 'skills',
      strategy: 'symlink',
      source: '/catalog/research',
      target: join(home, '.claude', 'skills', 'research'),
    });
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-011.2.2, OFTR-011.2.3).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('reports an unmanaged path as a conflict even when it already points at the right source', () => {
    const home = createHome();
    const target = join(home, '.claude', 'skills', 'research');
    mkdirSync(dirname(target), { recursive: true });
    symlinkSync('/catalog/research', target);

    const plan = planLinks({
      homeDirectory: home,
      settings,
      sources: [skill('/catalog/research')],
      manifest: manifestOf(),
    });

    expect(plan.steps[0]).toMatchObject({
      action: 'conflict',
      reason: 'path exists and is not managed by Outfitter',
    });
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-011.2.4).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('replaces an unmanaged path only under force, and says so', () => {
    const home = createHome();
    const target = join(home, '.claude', 'skills', 'research');
    write(target, 'hand written');

    const plan = planLinks({
      homeDirectory: home,
      settings,
      sources: [skill('/catalog/research')],
      manifest: manifestOf(),
      force: true,
    });

    expect(plan.steps[0]).toMatchObject({ action: 'update', reason: 'replacing existing path (--force)' });
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-011.3.1, OFTR-011.3.2).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('leaves a correct managed link unchanged and repoints one whose source moved', () => {
    const home = createHome();
    const target = join(home, '.claude', 'skills', 'research');
    mkdirSync(dirname(target), { recursive: true });
    symlinkSync('/catalog/research', target);

    const unchanged = planLinks({
      homeDirectory: home,
      settings,
      sources: [skill('/catalog/research')],
      manifest: manifestOf(target),
    });
    expect(unchanged.steps[0]?.action).toBe('unchanged');

    const moved = planLinks({
      homeDirectory: home,
      settings,
      sources: [skill('/elsewhere/research')],
      manifest: manifestOf(target),
    });
    expect(moved.steps[0]).toMatchObject({ action: 'update', source: '/elsewhere/research' });
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-011.3.3).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('prunes a managed link whose catalog resource disappeared, and only for selected harnesses', () => {
    const home = createHome();
    const stale = join(home, '.claude', 'skills', 'gone');
    const otherHarness = join(home, '.codex', 'skills', 'gone');

    const plan = planLinks({
      homeDirectory: home,
      settings,
      sources: [skill('/catalog/research')],
      manifest: {
        version: MANIFEST_VERSION,
        entries: [
          { target: stale, harness: 'claude', kind: 'skills', strategy: 'symlink' },
          { target: otherHarness, harness: 'codex', kind: 'skills', strategy: 'symlink' },
        ],
      },
    });

    expect(stepFor(plan.steps, stale)).toMatchObject({
      action: 'remove',
      reason: 'no longer present in the catalog',
    });
    // Codex was not selected, so its managed entries are left alone rather than pruned.
    expect(stepFor(plan.steps, otherHarness)).toBeUndefined();
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-011.5.3).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('provisions every configured config directory for one harness', () => {
    const home = createHome();
    const plan = planLinks({
      homeDirectory: home,
      settings: {
        link: ['claude'],
        overrides: { claude: { resources: ['skills'], configDirectories: ['~/.claude', '~/.claude-work'] } },
      },
      sources: [skill('/catalog/research')],
      manifest: manifestOf(),
    });

    expect(plan.steps.map((step) => step.target)).toEqual([
      join(home, '.claude', 'skills', 'research'),
      join(home, '.claude-work', 'skills', 'research'),
    ]);
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-011.1.5).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('reports a requested kind the harness does not support', () => {
    const home = createHome();
    const plan = planLinks({
      homeDirectory: home,
      settings: { link: ['copilot'], overrides: { copilot: { resources: ['hooks'] } } },
      sources: [],
      manifest: manifestOf(),
    });

    expect(plan.steps).toEqual([]);
    expect(plan.unsupported).toEqual(["copilot: 'hooks' is not a supported surface"]);
  });

  it('links the global instructions file, and skips it when absent', () => {
    const home = createHome();
    const withInstructions = planLinks({
      homeDirectory: home,
      settings: { link: ['codex'], overrides: { codex: { resources: ['instructions'] } } },
      sources: [],
      instructionsPath: join(home, '.agents', 'AGENTS.md'),
      manifest: manifestOf(),
    });

    expect(withInstructions.steps[0]).toMatchObject({
      kind: 'instructions',
      target: join(home, '.codex', 'AGENTS.md'),
      source: join(home, '.agents', 'AGENTS.md'),
    });

    const without = planLinks({
      homeDirectory: home,
      settings: { link: ['codex'], overrides: { codex: { resources: ['instructions'] } } },
      sources: [],
      manifest: manifestOf(),
    });
    expect(without.steps).toEqual([]);
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-011.4.1, OFTR-011.4.2).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('symlinks Markdown commands but generates Gemini TOML from the same source', () => {
    const home = createHome();
    const commandPath = join(createHome(), 'review.md');
    write(commandPath, '---\ndescription: Review\n---\nDo the review.\n');
    const sources: readonly LinkSource[] = [{ kind: 'commands', slug: 'review', path: commandPath }];

    const claude = planLinks({
      homeDirectory: home,
      settings: { link: ['claude'], overrides: { claude: { resources: ['commands'] } } },
      sources,
      manifest: manifestOf(),
    });
    expect(claude.steps[0]).toMatchObject({
      strategy: 'symlink',
      target: join(home, '.claude', 'commands', 'review.md'),
      source: commandPath,
    });

    const gemini = planLinks({
      homeDirectory: home,
      settings: { link: ['gemini'], overrides: { gemini: { resources: ['commands'] } } },
      sources,
      manifest: manifestOf(),
    });
    expect(gemini.steps[0]?.target).toBe(join(home, '.gemini', 'commands', 'review.toml'));
    expect(gemini.steps[0]?.content).toContain('description = "Review"');
    expect(gemini.steps[0]?.content).toContain('prompt = "Do the review."');
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-011.2.2).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('reports a conflict for a command source that vanished, rather than generating an empty one', () => {
    const home = createHome();
    const plan = planLinks({
      homeDirectory: home,
      settings: { link: ['gemini'], overrides: { gemini: { resources: ['commands'] } } },
      sources: [{ kind: 'commands', slug: 'ghost', path: join(home, 'missing.md') }],
      manifest: manifestOf(),
    });

    // Rendering it as an empty prompt would overwrite a previously good generated command.
    expect(plan.steps[0]).toMatchObject({ action: 'conflict', strategy: 'generate' });
    expect(plan.steps[0]?.reason).toContain('no longer exists');
  });

  it('leaves a generated command unchanged when its rendered content already matches', () => {
    const home = createHome();
    const commandPath = join(createHome(), 'review.md');
    write(commandPath, 'Do the review.\n');
    const target = join(home, '.gemini', 'commands', 'review.toml');
    const settingsForGemini: HarnessSettings = {
      link: ['gemini'],
      overrides: { gemini: { resources: ['commands'] } },
    };
    const sources: readonly LinkSource[] = [{ kind: 'commands', slug: 'review', path: commandPath }];

    const first = planLinks({ homeDirectory: home, settings: settingsForGemini, sources, manifest: manifestOf() });
    write(target, first.steps[0]?.content ?? '');

    const second = planLinks({
      homeDirectory: home,
      settings: settingsForGemini,
      sources,
      manifest: manifestOf(target),
    });
    expect(second.steps[0]?.action).toBe('unchanged');
  });

  it('emits one settings step carrying every projected hook, and reports untranslatable events', () => {
    const home = createHome();
    const plan = planLinks({
      homeDirectory: home,
      settings: {
        link: ['claude'],
        overrides: { claude: { resources: ['hooks'] } },
        hooks: [
          { event: 'before_tool', matcher: 'Bash', command: 'guard' },
          { event: 'before_agent', command: 'nope' },
        ],
      },
      sources: [],
      manifest: manifestOf(),
    });

    expect(plan.steps[0]).toMatchObject({
      kind: 'hooks',
      strategy: 'settings',
      target: join(home, '.claude', 'settings.json'),
    });
    expect((JSON.parse(plan.steps[0]?.content ?? '{}') as { hooks: object }).hooks).toHaveProperty('PreToolUse');
    expect(plan.unsupported).toEqual(["claude: hook event 'before_agent' has no claude equivalent"]);
  });

  it('emits no hook step when no hooks are declared', () => {
    const home = createHome();
    const plan = planLinks({
      homeDirectory: home,
      settings: { link: ['claude'], overrides: { claude: { resources: ['hooks'] } } },
      sources: [],
      manifest: manifestOf(),
    });

    expect(plan.steps).toEqual([]);
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-011.3.5).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('plans removal of every managed path, deepest first, ignoring settings merges', () => {
    const home = createHome();
    const plan = planLinks({
      homeDirectory: home,
      settings: {},
      sources: [],
      remove: true,
      manifest: {
        version: MANIFEST_VERSION,
        entries: [
          { target: '/a', harness: 'claude', kind: 'skills', strategy: 'symlink', source: '/catalog/a' },
          { target: '/a/b', harness: 'claude', kind: 'skills', strategy: 'symlink' },
          { target: '/settings.json', harness: 'claude', kind: 'hooks', strategy: 'settings' },
        ],
      },
    });

    // Path-owning entries are removed deepest-first; the settings entry is forgotten, never deleted.
    expect(plan.steps.filter((step) => step.action === 'remove').map((step) => step.target)).toEqual(['/a/b', '/a']);
    expect(plan.steps.find((step) => step.strategy === 'settings')).toMatchObject({
      action: 'unchanged',
      forget: true,
      target: '/settings.json',
    });
    expect(plan.harnesses).toEqual(['claude']);
  });
  it('reports a conflict on a generated command that Outfitter does not own', () => {
    const home = createHome();
    const commandPath = join(createHome(), 'review.md');
    write(commandPath, 'Do the review.\n');
    write(join(home, '.gemini', 'commands', 'review.toml'), 'prompt = "hand written"\n');

    const plan = planLinks({
      homeDirectory: home,
      settings: { link: ['gemini'], overrides: { gemini: { resources: ['commands'] } } },
      sources: [{ kind: 'commands', slug: 'review', path: commandPath }],
      manifest: manifestOf(),
    });

    expect(plan.steps[0]).toMatchObject({
      action: 'conflict',
      strategy: 'generate',
      reason: 'path exists and is not managed by Outfitter',
    });
  });

  it('orders equal removal targets stably', () => {
    const plan = planLinks({
      homeDirectory: createHome(),
      settings: {},
      sources: [],
      remove: true,
      manifest: {
        version: MANIFEST_VERSION,
        entries: [
          { target: '/same', harness: 'claude', kind: 'skills', strategy: 'symlink' },
          { target: '/same', harness: 'claude', kind: 'commands', strategy: 'symlink' },
        ],
      },
    });

    expect(plan.steps).toHaveLength(2);
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-011.2.9).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('reports a conflict rather than rewriting an unparseable harness settings file', () => {
    const home = createHome();
    write(join(home, '.claude', 'settings.json'), '{ not json');

    const plan = planLinks({
      homeDirectory: home,
      settings: {
        link: ['claude'],
        overrides: { claude: { resources: ['hooks'] } },
        hooks: [{ event: 'before_tool', command: 'guard' }],
      },
      sources: [],
      manifest: manifestOf(),
    });

    expect(plan.steps[0]).toMatchObject({
      action: 'conflict',
      strategy: 'settings',
      reason: 'could not be parsed as JSON; hooks were not written',
    });
  });

  it('reports a conflict when an unparseable settings file blocks --remove from stripping hooks', () => {
    const home = createHome();
    const target = join(home, '.claude', 'settings.json');
    write(target, '{ not json');

    const plan = planLinks({
      homeDirectory: home,
      settings: {},
      sources: [],
      remove: true,
      manifest: {
        version: MANIFEST_VERSION,
        entries: [{ target, harness: 'claude', kind: 'hooks', strategy: 'settings' }],
      },
    });

    expect(plan.steps[0]).toMatchObject({
      action: 'conflict',
      strategy: 'settings',
      reason: 'could not be parsed as JSON; managed hooks were left in place',
    });
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-011.3.5).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('forgets a settings entry whose file holds nothing of Outfitter own, without rewriting it', () => {
    const home = createHome();
    const target = join(home, '.claude', 'settings.json');
    write(target, '{"model":"opus"}');

    const plan = planLinks({
      homeDirectory: home,
      settings: {},
      sources: [],
      remove: true,
      manifest: {
        version: MANIFEST_VERSION,
        entries: [{ target, harness: 'claude', kind: 'hooks', strategy: 'settings' }],
      },
    });

    // Emitting nothing would strand the entry, so --remove could never drop the manifest.
    expect(plan.steps).toHaveLength(1);
    expect(plan.steps[0]).toMatchObject({ action: 'unchanged', forget: true, target });
    expect(plan.steps[0]?.content).toBeUndefined();
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-011.2.9).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('reports an unreadable settings path instead of treating it as absent', () => {
    const home = createHome();
    // A directory where the settings file should be: readFileSync throws EISDIR, not ENOENT.
    mkdirSync(join(home, '.claude', 'settings.json'), { recursive: true });

    const plan = planLinks({
      homeDirectory: home,
      settings: {
        link: ['claude'],
        overrides: { claude: { resources: ['hooks'] } },
        hooks: [{ event: 'before_tool', command: 'guard' }],
      },
      sources: [],
      manifest: manifestOf(),
    });

    // Building a fresh document here would truncate whatever the path really holds.
    expect(plan.steps[0]).toMatchObject({ action: 'conflict', strategy: 'settings' });
    expect(plan.steps[0]?.reason).toContain('could not be read');
  });

  it('reports an unreadable settings path during --remove rather than rewriting it', () => {
    const home = createHome();
    const target = join(home, '.claude', 'settings.json');
    mkdirSync(target, { recursive: true });

    const plan = planLinks({
      homeDirectory: home,
      settings: {},
      sources: [],
      remove: true,
      manifest: {
        version: MANIFEST_VERSION,
        entries: [{ target, harness: 'claude', kind: 'hooks', strategy: 'settings' }],
      },
    });

    expect(plan.steps[0]).toMatchObject({ action: 'conflict', strategy: 'settings' });
  });

  it('emits no hook step when every declared event is unsupported for the harness', () => {
    const home = createHome();
    const plan = planLinks({
      homeDirectory: home,
      settings: {
        link: ['claude'],
        overrides: { claude: { resources: ['hooks'] } },
        hooks: [{ event: 'before_agent', command: 'nope' }],
      },
      sources: [],
      manifest: manifestOf(),
    });

    // Writing `"hooks": {}` would claim the settings file for no reason.
    expect(plan.steps).toEqual([]);
    expect(plan.unsupported).toHaveLength(1);
  });
});
