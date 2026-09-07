// Sync-time compilation and offline inventories use content, never mutable source timestamps.
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';

import { Command } from 'commander';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createProfilesCommand, executeProfilesCommand } from '../../src/cli/commands/ProfilesCommand.js';
import { createSyncCommand, executeSyncCommand } from '../../src/cli/commands/SyncCommand.js';
import { compose } from '../../src/composer/Composer.js';
import {
  compileProfileRegistry,
  compiledRegistryPath,
  readCompiledRegistry,
} from '../../src/profiles/CompiledRegistry.js';
import { projectComposition } from '../../src/projection/ProjectHarness.js';

const roots: string[] = [];
const write = (path: string, value: string): void => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, value);
};
const invocation = () => {
  const root = join(process.cwd(), `.compiled-registry-test-${randomUUID()}`);
  roots.push(root);
  return { homeDirectory: join(root, 'home'), projectDirectory: join(root, 'project'), env: {}, root };
};
const agent = (name: string, fields = '') =>
  `---\nname: ${name}\ndescription: ${name} description\n${fields}---\n${name} identity\n`;
const fixture = () => {
  const input = invocation();
  const layer = join(input.projectDirectory, '.agents');
  write(join(layer, 'settings.yml'), 'default_agent: leader\n');
  write(join(layer, 'agents/leader/agent.md'), agent('leader', 'skills: [review]\nsubagents: [worker]\n'));
  write(join(layer, 'agents/worker/agent.md'), agent('worker', 'skills: [review]\n'));
  write(join(layer, 'skills/review/SKILL.md'), '---\nname: review\ndescription: Review code\n---\nOriginal skill\n');
  write(join(layer, 'skills/review/scripts/check.sh'), '#!/bin/sh\nprintf original\n');
  write(join(layer, 'agents/leader/pi/settings.json'), '{"theme":"original"}');
  return { ...input, layer };
};

afterEach(() => {
  process.exitCode = undefined;
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

// THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-004.7).
// YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
describe('compiled profile registry', () => {
  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-004.7).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('composes every enabled root and delegate once and does not write unchanged compilations', () => {
    const input = fixture();
    const composer = vi.fn(compose);
    const first = compileProfileRegistry(input, { compose: composer });
    expect(composer.mock.calls.map((call) => call[1])).toEqual(['leader', 'worker']);
    expect(first.registry.profiles.map((profile) => profile.agent)).toEqual(['leader', 'worker']);
    const path = compiledRegistryPath(input);
    const bytes = readFileSync(path, 'utf8');
    const before = statSync(path).mtimeMs;
    utimesSync(join(input.layer, 'skills/review/SKILL.md'), 20, 20);
    const second = compileProfileRegistry(input);
    expect(second.changed).toBe(false);
    expect(readFileSync(path, 'utf8')).toBe(bytes);
    expect(statSync(path).mtimeMs).toBe(before);
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(statSync(dirname(path)).mode & 0o777).toBe(0o700);
    expect(readCompiledRegistry(input)).toEqual(JSON.parse(bytes));
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-004.7, OFTR-005.20).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('projects frozen skills and native overlays after live sources change or disappear', () => {
    const input = fixture();
    const original = compileProfileRegistry(input).registry.profiles[0];
    const frozenSkill = original.plan.loadout.skills[0].winner.path;
    expect(frozenSkill).not.toContain(input.layer);
    expect(readFileSync(frozenSkill, 'utf8')).toContain('Original skill');
    write(join(input.layer, 'skills/review/SKILL.md'), 'Changed skill');
    const changed = compileProfileRegistry(input).registry.profiles[0];
    expect(changed.fingerprint).not.toBe(original.fingerprint);
    expect(readFileSync(frozenSkill, 'utf8')).toContain('Original skill');
    rmSync(input.layer, { recursive: true });
    const rootDirectory = join(input.root, 'runtime');
    projectComposition(original.plan, {
      harness: 'pi',
      homeDirectory: input.homeDirectory,
      rootDirectory,
      configurationOverlayDirectories: original.plan.contributingAgents!.flatMap(
        (resource) => resource.piConfigDirectories ?? [],
      ),
    });
    expect(readFileSync(join(rootDirectory, 'skills/review/SKILL.md'), 'utf8')).toContain('Original skill');
    expect(readFileSync(join(rootDirectory, 'settings.json'), 'utf8')).toContain('original');
  });

  it('keeps project caches separate and supports XDG cache roots', () => {
    const input = invocation();
    expect(readCompiledRegistry(input)).toBeUndefined();
    const compiled = compileProfileRegistry(input);
    expect(compiled.registry.profiles).toEqual([]);
    expect(compiled.warnings).toEqual([]);
    expect(compiledRegistryPath({ ...input, projectDirectory: `${input.projectDirectory}-other` })).not.toBe(
      compiledRegistryPath(input),
    );
    expect(compiledRegistryPath({ ...input, env: { XDG_CACHE_HOME: join(input.root, 'xdg') } })).toContain(
      join(input.root, 'xdg/outfitter'),
    );
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-004.7).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('compiles enabled workflow closure and the default once, excluding unselected agents', () => {
    const input = fixture();
    write(join(input.layer, 'settings.yml'), 'default_agent: leader\nworkflows: [delivery]\n');
    write(join(input.layer, 'agents/unselected/agent.md'), agent('unselected'));
    write(
      join(input.layer, 'workflows/review/workflow.yaml'),
      `version: 1
id: review
title: Review
description: Review work
actors:
  reviewer: {kind: agent, profile: worker}
nodes:
  - {id: inspect, description: Inspect work, action: inspect, actor: reviewer}
`,
    );
    write(
      join(input.layer, 'workflows/delivery/workflow.yaml'),
      `version: 1
id: delivery
title: Delivery
description: Deliver work
actors: {}
nodes:
  - {id: review, description: Review work, workflow: review}
`,
    );
    const composer = vi.fn(compose);
    expect(
      compileProfileRegistry(input, { compose: composer }).registry.profiles.map((profile) => profile.agent),
    ).toEqual(['leader', 'worker']);
    expect(composer.mock.calls.map((call) => call[1])).toEqual(['leader', 'worker']);
  });

  it('freezes layered config, MCP and hooks, including executable and binary assets', () => {
    const input = fixture();
    write(join(input.homeDirectory, '.agents/agents/leader/agent.md'), agent('leader'));
    write(join(input.layer, 'agents/leader/config.json'), '{"thinking":"high","mcp":["example"]}');
    write(
      join(input.layer, 'agents/leader/mcp.json'),
      '{"mcpServers":{"example":{"command":"example-server","env":{"EXAMPLE_SETTING":"fixture"}}}}',
    );
    write(join(input.layer, 'agents/leader/hooks/check/hook.sh'), 'printf fixture');
    chmodSync(join(input.layer, 'skills/review/scripts/check.sh'), 0o755);
    writeFileSync(join(input.layer, 'skills/review/binary'), Buffer.from([0, 255, 1]));
    const compiled = compileProfileRegistry(input);
    const resource = compiled.registry.profiles[0].plan.contributingAgents![0];
    expect(resource.shadowed).toHaveLength(1);
    expect(resource.configPaths).toHaveLength(1);
    expect(readFileSync(resource.configPaths![0], 'utf8')).toContain('high');
    expect(resource.mcpPaths![0]).not.toContain(input.layer);
    expect(readFileSync(join(resource.hookPaths![0], 'check/hook.sh'), 'utf8')).toBe('printf fixture');
    const skill = dirname(compiled.registry.profiles[0].plan.loadout.skills[0].winner.path);
    expect(statSync(join(skill, 'scripts/check.sh')).mode & 0o777).toBe(0o700);
    expect(readFileSync(join(skill, 'binary'))).toEqual(Buffer.from([0, 255, 1]));
    write(join(input.layer, 'agents/leader/config.json'), '{"thinking":"low"}');
    expect(compileProfileRegistry(input).registry.profiles[0].fingerprint).not.toBe(
      compiled.registry.profiles[0].fingerprint,
    );
  });

  it('rejects malformed registries and unsupported versions', () => {
    const input = invocation();
    for (const value of [
      null,
      {},
      { version: 2, profiles: [], settings: {} },
      { version: 1, profiles: [], settings: null },
      { version: 1, profiles: [null], settings: {} },
      { version: 1, profiles: [{ agent: 1 }], settings: {} },
      { version: 1, profiles: [{ agent: 'a', fingerprint: 1 }], settings: {} },
      { version: 1, profiles: [{ agent: 'a', fingerprint: 'hash', plan: null }], settings: {} },
      { version: 1, profiles: [{ agent: 'a', fingerprint: 'hash', plan: {} }], settings: {} },
    ]) {
      write(compiledRegistryPath(input), JSON.stringify(value));
      expect(() => readCompiledRegistry(input)).toThrow('Invalid compiled');
    }
  });

  it('fails invalid settings and missing selected agents without replacing a prior registry', () => {
    const input = fixture();
    compileProfileRegistry(input);
    const bytes = readFileSync(compiledRegistryPath(input), 'utf8');
    write(join(input.layer, 'settings.yml'), 'default_harness: invalid\n');
    expect(() => compileProfileRegistry(input)).toThrow('invalid settings');
    write(join(input.layer, 'settings.yml'), 'default_agent: missing\n');
    expect(() => compileProfileRegistry(input)).toThrow('Unknown agent');
    write(join(input.layer, 'settings.yml'), 'default_agent: leader\n');
    expect(() =>
      compileProfileRegistry(input, { compose: () => ({ errors: ['composition failed'], warnings: [] }) }),
    ).toThrow('composition failed');
    expect(readFileSync(compiledRegistryPath(input), 'utf8')).toBe(bytes);
  });

  it('reports composition warnings and rejects them before persistence in strict mode', () => {
    const input = fixture();
    const warningComposer: typeof compose = (...args) => ({ ...compose(...args), warnings: ['composition warning'] });
    expect(() => compileProfileRegistry({ ...input, strict: true }, { compose: warningComposer })).toThrow(
      'composition warning',
    );
    expect(existsSync(compiledRegistryPath(input))).toBe(false);
    expect(compileProfileRegistry(input, { compose: warningComposer }).warnings).toEqual(['composition warning']);
  });

  it('never copies symlinked child assets and rejects resources escaping their layers', () => {
    const input = fixture();
    const secret = join(input.root, 'private');
    write(secret, 'do not copy');
    symlinkSync(secret, join(input.layer, 'skills/review/secret'));
    const profile = compileProfileRegistry(input).registry.profiles[0];
    expect(existsSync(join(dirname(profile.plan.loadout.skills[0].winner.path), 'secret'))).toBe(false);
    const outside = join(input.root, 'outside');
    write(join(outside, 'SKILL.md'), 'outside');
    rmSync(join(input.layer, 'skills/review'), { recursive: true });
    symlinkSync(outside, join(input.layer, 'skills/review'));
    expect(() => compileProfileRegistry(input)).toThrow('outside its layer');
  });

  it('rejects symlinked configuration roots and special files without persisting a registry', () => {
    const input = fixture();
    const pi = join(input.layer, 'agents/leader/pi');
    rmSync(pi, { recursive: true });
    const target = join(input.layer, 'native');
    write(join(target, 'settings.json'), '{}');
    symlinkSync(target, pi);
    expect(() => compileProfileRegistry(input)).toThrow('symlinked asset');
    rmSync(pi);
    execFileSync('mkfifo', [join(input.layer, 'skills/review/pipe')]);
    expect(() => compileProfileRegistry(input)).toThrow('non-file asset');
    expect(existsSync(compiledRegistryPath(input))).toBe(false);
  });
});

// THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-004.7, OFTR-006.7, OFTR-012).
// YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
describe('compiled profile commands', () => {
  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-004.7, OFTR-006.7).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('local sync never fetches and repeats without writing unchanged native projections', async () => {
    const input = fixture();
    const syncRepository = vi.fn(() => {
      throw new Error('must not fetch');
    });
    const composer = vi.fn(compose);
    const lines: string[] = [];
    const program = new Command();
    createSyncCommand({ ...input, compose: composer, syncRepository, writeLine: (line) => lines.push(line) }).register(
      program,
    );
    await program.parseAsync(['node', 'outfitter', 'sync', '--local', '--harness', 'pi']);
    expect(process.exitCode).toBeUndefined();
    expect(lines.join('\n')).toContain('Compiled: 2 profile');
    expect(syncRepository).not.toHaveBeenCalled();
    expect(composer).toHaveBeenCalledTimes(2);
    const nativePaths = [
      join(input.homeDirectory, '.pi/agent/.outfitter/profiles.json'),
      join(input.homeDirectory, '.pi/agent/.outfitter/links.json'),
      compiledRegistryPath(input),
    ];
    const before = nativePaths.map((path) => statSync(path).mtimeMs);
    const result = executeSyncCommand({ ...input, local: true, harnesses: ['pi'] });
    expect(result.exitCode).toBe(0);
    expect(result.messages.join('\n')).toContain('Unchanged: 2 profile');
    expect(nativePaths.map((path) => statSync(path).mtimeMs)).toEqual(before);
  });

  it('lists the registry without consulting changed settings or source files', async () => {
    const input = fixture();
    compileProfileRegistry(input);
    rmSync(input.layer, { recursive: true });
    const json = executeProfilesCommand({ ...input, json: true });
    const value = JSON.parse(json.messages[0]) as {
      profiles: { agent: string; harnesses: { codex: { status: string } } }[];
    };
    expect(value.profiles.map((profile) => profile.agent)).toEqual(['leader', 'worker']);
    expect(value.profiles[0].harnesses.codex.status).toBe('partial');
    expect(executeProfilesCommand(input).messages[0]).toContain('leader (');
    const lines: string[] = [];
    const program = new Command();
    createProfilesCommand({ ...input, writeLine: (line) => lines.push(line) }).register(program);
    await program.parseAsync(['node', 'outfitter', 'profiles', '--json']);
    expect(lines).toEqual(json.messages);
  });

  it('reports empty inventory successfully with a stable JSON shape', () => {
    const input = invocation();
    expect(executeProfilesCommand({ ...input, json: true }).messages).toEqual(['{"version":1,"profiles":[]}']);
    expect(executeProfilesCommand(input).messages[0]).toContain("Run 'outfitter sync'");
  });

  it('strict unsupported projections and unknown harnesses fail before writing native homes', () => {
    const input = fixture();
    const result = executeSyncCommand({ ...input, local: true, strict: true, harnesses: ['pi', 'codex'] });
    expect(result.exitCode).toBe(1);
    expect(existsSync(join(input.homeDirectory, '.pi'))).toBe(false);
    expect(existsSync(join(input.homeDirectory, '.codex'))).toBe(false);
    expect(executeSyncCommand({ ...input, local: true, harnesses: ['unknown'] }).messages.join('\n')).toContain(
      'Unknown harness',
    );
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-004.7, OFTR-012).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('preflights every home, preserves ownership conflicts, and surfaces native application failure', () => {
    const input = fixture();
    const occupied = join(input.homeDirectory, '.pi/agent/.outfitter/profiles.json');
    write(occupied, 'user-owned profile index');
    const result = executeSyncCommand({ ...input, local: true, harnesses: ['claude', 'pi'] });
    expect(result.exitCode).toBe(1);
    expect(result.messages.join('\n')).toContain('conflict:');
    expect(readFileSync(occupied, 'utf8')).toBe('user-owned profile index');
    expect(existsSync(join(input.homeDirectory, '.claude'))).toBe(false);
    write(join(input.layer, 'agents/leader/agent.md'), agent('leader', 'mcp: [example]\n'));
    write(join(input.layer, 'agents/leader/mcp.json'), '{"mcpServers":{"example":{"command":"example-server"}}}');
    const failed = executeSyncCommand(
      { ...input, local: true, harnesses: ['claude'] },
      {
        runHarnessCommand: (_harness, args) => ({
          found: true,
          ok: false,
          output: args.includes('get') ? 'not found' : 'registration failed',
        }),
      },
    );
    expect(failed.exitCode).toBe(1);
    expect(failed.messages.join('\n')).toContain('registration failed');
  });

  it('projects configured harness defaults and reports non-Error compilation failures', () => {
    const input = fixture();
    write(
      join(input.layer, 'settings.yml'),
      'default_agent: leader\ndefault_harness: pi\nharness_defaults:\n  codex:\n    sandbox_mode: read-only\n',
    );
    const result = executeSyncCommand({ ...input, local: true });
    expect(result.exitCode).toBe(0);
    expect(readFileSync(join(input.homeDirectory, '.codex/config.toml'), 'utf8')).toContain('read-only');
    expect(result.messages.join('\n')).toContain('warning:');
    expect(
      executeSyncCommand(
        { ...input, local: true },
        {
          compose: () => {
            // eslint-disable-next-line @typescript-eslint/only-throw-error -- Exercise diagnostics for third-party non-Error throws.
            throw 'fixture failure';
          },
        },
      ).messages.join('\n'),
    ).toContain('fixture failure');
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-004.7.4, OFTR-004.7.6).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('reports source ambiguity once and blocks strict compilation after the fetch phase', () => {
    const input = invocation();
    const first = join(input.root, 'first');
    const second = join(input.root, 'second');
    for (const layer of [first, second])
      write(join(layer, 'skills/shared/SKILL.md'), '---\nname: shared\ndescription: shared skill\n---\n');
    write(join(input.projectDirectory, '.agents/settings.yml'), `sources:\n  - path: ${first}\n  - path: ${second}\n`);
    const normal = executeSyncCommand(input);
    expect(normal.exitCode).toBe(0);
    expect(new Set(normal.messages).size).toBe(normal.messages.length);
    expect(normal.messages.join('\n')).toContain('warning:');
    const strict = executeSyncCommand({ ...input, strict: true });
    expect(strict.exitCode).toBe(1);
    expect(strict.messages.join('\n')).toContain('ambiguous resolution is fatal');
  });
});
