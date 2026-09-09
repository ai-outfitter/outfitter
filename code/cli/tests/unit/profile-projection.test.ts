// Covers harness projection of the compiled registry: native artifact shapes, fingerprint parity,
// idempotent reconciliation, and unmanaged-file preservation.
// THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-012.6.1/3/4/6): the Pi, Claude, and Codex projections
// record the compiled composition fingerprint, and replaying unchanged inputs performs no mutation.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { parse as parseToml } from 'smol-toml';

import { afterEach, describe, expect, it } from 'vitest';

import { compileProfiles } from '../../src/profiles/ProfileCompiler.js';
import type { ProfileRegistry } from '../../src/profiles/ProfileCompiler.js';
import {
  applyProfileProjection,
  planProfileProjection,
  unsupportedProfileElements,
} from '../../src/profiles/ProfileProjection.js';
import { resolveEffectiveSet } from '../../src/resolver/ResolverContext.js';

interface ProfileManifestDocument {
  readonly harness: string;
  readonly profiles?: unknown;
  readonly entries: readonly { readonly path: string }[];
}

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

const write = (path: string, content: string): void => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
};

const agent = (name: string, extra = ''): string => `---\nname: ${name}\n${extra}---\n\n# ${name}\n`;

/** A home tree with one full-loadout agent; returns its compiled registry. */
const fixture = (): { registry: ProfileRegistry; home: string } => {
  const root = mkdtempSync(join(tmpdir(), 'outfitter-profile-projection-'));
  roots.push(root);
  const home = join(root, 'home');
  const tree = join(home, '.agents');
  write(join(tree, 'settings.yml'), 'default_agent: engineer\n');
  write(join(tree, 'agents.md'), 'Shared context.\n');
  write(join(tree, 'mcp.json'), JSON.stringify({ mcpServers: { github: { command: 'gh-mcp' } } }));
  write(join(tree, 'skills', 'review', 'SKILL.md'), '---\nname: review\ndescription: Review code.\n---\n');
  write(
    join(tree, 'agents', 'engineer', 'agent.md'),
    agent(
      'engineer',
      'description: Builds things.\nskills: [review]\nsubagents: [founder]\nmcp: [github]\nmodel: anthropic/claude-sonnet-4-5\nthinking: high\ntools: {allow: [read, bash]}\n',
    ),
  );
  write(join(tree, 'agents', 'founder', 'agent.md'), agent('founder'));
  const { set, settings } = resolveEffectiveSet({ homeDirectory: home, projectDirectory: join(root, 'project') });
  const compiled = compileProfiles({
    set,
    agents: ['engineer', 'founder'],
    projectDirectory: join(root, 'project'),
    agentDefaults: settings.agentDefaults,
  });
  if (compiled.registry === undefined) throw new Error(`fixture failed to compile: ${compiled.errors.join('; ')}`);
  return { registry: compiled.registry, home };
};

describe('profile projection plans', () => {
  it('plans the Pi registry, Claude native agents, and Codex config profiles', () => {
    const { registry } = fixture();
    const pi = planProfileProjection(registry, 'pi', '/home/user');
    expect(pi.artifacts.map((artifact) => artifact.path)).toEqual(['outfitter/profiles/registry.json']);
    const piRegistry = JSON.parse(pi.artifacts[0].content) as ProfileRegistry;
    expect(piRegistry.version).toBe(1);
    expect(piRegistry.profiles.map((profile) => profile.agent)).toEqual(['engineer', 'founder']);

    const claude = planProfileProjection(registry, 'claude', '/home/user');
    expect(claude.artifacts.map((artifact) => artifact.path)).toEqual([
      'agents/engineer.md',
      'agents/founder.md',
      'outfitter/profiles.json',
    ]);
    const engineer = claude.artifacts.find((artifact) => artifact.path === 'agents/engineer.md')!;
    expect(engineer.fingerprint).toBe(registry.profiles[0].fingerprint);
    expect(engineer.content).toContain(`fingerprint ${registry.profiles[0].fingerprint}`);
    expect(engineer.content).toContain('name: "engineer"');
    expect(engineer.content).toContain('model: "anthropic/claude-sonnet-4-5"');
    expect(engineer.content).toContain('thinking: "high"');

    const codex = planProfileProjection(registry, 'codex', '/home/user');
    expect(codex.artifacts.map((artifact) => artifact.path)).toEqual([
      'outfitter/agents/engineer.md',
      'engineer.config.toml',
      'outfitter/agents/founder.md',
      'founder.config.toml',
      'outfitter/profiles.json',
    ]);
  });

  it('reports unsupported elements per harness instead of dropping them silently', () => {
    const { registry } = fixture();
    const engineer = registry.profiles.find((profile) => profile.agent === 'engineer')!;
    // Pi can switch skills, model, thinking, and tools in-session, but not MCP servers or subagents.
    expect(unsupportedProfileElements('pi', engineer)).toEqual(['subagents', 'mcp']);
    expect(unsupportedProfileElements('claude', engineer)).toEqual(['subagents', 'mcp']);
    // Codex profiles carry identity, model, and reasoning effort only.
    expect(unsupportedProfileElements('codex', engineer)).toEqual(['skills', 'subagents', 'mcp', 'tools']);
    const founder = registry.profiles.find((profile) => profile.agent === 'founder')!;
    expect(unsupportedProfileElements('pi', founder)).toEqual([]);
    expect(unsupportedProfileElements('codex', founder)).toEqual([]);
  });

  it('writes a parseable Codex config profile referencing its instruction document', () => {
    const { registry } = fixture();
    const home = mkdtempSync(join(tmpdir(), 'outfitter-profile-projection-codex-'));
    roots.push(home);
    const codex = planProfileProjection(registry, 'codex', home);
    applyProfileProjection(codex, home);

    const configPath = join(home, 'engineer.config.toml');
    const document = parseToml(readFileSync(configPath, 'utf8')) as {
      profiles: { engineer: { model: string; model_reasoning_effort: string; instructions: string } };
    };
    expect(document.profiles.engineer.model).toBe('anthropic/claude-sonnet-4-5');
    expect(document.profiles.engineer.model_reasoning_effort).toBe('high');
    expect(document.profiles.engineer.instructions).toBe(join(home, 'outfitter', 'agents', 'engineer.md'));
    expect(readFileSync(document.profiles.engineer.instructions, 'utf8')).toContain('# engineer');
    expect(readFileSync(configPath, 'utf8')).toContain(`# fingerprint: ${registry.profiles[0].fingerprint}`);
  });
});

describe('profile projection application', () => {
  it('is idempotent: a replay reports unchanged and leaves every file byte-identical', () => {
    const { registry } = fixture();
    const claudeHome = mkdtempSync(join(tmpdir(), 'outfitter-profile-projection-claude-'));
    roots.push(claudeHome);
    const plan = planProfileProjection(registry, 'claude', claudeHome);
    const first = applyProfileProjection(plan, claudeHome);
    expect(first.map((action) => action.status)).toEqual(['created', 'created', 'created']);
    const snapshots = plan.artifacts.map((artifact) => ({
      path: artifact.path,
      content: readFileSync(join(claudeHome, artifact.path), 'utf8'),
      mtime: statSync(join(claudeHome, artifact.path)).mtimeMs,
    }));

    const second = applyProfileProjection(plan, claudeHome);
    expect(second.map((action) => action.status)).toEqual(['unchanged', 'unchanged', 'unchanged']);
    for (const snapshot of snapshots) {
      expect(readFileSync(join(claudeHome, snapshot.path), 'utf8')).toBe(snapshot.content);
      expect(statSync(join(claudeHome, snapshot.path)).mtimeMs).toBe(snapshot.mtime);
    }
  });

  it('updates owned artifacts when the composition changes and removes departed profiles', () => {
    const { registry } = fixture();
    const home = mkdtempSync(join(tmpdir(), 'outfitter-profile-projection-update-'));
    roots.push(home);
    applyProfileProjection(planProfileProjection(registry, 'claude', home), home);

    const engineer = registry.profiles.find((profile) => profile.agent === 'engineer')!;
    const updated: ProfileRegistry = {
      version: 1,
      profiles: [{ ...engineer, systemPrompt: `${engineer.systemPrompt}\nChanged.` }],
    };
    const actions = applyProfileProjection(planProfileProjection(updated, 'claude', home), home);
    expect(actions.find((action) => action.path === 'agents/engineer.md')?.status).toBe('updated');
    expect(actions.find((action) => action.path === 'agents/founder.md')?.status).toBe('removed');
    expect(existsSync(join(home, 'agents', 'founder.md'))).toBe(false);
    // The manifest keeps owning exactly the projected artifacts.
    const manifest = JSON.parse(
      readFileSync(join(home, '.outfitter', 'profiles.json'), 'utf8'),
    ) as ProfileManifestDocument;
    expect(manifest.profiles).toBe(undefined);
    expect(manifest.entries.map((entry: { path: string }) => entry.path)).toEqual([
      'agents/engineer.md',
      'outfitter/profiles.json',
    ]);
  });

  it('never overwrites or removes an unmanaged file at a planned path (OFTR-012 ownership)', () => {
    const { registry } = fixture();
    const home = mkdtempSync(join(tmpdir(), 'outfitter-profile-projection-conflict-'));
    roots.push(home);
    write(join(home, 'agents', 'engineer.md'), 'The user wrote this themselves.\n');

    const actions = applyProfileProjection(planProfileProjection(registry, 'claude', home), home);
    const conflict = actions.find((action) => action.path === 'agents/engineer.md');
    expect(conflict?.status).toBe('conflict');
    expect(readFileSync(join(home, 'agents', 'engineer.md'), 'utf8')).toBe('The user wrote this themselves.\n');
    // The conflicting path is not adopted into the ownership manifest.
    const manifest = JSON.parse(
      readFileSync(join(home, '.outfitter', 'profiles.json'), 'utf8'),
    ) as ProfileManifestDocument;
    expect(manifest.entries.map((entry) => entry.path)).not.toContain('agents/engineer.md');
  });

  it('treats a link-managed artifact as owned and updates it in place', () => {
    const { registry } = fixture();
    const home = mkdtempSync(join(tmpdir(), 'outfitter-profile-projection-links-'));
    roots.push(home);
    // `outfitter link` recorded agents/engineer.md in its manifest earlier.
    write(
      join(home, '.outfitter', 'links.json'),
      JSON.stringify({
        version: 1,
        harness: 'claude',
        entries: [{ kind: 'file', path: 'agents/engineer.md' }],
      }),
    );
    write(join(home, 'agents', 'engineer.md'), 'Old link output.\n');

    const actions = applyProfileProjection(planProfileProjection(registry, 'claude', home), home);
    expect(actions.find((action) => action.path === 'agents/engineer.md')?.status).toBe('updated');
    expect(readFileSync(join(home, 'agents', 'engineer.md'), 'utf8')).toContain('# engineer');
  });

  it('conflicts with a directory occupying a planned path', () => {
    const { registry } = fixture();
    const home = mkdtempSync(join(tmpdir(), 'outfitter-profile-projection-dir-'));
    roots.push(home);
    mkdirSync(join(home, 'agents', 'engineer.md'), { recursive: true });

    const actions = applyProfileProjection(planProfileProjection(registry, 'claude', home), home);
    expect(actions.find((action) => action.path === 'agents/engineer.md')?.status).toBe('conflict');
    expect(actions.find((action) => action.path === 'agents/engineer.md')?.detail).toContain('directory');
    expect(statSync(join(home, 'agents', 'engineer.md')).isDirectory()).toBe(true);
  });

  it('projects an empty registry without artifacts and clears a stale manifest', () => {
    const { registry } = fixture();
    const home = mkdtempSync(join(tmpdir(), 'outfitter-profile-projection-empty-'));
    roots.push(home);
    applyProfileProjection(planProfileProjection(registry, 'claude', home), home);
    expect(existsSync(join(home, 'agents', 'engineer.md'))).toBe(true);

    const actions = applyProfileProjection(planProfileProjection({ version: 1, profiles: [] }, 'claude', home), home);
    // The parity index is planned even for an empty registry; every agent artifact is removed.
    expect(actions.map((action) => action.status)).toEqual(['updated', 'removed', 'removed']);
    expect(existsSync(join(home, 'agents', 'engineer.md'))).toBe(false);
    // The parity index doubles as the ownership manifest, so it remains for the empty registry.
    expect(existsSync(join(home, '.outfitter', 'profiles.json'))).toBe(true);
    // The pi plan for an empty registry carries no registry artifact at all.
    expect(planProfileProjection({ version: 1, profiles: [] }, 'pi', home).artifacts).toEqual([]);
  });

  it('recovers when the ownership manifest is malformed', () => {
    const { registry } = fixture();
    const home = mkdtempSync(join(tmpdir(), 'outfitter-profile-projection-manifest-'));
    roots.push(home);
    const plan = planProfileProjection(registry, 'claude', home);
    const unownedIsConflict = (document: unknown): void => {
      write(
        join(home, '.outfitter', 'profiles.json'),
        typeof document === 'string' ? document : JSON.stringify(document),
      );
      write(join(home, 'agents', 'engineer.md'), 'Human content.\n');
      const actions = applyProfileProjection(plan, home);
      expect(actions.find((action) => action.path === 'agents/engineer.md')?.status).toBe('conflict');
      expect(readFileSync(join(home, 'agents', 'engineer.md'), 'utf8')).toBe('Human content.\n');
    };
    // Corrupt JSON, a foreign harness, missing entries, and null entries all read as no ownership.
    unownedIsConflict('not json at all\n');
    unownedIsConflict({ version: 1, harness: 'codex', entries: [] });
    unownedIsConflict({ version: 1, harness: 'claude' });
    unownedIsConflict({ version: 1, harness: 'claude', entries: [null, { resource: 'agent:x', fingerprint: 's' }] });
    // Absent files are still created when ownership cannot be read.
    rmSync(join(home, 'agents'), { recursive: true, force: true });
    write(join(home, '.outfitter', 'profiles.json'), '{broken');
    const created = applyProfileProjection(plan, home);
    expect(created.find((action) => action.path === 'agents/founder.md')?.status).toBe('created');
  });

  it('clears the manifest when nothing is planned for the harness', () => {
    const home = mkdtempSync(join(tmpdir(), 'outfitter-profile-projection-clear-'));
    roots.push(home);
    const actions = applyProfileProjection(planProfileProjection({ version: 1, profiles: [] }, 'pi', home), home);
    expect(actions).toEqual([]);
    expect(existsSync(join(home, '.outfitter'))).toBe(false);
  });

  it('treats a malformed link manifest as no ownership', () => {
    const { registry } = fixture();
    const home = mkdtempSync(join(tmpdir(), 'outfitter-profile-projection-badlinks-'));
    roots.push(home);
    write(join(home, '.outfitter', 'links.json'), '{broken');
    write(join(home, 'agents', 'engineer.md'), 'Human content.\n');

    const actions = applyProfileProjection(planProfileProjection(registry, 'claude', home), home);
    expect(actions.find((action) => action.path === 'agents/engineer.md')?.status).toBe('conflict');
  });
});
