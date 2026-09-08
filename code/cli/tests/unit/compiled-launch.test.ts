import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { executeRunAgentCommand } from '../../src/cli/commands/RunAgentCommand.js';
import * as Composer from '../../src/composer/Composer.js';
import { applyHarnessLinks } from '../../src/links/HarnessLinkApply.js';
import { copyCompiledLaunch } from '../../src/profiles/CompiledLaunch.js';
import { compileProfileRegistry } from '../../src/profiles/CompiledRegistry.js';
import { planNativeProfiles } from '../../src/profiles/NativeProfiles.js';
import * as Projection from '../../src/projection/ProjectHarness.js';
import type { AgentLaunchPlan } from '../../src/projection/Projection.js';
import * as Resolver from '../../src/resolver/ResolverContext.js';

const roots: string[] = [];
const write = (path: string, content: string): void => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
};

const fixture = (frontmatter = '') => {
  const root = mkdtempSync(join(tmpdir(), 'outfitter-compiled-launch-'));
  roots.push(root);
  const homeDirectory = join(root, 'home');
  const projectDirectory = join(root, 'project');
  mkdirSync(homeDirectory);
  write(join(projectDirectory, '.agents/settings.yml'), 'default_agent: engineer\n');
  write(
    join(projectDirectory, '.agents/agents/engineer/agent.md'),
    `---\nname: engineer\nskills: [wiki]\n${frontmatter}---\n\nENGINEER IDENTITY\n`,
  );
  write(
    join(projectDirectory, '.agents/skills/wiki/SKILL.md'),
    '---\nname: wiki\ndescription: Selected wiki capability.\n---\n\nFrozen skill.\n',
  );
  const input = { homeDirectory, projectDirectory };
  const { registry } = compileProfileRegistry(input);
  return { input, registry, root };
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('compiled launches', () => {
  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-005.8.1).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('launches frozen Pi without resolving, composing, projecting, or repairing absent sources', async () => {
    const { input, registry } = fixture('model: test-model\nthinking: high\n');
    rmSync(join(input.projectDirectory, '.agents'), { recursive: true });
    const compose = vi.spyOn(Composer, 'compose');
    const resolve = vi.spyOn(Resolver, 'resolveEffectiveSet');
    const project = vi.spyOn(Projection, 'projectComposition');
    const network = vi.fn(() => {
      throw new Error('network denied');
    });
    let launch: AgentLaunchPlan | undefined;
    const result = await executeRunAgentCommand({
      ...input,
      sourceCachePreparer: network,
      extensionInstallSpawner: network,
      passThroughArgs: ['--print', 'hello'],
      launcher: (plan) => {
        launch = plan;
        const root = plan.env.PI_CODING_AGENT_DIR;
        expect(readFileSync(join(root, 'skills/wiki/SKILL.md'), 'utf8')).toContain('Frozen skill.');
        const extension = readFileSync(join(root, '.outfitter/outfitter-runtime-extension.js'), 'utf8');
        expect(extension).toContain(registry.profiles[0].fingerprint);
        expect(extension).toContain('ENGINEER IDENTITY');
        expect(extension).toContain('"model":"test-model"');
        expect(extension).toContain('"thinking":"high"');
        return Promise.resolve(0);
      },
    });
    expect(result.exitCode).toBe(0);
    expect(result.messages).toEqual([]);
    expect(launch?.args).toEqual(expect.arrayContaining(['--print', 'hello']));
    expect(launch?.args).not.toContain('--model');
    expect(launch?.args).not.toContain('--thinking');
    expect(launch?.env.PI_CODING_AGENT_SESSION_DIR).toBeDefined();
    expect(existsSync(launch!.env.PI_CODING_AGENT_DIR)).toBe(false);
    expect(compose).not.toHaveBeenCalled();
    expect(resolve).not.toHaveBeenCalled();
    expect(project).not.toHaveBeenCalled();
    expect(network).not.toHaveBeenCalled();
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-004.8.5).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('does not rewrite unchanged launch templates and rebases copied paths', () => {
    const { input, registry, root } = fixture();
    const projections = registry.profiles[0].projections!;
    const files = [projections.pi!.isolated, projections.claude!.isolated, projections.claude!.inherit!].map(
      (projection) => join(projection.rootDirectory, '.outfitter-projection.json'),
    );
    const before = files.map((path) => ({ bytes: readFileSync(path, 'utf8'), time: statSync(path).mtimeMs }));
    const project = vi.spyOn(Projection, 'projectComposition');
    compileProfileRegistry(input);
    expect(files.map((path) => ({ bytes: readFileSync(path, 'utf8'), time: statSync(path).mtimeMs }))).toEqual(before);
    expect(project).not.toHaveBeenCalled();
    const copy = copyCompiledLaunch(registry.profiles[0], 'claude', join(root, 'copy'));
    expect(copy.launch.env.CLAUDE_CONFIG_DIR).toBe(join(root, 'copy'));
    expect(existsSync(join(root, 'copy/.outfitter-projection.json'))).toBe(false);
  });

  it('requires compilation for a selected agent and a missing launch template', async () => {
    const { input, registry, root } = fixture();
    await expect(executeRunAgentCommand({ ...input, agent: 'missing', launcher: vi.fn() })).rejects.toThrow(
      'not compiled',
    );
    rmSync(registry.profiles[0].projections!.pi!.isolated.rootDirectory, { recursive: true });
    expect(() => copyCompiledLaunch(registry.profiles[0], 'pi', join(root, 'copy'))).toThrow('sync --local');
  });

  it('cleans an incomplete template when projection fails', () => {
    const { input, registry } = fixture();
    const directory = dirname(registry.profiles[0].projections!.pi!.isolated.rootDirectory);
    rmSync(directory, { recursive: true });
    vi.spyOn(Projection, 'projectComposition').mockImplementation(() => {
      throw new Error('invalid projection');
    });
    expect(() => compileProfileRegistry(input)).toThrow('invalid projection');
    expect(readdirSync(directory)).toEqual([]);
  });

  it('snapshots declared Pi providers and native overlays without resolving credential values', () => {
    const { input } = fixture();
    write(
      join(input.projectDirectory, '.agents/models.json'),
      JSON.stringify({
        providers: {
          fixture: {
            baseUrl: 'http://localhost:9999',
            api: 'openai-responses',
            apiKey: '$FIXTURE_MODEL_KEY',
            models: [{ id: 'fixture-model', name: 'Fixture model' }],
          },
        },
      }),
    );
    write(join(input.projectDirectory, '.agents/agents/engineer/pi/settings.json'), '{"theme":"dark"}');
    const { registry } = compileProfileRegistry(input);
    const destination = join(input.homeDirectory, 'runtime');
    copyCompiledLaunch(registry.profiles[0], 'pi', destination);
    expect(readFileSync(join(destination, 'models.json'), 'utf8')).toContain('$FIXTURE_MODEL_KEY');
    expect(readFileSync(join(destination, 'settings.json'), 'utf8')).toContain('dark');
  });

  it('does not give compiled Pi a launch-time tool ceiling', () => {
    const { registry, root } = fixture('tools:\n  allow: [read]\n');
    const launch = copyCompiledLaunch(registry.profiles[0], 'pi', join(root, 'copy')).launch;
    expect(launch.args).not.toContain('--tools');
    expect(launch.args).not.toContain('--no-tools');
    expect(launch.args).not.toContain('--exclude-tools');
  });

  it('keeps runtime state when explicitly requested and cleans it after a failed launcher otherwise', async () => {
    const { input } = fixture();
    const result = await executeRunAgentCommand({
      ...input,
      retainProjection: true,
      launcher: () => Promise.resolve(0),
    });
    const retained = result.launchPlan!.env.PI_CODING_AGENT_DIR;
    roots.push(retained);
    expect(existsSync(retained)).toBe(true);
    let runtime = '';
    await expect(
      executeRunAgentCommand({
        ...input,
        launcher: (plan) => {
          runtime = plan.env.PI_CODING_AGENT_DIR;
          return Promise.reject(new Error('child failed'));
        },
      }),
    ).rejects.toThrow('child failed');
    expect(existsSync(runtime)).toBe(false);
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-006.10.1, OFTR-006.10.2).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it.each(['claude', 'codex'] as const)(
    'selects synchronized native %s profiles without recompilation',
    async (harness) => {
      const { input, registry, root } = fixture();
      const home = join(root, harness);
      vi.stubEnv(harness === 'claude' ? 'CLAUDE_CONFIG_DIR' : 'CODEX_HOME', home);
      applyHarnessLinks(planNativeProfiles(registry.profiles, harness, home), home);
      const compose = vi.spyOn(Composer, 'compose');
      const launcher = vi.fn(() => Promise.resolve(0));
      const result = await executeRunAgentCommand({
        ...input,
        harness,
        launcher,
        harnessHelpReader: () => '--plugin-dir --mcp-config',
      });
      expect(result.launchPlan!.args.slice(0, 2)).toEqual([harness === 'claude' ? '--agent' : '--profile', 'engineer']);
      expect(result.launchPlan!.env[harness === 'claude' ? 'CLAUDE_CONFIG_DIR' : 'CODEX_HOME']).toBe(home);
      expect(compose).not.toHaveBeenCalled();
    },
  );

  it('rejects absent native projections and strict partial profiles before launching', async () => {
    const { input, registry, root } = fixture();
    const home = join(root, 'codex');
    vi.stubEnv('CODEX_HOME', home);
    const launcher = vi.fn(() => Promise.resolve(0));
    await expect(executeRunAgentCommand({ ...input, harness: 'codex', launcher })).rejects.toThrow('not current');
    applyHarnessLinks(planNativeProfiles(registry.profiles, 'codex', home), home);
    const writeLine = vi.fn();
    const result = await executeRunAgentCommand({ ...input, harness: 'codex', strict: true, writeLine, launcher });
    expect(result.exitCode).toBe(1);
    expect(result.messages.join('\n')).toContain('Strict mode');
    expect(writeLine).toHaveBeenCalled();
    expect(launcher).not.toHaveBeenCalled();
  });

  it('passes caller prompts to native Claude and warns for Codex', async () => {
    const { input, registry, root } = fixture();
    const prompt = join(root, 'persona.md');
    writeFileSync(prompt, 'Caller persona.');
    for (const harness of ['claude', 'codex'] as const) {
      const home = join(root, harness);
      vi.stubEnv(harness === 'claude' ? 'CLAUDE_CONFIG_DIR' : 'CODEX_HOME', home);
      applyHarnessLinks(planNativeProfiles(registry.profiles, harness, home), home);
      const result = await executeRunAgentCommand({
        ...input,
        harness,
        appendPromptPaths: [prompt],
        harnessHelpReader: () => '--plugin-dir --mcp-config',
        launcher: (plan) => {
          if (harness === 'claude')
            expect(readFileSync(plan.args[plan.args.indexOf('--append-system-prompt-file') + 1], 'utf8')).toBe(
              'Caller persona.',
            );
          return Promise.resolve(0);
        },
      });
      if (harness === 'codex') expect(result.messages.join('\n')).toContain('append-prompt');
    }
  });

  it('preserves the compiled identity when appending caller prompts to isolated Claude', async () => {
    const { input, root } = fixture();
    const path = join(root, 'caller.md');
    writeFileSync(path, 'EXTRA PERSONA');
    const result = await executeRunAgentCommand({
      ...input,
      harness: 'claude',
      isolated: true,
      appendPromptPaths: [path],
      launcher: (plan) => {
        expect(plan.args.filter((arg) => arg === '--append-system-prompt-file')).toHaveLength(1);
        const prompt = readFileSync(plan.args[plan.args.indexOf('--append-system-prompt-file') + 1], 'utf8');
        expect(prompt).toContain('ENGINEER IDENTITY');
        expect(prompt).toContain('EXTRA PERSONA');
        return Promise.resolve(0);
      },
    });
    expect(result.exitCode).toBe(0);
  });
});
