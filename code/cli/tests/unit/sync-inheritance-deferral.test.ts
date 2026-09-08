// Guards the sync wiring for OFTR-004.6.11: isolated validation must defer an inheritance parent
// that a catalog's transitive dependency supplies, then sync must discover and fetch that catalog.
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { executeSyncCommand } from '../../src/cli/commands/SyncCommand.js';
import { compose } from '../../src/composer/Composer.js';
import { discoverLayers } from '../../src/resolver/Layer.js';
import { resolveResources } from '../../src/resolver/Resolver.js';
import { validateEffectiveSet } from '../../src/resolver/ResolverValidation.js';
import { discoverSettingsLoadPlan, loadSettings } from '../../src/settings/SettingsLoader.js';
import { syncRemoteRepositoryAtomically } from '../../src/sources/GitRepository.js';

const temporaryRoots: string[] = [];

const git = (args: readonly string[]): string =>
  execFileSync('git', [...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

const write = (path: string, content: string): void => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
};

const createRepository = (files: Readonly<Record<string, string>>, tag?: string): string => {
  const root = mkdtempSync(join(tmpdir(), 'outfitter-inheritance-deferral-'));
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

describe('sync inheritance-resolution deferral', () => {
  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-004.6.11).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('syncs a source whose agent inherits a parent supplied by its declared dependency', () => {
    const root = mkdtempSync(join(tmpdir(), 'outfitter-inheritance-deferral-home-'));
    temporaryRoots.push(root);
    const home = join(root, 'home');
    const dependency = createRepository(
      { 'agents/base/agent.md': '---\nname: base\ndescription: Base.\n---\n\n# Base\n' },
      'v1.0.0',
    );
    const top = createRepository({
      'agents/child/agent.md': '---\nname: child\ndescription: Child.\ninherits: base\n---\n\n# Child\n',
      'settings.yml': 'sources:\n  - github: ai-outfitter/community-profiles\n    ref: v1.0.0\n',
    });
    write(join(home, '.agents', 'settings.yml'), `sources:\n  - uri: ${JSON.stringify(top)}\n`);

    const result = executeSyncCommand(
      { homeDirectory: home, projectDirectory: join(root, 'project') },
      {
        classifier: { classify: () => 'public' },
        syncRepository: githubFixtureSync({ 'ai-outfitter/community-profiles': dependency }),
      },
    );

    expect(result.exitCode).toBe(0);
    expect(result.results.map(({ kind, status }) => ({ kind, status }))).toEqual([
      { kind: 'source', status: 'updated' },
      { kind: 'transitive', status: 'updated' },
    ]);
    expect(result.messages.join('\n')).toContain('validated with 1 warning(s)');

    // Resolution after sync uses both cached catalogs. The dependency must do more than fetch: it
    // must satisfy `child`'s parent and participate in the authoritative merged composition.
    const projectDirectory = join(root, 'project');
    const settings = loadSettings(discoverSettingsLoadPlan({ homeDirectory: home, projectDirectory })).settings;
    const layers = discoverLayers({ homeDirectory: home, projectDirectory, settings }).layers;
    const merged = resolveResources(layers);
    expect(validateEffectiveSet(merged).filter((finding) => finding.message.includes('unknown parent'))).toEqual([]);
    expect(compose(merged, 'child').plan?.inheritanceChain).toEqual(['base', 'child']);
  });
});
