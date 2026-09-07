import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { parse as parseToml } from 'smol-toml';
import { parse as parseYaml } from 'yaml';
import { afterEach, describe, expect, it } from 'vitest';

import type { CompositionPlan } from '../../src/composer/Composition.js';
import type { PromptFragment } from '../../src/composer/PromptSource.js';
import { applyHarnessLinks } from '../../src/links/HarnessLinkApply.js';
import type { HarnessLinkPlan } from '../../src/links/HarnessLinkPlan.js';
import { nativeProfileName, planNativeProfiles, profileProjectionStatus } from '../../src/profiles/NativeProfiles.js';
import type { NativeProfile } from '../../src/profiles/NativeProfiles.js';
import type { ResolvedResource } from '../../src/resolver/Resource.js';

const roots: string[] = [];
const fixture = (): string => {
  const root = join(process.cwd(), `.native-profiles-test-${randomUUID()}`);
  mkdirSync(root);
  roots.push(root);
  return root;
};
const write = (path: string, content: string): void => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
};
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
const composition = (
  loadout: Partial<CompositionPlan['loadout']> = {},
  identity: Partial<CompositionPlan['identity']> = {},
): CompositionPlan => ({
  agent: 'leader',
  identity: { agentBody: 'Lead the work.', ...identity },
  loadout: {
    skills: [],
    delegateSkills: [],
    subagents: [],
    mcp: [],
    mcpServers: {},
    extensions: [],
    plugins: [],
    ...loadout,
  },
  warnings: [],
});
const profile = (plan = composition(), agent = plan.agent): NativeProfile => ({
  agent,
  fingerprint: `fingerprint-${agent}`,
  plan,
});
const fragment = (content: string): PromptFragment => ({
  content,
  kind: 'agent_body',
  label: content,
  trust: 'catalog',
});
const skill = (root: string, slug = 'review'): ResolvedResource => {
  const path = join(root, 'skills', slug, 'SKILL.md');
  write(path, `# ${slug}`);
  return {
    kind: 'skill',
    slug,
    winner: { kind: 'skill', slug, path, layer: { root, origin: 'workspace', label: 'test' } },
    shadowed: [],
  };
};
const content = (plan: HarnessLinkPlan, path: string): string =>
  plan.entries.find((entry) => entry.path === path)!.content!;
const frontmatter = (plan: HarnessLinkPlan): Record<string, unknown> =>
  parseYaml(content(plan, 'agents/leader.md').split('---\n')[1]) as Record<string, unknown>;
const apply = (plan: HarnessLinkPlan, home: string) =>
  applyHarnessLinks(plan, home, {}, () => ({ found: false, ok: false, output: '' }));

// THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-006.10).
// YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
describe('sync-native profile projection', () => {
  it('plans no global identity replacement and leaves Pi activation to the runtime registry', () => {
    const plan = planNativeProfiles([profile(composition(), 'z'), profile(composition(), 'a')], 'pi', '/pi');
    expect(plan.entries).toHaveLength(1);
    expect(JSON.parse(content(plan, '.outfitter/profiles.json'))).toEqual({
      version: 1,
      profiles: [
        { agent: 'a', fingerprint: 'fingerprint-a' },
        { agent: 'z', fingerprint: 'fingerprint-z' },
      ],
    });
    expect(profileProjectionStatus(composition({ plugins: ['native'] }), 'pi')).toEqual({
      status: 'partial',
      unsupported: ['plugins'],
    });
    expect(planNativeProfiles([], 'claude', '/claude')).toEqual({ harness: 'claude', entries: [], warnings: [] });
  });

  it('reports Pi activation gaps and unsupported MCP transports rather than unconditional readiness', () => {
    expect(profileProjectionStatus(composition(), 'pi')).toEqual({ status: 'ready', unsupported: [] });
    expect(profileProjectionStatus(composition({ thinking: 'high' }), 'pi')).toEqual({
      status: 'ready',
      unsupported: [],
    });
    expect(profileProjectionStatus(composition({ thinking: 'unlimited' }), 'pi')).toEqual({
      status: 'partial',
      unsupported: ['thinking'],
    });
    const composed = composition(
      {
        plugins: ['plugin'],
        extensions: ['launch-only-extension'],
        mcp: ['stdio', 'http', 'inferred', 'inferred-http', 'missing', 'invalid', 'blank', 'sse'],
        mcpServers: {
          stdio: { type: 'stdio', command: 'docs-server' },
          http: { type: 'http', url: 'https://example.invalid' },
          inferred: { command: 'docs-server' },
          'inferred-http': { url: 'https://example.invalid' },
          invalid: {},
          blank: { command: '' },
          sse: { type: 'sse', url: 'https://example.invalid/events' },
        },
      },
      { promptTemplate: fragment('Template') },
    );
    const unsupported = [
      'plugins',
      'prompt_template',
      'extensions_live_activation',
      'mcp_transport:http',
      'mcp_transport:inferred-http',
      'mcp:missing',
      'mcp:invalid',
      'mcp:blank',
      'mcp_transport:sse',
    ];
    expect(profileProjectionStatus(composed, 'pi')).toEqual({ status: 'partial', unsupported });
    expect(planNativeProfiles([profile(composed)], 'pi', '/pi').warnings).toEqual(
      unsupported.map((control) => `pi profile 'leader' does not support ${control}.`),
    );
  });

  it('serializes complete Claude identity and only supported native fields', () => {
    const selectedSkill = skill(fixture());
    const plan = planNativeProfiles(
      [
        profile(
          composition(
            {
              model: 'sonnet',
              thinking: 'high',
              skills: [selectedSkill],
              tools: { allow: ['Read', 'Bash'], deny: ['Bash'] },
              mcp: ['docs'],
              mcpServers: { docs: { command: 'docs-server' } },
              extensions: ['pi-extension'],
            },
            {
              description: 'A useful leader',
              systemPrompt: 'System',
              sharedContext: 'Shared',
              appendSystemPrompts: [fragment('Appended')],
              agentBodies: [fragment('Parent'), fragment('Child')],
            },
          ),
        ),
      ],
      'claude',
      '/claude',
    );
    expect(frontmatter(plan)).toEqual({
      name: 'leader',
      description: 'A useful leader',
      model: 'sonnet',
      tools: ['Read'],
      disallowedTools: ['Bash'],
      skills: ['review'],
      mcpServers: ['docs'],
    });
    expect(content(plan, 'agents/leader.md')).toContain('System\n\nShared\n\nAppended\n\nParent\n\nChild');
    expect(content(plan, 'agents/leader.md')).not.toContain('Lead the work.');
    expect(plan.warnings).toEqual([
      "claude profile 'leader' does not support extensions.",
      "claude profile 'leader' does not support thinking.",
    ]);
  });

  it('preserves explicit empty Claude allowlists and deny-only controls', () => {
    const empty = planNativeProfiles(
      [profile(composition({ tools: { allow: ['Read'], deny: ['Read'] } }, { label: 'Label' }))],
      'claude',
      '/claude',
    );
    expect(frontmatter(empty)).toMatchObject({ description: 'Label', tools: [], disallowedTools: ['Read'] });
    const denied = planNativeProfiles([profile(composition({ tools: { deny: ['Bash'] } }))], 'claude', '/claude');
    expect(frontmatter(denied)).toEqual({
      name: 'leader',
      description: 'Outfitter profile leader.',
      disallowedTools: ['Bash'],
    });
    const blank = planNativeProfiles(
      [profile(composition({}, { agentBody: '', systemPrompt: '', agentBodies: [] }))],
      'claude',
      '/claude',
    );
    expect(content(blank, 'agents/leader.md')).toContain('fingerprint-leader');
  });

  it('writes actual Codex profiles, a standalone config artifact, and full instructions', () => {
    const home = fixture();
    const plan = planNativeProfiles(
      [profile(composition({ model: 'gpt-5', thinking: 'high' }, { systemPrompt: 'System', sharedContext: 'Shared' }))],
      'codex',
      home,
      { sandbox_mode: 'read-only', approval_policy: 'on-request' },
    );
    expect(plan.warnings).toEqual([]);
    const result = apply(plan, home);
    expect(result.actions.every((action) => action.status === 'created')).toBe(true);
    const native = {
      model: 'gpt-5',
      model_reasoning_effort: 'high',
      model_instructions_file: join(home, 'leader.instructions.md'),
      sandbox_mode: 'read-only',
      approval_policy: 'on-request',
    };
    expect(parseToml(readFileSync(join(home, 'config.toml'), 'utf8'))).toEqual({ profiles: { leader: native } });
    expect(parseToml(content(plan, 'leader.config.toml'))).toEqual(native);
    expect(content(plan, 'leader.instructions.md')).toBe('System\n\nShared\n\nLead the work.\n');
    expect(apply(plan, home).actions.every((action) => action.status === 'unchanged')).toBe(true);
  });

  it('does not invent Codex profile keys for generic tool permissions or profile-scoped resources', () => {
    const selectedSkill = skill(fixture());
    const composed = composition({
      tools: { allow: ['Read'] },
      skills: [selectedSkill],
      subagents: [{ ...selectedSkill, kind: 'agent' }],
      mcp: ['docs'],
      mcpServers: { docs: { command: 'docs-server' } },
      thinking: 'unlimited',
      plugins: ['plugin'],
    });
    const plan = planNativeProfiles([profile(composed)], 'codex', '/codex', {
      sandbox_mode: 'invalid',
      approval_policy: 'invalid',
      skills: ['invented'],
      features: { invented: true },
    });
    expect(parseToml(content(plan, 'leader.config.toml'))).toEqual({
      model_instructions_file: '/codex/leader.instructions.md',
    });
    expect(profileProjectionStatus(composed, 'codex')).toEqual({
      status: 'partial',
      unsupported: ['plugins', 'thinking', 'subagents_scope', 'tools', 'skills_scope', 'mcp_scope'],
    });
    expect(plan.warnings.filter((warning) => warning.includes('default'))).toHaveLength(4);
  });

  it('reports provider and prompt-template gaps rather than silently changing the provider', () => {
    const composed: CompositionPlan = {
      ...composition({ model: 'custom/model' }, { promptTemplate: fragment('Template') }),
      models: {
        configured: true,
        document: {},
        target: {
          providerId: 'custom',
          modelId: 'model',
          api: 'openai-responses',
          baseUrl: 'https://example.invalid',
          requiredHeaders: {},
          capabilities: {},
          source: 'test',
        },
      },
    };
    expect(profileProjectionStatus(composed, 'pi')).toEqual({
      status: 'partial',
      unsupported: ['prompt_template'],
    });
    expect(profileProjectionStatus({ ...composed, identity: { agentBody: 'Canonical provider' } }, 'pi')).toEqual({
      status: 'ready',
      unsupported: [],
    });
    for (const harness of ['claude', 'codex'] as const) {
      expect(profileProjectionStatus({ plan: composed }, harness)).toEqual({
        status: 'partial',
        unsupported: ['prompt_template', 'model_provider'],
      });
      const planned = planNativeProfiles([profile(composed)], harness, '/harness');
      const native = harness === 'claude' ? frontmatter(planned) : parseToml(content(planned, 'leader.config.toml'));
      expect(native).not.toHaveProperty('model');
    }
    expect(profileProjectionStatus(composition({ delegateSkills: [skill(fixture())] }), 'codex').unsupported).toEqual([
      'skills_scope',
    ]);
  });

  it('registers selected Codex subagents as additive native roles pointing at compiled sidecars', () => {
    const home = fixture();
    const resource = skill(fixture());
    const slugs = ['worker', 'reviewer', 'helper'];
    const leader = composition({ subagents: slugs.map((slug) => ({ ...resource, kind: 'agent', slug })) });
    const profiles = [
      profile(leader),
      profile(composition({ model: 'gpt-5' }, { description: 'Work on tasks' }), 'worker'),
      profile(composition({}, { label: 'Review tasks' }), 'reviewer'),
      profile(composition(), 'helper'),
    ];
    const plan = planNativeProfiles(profiles, 'codex', home);
    apply(plan, home);
    expect(parseToml(readFileSync(join(home, 'config.toml'), 'utf8'))).toMatchObject({
      agents: {
        worker: { config_file: join(home, 'worker.config.toml'), description: 'Work on tasks' },
        reviewer: { config_file: join(home, 'reviewer.config.toml'), description: 'Review tasks' },
        helper: { config_file: join(home, 'helper.config.toml'), description: 'Outfitter profile helper.' },
      },
    });
    expect(profileProjectionStatus(leader, 'codex').unsupported).toEqual(['subagents_scope']);
    expect(profileProjectionStatus(leader, 'claude').unsupported).toEqual(['subagents']);
    const missing = planNativeProfiles(
      [
        profile(
          composition({
            subagents: [
              { ...resource, slug: 'missing' },
              { ...resource, slug: '../bad' },
            ],
          }),
        ),
        profile(composition(), '../bad'),
      ],
      'codex',
      home,
    );
    expect(missing.warnings).toContain(
      "codex subagent 'missing' has no compiled native profile and is not registered.",
    );
    expect(missing.warnings).toContain("codex subagent '../bad' has no compiled native profile and is not registered.");
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-012.1.10, OFTR-012.5.8).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('shares skills and MCP once, reports collisions deterministically, and includes delegate skills', () => {
    const first = skill(fixture());
    const second = skill(fixture());
    writeFileSync(second.winner.path, '# review\nDifferent agent-local guidance.');
    const delegate = skill(fixture(), 'delegate');
    const profiles = [
      profile(composition({ skills: [second], mcp: ['docs'], mcpServers: { docs: { command: 'second' } } }), 'z'),
      profile(
        composition({
          skills: [first, first],
          delegateSkills: [delegate],
          mcp: ['docs', 'docs'],
          mcpServers: { docs: { command: 'first' } },
        }),
        'a',
      ),
    ];
    const plan = planNativeProfiles(profiles, 'claude', '/claude');
    expect(plan).toEqual(planNativeProfiles([...profiles].reverse(), 'claude', '/claude'));
    expect(plan.entries.filter((entry) => entry.path === 'skills/review')).toHaveLength(1);
    expect(plan.entries.find((entry) => entry.path === 'skills/review')?.target).toBe(dirname(first.winner.path));
    expect(plan.entries.find((entry) => entry.path === 'skills/delegate')?.target).toBe(dirname(delegate.winner.path));
    expect(plan.entries.filter((entry) => entry.kind === 'mcp')).toHaveLength(1);
    expect(plan.warnings).toEqual(
      expect.arrayContaining([
        "claude profile 'a' does not support skills_conflict:review.",
        "claude profile 'z' does not support skills_conflict:review.",
        "skill 'review' has conflicting profile definitions; the first definition is linked.",
        "MCP server 'docs' has conflicting profile definitions; the first definition is linked.",
      ]),
    );
    expect(profileProjectionStatus(profiles[0], 'claude', profiles).unsupported).toContain('skills_conflict:review');
    expect(profileProjectionStatus(profiles[1], 'claude', profiles).unsupported).toContain('skills_conflict:review');
    expect(
      profileProjectionStatus(composition({ skills: [first], delegateSkills: [second] }), 'claude').unsupported,
    ).toEqual(['skills_conflict:review']);
  });

  it('reports dropped MCP fields and malformed definitions before reconciliation', () => {
    const composed = composition({
      mcp: ['missing', 'null', 'array', 'bad', 'docs'],
      mcpServers: { null: null, array: [], bad: 'bad', docs: { url: 'https://example.invalid', headers: { x: 'y' } } },
    });
    const plan = planNativeProfiles([profile(composed)], 'codex', '/codex');
    expect(plan.entries.filter((entry) => entry.kind === 'mcp')).toHaveLength(1);
    expect(profileProjectionStatus(composed, 'codex').unsupported).toEqual([
      'mcp_scope',
      'mcp:missing',
      'mcp:null',
      'mcp:array',
      'mcp:bad',
      "mcp:docs: codex MCP server 'docs': header 'x' cannot be registered by 'codex mcp add' and is dropped.",
    ]);
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-012.1.10).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('rejects traversal names and skill directories that escape their layer', () => {
    const root = fixture();
    const outside = skill(fixture());
    const escaped = { ...outside, winner: { ...outside.winner, layer: { ...outside.winner.layer, root } } };
    const unsafe = { ...outside, slug: '../unsafe' };
    const plan = planNativeProfiles(
      [profile(composition(), '../unsafe'), profile(composition({ skills: [escaped, unsafe] }))],
      'claude',
      root,
    );
    expect(plan.entries).toHaveLength(1);
    expect(plan.warnings).toHaveLength(3);
    expect(plan.entries[0]?.path).toBe('agents/leader.md');
  });

  it('quotes dotted Codex profile keys and maps dotted Claude identifiers without collisions', () => {
    const home = fixture();
    const composed = { ...composition({ skills: [skill(fixture(), 'review.code')] }), agent: 'team.leader' };
    const selected = profile(composed);
    const codex = planNativeProfiles([selected], 'codex', home);
    apply(codex, home);
    expect(parseToml(readFileSync(join(home, 'config.toml'), 'utf8'))).toEqual({
      profiles: { 'team.leader': { model_instructions_file: join(home, 'team.leader.instructions.md') } },
    });
    expect(codex.entries.some((entry) => entry.path === 'skills/review.code')).toBe(true);
    expect(profileProjectionStatus(selected, 'claude').unsupported).toEqual([]);
    const claude = planNativeProfiles([selected], 'claude', home);
    expect(content(claude, 'agents/team.leader.md')).toContain('name: team--leader');
    expect(claude.warnings).toEqual([]);
    expect(nativeProfileName('team.leader', 'claude')).toBe('team--leader');
    expect(nativeProfileName('team-leader', 'claude')).toBe('team-leader');
    expect(nativeProfileName('team.leader', 'codex')).toBe('team.leader');
    expect(nativeProfileName('team.leader', 'pi')).toBe('team.leader');
    expect(() => nativeProfileName('../unsafe', 'claude')).toThrow('Unsafe profile slug');
    expect(profileProjectionStatus({ ...composition(), agent: '../unsafe' }, 'claude').unsupported).toEqual([
      'native_slug',
    ]);
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-012.3.2, OFTR-012.3.3, OFTR-012.3.4).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('never replaces unmanaged Claude or Codex files, settings, or symlink ancestors', () => {
    const home = fixture();
    write(join(home, 'agents/leader.md'), 'Unmanaged Claude agent');
    write(join(home, 'leader.config.toml'), 'Unmanaged Codex config');
    write(join(home, 'leader.instructions.md'), 'Unmanaged Codex instructions');
    write(join(home, 'config.toml'), 'theme = "user"\n[profiles.leader]\nmodel = "user-model"\n');
    const profiles = [profile(composition({ model: 'catalog-model' }))];
    expect(apply(planNativeProfiles(profiles, 'claude', home), home).actions[0]?.status).toBe('conflict');
    const codex = apply(planNativeProfiles(profiles, 'codex', home), home);
    expect(codex.actions.filter((action) => action.status === 'conflict')).toHaveLength(3);
    expect(readFileSync(join(home, 'agents/leader.md'), 'utf8')).toBe('Unmanaged Claude agent');
    expect(readFileSync(join(home, 'leader.config.toml'), 'utf8')).toBe('Unmanaged Codex config');
    expect(readFileSync(join(home, 'leader.instructions.md'), 'utf8')).toBe('Unmanaged Codex instructions');
    expect(parseToml(readFileSync(join(home, 'config.toml'), 'utf8'))).toMatchObject({
      theme: 'user',
      profiles: { leader: { model: 'user-model' } },
    });
    const linkedHome = fixture();
    const external = fixture();
    symlinkSync(external, join(linkedHome, 'agents'));
    expect(apply(planNativeProfiles(profiles, 'claude', linkedHome), linkedHome).actions[0]?.status).toBe('conflict');
    expect(existsSync(join(external, 'leader.md'))).toBe(false);
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-012.4.1, OFTR-012.4.2).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('updates owned projections deterministically and forwards unique composition warnings', () => {
    const home = fixture();
    const composed = { ...composition(), warnings: ['composition warning', 'composition warning'] };
    const initial = planNativeProfiles([profile(composed)], 'claude', home);
    expect(initial.warnings).toEqual(['composition warning']);
    expect(apply(initial, home).actions[0]?.status).toBe('created');
    expect(apply(initial, home).actions[0]?.status).toBe('unchanged');
    const changed = planNativeProfiles([profile(composition({}, { agentBody: 'Changed' }))], 'claude', home);
    expect(apply(changed, home).actions[0]?.status).toBe('updated');
    expect(readFileSync(join(home, 'agents/leader.md'), 'utf8')).toContain('Changed');
  });
});
