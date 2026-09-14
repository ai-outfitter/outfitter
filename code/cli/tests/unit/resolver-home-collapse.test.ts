// Tests same-directory layer collapse: home-directory and symlink-equal workspace/global roots resolve once.
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { executeListCommand } from '../../src/cli/commands/ListCommand.js';
import { executeValidateCommand } from '../../src/cli/commands/ValidateCommand.js';
import { discoverLayers } from '../../src/resolver/Layer.js';
import { findResource } from '../../src/resolver/Resource.js';
import { resolveEffectiveSet } from '../../src/resolver/ResolverContext.js';
import { resolveResources } from '../../src/resolver/Resolver.js';

const temporaryRoots: string[] = [];

const createTemporaryRoot = (): string => {
  const root = mkdtempSync(join(tmpdir(), 'outfitter-home-collapse-'));
  temporaryRoots.push(root);
  return root;
};

const write = (path: string, content: string): void => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
};

const agentMd = (name: string): string => `---\nname: ${name}\ndescription: The ${name} agent.\n---\n\n# ${name}\n`;

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe('same-directory layer collapse', () => {
  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-003.3.4).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('collapses workspace and global into one global layer when the working directory is home', () => {
    const home = createTemporaryRoot();
    write(join(home, '.agents', 'agents', 'coding', 'agent.md'), agentMd('coding'));

    const discovered = discoverLayers({ homeDirectory: home, projectDirectory: home, settings: { sources: [] } });
    expect(discovered.layers.map((layer) => layer.origin)).toEqual(['global']);
    expect(discovered.layers[0]?.label).toBe('global');
    expect(discovered.layers[0]?.root).toBe(join(home, '.agents'));

    const set = resolveResources(discovered.layers);
    const coding = findResource(set, 'agent', 'coding');
    expect(coding?.winner.layer.label).toBe('global');
    expect(coding?.winner.path).toBe(join(home, '.agents', 'agents', 'coding', 'agent.md'));
    expect(coding?.shadowed).toEqual([]);
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-003.3.4).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('collapses when either root reaches the other through a symlink', () => {
    const root = createTemporaryRoot();
    const home = join(root, 'home');
    const project = join(root, 'project');
    write(join(project, '.agents', 'agents', 'coding', 'agent.md'), agentMd('coding'));
    mkdirSync(home, { recursive: true });
    symlinkSync(join(project, '.agents'), join(home, '.agents'));

    const homeLinksProject = discoverLayers({
      homeDirectory: home,
      projectDirectory: project,
      settings: { sources: [] },
    });
    expect(homeLinksProject.layers.map((layer) => layer.origin)).toEqual(['global']);

    const reversedRoot = createTemporaryRoot();
    const reversedHome = join(reversedRoot, 'home');
    const reversedProject = join(reversedRoot, 'project');
    write(join(reversedHome, '.agents', 'agents', 'coding', 'agent.md'), agentMd('coding'));
    mkdirSync(reversedProject, { recursive: true });
    symlinkSync(join(reversedHome, '.agents'), join(reversedProject, '.agents'));

    const projectLinksHome = discoverLayers({
      homeDirectory: reversedHome,
      projectDirectory: reversedProject,
      settings: { sources: [] },
    });
    expect(projectLinksHome.layers.map((layer) => layer.origin)).toEqual(['global']);
    expect(findResource(resolveResources(projectLinksHome.layers), 'agent', 'coding')).toBeDefined();
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-003.3.1, OFTR-003.3.4).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('still shadows and warns across distinct roots', () => {
    const root = createTemporaryRoot();
    const home = join(root, 'home');
    const project = join(root, 'project');
    write(join(home, '.agents', 'agents', 'coding', 'agent.md'), agentMd('coding'));
    write(join(project, '.agents', 'agents', 'coding', 'agent.md'), agentMd('coding'));

    const resolved = resolveEffectiveSet({ homeDirectory: home, projectDirectory: project });
    expect(resolved.set.layers.map((layer) => layer.origin)).toEqual(['workspace', 'global']);
    expect(findResource(resolved.set, 'agent', 'coding')?.winner.layer.label).toBe('workspace');
    expect(resolved.warnings.join('\n')).toContain(
      "Ambiguous agent slug 'coding' is supplied by 'workspace', 'global'",
    );
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-003.3.4).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('tolerates missing payload roots without crashing discovery', () => {
    const root = createTemporaryRoot();
    const home = join(root, 'home');

    const discovered = discoverLayers({ homeDirectory: home, projectDirectory: home, settings: { sources: [] } });
    expect(discovered.layers).toEqual([]);
    expect(resolveResources(discovered.layers).resources.get('agent')?.size ?? 0).toBe(0);
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-003.3.4).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('suppresses the self-shadowing warnings on every shared-resolver command from home', () => {
    const home = createTemporaryRoot();
    write(join(home, '.agents', 'agents', 'coding', 'agent.md'), agentMd('coding'));

    const resolved = resolveEffectiveSet({ homeDirectory: home, projectDirectory: home });
    expect(resolved.warnings.filter((warning) => warning.includes('Ambiguous'))).toEqual([]);

    const listed = executeListCommand({ homeDirectory: home, projectDirectory: home, kind: 'agents' });
    expect(listed.messages.join('\n')).not.toContain('Ambiguous');

    const validation = executeValidateCommand({ homeDirectory: home, projectDirectory: home });
    expect(validation.ok).toBe(true);
    expect(validation.findings.filter((finding) => finding.severity === 'warning')).toEqual([]);
    expect(executeValidateCommand({ homeDirectory: home, projectDirectory: home, strict: true }).ok).toBe(true);
  });

  it('keeps settings scopes readable when the working directory coincides with home', () => {
    const home = createTemporaryRoot();
    write(join(home, '.agents', 'agents', 'coding', 'agent.md'), agentMd('coding'));
    const catalog = createTemporaryRoot();
    write(join(home, '.agents', 'settings.yml'), `sources:\n  - path: ${catalog}\n`);

    const resolved = resolveEffectiveSet({ homeDirectory: home, projectDirectory: home });
    // The user-scope settings file is still read and its path source still becomes a layer.
    expect(resolved.set.layers.some((layer) => layer.origin === 'source' && layer.root === catalog)).toBe(true);
  });
});
