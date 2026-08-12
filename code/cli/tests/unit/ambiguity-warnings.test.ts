import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { executeListCommand } from '../../src/cli/commands/ListCommand.js';
import { executeRunAgentCommand } from '../../src/cli/commands/RunAgentCommand.js';
import { executeSyncCommand } from '../../src/cli/commands/SyncCommand.js';
import { executeValidateCommand } from '../../src/cli/commands/ValidateCommand.js';
import { findResource } from '../../src/resolver/Resource.js';
import { resolveEffectiveSet } from '../../src/resolver/ResolverContext.js';

const temporaryRoots: string[] = [];

const createTemporaryRoot = (): string => {
  const root = mkdtempSync(join(tmpdir(), 'outfitter-ambiguity-'));
  temporaryRoots.push(root);
  return root;
};

const write = (path: string, content: string): void => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
};

const resource = (root: string, kind: 'agents' | 'skills', slug: string): void => {
  const filename = kind === 'agents' ? 'agent.md' : 'SKILL.md';
  write(join(root, kind, slug, filename), `---\nname: ${slug}\n---\n\n${root}\n`);
};

const resolve = (root: string) =>
  resolveEffectiveSet({ homeDirectory: join(root, 'home'), projectDirectory: join(root, 'project') });

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe('ambiguous source resolution warnings', () => {
  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-004.7.1, OFTR-004.7.5).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('names both declaring settings layers and refs, the winner, and preserves source precedence', () => {
    const root = createTemporaryRoot();
    write(
      join(root, 'home', '.agents', 'settings.yml'),
      'sources:\n  - github: ai-outfitter/community-profiles\n    ref: v1.2.1\n',
    );
    write(
      join(root, 'project', '.agents', 'settings.yml'),
      'sources:\n  - github: ai-outfitter/community-profiles\n    ref: v1.2.0\n',
    );

    const result = resolve(root);
    const warning = result.ambiguityWarnings.find((message) => message.includes('community-profiles'));

    expect(warning).toContain(join(root, 'home', '.agents', 'settings.yml'));
    expect(warning).toContain('v1.2.1');
    expect(warning).toContain(join(root, 'project', '.agents', 'settings.yml'));
    expect(warning).toContain('v1.2.0');
    expect(warning).toContain(`'${join(root, 'project', '.agents', 'settings.yml')}' at ref 'v1.2.0' won`);
    expect(result.settings.sources).toEqual([{ github: 'ai-outfitter/community-profiles', ref: 'v1.2.0' }]);
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-004.7.2, OFTR-004.7.5).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('warns when a project source list drops a different repository declared by the user scope', () => {
    const root = createTemporaryRoot();
    const userSettings = join(root, 'home', '.agents', 'settings.yml');
    const projectSettings = join(root, 'project', '.agents', 'settings.yml');
    write(userSettings, 'sources:\n  - github: ai-outfitter/.agents\n');
    write(projectSettings, 'sources:\n  - github: ai-outfitter/community-profiles\n    ref: v1.2.0\n');

    const result = resolve(root);
    const warning = result.ambiguityWarnings.find((message) => message.includes('github:ai-outfitter/.agents'));

    expect(warning).toContain(`declared by '${userSettings}'`);
    expect(warning).toContain(`replaced by '${projectSettings}'`);
    expect(warning).toContain('is not in the effective configuration');
    expect(result.settings.sources).toEqual([{ github: 'ai-outfitter/community-profiles', ref: 'v1.2.0' }]);
    expect(result.settings.sources).not.toContainEqual({ github: 'ai-outfitter/.agents' });
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-004.7.3, OFTR-004.7.5).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('warns when two sources supply an agent slug, names both sources and the unchanged winner', () => {
    const root = createTemporaryRoot();
    const winner = join(root, 'winner');
    const shadowed = join(root, 'shadowed');
    resource(winner, 'agents', 'actions-agent');
    resource(shadowed, 'agents', 'actions-agent');
    write(join(root, 'project', '.agents', 'settings.yml'), `sources:\n  - path: ${winner}\n  - path: ${shadowed}\n`);

    const result = resolve(root);
    const warning = result.warnings.find((message) => message.includes("agent slug 'actions-agent'"));

    expect(warning).toContain(winner);
    expect(warning).toContain(shadowed);
    expect(warning).toContain(`'${winner}' won`);
    expect(findResource(result.set, 'agent', 'actions-agent')?.winner.layer.label).toBe(winner);
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-004.7.3).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('warns when two sources supply a skill slug and names the winner', () => {
    const root = createTemporaryRoot();
    const winner = join(root, 'skills-one');
    const shadowed = join(root, 'skills-two');
    resource(winner, 'skills', 'triage');
    resource(shadowed, 'skills', 'triage');
    write(join(root, 'project', '.agents', 'settings.yml'), `sources:\n  - path: ${winner}\n  - path: ${shadowed}\n`);

    const warning = resolve(root).warnings.find((message) => message.includes("skill slug 'triage'"));

    expect(warning).toContain(winner);
    expect(warning).toContain(shadowed);
    expect(warning).toContain(`'${winner}' won`);
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-004.7.4).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('surfaces ambiguity warnings from sync, validate, list agents, and run', async () => {
    const root = createTemporaryRoot();
    const winner = join(root, 'catalog-one');
    const shadowed = join(root, 'catalog-two');
    resource(winner, 'agents', 'actions-agent');
    resource(shadowed, 'agents', 'actions-agent');
    write(join(root, 'project', '.agents', 'settings.yml'), `sources:\n  - path: ${winner}\n  - path: ${shadowed}\n`);
    const input = { homeDirectory: join(root, 'home'), projectDirectory: join(root, 'project') };
    const isAmbiguityWarning = (message: string): boolean => message.includes("Ambiguous agent slug 'actions-agent'");

    expect(executeSyncCommand(input).messages.some(isAmbiguityWarning)).toBe(true);
    expect(executeValidateCommand(input).messages.some(isAmbiguityWarning)).toBe(true);
    expect(executeListCommand({ ...input, kind: 'agents' }).messages.some(isAmbiguityWarning)).toBe(true);
    const run = await executeRunAgentCommand({
      ...input,
      agent: 'actions-agent',
      launcher: () => Promise.resolve(0),
    });
    expect(run.messages.some(isAmbiguityWarning)).toBe(true);
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-004.7.1, OFTR-004.7.3).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('does not report ambiguity for a clean effective configuration', () => {
    const root = createTemporaryRoot();
    const first = join(root, 'first');
    const second = join(root, 'second');
    resource(first, 'agents', 'engineer');
    resource(second, 'skills', 'research');
    write(join(root, 'project', '.agents', 'settings.yml'), `sources:\n  - path: ${first}\n  - path: ${second}\n`);

    expect(resolve(root).warnings.filter((message) => message.includes('Ambiguous'))).toEqual([]);
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-004.7.2).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('reports a dropped repository once when a higher-precedence empty list excludes duplicate declarations', () => {
    const root = createTemporaryRoot();
    write(
      join(root, 'home', '.agents', 'settings.yml'),
      'sources:\n  - github: acme/catalog\n    ref: v1.0.0\n  - github: acme/catalog\n    ref: v2.0.0\n',
    );
    write(join(root, 'project', '.agents', 'settings.yml'), 'sources: []\n');

    const warnings = resolve(root).ambiguityWarnings;

    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("source 'github:acme/catalog'");
    expect(warnings[0]).toContain(join(root, 'home', '.agents', 'settings.yml'));
    expect(warnings[0]).toContain(join(root, 'project', '.agents', 'settings.yml'));
  });
});
