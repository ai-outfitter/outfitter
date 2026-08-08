// Tests Codex launch planning, additive MCP projection, TOML values, and unsupported elements.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import type { CompositionPlan } from '../../src/composer/Composition.js';
import { projectComposition } from '../../src/projection/ProjectHarness.js';
import type { ResolvedResource } from '../../src/resolver/Resource.js';

const roots: string[] = [];
const root = (): string => {
  const directory = mkdtempSync(join(tmpdir(), 'outfitter-codex-'));
  roots.push(directory);
  return directory;
};

afterEach(() => {
  for (const directory of roots.splice(0)) rmSync(directory, { recursive: true, force: true });
});

const plan = (mcpServers: Readonly<Record<string, unknown>>, mcp = Object.keys(mcpServers)): CompositionPlan => ({
  agent: 'engineer',
  identity: { agentBody: 'Engineer.' },
  loadout: {
    skills: [],
    delegateSkills: [],
    subagents: [],
    mcp,
    mcpServers,
    extensions: [],
    plugins: [],
  },
  warnings: [],
});

const overrideValues = (args: readonly string[]): readonly string[] =>
  args.filter((value, index) => args[index - 1] === '-c');

const resource = (kind: 'agent' | 'skill', slug: string, path: string, layerRoot: string): ResolvedResource => ({
  kind,
  slug,
  winner: { kind, slug, path, layer: { root: layerRoot, origin: 'workspace', label: 'workspace' } },
  shadowed: [],
});

describe('projectComposition Codex MCP projection', () => {
  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-006.6).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('projects HTTP URLs and headers as repeated TOML overrides', () => {
    const directory = root();
    const projection = projectComposition(
      plan({
        'remote.github': {
          type: 'http',
          url: 'https://mcp.example.test/rpc',
          headers: {
            'X-Literal': 'public-value',
            'Z-Literal': 'second-value',
            Authorization: 'Bearer ${GITHUB_TOKEN}',
            'X-Token': '${SECOND_TOKEN}',
            Ignored: 42,
          },
        },
      }),
      { harness: 'codex', rootDirectory: directory, homeDirectory: directory },
    );

    expect(overrideValues(projection.launch.args)).toEqual([
      'mcp_servers."remote.github".url="https://mcp.example.test/rpc"',
      'mcp_servers."remote.github".http_headers={ "X-Literal" = "public-value", "Z-Literal" = "second-value" }',
      'mcp_servers."remote.github".env_http_headers={ "X-Token" = "SECOND_TOKEN" }',
      'mcp_servers."remote.github".bearer_token_env_var="GITHUB_TOKEN"',
    ]);
    expect(projection.warnings).toContain(
      'codex MCP projection is additive: user and project MCP servers remain active because Codex has no strict isolation mode.',
    );
    expect(projection.warnings).toContain(
      "codex adapter dropped non-string MCP header 'Ignored' from server 'remote.github'.",
    );
    expect(projection.warnings).toEqual(
      expect.arrayContaining([
        "codex MCP server 'remote.github' header 'X-Literal' is literal and will be visible in process arguments.",
        "codex MCP server 'remote.github' header 'Z-Literal' is literal and will be visible in process arguments.",
      ]),
    );
    expect(projection.unsupported).not.toContain('mcp');
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-006.6).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('projects stdio command, args, env, and cwd as repeated TOML overrides', () => {
    const directory = root();
    const projection = projectComposition(
      plan({
        local: {
          command: 'node',
          args: ['server.js', '--stdio', 3],
          env: { MODE: 'test', MCP_TOKEN: '${MCP_TOKEN}', Ignored: false },
          cwd: '/workspace',
        },
      }),
      {
        harness: 'codex',
        rootDirectory: directory,
        homeDirectory: directory,
        passThroughArgs: ['exec', 'review this tree'],
      },
    );

    expect(projection.launch.command).toBe('codex');
    expect(overrideValues(projection.launch.args)).toEqual([
      'mcp_servers.local.command="node"',
      'mcp_servers.local.args=["server.js", "--stdio"]',
      'mcp_servers.local.env={ "MODE" = "test" }',
      'mcp_servers.local.env_vars=["MCP_TOKEN"]',
      'mcp_servers.local.cwd="/workspace"',
    ]);
    expect(projection.launch.args.slice(-2)).toEqual(['exec', 'review this tree']);
    expect(projection.launch.env).toEqual({});
    expect(projection.warnings).toEqual(
      expect.arrayContaining([
        "codex adapter dropped non-string MCP arg at index 2 from server 'local'.",
        "codex MCP server 'local' env entry 'MODE' is literal and will be visible in process arguments.",
        "codex adapter dropped non-string MCP env entry 'Ignored' from server 'local'.",
      ]),
    );
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-006.6.3).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('projects a stdio server with an explicit transport type', () => {
    const directory = root();
    const projection = projectComposition(plan({ local: { type: 'stdio', command: 'server' } }), {
      harness: 'codex',
      rootDirectory: directory,
      homeDirectory: directory,
    });

    expect(overrideValues(projection.launch.args)).toEqual(['mcp_servers.local.command="server"']);
    expect(projection.warnings).not.toContain(
      "codex adapter cannot project MCP server 'local': transport 'stdio' is unsupported.",
    );
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-006.6.3).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('warns and omits a stdio environment reference that renames the source variable', () => {
    const directory = root();
    const projection = projectComposition(
      plan({ local: { command: 'server', env: { GH_TOKEN: '${GITHUB_TOKEN}' } } }),
      { harness: 'codex', rootDirectory: directory, homeDirectory: directory },
    );

    expect(overrideValues(projection.launch.args)).toEqual(['mcp_servers.local.command="server"']);
    expect(projection.warnings).toContain(
      "codex adapter cannot project MCP server 'local' env entry 'GH_TOKEN': environment reference '${GITHUB_TOKEN}' would rename 'GITHUB_TOKEN'.",
    );
  });

  it('warns instead of projecting a legacy SSE HTTP server', () => {
    const directory = root();
    const projection = projectComposition(plan({ legacy: { type: 'sse', url: 'https://example.test/sse' } }), {
      harness: 'codex',
      rootDirectory: directory,
      homeDirectory: directory,
    });

    expect(projection.warnings).toContain(
      "codex adapter cannot project MCP server 'legacy': transport 'sse' is unsupported.",
    );
    expect(overrideValues(projection.launch.args)).toEqual([]);
  });

  it('projects an explicitly streamable HTTP server', () => {
    const directory = root();
    const projection = projectComposition(
      plan({ remote: { type: 'streamable-http', url: 'https://example.test/mcp' } }),
      { harness: 'codex', rootDirectory: directory, homeDirectory: directory },
    );

    expect(overrideValues(projection.launch.args)).toEqual(['mcp_servers.remote.url="https://example.test/mcp"']);
    expect(projection.warnings).not.toContain(
      "codex adapter cannot project MCP server 'remote': transport 'streamable-http' is unsupported.",
    );
  });

  // THIS TEST VALIDATES HARD REQUIREMENTS (OFTR-006.6.2 AND OFTR-006.6.6).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENTS CHANGE.
  it('maps only model and MCP and reports the rest of the Codex loadout unsupported', () => {
    const directory = root();
    const catalog = root();
    const skillPath = join(catalog, 'skills', 'review', 'SKILL.md');
    const subagentPath = join(catalog, 'agents', 'reviewer', 'agent.md');
    mkdirSync(join(catalog, 'skills', 'review'), { recursive: true });
    mkdirSync(join(catalog, 'agents', 'reviewer'), { recursive: true });
    writeFileSync(skillPath, '---\nname: review\n---\n\nReview skill.\n');
    writeFileSync(subagentPath, '---\nname: reviewer\n---\n\nReview carefully.\n');
    const base = plan({}, []);
    const projection = projectComposition(
      {
        ...base,
        identity: {
          ...base.identity,
          promptTemplate: { kind: 'file', content: '{{input}}', label: 'template', trust: 'catalog' },
        },
        loadout: {
          ...base.loadout,
          skills: [resource('skill', 'review', skillPath, catalog)],
          subagents: [resource('agent', 'reviewer', subagentPath, catalog)],
          model: 'gpt-5',
          thinking: 'high',
          tools: { allow: ['read'] },
          extensions: ['npm:extension'],
          plugins: ['plugin'],
        },
      },
      {
        harness: 'codex',
        rootDirectory: directory,
        homeDirectory: directory,
        appendPromptPaths: ['/caller-prompt.md'],
      },
    );

    expect(projection.launch.args).toEqual(['-m', 'gpt-5']);
    expect(projection.unsupported).toEqual([
      'identity',
      'skills',
      'subagents',
      'extensions',
      'plugins',
      'thinking',
      'tools',
      'prompt_template',
    ]);
    expect(projection.warnings).toEqual([
      'codex adapter does not project supplied append-prompt documents; they will be dropped.',
    ]);
  });

  it('omits optional empty HTTP and stdio fields', () => {
    const directory = root();
    const projection = projectComposition(
      plan({ remote: { url: 'https://example.test', headers: [] }, local: { command: 'server', env: null } }),
      { harness: 'codex', rootDirectory: directory, homeDirectory: directory },
    );

    expect(overrideValues(projection.launch.args)).toEqual([
      'mcp_servers.remote.url="https://example.test"',
      'mcp_servers.local.command="server"',
    ]);
  });
});
