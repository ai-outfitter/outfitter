// Launch templates are immutable sync artifacts, not deferred projections of live catalogs.
import { randomUUID } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { compileProfileRegistry, readCompiledRegistry } from '../../src/profiles/CompiledRegistry.js';
import { compileProfileProjections, relocateCompiledProjection } from '../../src/profiles/CompiledProjections.js';
import { projectModel } from '../../src/projection/ModelProjection.js';
import * as projector from '../../src/projection/ProjectHarness.js';

const roots: string[] = [];
const write = (path: string, content: string): void => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
};
const fixture = () => {
  const root = join(process.cwd(), `.compiled-projections-test-${randomUUID()}`);
  roots.push(root);
  const homeDirectory = join(root, 'home');
  const projectDirectory = join(root, 'project');
  const layer = join(projectDirectory, '.agents');
  write(join(layer, 'settings.yml'), 'default_agent: leader\nharness_defaults:\n  claude:\n    verbose: true\n');
  write(join(layer, 'agents/leader/agent.md'), '---\nname: leader\n---\nFrozen identity\n');
  return { root, layer, homeDirectory, projectDirectory, env: {} };
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

// THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-004.7, OFTR-005.20).
// YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
describe('compiled launch templates', () => {
  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-004.7, OFTR-005.20).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('prebuilds Pi and both Claude isolation modes once, then relocates copies without projection', () => {
    const input = fixture();
    const spy = vi.spyOn(projector, 'projectComposition');
    const registry = compileProfileRegistry(input).registry;
    expect(spy).toHaveBeenCalledTimes(3);
    const templates = registry.profiles[0].projections!;
    expect(Object.keys(templates)).toEqual(['pi', 'claude']);
    const pi = templates.pi!.isolated;
    const isolated = templates.claude!.isolated;
    const inherit = templates.claude!.inherit!;
    expect(pi.launch.env.PI_CODING_AGENT_DIR).toBe(pi.rootDirectory);
    expect(isolated.launch.env.CLAUDE_CONFIG_DIR).toBe(isolated.rootDirectory);
    expect(isolated.launch.args).toContain('--strict-mcp-config');
    expect(inherit.launch.env).not.toHaveProperty('CLAUDE_CONFIG_DIR');
    expect(inherit.launch.args).toContain('--plugin-dir');
    expect(inherit.launch.args).not.toContain('--strict-mcp-config');
    expect(existsSync(join(inherit.rootDirectory, '.claude-plugin/plugin.json'))).toBe(true);
    const before = statSync(join(pi.rootDirectory, 'system-prompt.md')).mtimeMs;
    expect(compileProfileRegistry(input).changed).toBe(false);
    expect(spy).toHaveBeenCalledTimes(3);
    expect(statSync(join(pi.rootDirectory, 'system-prompt.md')).mtimeMs).toBe(before);
    rmSync(input.layer, { recursive: true });
    const cached = readCompiledRegistry(input)!.profiles[0].projections!.pi!.isolated;
    const runtime = join(input.root, 'run');
    cpSync(cached.rootDirectory, runtime, { recursive: true });
    const launch = relocateCompiledProjection(cached, runtime);
    expect(launch.rootDirectory).toBe(runtime);
    expect(launch.launch.env.PI_CODING_AGENT_DIR).toBe(runtime);
    expect(launch.launch.args.join(' ')).not.toContain(cached.rootDirectory);
    const prompt = launch.launch.args[launch.launch.args.indexOf('--append-system-prompt') + 1];
    expect(readFileSync(prompt, 'utf8')).toContain('Frozen identity');
    expect(statSync(join(runtime, 'system-prompt.md')).mode & 0o777).toBe(0o600);
    expect(spy).toHaveBeenCalledTimes(3);
  });

  it('never resolves process credentials during sync and leaves runtime model warnings replaceable', () => {
    const input = fixture();
    vi.stubEnv('OUTFITTER_TEMPLATE_TEST_KEY', 'runtime-only-fixture-value');
    write(join(input.layer, 'agents/leader/agent.md'), '---\nname: leader\nmodel: proxy/claude-test\n---\nIdentity\n');
    write(
      join(input.layer, 'models.json'),
      JSON.stringify({
        providers: {
          proxy: {
            api: 'anthropic-messages',
            baseUrl: 'https://example.invalid',
            apiKey: '$OUTFITTER_TEMPLATE_TEST_KEY',
            models: [{ id: 'claude-test' }],
          },
        },
      }),
    );
    const registry = compileProfileRegistry(input).registry;
    const profile = registry.profiles[0];
    const template = profile.projections!.claude!.isolated;
    expect(JSON.stringify(registry)).not.toContain('runtime-only-fixture-value');
    expect(template.launch.env).not.toHaveProperty('ANTHROPIC_AUTH_TOKEN');
    expect(template.modelWarnings.join(' ')).toContain('OUTFITTER_TEMPLATE_TEST_KEY');
    const runtime = projectModel(profile.plan, {
      harness: 'claude',
      rootDirectory: 'unused',
      homeDirectory: input.homeDirectory,
      processEnvironment: process.env,
    });
    expect(runtime.env.ANTHROPIC_AUTH_TOKEN).toBe('runtime-only-fixture-value');
    expect(runtime.warnings).toEqual([]);
  });

  it('supports plans without contributor metadata and cleans incomplete templates after projection errors', () => {
    const input = fixture();
    const profile = compileProfileRegistry(input).registry.profiles[0];
    const custom = { ...profile, plan: { ...profile.plan, contributingAgents: undefined } };
    const directory = join(input.root, 'custom');
    expect(compileProfileProjections(custom, {}, directory, input.homeDirectory).pi).toBeDefined();
    const noNative = {
      ...profile,
      plan: {
        ...profile.plan,
        contributingAgents: [{ ...profile.plan.contributingAgents![0], piConfigDirectories: undefined }],
      },
    };
    expect(
      compileProfileProjections(noNative, {}, join(input.root, 'no-native'), input.homeDirectory).pi,
    ).toBeDefined();
    const invalid = {
      ...custom,
      plan: { ...custom.plan, loadout: { ...custom.plan.loadout, tools: { allow: ['invalid tool'] } } },
    };
    const failedDirectory = join(input.root, 'failed');
    expect(() => compileProfileProjections(invalid, {}, failedDirectory, input.homeDirectory)).toThrow(
      'cannot be projected',
    );
    expect(readdirSync(join(failedDirectory, 'launch-v1', profile.fingerprint))).toEqual([]);
  });
});
