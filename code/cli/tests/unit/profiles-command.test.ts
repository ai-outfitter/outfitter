// Covers `outfitter profiles [--json]`: per-profile, per-harness parity against the compiled
// registry, including unavailable homes, stale projections, and unsupported-element reporting.
// THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-012.6.7): the parity command reports every compiled
// agent's fingerprint and each harness's projection status with unsupported elements listed.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { executeProfilesCommand } from '../../src/cli/commands/ProfilesCommand.js';
import { compileProfiles } from '../../src/profiles/ProfileCompiler.js';
import type { ProfileRegistry } from '../../src/profiles/ProfileCompiler.js';
import { applyProfileProjection, planProfileProjection } from '../../src/profiles/ProfileProjection.js';
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

/** Home tree with one full-loadout agent, plus empty Claude and Codex harness homes. */
const fixture = () => {
  const root = mkdtempSync(join(tmpdir(), 'outfitter-profiles-command-'));
  roots.push(root);
  const home = join(root, 'home');
  const project = join(root, 'project');
  mkdirSync(project, { recursive: true });
  const tree = join(home, '.agents');
  write(join(tree, 'settings.yml'), 'default_agent: engineer\n');
  write(join(tree, 'agents.md'), 'Shared context.\n');
  write(join(tree, 'mcp.json'), JSON.stringify({ mcpServers: { github: { command: 'gh-mcp' } } }));
  write(join(tree, 'skills', 'review', 'SKILL.md'), '---\nname: review\ndescription: Review code.\n---\n');
  write(
    join(tree, 'agents', 'engineer', 'agent.md'),
    agent(
      'engineer',
      'description: Builds things.\nskills: [review]\nmcp: [github]\nmodel: anthropic/claude-sonnet-4-5\nthinking: high\n',
    ),
  );
  write(join(tree, 'agents', 'founder', 'agent.md'), agent('founder'));
  // Detected harness homes: existence is enough because the env carries no PATH.
  mkdirSync(join(home, '.claude'), { recursive: true });
  mkdirSync(join(home, '.codex'), { recursive: true });
  const { set, settings } = resolveEffectiveSet({ homeDirectory: home, projectDirectory: project });
  const compiled = compileProfiles({
    set,
    agents: ['engineer', 'founder'],
    projectDirectory: project,
    agentDefaults: settings.agentDefaults,
  });
  if (compiled.registry === undefined) throw new Error(`fixture failed to compile: ${compiled.errors.join('; ')}`);
  return { home, project, registry: compiled.registry };
};

const input = (home: string, json?: boolean) => ({
  homeDirectory: home,
  projectDirectory: join(home, '..', 'project'),
  json,
  env: {},
});

describe('profiles parity command', () => {
  it('reports no compiled profiles before the first sync', () => {
    const { home } = fixture();
    const result = executeProfilesCommand(input(home));
    expect(result.exitCode).toBe(0);
    expect(result.messages).toEqual(["No compiled profiles. Run 'outfitter sync' to compile the enabled agents."]);
  });

  it('reports ready and partial per harness, and unavailable when no home exists', () => {
    const { home, registry } = fixture();
    write(join(home, '.outfitter', 'profiles', 'registry.json'), `${JSON.stringify(registry, null, 2)}\n`);
    applyProfileProjection(planProfileProjection(registry, 'claude', join(home, '.claude')), join(home, '.claude'));
    // Codex home exists but nothing was projected into it.

    const result = executeProfilesCommand(input(home, true));
    expect(result.exitCode).toBe(0);
    const report = result.report!;
    expect(report).toHaveLength(2);
    const entry = (
      JSON.parse(result.messages[0]) as {
        profiles: { agent: string; fingerprint: string; pi: unknown; claude: unknown; codex: unknown }[];
      }
    ).profiles[0];
    expect(entry.agent).toBe('engineer');
    expect(entry.fingerprint).toMatch(/^sha256:[0-9a-f]{64}$/u);
    // No pi home in this fixture -> unavailable; claude projected and current -> partial (mcp);
    // codex home exists without a projection -> missing.
    expect(entry.pi).toEqual({ status: 'unavailable' });
    expect(entry.claude).toEqual({ status: 'partial', unsupported: ['mcp'] });
    expect(entry.codex).toEqual({ status: 'missing' });
    expect(report[0].claude.status).toBe('partial');
  });

  it('reports missing for a stale projection whose fingerprint lags the registry', () => {
    const { home, registry } = fixture();
    write(join(home, '.outfitter', 'profiles', 'registry.json'), `${JSON.stringify(registry, null, 2)}\n`);
    const stale: ProfileRegistry = {
      version: 1,
      profiles: registry.profiles.map((profile) => ({ ...profile, fingerprint: 'sha256:' + '0'.repeat(64) })),
    };
    applyProfileProjection(planProfileProjection(stale, 'claude', join(home, '.claude')), join(home, '.claude'));

    const entry = (
      JSON.parse(executeProfilesCommand(input(home, true)).messages[0]) as {
        profiles: { claude: { status: string } }[];
      }
    ).profiles[0];
    expect(entry.claude.status).toBe('missing');
  });

  it('renders human-readable lines without --json', () => {
    const { home, registry } = fixture();
    write(join(home, '.outfitter', 'profiles', 'registry.json'), `${JSON.stringify(registry, null, 2)}\n`);
    applyProfileProjection(planProfileProjection(registry, 'claude', join(home, '.claude')), join(home, '.claude'));

    const result = executeProfilesCommand(input(home));
    expect(result.messages).toEqual([
      expect.stringMatching(
        /^engineer sha256:[0-9a-f]{64} pi:unavailable claude:partial \(unsupported: mcp\) codex:missing$/u,
      ),
      expect.stringMatching(/^founder sha256:[0-9a-f]{64} pi:unavailable claude:ready codex:missing$/u),
    ]);
  });

  it('reports ready when the projected fingerprint matches the compiled registry', () => {
    const { home, registry } = fixture();
    write(join(home, '.outfitter', 'profiles', 'registry.json'), `${JSON.stringify(registry, null, 2)}\n`);
    applyProfileProjection(planProfileProjection(registry, 'claude', join(home, '.claude')), join(home, '.claude'));
    // pi home carries the full compiled registry, which always matches itself.
    mkdirSync(join(home, '.pi', 'agent', 'outfitter', 'profiles'), { recursive: true });
    write(
      join(home, '.pi', 'agent', 'outfitter', 'profiles', 'registry.json'),
      `${JSON.stringify(registry, null, 2)}\n`,
    );

    const entry = JSON.parse(executeProfilesCommand(input(home, true)).messages[0]) as {
      profiles: { agent: string; pi: { status: string; unsupported?: string[] }; claude: { status: string } }[];
    };
    const founder = entry.profiles.find((profile) => profile.agent === 'founder');
    expect(founder?.pi).toEqual({ status: 'ready' });
    expect(founder?.claude.status).toBe('ready');
  });

  it('treats malformed or mismatched projection metadata as missing, never as an error', () => {
    const { home, registry } = fixture();
    write(join(home, '.outfitter', 'profiles', 'registry.json'), `${JSON.stringify(registry, null, 2)}\n`);
    const claude = join(home, '.claude');
    const codex = join(home, '.codex');
    mkdirSync(join(claude, 'outfitter'), { recursive: true });
    mkdirSync(join(codex, 'outfitter'), { recursive: true });
    mkdirSync(join(home, '.pi', 'agent', 'outfitter', 'profiles'), { recursive: true });

    // Corrupt documents read as no projection.
    write(join(claude, 'outfitter', 'profiles.json'), '{broken');
    write(join(codex, 'outfitter', 'profiles.json'), '{broken');
    write(join(home, '.pi', 'agent', 'outfitter', 'profiles', 'registry.json'), '{broken');
    let report = JSON.parse(executeProfilesCommand(input(home, true)).messages[0]) as {
      profiles: { agent: string; pi: { status: string }; claude: { status: string }; codex: { status: string } }[];
    };
    expect(report.profiles[0].claude.status).toBe('missing');
    expect(report.profiles[0].codex.status).toBe('missing');
    expect(report.profiles[0].pi.status).toBe('missing');

    // Wrong harness, missing entries, null entries, and fingerprint-less agents all read as missing.
    write(join(claude, 'outfitter', 'profiles.json'), JSON.stringify({ harness: 'codex', profiles: [] }));
    write(join(codex, 'outfitter', 'profiles.json'), JSON.stringify({ harness: 'codex' }));
    write(
      join(home, '.pi', 'agent', 'outfitter', 'profiles', 'registry.json'),
      JSON.stringify({ version: 1, profiles: [null, { agent: 'other', fingerprint: 'sha256:x' }] }),
    );
    report = JSON.parse(executeProfilesCommand(input(home, true)).messages[0]) as typeof report;
    expect(report.profiles[0].claude.status).toBe('missing');
    expect(report.profiles[0].codex.status).toBe('missing');
    expect(report.profiles[0].pi.status).toBe('missing');

    // An index entry for the right agent without a fingerprint is missing too.
    write(
      join(claude, 'outfitter', 'profiles.json'),
      JSON.stringify({ harness: 'claude', profiles: [{ agent: 'engineer' }] }),
    );
    write(
      join(home, '.pi', 'agent', 'outfitter', 'profiles', 'registry.json'),
      JSON.stringify({ version: 1, profiles: [{ agent: 'engineer' }] }),
    );
    report = JSON.parse(executeProfilesCommand(input(home, true)).messages[0]) as typeof report;
    expect(report.profiles[0].claude.status).toBe('missing');
    expect(report.profiles[0].pi.status).toBe('missing');
  });
});
