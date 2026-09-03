// Builds the harness CLI invocations that register, inspect, and remove user-scope MCP servers.
import type { LinkHarness } from './HarnessHome.js';

export interface HarnessMcpArgs {
  /** Undefined when the harness cannot express this server at all. */
  readonly args?: readonly string[];
  readonly warnings: readonly string[];
}

const CODEX_MCP_ID = /^[A-Za-z0-9_-]+$/u;
const ENVIRONMENT_REFERENCE = /\$\{[A-Za-z_][A-Za-z0-9_]*\}/u;

const asRecord = (value: unknown): Readonly<Record<string, unknown>> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : {};

/** Claude Code takes the protocol definition verbatim: its `mcp.json` shape is Claude's own. */
const claudeAddArgs = (id: string, server: Readonly<Record<string, unknown>>): HarnessMcpArgs => ({
  args: ['mcp', 'add-json', id, JSON.stringify(server), '--scope', 'user'],
  warnings: [],
});

const codexHttpArgs = (id: string, url: string, server: Readonly<Record<string, unknown>>): HarnessMcpArgs => {
  const args = ['mcp', 'add', id, '--url', url];
  const warnings: string[] = [];
  for (const [header, value] of Object.entries(asRecord(server.headers))) {
    const bearer =
      header.toLowerCase() === 'authorization' && typeof value === 'string'
        ? /^Bearer \$\{([A-Za-z_][A-Za-z0-9_]*)\}$/iu.exec(value)?.[1]
        : undefined;
    if (bearer !== undefined) args.push('--bearer-token-env-var', bearer);
    else
      warnings.push(
        `codex MCP server '${id}': header '${header}' cannot be registered by 'codex mcp add' and is dropped.`,
      );
  }
  return { args, warnings };
};

const codexEnvironmentFlags = (id: string, env: Readonly<Record<string, unknown>>, warnings: string[]): string[] =>
  Object.entries(env).flatMap(([name, value]) => {
    if (typeof value !== 'string') {
      warnings.push(`codex MCP server '${id}': dropped non-string env entry '${name}'.`);
      return [];
    }
    if (ENVIRONMENT_REFERENCE.test(value)) {
      warnings.push(
        `codex MCP server '${id}': env entry '${name}' references an environment variable Codex does not expand; export it before launching codex.`,
      );
      return [];
    }
    return ['--env', `${name}=${value}`];
  });

const codexStdioArgs = (id: string, command: string, server: Readonly<Record<string, unknown>>): HarnessMcpArgs => {
  const warnings: string[] = [];
  const commandArgs = Array.isArray(server.args) ? server.args.filter((value) => typeof value === 'string') : [];
  const args = [
    'mcp',
    'add',
    id,
    ...codexEnvironmentFlags(id, asRecord(server.env), warnings),
    '--',
    command,
    ...commandArgs,
  ];
  return { args, warnings };
};

/**
 * Codex registers servers through flags rather than a document, so only what `codex mcp add`
 * can express is registered; everything else is reported and dropped rather than mis-registered.
 */
const codexAddArgs = (id: string, server: Readonly<Record<string, unknown>>): HarnessMcpArgs => {
  if (!CODEX_MCP_ID.test(id)) {
    return { warnings: [`codex MCP server '${id}': id contains characters Codex cannot express.`] };
  }
  if (typeof server.url === 'string') return codexHttpArgs(id, server.url, server);
  if (typeof server.command === 'string') return codexStdioArgs(id, server.command, server);
  return { warnings: [`codex MCP server '${id}': expected a URL or command.`] };
};

export const mcpAddArgs = (
  harness: LinkHarness,
  id: string,
  server: Readonly<Record<string, unknown>>,
): HarnessMcpArgs => (harness === 'claude' ? claudeAddArgs(id, server) : codexAddArgs(id, server));

export const mcpGetArgs = (id: string): readonly string[] => ['mcp', 'get', id];

export const mcpRemoveArgs = (harness: LinkHarness, id: string): readonly string[] =>
  harness === 'claude' ? ['mcp', 'remove', id, '--scope', 'user'] : ['mcp', 'remove', id];
