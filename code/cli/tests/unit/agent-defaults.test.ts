// Tests `agent_defaults`: settings parsing/merging and composition into every agent.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { compose } from '../../src/composer/Composer.js';
import { executeDumpCommand } from '../../src/cli/commands/DumpCommand.js';
import { executeRunAgentCommand } from '../../src/cli/commands/RunAgentCommand.js';
import { executeValidateCommand } from '../../src/cli/commands/ValidateCommand.js';
import { composeLinkClosure } from '../../src/links/HarnessLinkPlan.js';
import { discoverLayers } from '../../src/resolver/Layer.js';
import { resolveResources } from '../../src/resolver/Resolver.js';
import { resolveEffectiveSet } from '../../src/resolver/ResolverContext.js';
import { discoverSettingsLoadPlan, loadSettings } from '../../src/settings/SettingsLoader.js';
import type { AgentLaunchPlan } from '../../src/projection/Projection.js';

const temporaryRoots: string[] = [];

const createTemporaryRoot = (): string => {
  const root = mkdtempSync(join(tmpdir(), 'outfitter-agent-defaults-'));
  temporaryRoots.push(root);
  return root;
};

const write = (path: string, content: string): void => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
};

const relativeTree = (root: string): string[] => {
  const files: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else files.push(relative(root, full).split(/[/\\]/).join('/'));
    }
  };
  walk(root);
  return files.sort();
};

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

// The pinned collector extension the issue's acceptance scenario describes.
const PENSIEVE = 'git:github.com/ai-outfitter/pensieve@4b1e0d2c9a7f35e86b0d1c4a92f6e3d5a8b7c601';

/** Two unrelated Pi agents, neither mentioning the defaults in its own profile. */
const writeTwoAgentTree = (project: string): void => {
  write(join(project, '.agents', 'agents', 'alpha', 'agent.md'), '---\nname: alpha\n---\n\nAlpha body.\n');
  write(join(project, '.agents', 'agents', 'beta', 'agent.md'), '---\nname: beta\n---\n\nBeta body.\n');
};

const resolveSetFor = (home: string, project: string) =>
  resolveResources(discoverLayers({ homeDirectory: home, projectDirectory: project, settings: {} }).layers);

/** Asserts one dumped agent tree carries the defaults without leaking them into the agent profile. */
const expectDumpedDefaultTree = (out: string, agent: string): void => {
  // The agent profile itself does not mention the default; the settings layer carries it.
  const profile = readFileSync(join(out, '.agents', 'agents', agent, 'agent.md'), 'utf8');
  expect(profile).not.toContain('pensieve');
  expect(profile).not.toContain('organization');
  // Provenance records the settings layer.
  const provenance = JSON.parse(readFileSync(join(out, '.agents', '.outfitter', 'composition.json'), 'utf8')) as {
    compositions: { agentDefaults?: { extensions?: string[]; appendSystemPrompt?: unknown[] } }[];
  };
  expect(provenance.compositions[0]?.agentDefaults?.extensions).toEqual([PENSIEVE]);
  expect(provenance.compositions[0]?.agentDefaults?.appendSystemPrompt).toEqual([{ file: 'prompts/organization.md' }]);
  // The dumped tree carries the merged defaults and re-resolves exactly one extension.
  const tree = relativeTree(join(out, '.agents'));
  expect(tree).toContain('settings.yml');
  expect(tree).toContain('prompts/organization.md');
  const reloaded = resolveEffectiveSet({ homeDirectory: join(createTemporaryRoot(), 'home'), projectDirectory: out });
  expect(reloaded.settings.agentDefaults?.extensions).toEqual([PENSIEVE]);
  const recomposed = compose(reloaded.set, agent, {
    projectDirectory: out,
    agentDefaults: reloaded.settings.agentDefaults,
  });
  expect(recomposed.plan?.loadout.extensions).toEqual([PENSIEVE]);
};

describe('agent defaults', () => {
  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-002.10.1, OFTR-002.10.2).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('parses agent_defaults into settings and rejects unknown keys', () => {
    const root = createTemporaryRoot();
    const project = join(root, 'project');
    write(
      join(project, '.agents', 'settings.yml'),
      [
        'agent_defaults:',
        '  extensions:',
        `    - ${PENSIEVE}`,
        '  skills: [organization-practices]',
        '  mcp: [github]',
        '  plugins: [org-plugin]',
        '  subagents: [org-reviewer]',
        '  append_system_prompt:',
        '    - file: prompts/organization.md',
        '    - repo_file: docs/context.md',
      ].join('\n'),
    );

    const loaded = loadSettings(
      discoverSettingsLoadPlan({ homeDirectory: join(root, 'home'), projectDirectory: project }),
    );

    expect(loaded.issues).toEqual([]);
    expect(loaded.settings.agentDefaults).toEqual({
      extensions: [PENSIEVE],
      skills: ['organization-practices'],
      mcp: ['github'],
      plugins: ['org-plugin'],
      subagents: ['org-reviewer'],
      appendSystemPrompt: [{ file: 'prompts/organization.md' }, { repo_file: 'docs/context.md' }],
    });

    // A single prompt source (no array) is accepted and normalized.
    write(
      join(project, '.agents', 'settings.yml'),
      'agent_defaults:\n  append_system_prompt:\n    file: prompts/organization.md\n',
    );
    const scalar = loadSettings(
      discoverSettingsLoadPlan({ homeDirectory: join(root, 'home'), projectDirectory: project }),
    );
    expect(scalar.issues).toEqual([]);
    expect(scalar.settings.agentDefaults?.appendSystemPrompt).toEqual([{ file: 'prompts/organization.md' }]);

    write(join(project, '.agents', 'settings.yml'), 'agent_defaults:\n  model: gpt-5.2\n');
    const rejected = loadSettings(
      discoverSettingsLoadPlan({ homeDirectory: join(root, 'home'), projectDirectory: project }),
    );
    expect(rejected.issues.length).toBeGreaterThan(0);
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-002.10.5).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('merges agent_defaults across settings scopes as ordered-set unions', () => {
    const root = createTemporaryRoot();
    const home = join(root, 'home');
    const project = join(root, 'project');
    write(join(home, '.agents', 'settings.yml'), 'agent_defaults:\n  skills: [shared, user-only]\n');
    write(join(project, '.agents', 'settings.yml'), 'agent_defaults:\n  skills: [shared, project-only]\n');
    // A higher-precedence file that declares no defaults contributes nothing.
    write(join(project, '.agents', 'settings.local.yml'), 'default_agent: alpha\n');

    const loaded = loadSettings(discoverSettingsLoadPlan({ homeDirectory: home, projectDirectory: project }));

    expect(loaded.issues).toEqual([]);
    expect(loaded.settings.agentDefaults?.skills).toEqual(['shared', 'user-only', 'project-only']);
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-002.10.3).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('composes agent defaults ahead of the inheritance chain with stable de-duplication', () => {
    const root = createTemporaryRoot();
    const home = join(root, 'home');
    const project = join(root, 'project');
    for (const slug of ['defaults-skill', 'child-skill', 'parent-skill']) {
      write(join(project, '.agents', 'skills', slug, 'SKILL.md'), `---\nname: ${slug}\n---\n`);
    }
    write(
      join(project, '.agents', 'mcp.json'),
      JSON.stringify({ mcpServers: { github: { command: 'root' }, slack: { command: 'root-slack' } } }),
    );
    write(
      join(project, '.agents', 'settings.yml'),
      [
        'agent_defaults:',
        `  extensions: [${PENSIEVE}]`,
        '  skills: [defaults-skill, parent-skill]',
        '  plugins: [org-plugin]',
        '  mcp: [github, slack]',
      ].join('\n'),
    );
    write(
      join(project, '.agents', 'agents', 'parent', 'agent.md'),
      '---\nname: parent\nskills: [parent-skill]\nextensions: [parent-extension]\nplugins: [parent-plugin]\n---\n\nParent.\n',
    );
    write(
      join(project, '.agents', 'agents', 'child', 'agent.md'),
      '---\nname: child\ninherits: parent\nskills: [parent-skill, child-skill]\nextensions: [child-extension]\nplugins: [child-plugin]\n---\n\nChild.\n',
    );

    const loaded = loadSettings(discoverSettingsLoadPlan({ homeDirectory: home, projectDirectory: project }));
    const result = compose(resolveSetFor(home, project), 'child', {
      projectDirectory: project,
      agentDefaults: loaded.settings.agentDefaults,
    });

    expect(result.errors).toEqual([]);
    const plan = result.plan!;
    expect(plan.loadout.extensions).toEqual([PENSIEVE, 'parent-extension', 'child-extension']);
    expect(plan.loadout.plugins).toEqual(['org-plugin', 'parent-plugin', 'child-plugin']);
    expect(plan.loadout.skills.map((skill) => skill.slug)).toEqual(['defaults-skill', 'parent-skill', 'child-skill']);
    expect(plan.loadout.mcp).toEqual(['github', 'slack']);
    expect(plan.loadout.mcpServers).toEqual({ github: { command: 'root' }, slack: { command: 'root-slack' } });
    // Settings-layer entries are visible in plan provenance.
    expect(plan.agentDefaults).toEqual({
      extensions: [PENSIEVE],
      skills: ['defaults-skill', 'parent-skill'],
      plugins: ['org-plugin'],
      mcp: ['github', 'slack'],
    });
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-002.10.4).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('resolves defaults catalog-wide, ahead of any agent-local namespace', () => {
    const root = createTemporaryRoot();
    const home = join(root, 'home');
    const project = join(root, 'project');
    write(join(project, '.agents', 'skills', 'shared', 'SKILL.md'), '---\nname: shared\n---\n\ncatalog\n');
    write(join(project, '.agents', 'settings.yml'), 'agent_defaults:\n  skills: [shared]\n');
    write(join(project, '.agents', 'agents', 'alpha', 'agent.md'), '---\nname: alpha\nskills: [shared]\n---\n');
    write(
      join(project, '.agents', 'agents', 'alpha', 'skills', 'shared', 'SKILL.md'),
      '---\nname: shared\n---\n\nlocal\n',
    );

    const loaded = loadSettings(discoverSettingsLoadPlan({ homeDirectory: home, projectDirectory: project }));
    const result = compose(resolveSetFor(home, project), 'alpha', {
      projectDirectory: project,
      agentDefaults: loaded.settings.agentDefaults,
    });

    expect(result.errors).toEqual([]);
    expect(result.plan?.loadout.skills).toHaveLength(1);
    expect(result.plan?.loadout.skills[0]?.winner.ownerAgent).toBeUndefined();
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-002.10.7).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('warns about unresolved defaults naming the settings layer', () => {
    const root = createTemporaryRoot();
    const home = join(root, 'home');
    const project = join(root, 'project');
    writeTwoAgentTree(project);
    write(
      join(project, '.agents', 'settings.yml'),
      'agent_defaults:\n  skills: [ghost]\n  mcp: [ghost-server]\n  subagents: [ghost-delegate]\n',
    );
    write(
      join(project, '.agents', 'agents', 'alpha', 'agent.md'),
      '---\nname: alpha\nsubagents: [ghost-own]\n---\n\nAlpha body.\n',
    );

    const loaded = loadSettings(discoverSettingsLoadPlan({ homeDirectory: home, projectDirectory: project }));
    const result = compose(resolveSetFor(home, project), 'alpha', {
      projectDirectory: project,
      agentDefaults: loaded.settings.agentDefaults,
    });

    expect(result.plan?.warnings).toEqual([
      "agent_defaults subagents references unknown agent 'ghost-delegate'.",
      "loadout subagents references unknown agent 'ghost-own'.",
      "agent_defaults skills references unknown skill 'ghost'.",
      "agent_defaults mcp references unknown server 'ghost-server'.",
    ]);
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-002.10.7).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('warns when an optional settings repo_file prompt source is missing', () => {
    const root = createTemporaryRoot();
    const home = join(root, 'home');
    const project = join(root, 'project');
    writeTwoAgentTree(project);
    write(
      join(project, '.agents', 'settings.yml'),
      'agent_defaults:\n  append_system_prompt:\n    - repo_file: docs/ghost.md\n',
    );

    const loaded = loadSettings(discoverSettingsLoadPlan({ homeDirectory: home, projectDirectory: project }));
    const result = compose(resolveSetFor(home, project), 'alpha', {
      projectDirectory: project,
      agentDefaults: loaded.settings.agentDefaults,
    });

    expect(result.errors).toEqual([]);
    expect(result.plan?.warnings).toEqual([
      "agent 'settings:agent_defaults' optional repo_file prompt source 'docs/ghost.md' was not found.",
    ]);
    expect(result.plan?.identity.appendSystemPrompts).toEqual([]);
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-002.10.1, OFTR-002.10.2).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('records only non-empty defaults fields in plan provenance', () => {
    const root = createTemporaryRoot();
    const home = join(root, 'home');
    const project = join(root, 'project');
    writeTwoAgentTree(project);
    write(join(project, '.agents', 'settings.yml'), `agent_defaults:\n  extensions: [${PENSIEVE}]\n  skills: []\n`);

    const loaded = loadSettings(discoverSettingsLoadPlan({ homeDirectory: home, projectDirectory: project }));
    const result = compose(resolveSetFor(home, project), 'alpha', {
      projectDirectory: project,
      agentDefaults: loaded.settings.agentDefaults,
    });

    expect(result.errors).toEqual([]);
    expect(result.plan?.agentDefaults).toEqual({ extensions: [PENSIEVE] });
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-002.10.3, OFTR-002.10.8).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('composes settings append prompts first with settings-layer provenance', () => {
    const root = createTemporaryRoot();
    const home = join(root, 'home');
    const project = join(root, 'project');
    write(join(project, '.agents', 'prompts', 'organization.md'), 'ORG POLICY');
    write(join(project, 'docs', 'context.md'), 'repo context');
    write(
      join(project, '.agents', 'settings.yml'),
      'agent_defaults:\n  append_system_prompt:\n    - file: prompts/organization.md\n    - repo_file: docs/context.md\n',
    );
    write(
      join(project, '.agents', 'agents', 'alpha', 'agent.md'),
      '---\nname: alpha\nappend_system_prompt:\n  - file: prompts/organization.md\n---\n\nAlpha.\n',
    );

    const loaded = loadSettings(discoverSettingsLoadPlan({ homeDirectory: home, projectDirectory: project }));
    const result = compose(resolveSetFor(home, project), 'alpha', {
      projectDirectory: project,
      agentDefaults: loaded.settings.agentDefaults,
    });

    expect(result.errors).toEqual([]);
    const plan = result.plan!;
    const appended = plan.identity.appendSystemPrompts ?? [];
    // Duplicate suppression: the agent's own identical fragment collapses into the settings one.
    expect(appended.map((fragment) => fragment.content)).toEqual(['ORG POLICY', 'repo context']);
    expect(appended[0]?.declaringAgent).toBe('settings:agent_defaults');
    expect(appended[1]?.trust).toBe('repository');
    expect(plan.agentDefaults?.appendSystemPrompt).toEqual([
      { file: 'prompts/organization.md' },
      { repo_file: 'docs/context.md' },
    ]);
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-002.10.3).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('applies agent_defaults while composing the native harness link closure', () => {
    const root = createTemporaryRoot();
    const home = join(root, 'home');
    const project = join(root, 'project');
    write(join(project, '.agents', 'prompts', 'organization.md'), 'ORG POLICY');
    write(
      join(project, '.agents', 'settings.yml'),
      'agent_defaults:\n  append_system_prompt:\n    - file: prompts/organization.md\n',
    );
    write(join(project, '.agents', 'agents', 'alpha', 'agent.md'), '---\nname: alpha\n---\n\nAlpha.\n');

    const loaded = loadSettings(discoverSettingsLoadPlan({ homeDirectory: home, projectDirectory: project }));
    const closure = composeLinkClosure(resolveSetFor(home, project), ['alpha'], project, loaded.settings.agentDefaults);

    expect(closure.errors).toEqual([]);
    expect(closure.agents[0]?.document).toContain('ORG POLICY');
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-002.10.7).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('fails a settings prompt fragment missing from every layer', () => {
    const root = createTemporaryRoot();
    const home = join(root, 'home');
    const project = join(root, 'project');
    writeTwoAgentTree(project);
    write(
      join(project, '.agents', 'settings.yml'),
      'agent_defaults:\n  append_system_prompt:\n    - file: prompts/ghost.md\n',
    );

    const loaded = loadSettings(discoverSettingsLoadPlan({ homeDirectory: home, projectDirectory: project }));
    const result = compose(resolveSetFor(home, project), 'alpha', {
      projectDirectory: project,
      agentDefaults: loaded.settings.agentDefaults,
    });

    expect(result.plan).toBeUndefined();
    expect(result.errors[0]).toContain('prompt source file');
    expect(result.errors[0]).toContain('missing file');
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-002.10.3).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('composes agent defaults into delegated subagents too', () => {
    const root = createTemporaryRoot();
    const home = join(root, 'home');
    const project = join(root, 'project');
    write(join(project, '.agents', 'settings.yml'), `agent_defaults:\n  extensions: [${PENSIEVE}]\n`);
    write(
      join(project, '.agents', 'agents', 'leader', 'agent.md'),
      '---\nname: leader\nsubagents: [reviewer]\n---\n\nLeader.\n',
    );
    write(join(project, '.agents', 'agents', 'reviewer', 'agent.md'), '---\nname: reviewer\n---\n\nReview.\n');

    const loaded = loadSettings(discoverSettingsLoadPlan({ homeDirectory: home, projectDirectory: project }));
    const result = compose(resolveSetFor(home, project), 'leader', {
      projectDirectory: project,
      agentDefaults: loaded.settings.agentDefaults,
    });

    expect(result.errors).toEqual([]);
    expect(result.plan?.loadout.composedSubagents?.[0]?.extensions).toEqual([PENSIEVE]);
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-002.10.11).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('composes identically when agent_defaults is absent', () => {
    const root = createTemporaryRoot();
    const home = join(root, 'home');
    const project = join(root, 'project');
    write(join(project, '.agents', 'skills', 'wiki', 'SKILL.md'), '---\nname: wiki\n---\n');
    write(join(project, '.agents', 'agents', 'alpha', 'agent.md'), '---\nname: alpha\nskills: [wiki]\n---\n\nAlpha.\n');
    const set = resolveSetFor(home, project);

    expect(compose(set, 'alpha', { projectDirectory: project }).plan).toEqual(compose(set, 'alpha').plan);
    expect(compose(set, 'alpha').plan?.agentDefaults).toBeUndefined();
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-002.10.6).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('runs with agent defaults: the pinned extension reaches the pi install boundary', async () => {
    const root = createTemporaryRoot();
    const home = join(root, 'home');
    const project = join(root, 'project');
    const xdg = join(root, 'xdg');
    writeTwoAgentTree(project);
    write(
      join(project, '.agents', 'settings.yml'),
      `agent_defaults:\n  extensions: [git:github.com/ai-outfitter/pensieve@v1]\n`,
    );
    const installed: string[] = [];
    const extensionInstallSpawner = ({ source, cacheAgentDir }: { source: string; cacheAgentDir: string }) => {
      installed.push(source);
      write(
        join(cacheAgentDir, 'git', 'github.com', 'ai-outfitter', 'pensieve', 'package.json'),
        '{"name":"pensieve","version":"1.0.0"}',
      );
      return Promise.resolve(0);
    };
    let capturedPlan: AgentLaunchPlan | undefined;
    const launcher = (plan: AgentLaunchPlan): Promise<number> => {
      capturedPlan = plan;
      return Promise.resolve(0);
    };

    const previousXdg = process.env.XDG_CACHE_HOME;
    process.env.XDG_CACHE_HOME = xdg;
    try {
      const result = await executeRunAgentCommand({
        homeDirectory: home,
        projectDirectory: project,
        agent: 'alpha',
        harness: 'pi',
        launcher,
        extensionInstallSpawner,
      });

      expect(result.exitCode).toBe(0);
      expect(installed).toEqual(['git:github.com/ai-outfitter/pensieve@v1']);
      expect(capturedPlan?.args).toContain('--extension');
    } finally {
      if (previousXdg === undefined) delete process.env.XDG_CACHE_HOME;
      else process.env.XDG_CACHE_HOME = previousXdg;
    }
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-002.10.6, OFTR-002.10.7).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('validates unresolved defaults as errors naming the settings layer', () => {
    const root = createTemporaryRoot();
    const home = join(root, 'home');
    const project = join(root, 'project');
    writeTwoAgentTree(project);
    write(join(project, '.agents', 'settings.yml'), 'agent_defaults:\n  skills: [ghost]\n');

    const result = executeValidateCommand({ homeDirectory: home, projectDirectory: project });

    expect(result.ok).toBe(false);
    expect(result.findings).toEqual([
      {
        resource: 'agent:alpha',
        severity: 'error',
        message: "agent_defaults skills references unknown skill 'ghost'.",
      },
      {
        resource: 'agent:beta',
        severity: 'error',
        message: "agent_defaults skills references unknown skill 'ghost'.",
      },
    ]);
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-002.10.6, OFTR-002.10.8).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('dumps self-contained trees carrying exactly one resolved default per agent', () => {
    const root = createTemporaryRoot();
    const home = join(root, 'home');
    const project = join(root, 'project');
    writeTwoAgentTree(project);
    write(join(project, '.agents', 'prompts', 'organization.md'), 'ORG POLICY');
    write(
      join(project, '.agents', 'settings.yml'),
      `agent_defaults:\n  extensions: [${PENSIEVE}]\n  append_system_prompt:\n    - file: prompts/organization.md\n`,
    );

    for (const agent of ['alpha', 'beta']) {
      const out = join(root, `dump-${agent}`);
      const result = executeDumpCommand({ homeDirectory: home, projectDirectory: project, agent, out });

      expect(result.ok).toBe(true);
      expectDumpedDefaultTree(out, agent);
    }
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-002.10.6, OFTR-002.10.8).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('carries a lower-layer agent-default MCP definition into a self-contained dump', () => {
    const root = createTemporaryRoot();
    const home = join(root, 'home');
    const project = join(root, 'project');
    const out = join(root, 'dump');
    write(join(home, '.agents', 'mcp.json'), JSON.stringify({ mcpServers: { github: { command: 'home-gh' } } }));
    write(join(project, '.agents', 'mcp.json'), JSON.stringify({ mcpServers: { slack: { command: 'slack' } } }));
    write(join(project, '.agents', 'settings.yml'), 'agent_defaults:\n  mcp: [github]\n');
    write(join(project, '.agents', 'agents', 'alpha', 'agent.md'), '---\nname: alpha\n---\n\nAlpha.\n');

    const result = executeDumpCommand({ homeDirectory: home, projectDirectory: project, agent: 'alpha', out });

    expect(result.ok).toBe(true);
    expect(JSON.parse(readFileSync(join(out, '.agents', 'mcp.json'), 'utf8'))).toEqual({
      mcpServers: {
        slack: { command: 'slack' },
        github: { command: 'home-gh' },
      },
    });
    const reloaded = resolveEffectiveSet({
      homeDirectory: join(createTemporaryRoot(), 'home'),
      projectDirectory: out,
    });
    const recomposed = compose(reloaded.set, 'alpha', {
      projectDirectory: out,
      agentDefaults: reloaded.settings.agentDefaults,
    });
    expect(recomposed.warnings).toEqual([]);
    expect(recomposed.plan?.loadout.mcpServers).toEqual({ github: { command: 'home-gh' } });
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-002.10.8).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('replaces a copied MCP document without a server map with the effective default definition', () => {
    const root = createTemporaryRoot();
    const home = join(root, 'home');
    const project = join(root, 'project');
    const out = join(root, 'dump');
    write(join(home, '.agents', 'mcp.json'), JSON.stringify({ mcpServers: { github: { command: 'home-gh' } } }));
    write(join(project, '.agents', 'mcp.json'), '{}');
    write(join(project, '.agents', 'settings.yml'), 'agent_defaults:\n  mcp: [github]\n');
    write(join(project, '.agents', 'agents', 'alpha', 'agent.md'), '---\nname: alpha\n---\n\nAlpha.\n');

    const result = executeDumpCommand({ homeDirectory: home, projectDirectory: project, agent: 'alpha', out });

    expect(result.ok).toBe(true);
    expect(JSON.parse(readFileSync(join(out, '.agents', 'mcp.json'), 'utf8'))).toEqual({
      mcpServers: { github: { command: 'home-gh' } },
    });
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-002.10.11).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('writes no settings.yml into dumps without agent defaults', () => {
    const root = createTemporaryRoot();
    const home = join(root, 'home');
    const project = join(root, 'project');
    writeTwoAgentTree(project);
    const out = join(root, 'dump');

    const result = executeDumpCommand({ homeDirectory: home, projectDirectory: project, agent: 'alpha', out });

    expect(result.ok).toBe(true);
    expect(existsSync(join(out, '.agents', 'settings.yml'))).toBe(false);
    const provenance = JSON.parse(readFileSync(join(out, '.agents', '.outfitter', 'composition.json'), 'utf8')) as {
      compositions: { agentDefaults?: unknown }[];
    };
    expect(provenance.compositions[0]?.agentDefaults).toBeUndefined();
  });
});
