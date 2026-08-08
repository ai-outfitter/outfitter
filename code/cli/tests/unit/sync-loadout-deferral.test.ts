// Guards the sync wiring for OFTR-004.6.11: `outfitter sync` validates each source in isolation and
// must DEFER an unresolved loadout slug (a source may reference a dependency's skill), so a catalog
// that depends on another catalog's skills syncs cleanly instead of failing. Reverting the
// `deferLoadoutResolution` wiring in validateSourceCheckout makes this test fail.
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { executeSyncCommand } from '../../src/cli/commands/SyncCommand.js';
import { syncRemoteRepositoryAtomically } from '../../src/sources/GitRepository.js';

const temporaryRoots: string[] = [];

const git = (args: readonly string[]): string =>
  execFileSync('git', [...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

const write = (path: string, content: string): void => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
};

const createRepository = (files: Readonly<Record<string, string>>, tag?: string): string => {
  const root = mkdtempSync(join(tmpdir(), 'outfitter-deferral-'));
  temporaryRoots.push(root);
  git(['init', '--quiet', root]);
  git(['-C', root, 'config', 'user.name', 'Outfitter Tests']);
  git(['-C', root, 'config', 'user.email', 'tests@outfitter.dev']);
  git(['-C', root, 'config', 'commit.gpgsign', 'false']);
  git(['-C', root, 'config', 'tag.gpgsign', 'false']);
  for (const [path, content] of Object.entries(files)) write(join(root, path), content);
  git(['-C', root, 'add', '.']);
  git(['-C', root, 'commit', '--quiet', '-m', 'init']);
  if (tag !== undefined) git(['-C', root, 'tag', tag]);
  return root;
};

// Remaps a `github:` source to a local fixture, then runs the real atomic sync (real fetch/validate).
const githubFixtureSync =
  (fixtures: Readonly<Record<string, string>>): typeof syncRemoteRepositoryAtomically =>
  (input) => {
    if (input.source.github === undefined) return syncRemoteRepositoryAtomically(input);
    const local = fixtures[input.source.github];
    if (local === undefined) throw new Error(`no fixture for github:${input.source.github}`);
    return syncRemoteRepositoryAtomically({ ...input, source: { uri: local, ref: input.source.ref } });
  };

afterEach(() => {
  process.exitCode = undefined;
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('sync loadout-resolution deferral', () => {
  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-004.6.11).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('syncs a source whose agent references a skill supplied by its declared dependency', () => {
    const root = mkdtempSync(join(tmpdir(), 'outfitter-deferral-home-'));
    temporaryRoots.push(root);
    const home = join(root, 'home');
    // The dependency supplies `dep-skill`; `top`'s agent references it but does not define it.
    const dependency = createRepository(
      { 'skills/dep-skill/SKILL.md': '---\nname: dep-skill\n---\n\n# dep-skill\n' },
      'v1.0.0',
    );
    const top = createRepository({
      'agents/top/agent.md': '---\nname: top\ndescription: Top.\nskills:\n  - dep-skill\n---\n\n# top\n',
      'settings.yml': `sources:\n  - github: acme/dep\n    ref: v1.0.0\n`,
    });
    write(join(home, '.agents', 'settings.yml'), `sources:\n  - uri: ${JSON.stringify(top)}\n`);

    const result = executeSyncCommand(
      { homeDirectory: home, projectDirectory: join(root, 'project') },
      { classifier: { classify: () => 'public' }, syncRepository: githubFixtureSync({ 'acme/dep': dependency }) },
    );

    // Isolated validation defers the unresolved loadout slug to a warning, so `top` is `updated`
    // (not `failed`), its declared dependency is fetched, and the command exits 0.
    expect(result.exitCode).toBe(0);
    expect(result.results.map(({ kind, status }) => ({ kind, status }))).toEqual([
      { kind: 'source', status: 'updated' },
      { kind: 'transitive', status: 'updated' },
    ]);
    expect(result.messages.join('\n')).toContain('validated with 1 warning(s)');
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-004.6.6).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('fetches an exact-duplicate configured source only once', () => {
    const root = mkdtempSync(join(tmpdir(), 'outfitter-deferral-home-'));
    temporaryRoots.push(root);
    const home = join(root, 'home');
    const source = createRepository({ 'agents/solo/agent.md': '---\nname: solo\n---\n\n# solo\n' });
    // The same local source is configured twice; it must be fetched and reported once, not twice.
    write(
      join(home, '.agents', 'settings.yml'),
      `sources:\n  - uri: ${JSON.stringify(source)}\n  - uri: ${JSON.stringify(source)}\n`,
    );

    const result = executeSyncCommand({ homeDirectory: home, projectDirectory: join(root, 'project') });

    expect(result.exitCode).toBe(0);
    expect(result.results.map((entry) => entry.kind)).toEqual(['source']);
  });
});
