// Covers compiled profile registry production: one composition per enabled agent, stable
// fingerprints, and the harness-neutral fields every projection consumes.
// THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-004.2.25): sync compiles every enabled agent exactly
// once from the resolved source set into the harness-neutral registry.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { compose } from '../../src/composer/Composer.js';
import { canonicalJson, compileProfiles, serializeProfileRegistry } from '../../src/profiles/ProfileCompiler.js';
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

/** A home tree with two scoped agents; the engineer delegates to the founder as a subagent. */
const fixture = () => {
  const root = mkdtempSync(join(tmpdir(), 'outfitter-profile-compiler-'));
  roots.push(root);
  const home = join(root, 'home');
  const project = join(root, 'project');
  mkdirSync(project, { recursive: true });
  const tree = join(home, '.agents');
  write(join(tree, 'settings.yml'), 'default_agent: engineer\n');
  write(join(tree, 'agents.md'), 'Shared context.\n');
  write(join(tree, 'mcp.json'), JSON.stringify({ mcpServers: { github: { command: 'gh-mcp' } } }));
  write(join(tree, 'skills', 'review', 'SKILL.md'), '---\nname: review\ndescription: Review code carefully.\n---\n');
  write(
    join(tree, 'agents', 'engineer', 'agent.md'),
    agent(
      'engineer',
      'label: Engineer\ndescription: Builds things.\nskills: [review]\nsubagents: [founder]\nmcp: [github]\nmodel: anthropic/claude-sonnet-4-5\nthinking: high\ntools: {allow: [read, bash, edit], deny: [write]}\n',
    ),
  );
  write(join(tree, 'agents', 'founder', 'agent.md'), agent('founder', 'label: Founder\n'));
  return { home, project };
};

describe('compiled profile registry', () => {
  it('composes every scoped agent exactly once, even when one delegates to the other', () => {
    const { home, project } = fixture();
    const { set, settings } = resolveEffectiveSet({ homeDirectory: home, projectDirectory: project });
    const composedSlugs: string[] = [];
    const composeSpy = vi.fn((...args: Parameters<typeof compose>) => {
      composedSlugs.push(args[1]);
      return compose(...args);
    });

    const result = compileProfiles({
      set,
      agents: ['engineer', 'founder'],
      projectDirectory: project,
      agentDefaults: settings.agentDefaults,
      compose: composeSpy,
    });

    expect(result.errors).toEqual([]);
    expect(result.registry?.profiles.map((profile) => profile.agent)).toEqual(['engineer', 'founder']);
    // Exactly one compose call per scoped agent, in scope order: the compiler never recomposes a
    // delegate that another scoped agent already carries as a subagent.
    expect(composedSlugs).toEqual(['engineer', 'founder']);
  });

  it('records the fingerprint, identity, loadout, and skill summaries per profile', () => {
    const { home, project } = fixture();
    const { set, settings } = resolveEffectiveSet({ homeDirectory: home, projectDirectory: project });
    const result = compileProfiles({
      set,
      agents: ['engineer'],
      projectDirectory: project,
      agentDefaults: settings.agentDefaults,
    });
    expect(result.errors).toEqual([]);
    const profile = result.registry!.profiles[0];
    expect(profile.agent).toBe('engineer');
    expect(profile.fingerprint).toMatch(/^sha256:[0-9a-f]{64}$/u);
    expect(profile.label).toBe('Engineer');
    expect(profile.description).toBe('Builds things.');
    expect(profile.systemPrompt).toContain('# engineer');
    expect(profile.systemPrompt).toContain('Shared context.');
    expect(profile.skills).toEqual([{ slug: 'review', name: 'review', description: 'Review code carefully.' }]);
    expect(profile.subagents).toEqual(['founder']);
    expect(profile.model).toBe('anthropic/claude-sonnet-4-5');
    expect(profile.thinking).toBe('high');
    expect(profile.toolAllowlist).toEqual(['read', 'bash', 'edit']);
    expect(profile.toolDenylist).toEqual(['write']);
    expect(profile.mcpServers).toEqual({ github: { command: 'gh-mcp' } });
  });

  it('produces a byte-identical registry for unchanged inputs and a different one after edits', () => {
    const { home, project } = fixture();
    const resolve = () => resolveEffectiveSet({ homeDirectory: home, projectDirectory: project });
    const compileAll = () =>
      serializeProfileRegistry(
        compileProfiles({ set: resolve().set, agents: ['engineer', 'founder'], projectDirectory: project }).registry!,
      );

    const first = compileAll();
    expect(compileAll()).toBe(first);

    const agentPath = join(home, '.agents', 'agents', 'engineer', 'agent.md');
    write(agentPath, readFileSync(agentPath, 'utf8').replace('# engineer', '# engineer v2'));
    const third = compileAll();
    expect(third).not.toBe(first);
    const parsedFirst = JSON.parse(first) as { profiles: { fingerprint: string }[] };
    const parsedThird = JSON.parse(third) as { profiles: { fingerprint: string }[] };
    expect(parsedThird.profiles[0].fingerprint).not.toBe(parsedFirst.profiles[0].fingerprint);
  });

  it('collects composition failures as errors instead of aborting the registry', () => {
    const { home, project } = fixture();
    const { set, settings } = resolveEffectiveSet({ homeDirectory: home, projectDirectory: project });
    const result = compileProfiles({
      set,
      agents: ['engineer', 'missing-agent'],
      projectDirectory: project,
      agentDefaults: settings.agentDefaults,
    });
    expect(result.registry?.profiles.map((profile) => profile.agent)).toEqual(['engineer']);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors.join('\n')).toContain('missing-agent');
  });

  it('summarizes a skill with an unreadable or invalid SKILL.md by slug alone', () => {
    const { home, project } = fixture();
    write(join(home, '.agents', 'skills', 'broken', 'SKILL.md'), 'no frontmatter here\n');
    write(
      join(home, '.agents', 'agents', 'engineer', 'agent.md'),
      agent('engineer', 'description: Builds things.\nskills: [broken]\n'),
    );
    const { set, settings } = resolveEffectiveSet({ homeDirectory: home, projectDirectory: project });
    const result = compileProfiles({
      set,
      agents: ['engineer'],
      projectDirectory: project,
      agentDefaults: settings.agentDefaults,
    });
    expect(result.registry?.profiles[0].skills).toEqual([{ slug: 'broken' }]);
  });

  it('resolves the canonical model target when a models registry is effective', () => {
    const { home, project } = fixture();
    write(
      join(home, '.agents', 'models.json'),
      JSON.stringify({
        providers: {
          anthropic: {
            name: 'Anthropic',
            api: 'anthropic-messages',
            baseUrl: 'https://api.anthropic.com',
            apiKey: '$ANTHROPIC_API_KEY',
            models: [{ id: 'claude-sonnet-4-5' }],
          },
        },
      }),
    );
    const { set, settings } = resolveEffectiveSet({ homeDirectory: home, projectDirectory: project });
    const result = compileProfiles({
      set,
      agents: ['engineer'],
      projectDirectory: project,
      agentDefaults: settings.agentDefaults,
    });
    expect(result.registry?.profiles[0].modelTarget).toEqual({
      providerId: 'anthropic',
      modelId: 'claude-sonnet-4-5',
    });
  });

  it('canonicalizes JSON deterministically with sorted keys, arrays, and null for undefined', () => {
    expect(canonicalJson({ b: 1, a: [2, { d: undefined, c: 3 }] })).toBe('{"a":[2,{"c":3}],"b":1}');
    expect(canonicalJson(undefined)).toBe('null');
    expect(canonicalJson(null)).toBe('null');
    expect(canonicalJson('x')).toBe('"x"');
  });
});
