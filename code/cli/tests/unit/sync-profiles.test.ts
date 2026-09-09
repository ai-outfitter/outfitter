// Covers the compile-and-project phase `outfitter sync` runs after fetching: registry production,
// harness-home projection, idempotent replays, and unmanaged-file conflicts.
// THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-004.2.26/27/28): sync projects the compiled registry
// into every detected harness home, replays without harness mutations, and conflicts with unmanaged
// files instead of overwriting them.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { syncProfiles } from '../../src/profiles/SyncProfiles.js';
import { resolveEffectiveSet } from '../../src/resolver/ResolverContext.js';

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

const write = (path: string, content: string): void => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
};

const agent = (name: string, extra = ''): string => `---\nname: ${name}\n${extra}---\n\n# ${name}\n`;

/** Home tree with one enabled agent and pre-existing (empty) Claude and Codex homes. */
const fixture = () => {
  const root = mkdtempSync(join(tmpdir(), 'outfitter-sync-profiles-'));
  roots.push(root);
  const home = join(root, 'home');
  const project = join(root, 'project');
  mkdirSync(project, { recursive: true });
  const tree = join(home, '.agents');
  write(join(tree, 'settings.yml'), 'default_agent: engineer\n');
  write(join(tree, 'agents.md'), 'Shared context.\n');
  write(
    join(tree, 'agents', 'engineer', 'agent.md'),
    agent('engineer', 'description: Builds things.\nskills: [review]\n'),
  );
  write(join(tree, 'skills', 'review', 'SKILL.md'), '---\nname: review\ndescription: Review code.\n---\n');
  // Detected harness homes: existence is enough because the env carries no PATH.
  mkdirSync(join(home, '.pi', 'agent'), { recursive: true });
  mkdirSync(join(home, '.claude'), { recursive: true });
  mkdirSync(join(home, '.codex'), { recursive: true });
  return { home, project };
};

const sync = (home: string, project: string) => {
  const { set, settings } = resolveEffectiveSet({ homeDirectory: home, projectDirectory: project });
  return syncProfiles({ homeDirectory: home, projectDirectory: project, set, settings, env: {} });
};

describe('sync compile-and-project phase', () => {
  it('compiles the enabled agent and projects the registry into every detected harness home', () => {
    const { home, project } = fixture();
    const result = sync(home, project);
    expect(result.failed).toBe(false);
    expect(result.messages.some((message) => message.startsWith('compiled 1 agent profile(s)'))).toBe(true);

    const registry = JSON.parse(readFileSync(join(home, '.outfitter', 'profiles', 'registry.json'), 'utf8')) as {
      profiles: { agent: string; fingerprint: string }[];
    };
    expect(registry.profiles.map((profile) => profile.agent)).toEqual(['engineer']);
    const fingerprint = registry.profiles[0].fingerprint;

    // Pi received the registry; Claude a native agent doc; Codex a config profile + instructions.
    expect(
      JSON.parse(readFileSync(join(home, '.pi', 'agent', 'outfitter', 'profiles', 'registry.json'), 'utf8')) as unknown,
    ).toEqual(registry);
    const claudeDoc = readFileSync(join(home, '.claude', 'agents', 'engineer.md'), 'utf8');
    expect(claudeDoc).toContain(`fingerprint ${fingerprint}`);
    expect(readFileSync(join(home, '.codex', 'engineer.config.toml'), 'utf8')).toContain(
      `# fingerprint: ${fingerprint}`,
    );
    expect(readFileSync(join(home, '.codex', 'outfitter', 'agents', 'engineer.md'), 'utf8')).toContain('# engineer');
    expect(result.actions.every((action) => action.status === 'created')).toBe(true);
  });

  it('replays with unchanged inputs byte-identically and without harness mutations', () => {
    const { home, project } = fixture();
    sync(home, project);
    const tracked = [
      join(home, '.outfitter', 'profiles', 'registry.json'),
      join(home, '.pi', 'agent', 'outfitter', 'profiles', 'registry.json'),
      join(home, '.claude', 'agents', 'engineer.md'),
      join(home, '.claude', 'outfitter', 'profiles.json'),
      join(home, '.codex', 'engineer.config.toml'),
      join(home, '.codex', 'outfitter', 'profiles.json'),
    ].map((path) => ({ path, content: readFileSync(path, 'utf8'), mtime: statSync(path).mtimeMs }));

    const result = sync(home, project);
    expect(result.failed).toBe(false);
    expect(result.messages.some((message) => message.startsWith('compiled profiles unchanged'))).toBe(true);
    expect(result.actions.every((action) => action.status === 'unchanged')).toBe(true);
    for (const snapshot of tracked) {
      expect(readFileSync(snapshot.path, 'utf8')).toBe(snapshot.content);
      expect(statSync(snapshot.path).mtimeMs).toBe(snapshot.mtime);
    }
  });

  it('conflicts with an unmanaged harness file instead of overwriting it, failing the sync', () => {
    const { home, project } = fixture();
    write(join(home, '.claude', 'agents', 'engineer.md'), 'Unmanaged human content.\n');
    const result = sync(home, project);
    expect(result.failed).toBe(true);
    expect(result.messages.join('\n')).toContain('conflict');
    expect(readFileSync(join(home, '.claude', 'agents', 'engineer.md'), 'utf8')).toBe('Unmanaged human content.\n');
  });

  it('stays quiet when settings enable no agents', () => {
    const { home, project } = fixture();
    write(join(home, '.agents', 'settings.yml'), 'default_harness: pi\n');
    const result = sync(home, project);
    expect(result.failed).toBe(false);
    expect(result.messages).toEqual([]);
    expect(existsSync(join(home, '.outfitter', 'profiles', 'registry.json'))).toBe(false);
  });

  it('fails when a scoped agent does not compose', () => {
    const { home, project } = fixture();
    write(join(home, '.agents', 'settings.yml'), 'default_agent: engineer\nworkflows:\n  - ship\n');
    // A workflow that references an unknown agent fails workflow-closure collection.
    write(
      join(home, '.agents', 'workflows', 'ship', 'workflow.yaml'),
      `version: 1
id: ship
title: Ship
description: Ship a change.
actors:
  ghost: {kind: agent, profile: does-not-exist}
environments: {workstation: local}
nodes:
  - {id: build, action: build, description: Build., actor: ghost, environment: workstation}
`,
    );
    const result = sync(home, project);
    expect(result.failed).toBe(true);
    expect(result.messages.join('\n')).toContain('does-not-exist');
  });

  it('makes unsupported profile elements fatal under strict projection', () => {
    const { home, project } = fixture();
    write(
      join(home, '.agents', 'agents', 'engineer', 'agent.md'),
      agent('engineer', 'description: Builds things.\nmcp: [github]\n'),
    );
    write(join(home, '.agents', 'mcp.json'), JSON.stringify({ mcpServers: { github: { command: 'gh-mcp' } } }));
    const { set, settings } = resolveEffectiveSet({ homeDirectory: home, projectDirectory: project });
    const result = syncProfiles({
      homeDirectory: home,
      projectDirectory: project,
      set,
      settings,
      env: {},
      strict: true,
    });
    expect(result.failed).toBe(true);
    expect(result.messages.join('\n')).toContain('cannot project element(s) mcp');
  });

  it('fails when the harness-neutral registry cannot be written', () => {
    const { home, project } = fixture();
    // A file at ~/.outfitter blocks the registry directory.
    write(join(home, '.outfitter'), 'not a directory\n');
    const { set, settings } = resolveEffectiveSet({ homeDirectory: home, projectDirectory: project });
    const result = syncProfiles({ homeDirectory: home, projectDirectory: project, set, settings, env: {} });
    expect(result.failed).toBe(true);
    expect(result.messages.join('\n')).toContain('cannot write the compiled profile registry');
  });
});
