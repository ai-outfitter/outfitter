// Covers link scope resolution, closure composition, harness mapping, and conflict-safe application.
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { detectInstalledHarnesses, isLinkHarness, resolveHarnessHome } from '../../src/links/HarnessHome.js';
import { applyHarnessLinks, removeHarnessLinks } from '../../src/links/HarnessLinkApply.js';
import type { HarnessCommandRunner } from '../../src/links/HarnessLinkApply.js';
import { composeLinkClosure, planHarnessLinks, resolveLinkScope } from '../../src/links/HarnessLinkPlan.js';
import type { HarnessLinkPlan, LinkEntry } from '../../src/links/HarnessLinkPlan.js';
import { resolveEffectiveSet } from '../../src/resolver/ResolverContext.js';

const roots: string[] = [];
const temporary = (): string => {
  const root = mkdtempSync(join(tmpdir(), 'outfitter-links-test-'));
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

const agent = (name: string, extra = ''): string => `---\nname: ${name}\n${extra}---\n\n# ${name}\n`;

/** A global tree with a workflow, a leader delegating to a reviewer, skills, commands, and MCP. */
const fixture = () => {
  const root = temporary();
  const home = join(root, 'home');
  const project = join(root, 'project');
  const tree = join(home, '.agents');
  mkdirSync(project, { recursive: true });
  write(join(tree, 'settings.yml'), 'default_agent: leader\nworkflows:\n  - ship\n');
  write(join(tree, 'agents.md'), 'Shared context.\n');
  write(
    join(tree, 'mcp.json'),
    JSON.stringify({ mcpServers: { github: { command: 'gh-mcp' }, web: { url: 'https://w' } } }),
  );
  write(join(tree, 'skills', 'review', 'SKILL.md'), '---\nname: review\n---\n');
  write(join(tree, 'skills', 'deploy', 'SKILL.md'), '---\nname: deploy\n---\n');
  write(join(tree, 'commands', 'ship.md'), 'Ship it.\n');
  write(join(tree, 'commands', 'nested', 'deep.md'), 'Deep.\n');
  write(join(tree, 'prompts', 'tone.md'), 'Be terse.\n');
  write(
    join(tree, 'agents', 'leader', 'agent.md'),
    agent(
      'leader',
      'description: Leads.\nskills: [deploy]\nsubagents: [reviewer]\nmcp: [github]\nappend_system_prompt:\n  - file: prompts/tone.md\n',
    ),
  );
  write(join(tree, 'agents', 'leader', 'commands', 'ship.md'), 'Ship it, leader style.\n');
  write(join(tree, 'agents', 'reviewer', 'agent.md'), agent('reviewer', 'skills: [review]\nmcp: [web]\n'));
  write(join(tree, 'agents', 'idle', 'agent.md'), agent('idle'));
  write(
    join(tree, 'workflows', 'ship', 'workflow.yaml'),
    `version: 1
id: ship
title: Ship
description: Ship a change.
actors:
  reviewer: {kind: agent, profile: reviewer}
environments: {workstation: local}
nodes:
  - {id: review, action: review, description: Review., actor: reviewer, environment: workstation}
`,
  );
  const resolved = resolveEffectiveSet({ homeDirectory: home, projectDirectory: project });
  return { root, home, project, tree, set: resolved.set, settings: resolved.settings };
};

const noRunner: HarnessCommandRunner = () => ({ found: false, ok: false, output: '' });

describe('harness homes', () => {
  it('resolves overrides, defaults, and installed harnesses', () => {
    expect(resolveHarnessHome('claude', '/h', { CLAUDE_CONFIG_DIR: '/cfg' })).toBe('/cfg');
    expect(resolveHarnessHome('claude', '/h', { CLAUDE_CONFIG_DIR: ' ' })).toBe('/h/.claude');
    expect(resolveHarnessHome('codex', '/h', { CODEX_HOME: '/cx' })).toBe('/cx');
    expect(resolveHarnessHome('codex', '/h', {})).toBe('/h/.codex');
    expect(isLinkHarness('pi')).toBe(false);
    const home = temporary();
    expect(detectInstalledHarnesses(home, {})).toEqual([]);
    mkdirSync(join(home, '.codex'));
    expect(detectInstalledHarnesses(home, {})).toEqual(['codex']);
  });
});

describe('link scope', () => {
  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-012.1).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('defaults to every enabled workflow root plus the default agent', () => {
    const { set, settings } = fixture();
    expect(resolveLinkScope(set, settings, { agents: [], workflows: [], all: false })).toEqual({
      agents: ['leader', 'reviewer'],
      errors: [],
    });
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-012.1).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('honors explicit selections and rejects disabled workflows and unknown agents', () => {
    const { set, settings } = fixture();
    expect(resolveLinkScope(set, settings, { agents: ['idle'], workflows: [], all: false }).agents).toEqual(['idle']);
    expect(resolveLinkScope(set, settings, { agents: [], workflows: ['ship'], all: false }).agents).toEqual([
      'reviewer',
    ]);
    expect(resolveLinkScope(set, settings, { agents: [], workflows: [], all: true }).agents).toEqual([
      'idle',
      'leader',
      'reviewer',
    ]);
    expect(resolveLinkScope(set, settings, { agents: ['ghost'], workflows: ['other'], all: false }).errors).toEqual([
      "Workflow 'other' is not enabled. Add it to 'workflows' in settings.yml to link it.",
      "Unknown agent 'ghost'. Run 'outfitter list agents' to see resolvable agents.",
    ]);
  });

  it('explains an empty scope and surfaces workflow closure errors', () => {
    const { home, project, tree } = fixture();
    write(join(tree, 'settings.yml'), 'workflows:\n  - missing\n');
    const { set, settings } = resolveEffectiveSet({ homeDirectory: home, projectDirectory: project });
    expect(resolveLinkScope(set, settings, { agents: [], workflows: [], all: false }).errors).toEqual([
      "workflow 'missing' references unknown workflow 'missing'.",
    ]);
    write(join(tree, 'settings.yml'), '');
    const empty = resolveEffectiveSet({ homeDirectory: home, projectDirectory: project });
    expect(resolveLinkScope(empty.set, empty.settings, { agents: [], workflows: [], all: false }).errors).toEqual([
      'Nothing to link: enable a workflow or set default_agent in settings.yml, or pass --agent, --workflow, or --all.',
    ]);
  });
});

describe('link closure', () => {
  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-012.2).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('composes scoped agents with their delegates, skills, commands, MCP servers, and shared context', () => {
    const { root, home, project, tree } = fixture();
    write(join(tree, 'agents', 'reviewer', 'agent.md'), agent('reviewer', 'skills: [review]\nmcp: [web, github]\n'));
    symlinkSync(join(root, 'outside.md'), join(tree, 'commands', 'escaped.md'));
    const reloaded = resolveEffectiveSet({ homeDirectory: home, projectDirectory: project }).set;
    const closure = composeLinkClosure(reloaded, ['leader', 'leader'], project);
    expect(closure.errors).toEqual([]);
    expect(closure.warnings).toEqual([]);
    expect(closure.agents.map((entry) => entry.slug)).toEqual(['leader', 'reviewer']);
    const leader = closure.agents[0].document;
    expect(leader).toContain('name: "leader"');
    expect(leader).toContain('description: "Leads."');
    expect(leader).toContain('skills: "deploy"');
    expect(leader).toContain('Generated by `outfitter link` from agents/leader');
    expect(leader).toContain('Shared context.');
    expect(leader).toContain('Be terse.');
    expect(leader).toContain('# leader');
    expect(closure.skills.map((skill) => skill.slug)).toEqual(['deploy', 'review']);
    expect(closure.commands.map((command) => [command.slug, command.winner.path])).toEqual([
      ['nested/deep.md', join(tree, 'commands', 'nested', 'deep.md')],
      ['ship.md', join(tree, 'agents', 'leader', 'commands', 'ship.md')],
    ]);
    expect(closure.mcpServers).toEqual([
      { id: 'github', server: { command: 'gh-mcp' } },
      { id: 'web', server: { url: 'https://w' } },
    ]);
    expect(closure.sharedContextPath).toBe(join(tree, 'agents.md'));
  });

  it('warns on escaping skills and conflicting MCP definitions, and reports composition errors', () => {
    const { root, home, project, tree } = fixture();
    const outside = join(root, 'outside-skill');
    write(join(outside, 'SKILL.md'), '---\nname: escaped\n---\n');
    symlinkSync(outside, join(tree, 'skills', 'escaped'));
    write(
      join(tree, 'agents', 'reviewer', 'mcp.json'),
      JSON.stringify({ mcpServers: { github: { command: 'other-gh' } } }),
    );
    write(join(tree, 'agents', 'reviewer', 'agent.md'), agent('reviewer', 'skills: [escaped]\nmcp: [github]\n'));
    write(join(tree, 'agents', 'broken', 'agent.md'), agent('broken', 'inherits: [missing]\n'));
    rmSync(join(tree, 'agents.md'));
    const { set } = resolveEffectiveSet({ homeDirectory: home, projectDirectory: project });
    const closure = composeLinkClosure(set, ['leader', 'broken'], project);
    expect(closure.warnings).toEqual([
      "skill 'escaped' resolves outside its layer and is not linked.",
      "MCP server 'github' is defined differently by agent 'reviewer'; the first definition is linked.",
    ]);
    expect(closure.errors).toHaveLength(1);
    expect(closure.errors[0]).toContain('missing');
    expect(closure.sharedContextPath).toBeUndefined();
    expect(closure.skills.map((skill) => skill.slug)).toEqual(['deploy']);
  });
});

describe('harness link plans', () => {
  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-012.2).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('maps the closure onto Claude Code and Codex native layouts', () => {
    const { set, project, tree } = fixture();
    const closure = composeLinkClosure(set, ['leader'], project);
    const claude = planHarnessLinks(closure, 'claude');
    expect(claude.warnings).toEqual([]);
    expect(claude.entries.map((entry) => [entry.kind, entry.path, entry.target ?? entry.resource])).toEqual([
      ['symlink', 'CLAUDE.md', join(tree, 'agents.md')],
      ['symlink', 'skills/deploy', join(tree, 'skills', 'deploy')],
      ['symlink', 'skills/review', join(tree, 'skills', 'review')],
      ['file', 'agents/leader.md', 'agent:leader'],
      ['file', 'agents/reviewer.md', 'agent:reviewer'],
      ['symlink', 'commands/nested/deep.md', join(tree, 'commands', 'nested', 'deep.md')],
      ['symlink', 'commands/ship.md', join(tree, 'agents', 'leader', 'commands', 'ship.md')],
      ['mcp', 'mcp:github', 'mcp:github'],
      ['mcp', 'mcp:web', 'mcp:web'],
    ]);
    const codex = planHarnessLinks(closure, 'codex');
    expect(codex.warnings).toEqual([
      'codex has no native agent definitions; identities for leader, reviewer are not linked.',
    ]);
    expect(codex.entries.map((entry) => entry.path)).toEqual([
      'AGENTS.md',
      'skills/deploy',
      'skills/review',
      'prompts/nested/deep.md',
      'prompts/ship.md',
      'mcp:github',
      'mcp:web',
    ]);
    const bare = planHarnessLinks({ ...closure, agents: [], sharedContextPath: undefined }, 'codex');
    expect(bare.warnings).toEqual([]);
    expect(bare.entries[0].path).toBe('skills/deploy');
  });
});

const symlink = (path: string, target: string): LinkEntry => ({ kind: 'symlink', path, target, resource: path });
const file = (path: string, content: string): LinkEntry => ({ kind: 'file', path, content, resource: path });
const mcp = (id: string, server: Record<string, unknown>): LinkEntry => ({
  kind: 'mcp',
  path: `mcp:${id}`,
  mcp: { id, server },
  resource: `mcp:${id}`,
});
const plan = (entries: LinkEntry[], harness: 'claude' | 'codex' = 'claude'): HarnessLinkPlan => ({
  harness,
  entries,
  warnings: [],
});
const statuses = (result: { actions: readonly { entry: LinkEntry; status: string }[] }): string[] =>
  result.actions.map((action) => `${action.status} ${action.entry.path}`);

describe('applying harness links', () => {
  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-012.4).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('creates links and files once, reports them unchanged on relink, and updates only what it owns', () => {
    const root = temporary();
    const home = join(root, 'claude');
    const skill = join(root, 'tree', 'skills', 'a');
    write(join(skill, 'SKILL.md'), '');
    const first = plan([symlink('skills/a', skill), file('agents/x.md', 'one')]);
    expect(statuses(applyHarnessLinks(first, home, {}, noRunner))).toEqual(['created skills/a', 'created agents/x.md']);
    expect(readlinkSync(join(home, 'skills', 'a'))).toBe(skill);
    expect(statuses(applyHarnessLinks(first, home, {}, noRunner))).toEqual([
      'unchanged skills/a',
      'unchanged agents/x.md',
    ]);
    const moved = join(root, 'tree', 'skills', 'b');
    write(join(moved, 'SKILL.md'), '');
    const second = plan([symlink('skills/a', moved), file('agents/x.md', 'two')]);
    expect(statuses(applyHarnessLinks(second, home, {}, noRunner))).toEqual([
      'updated skills/a',
      'updated agents/x.md',
    ]);
    expect(readlinkSync(join(home, 'skills', 'a'))).toBe(moved);
    expect(readFileSync(join(home, 'agents', 'x.md'), 'utf8')).toBe('two');
    const manifest = JSON.parse(readFileSync(join(home, '.outfitter', 'links.json'), 'utf8')) as { entries: unknown[] };
    expect(manifest.entries).toEqual([
      { kind: 'symlink', path: 'skills/a', target: moved },
      { kind: 'file', path: 'agents/x.md' },
    ]);
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-012.3).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('never replaces unmanaged files, directories, symlinks, or symlinked parents', () => {
    const root = temporary();
    const home = join(root, 'claude');
    const target = join(root, 'tree', 'x');
    mkdirSync(target, { recursive: true });
    write(join(home, 'CLAUDE.md'), 'mine');
    mkdirSync(join(home, 'agents'));
    symlinkSync(join(root, 'elsewhere'), join(home, 'agents', 'theirs.md'));
    write(join(home, 'commands', 'own.md'), 'own');
    symlinkSync(join(root, 'tree'), join(home, 'skills'));
    mkdirSync(join(home, 'prompts'));
    const result = applyHarnessLinks(
      plan([
        symlink('CLAUDE.md', target),
        symlink('agents/theirs.md', target),
        file('commands/own.md', 'generated'),
        symlink('skills/x', target),
        file('prompts', 'generated'),
        file('agents/theirs.md', 'generated'),
      ]),
      home,
      {},
      noRunner,
    );
    expect(result.actions.map((action) => [action.status, action.detail])).toEqual([
      ['conflict', 'an unmanaged file or directory already exists here'],
      ['conflict', `an unmanaged symlink to ${join(root, 'elsewhere')} already exists here`],
      ['conflict', 'an unmanaged file already exists here'],
      ['conflict', "'skills' is an unmanaged symlink; unlink it to let outfitter manage its entries"],
      ['conflict', 'an unmanaged symlink or directory already exists here'],
      ['conflict', 'an unmanaged symlink or directory already exists here'],
    ]);
    expect(readFileSync(join(home, 'CLAUDE.md'), 'utf8')).toBe('mine');
    expect(readFileSync(join(home, 'commands', 'own.md'), 'utf8')).toBe('own');
    expect(existsSync(join(home, '.outfitter', 'links.json'))).toBe(false);
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-012.4).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('dry runs without touching the home and prunes managed links whose target vanished', () => {
    const root = temporary();
    const home = join(root, 'claude');
    const target = join(root, 'tree', 'gone');
    mkdirSync(target, { recursive: true });
    const dry = applyHarnessLinks(plan([symlink('skills/gone', target)]), home, { dryRun: true }, noRunner);
    expect(statuses(dry)).toEqual(['created skills/gone']);
    expect(existsSync(home)).toBe(false);
    applyHarnessLinks(plan([symlink('skills/gone', target)]), home, {}, noRunner);
    rmSync(target, { recursive: true });
    const keep = join(root, 'tree', 'keep');
    mkdirSync(keep, { recursive: true });
    const preview = applyHarnessLinks(plan([symlink('skills/keep', keep)]), home, { dryRun: true }, noRunner);
    expect(statuses(preview)).toEqual(['created skills/keep', 'pruned skills/gone']);
    expect(lstatSync(join(home, 'skills', 'gone')).isSymbolicLink()).toBe(true);
    const pruned = applyHarnessLinks(plan([symlink('skills/keep', keep)]), home, {}, noRunner);
    expect(statuses(pruned)).toEqual(['created skills/keep', 'pruned skills/gone']);
    expect(existsSync(join(home, 'skills', 'gone'))).toBe(false);
    const manifest = JSON.parse(readFileSync(join(home, '.outfitter', 'links.json'), 'utf8')) as { entries: unknown[] };
    expect(manifest.entries).toEqual([{ kind: 'symlink', path: 'skills/keep', target: keep }]);
  });

  it('keeps stale managed entries it cannot prune and tolerates a corrupt manifest', () => {
    const root = temporary();
    const home = join(root, 'claude');
    applyHarnessLinks(plan([file('agents/old.md', 'old')]), home, {}, noRunner);
    const next = applyHarnessLinks(plan([file('agents/new.md', 'new')]), home, {}, noRunner);
    expect(statuses(next)).toEqual(['created agents/new.md']);
    const manifest = JSON.parse(readFileSync(join(home, '.outfitter', 'links.json'), 'utf8')) as { entries: unknown[] };
    expect(manifest.entries).toEqual([
      { kind: 'file', path: 'agents/old.md' },
      { kind: 'file', path: 'agents/new.md' },
    ]);
    write(join(home, '.outfitter', 'links.json'), '{not json');
    expect(statuses(applyHarnessLinks(plan([file('agents/new.md', 'changed')]), home, {}, noRunner))).toEqual([
      'conflict agents/new.md',
    ]);
    write(join(home, '.outfitter', 'links.json'), '{}');
    expect(statuses(applyHarnessLinks(plan([file('agents/new.md', 'new')]), home, {}, noRunner))).toEqual([
      'unchanged agents/new.md',
    ]);
  });

  it('reports a failed mutation as skipped instead of throwing', () => {
    const root = temporary();
    const home = join(root, 'claude');
    write(join(home, 'skills'), 'not a directory');
    const result = applyHarnessLinks(plan([symlink('skills/a', join(root, 'tree'))]), home, {}, noRunner);
    expect(result.actions[0].status).toBe('skipped');
    expect(result.actions[0].detail).toContain('EEXIST');
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-012.5).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('registers MCP servers through the harness CLI only when absent, and owns what it added', () => {
    const root = temporary();
    const home = join(root, 'claude');
    const calls: string[][] = [];
    const existing = new Set(['present']);
    const runner: HarnessCommandRunner = (_harness, args) => {
      calls.push([...args]);
      if (args[1] === 'get') return { found: true, ok: existing.has(args[2]), output: '' };
      if (args[2] === 'broken') return { found: true, ok: false, output: 'boom\nmore' };
      existing.add(args[2]);
      return { found: true, ok: args[2] !== 'late', output: 'login failed' };
    };
    const entries = [
      mcp('present', { command: 'p' }),
      mcp('fresh', { command: 'f' }),
      mcp('broken', { command: 'b' }),
      mcp('late', { url: 'https://l' }),
    ];
    const result = applyHarnessLinks(plan(entries), home, {}, runner);
    expect(result.actions.map((action) => [action.status, action.detail])).toEqual([
      ['unchanged', 'already configured in claude'],
      ['created', undefined],
      ['skipped', 'boom'],
      ['created', undefined],
    ]);
    expect(calls.filter((call) => call[1] === 'add-json').map((call) => call[2])).toEqual(['fresh', 'broken', 'late']);
    const manifest = JSON.parse(readFileSync(join(home, '.outfitter', 'links.json'), 'utf8')) as { entries: unknown[] };
    expect(manifest.entries).toEqual([
      { kind: 'mcp', path: 'mcp:fresh' },
      { kind: 'mcp', path: 'mcp:late' },
    ]);
    const again = applyHarnessLinks(plan(entries), home, { dryRun: true }, runner);
    expect(again.actions.map((action) => action.status)).toEqual(['unchanged', 'unchanged', 'created', 'unchanged']);
  });

  it('skips MCP registration when the harness CLI is missing or cannot express the server', () => {
    const home = join(temporary(), 'codex');
    const result = applyHarnessLinks(
      plan([mcp('a', { command: 'a' }), mcp('bad id', { command: 'b' })], 'codex'),
      home,
      {},
      noRunner,
    );
    expect(result.actions.map((action) => [action.status, action.detail])).toEqual([
      ['skipped', 'codex CLI not found on PATH'],
      ['skipped', "codex MCP server 'bad id': id contains characters Codex cannot express."],
    ]);
    const withWarnings = applyHarnessLinks(
      plan([mcp('h', { url: 'https://h', headers: { 'X-A': '1' } })], 'codex'),
      home,
      {},
      () => ({ found: true, ok: false, output: '' }),
    );
    expect(withWarnings.actions[0].status).toBe('skipped');
    const registered = applyHarnessLinks(
      plan([mcp('h', { url: 'https://h', headers: { 'X-A': '1' } })], 'codex'),
      home,
      {},
      (_harness, args) => ({ found: true, ok: args[1] === 'add', output: '' }),
    );
    expect(registered.actions[0].detail).toContain("header 'X-A'");
    expect(registered.actions[0].status).toBe('created');
  });
});

describe('removing harness links', () => {
  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-012.4).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('removes exactly the managed entries and forgets them, leaving unmanaged neighbors', () => {
    const root = temporary();
    const home = join(root, 'claude');
    const target = join(root, 'tree', 'skills', 'a');
    mkdirSync(target, { recursive: true });
    const calls: string[][] = [];
    const runner: HarnessCommandRunner = (_harness, args) => {
      calls.push([...args]);
      return { found: true, ok: args[1] !== 'get', output: '' };
    };
    applyHarnessLinks(
      plan([symlink('skills/a', target), file('agents/x.md', 'x'), mcp('m', { command: 'm' })]),
      home,
      {},
      runner,
    );
    write(join(home, 'agents', 'mine.md'), 'mine');
    const result = removeHarnessLinks('claude', home, runner);
    expect(statuses(result)).toEqual(['removed skills/a', 'removed agents/x.md', 'removed mcp:m']);
    expect(calls.at(-1)).toEqual(['mcp', 'remove', 'm', '--scope', 'user']);
    expect(existsSync(join(home, 'skills'))).toBe(false);
    expect(readFileSync(join(home, 'agents', 'mine.md'), 'utf8')).toBe('mine');
    expect(existsSync(join(home, '.outfitter'))).toBe(false);
    expect(statuses(removeHarnessLinks('claude', home, runner))).toEqual([]);
  });

  it('skips entries that are no longer managed and retains MCP entries it could not remove', () => {
    const root = temporary();
    const home = join(root, 'codex');
    const target = join(root, 'tree', 'skills', 'a');
    mkdirSync(target, { recursive: true });
    const ok: HarnessCommandRunner = (_harness, args) => ({ found: true, ok: args[1] !== 'get', output: '' });
    applyHarnessLinks(
      plan(
        [
          symlink('skills/a', target),
          file('agents/x.md', 'x'),
          file('agents/y.md', 'y'),
          mcp('m', { command: 'm' }),
          mcp('n', { command: 'n' }),
        ],
        'codex',
      ),
      home,
      {},
      ok,
    );
    rmSync(join(home, 'skills', 'a'));
    write(join(home, 'skills', 'a'), 'now a file');
    rmSync(join(home, 'agents', 'x.md'));
    symlinkSync(target, join(home, 'agents', 'x.md'));
    rmSync(join(home, 'agents', 'y.md'));
    write(join(home, '.outfitter', 'keep.txt'), 'other file');
    const runner: HarnessCommandRunner = (_harness, args) =>
      args[2] === 'm' ? { found: false, ok: false, output: '' } : { found: true, ok: false, output: 'refused' };
    const result = removeHarnessLinks('codex', home, runner);
    expect(result.actions.map((action) => [action.status, action.detail])).toEqual([
      ['skipped', 'no longer a managed entry'],
      ['skipped', 'no longer a managed entry'],
      ['skipped', 'no longer a managed entry'],
      ['skipped', 'codex CLI not found on PATH'],
      ['skipped', 'refused'],
    ]);
    const manifest = JSON.parse(readFileSync(join(home, '.outfitter', 'links.json'), 'utf8')) as { entries: unknown[] };
    expect(manifest.entries).toEqual([{ kind: 'mcp', path: 'mcp:m' }]);
    expect(existsSync(join(home, 'skills', 'a'))).toBe(true);
    const cleared = removeHarnessLinks('codex', home, ok);
    expect(statuses(cleared)).toEqual(['removed mcp:m']);
    expect(existsSync(join(home, '.outfitter', 'links.json'))).toBe(false);
    expect(existsSync(join(home, '.outfitter', 'keep.txt'))).toBe(true);
  });
});
