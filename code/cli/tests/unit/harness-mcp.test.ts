// Covers the harness CLI argument builders that register, inspect, and remove user-scope MCP servers.
import { describe, expect, it } from 'vitest';

import { mcpAddArgs, mcpGetArgs, mcpRemoveArgs } from '../../src/links/HarnessMcp.js';

describe('harness MCP argument builders', () => {
  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-012.5).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('registers a Claude server verbatim at user scope and removes it from the same scope', () => {
    const server = { command: 'srv', args: ['--x'], env: { TOKEN: '${TOKEN}' } };
    expect(mcpAddArgs('claude', 'github', server)).toEqual({
      args: ['mcp', 'add-json', 'github', JSON.stringify(server), '--scope', 'user'],
      warnings: [],
    });
    expect(mcpGetArgs('github')).toEqual(['mcp', 'get', 'github']);
    expect(mcpRemoveArgs('claude', 'github')).toEqual(['mcp', 'remove', 'github', '--scope', 'user']);
    expect(mcpRemoveArgs('codex', 'github')).toEqual(['mcp', 'remove', 'github']);
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-012.5).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('translates a Codex HTTP server to --url with a bearer token variable and drops other headers', () => {
    const result = mcpAddArgs('codex', 'remote', {
      url: 'https://example.test/mcp',
      headers: { Authorization: 'Bearer ${REMOTE_TOKEN}', 'X-Team': 'blue', Count: 3 },
    });
    expect(result.args).toEqual([
      'mcp',
      'add',
      'remote',
      '--url',
      'https://example.test/mcp',
      '--bearer-token-env-var',
      'REMOTE_TOKEN',
    ]);
    expect(result.warnings).toEqual([
      "codex MCP server 'remote': header 'X-Team' cannot be registered by 'codex mcp add' and is dropped.",
      "codex MCP server 'remote': header 'Count' cannot be registered by 'codex mcp add' and is dropped.",
    ]);
  });

  it('translates a Codex stdio server with literal env, warning on references and non-strings', () => {
    const result = mcpAddArgs('codex', 'local', {
      command: 'srv',
      args: ['--flag', 7, 'value'],
      env: { PLAIN: 'yes', REF: '${REF}', NUM: 1 },
    });
    expect(result.args).toEqual(['mcp', 'add', 'local', '--env', 'PLAIN=yes', '--', 'srv', '--flag', 'value']);
    expect(result.warnings).toEqual([
      "codex MCP server 'local': env entry 'REF' references an environment variable Codex does not expand; export it before launching codex.",
      "codex MCP server 'local': dropped non-string env entry 'NUM'.",
    ]);
    expect(mcpAddArgs('codex', 'bare', { command: 'srv' }).args).toEqual(['mcp', 'add', 'bare', '--', 'srv']);
  });

  it('refuses Codex servers it cannot express', () => {
    expect(mcpAddArgs('codex', 'bad id', { command: 'srv' })).toEqual({
      warnings: ["codex MCP server 'bad id': id contains characters Codex cannot express."],
    });
    expect(mcpAddArgs('codex', 'empty', { type: 'stdio' })).toEqual({
      warnings: ["codex MCP server 'empty': expected a URL or command."],
    });
  });
});
