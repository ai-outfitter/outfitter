// Translates selected protocol MCP server definitions into Codex CLI TOML overrides.

const asRecord = (value: unknown): Readonly<Record<string, unknown>> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : {};

const tomlString = (value: string): string => JSON.stringify(value);
const tomlKey = (value: string): string => (/^[A-Za-z0-9_-]+$/u.test(value) ? value : tomlString(value));

const stringRecord = (value: unknown): Readonly<Record<string, string>> =>
  Object.fromEntries(
    Object.entries(asRecord(value)).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
  );

const tomlInlineTable = (value: Readonly<Record<string, string>>): string =>
  `{ ${Object.entries(value)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${tomlString(key)} = ${tomlString(item)}`)
    .join(', ')} }`;

const environmentReference = (value: string): string | undefined =>
  /^\$\{([A-Za-z_][A-Za-z0-9_]*)\}$/u.exec(value)?.[1];
const bearerTokenReference = (header: string, value: string): string | undefined =>
  header.toLowerCase() === 'authorization' ? /^Bearer \$\{([A-Za-z_][A-Za-z0-9_]*)\}$/iu.exec(value)?.[1] : undefined;

const override = (key: string, value: string): readonly string[] => ['-c', `${key}=${value}`];

const projectHttpServer = (
  prefix: string,
  url: string,
  server: Readonly<Record<string, unknown>>,
): readonly string[] => {
  const args = [...override(`${prefix}.url`, tomlString(url))];
  const literalHeaders: Record<string, string> = {};
  const environmentHeaders: Record<string, string> = {};
  let bearerTokenEnvironment: string | undefined;
  for (const [header, value] of Object.entries(stringRecord(server.headers))) {
    const bearerToken = bearerTokenReference(header, value);
    const environment = environmentReference(value);
    if (bearerToken !== undefined) bearerTokenEnvironment = bearerToken;
    else if (environment === undefined) literalHeaders[header] = value;
    else environmentHeaders[header] = environment;
  }
  if (Object.keys(literalHeaders).length > 0) {
    args.push(...override(`${prefix}.http_headers`, tomlInlineTable(literalHeaders)));
  }
  if (Object.keys(environmentHeaders).length > 0) {
    args.push(...override(`${prefix}.env_http_headers`, tomlInlineTable(environmentHeaders)));
  }
  if (bearerTokenEnvironment !== undefined) {
    args.push(...override(`${prefix}.bearer_token_env_var`, tomlString(bearerTokenEnvironment)));
  }
  return args;
};

const projectStdioServer = (
  prefix: string,
  command: string,
  server: Readonly<Record<string, unknown>>,
): readonly string[] => {
  const args = [...override(`${prefix}.command`, tomlString(command))];
  if (Array.isArray(server.args)) {
    const commandArgs = server.args.filter((value): value is string => typeof value === 'string');
    args.push(...override(`${prefix}.args`, `[${commandArgs.map(tomlString).join(', ')}]`));
  }
  const environment = stringRecord(server.env);
  if (Object.keys(environment).length > 0) {
    args.push(...override(`${prefix}.env`, tomlInlineTable(environment)));
  }
  if (typeof server.cwd === 'string') args.push(...override(`${prefix}.cwd`, tomlString(server.cwd)));
  return args;
};

export interface CodexMcpProjection {
  readonly args: readonly string[];
  readonly warnings: readonly string[];
}

// Codex merges `-c` overrides with user and project `config.toml` and has no exclusive MCP mode, so
// selecting any server leaves lower-layer servers active. Reported as an adapter warning, which
// `--strict` makes fatal.
const ADDITIVE_PROJECTION_WARNING =
  'codex MCP projection is additive: user and project MCP servers remain active because Codex has no strict isolation mode.';

/**
 * Codex CLI `-c` values are TOML, not JSON. HTTP header values written as `${ENV_NAME}` are
 * translated to `env_http_headers`, and `Authorization: Bearer ${ENV_NAME}` becomes
 * `bearer_token_env_var`, so the secret itself stays out of argv. Other values must use Codex's
 * literal `http_headers` because the protocol definition contains no environment reference.
 */
export const projectCodexMcpServers = (
  selectedIds: readonly string[],
  servers: Readonly<Record<string, unknown>>,
): CodexMcpProjection => {
  const args: string[] = [];
  const warnings: string[] = selectedIds.length === 0 ? [] : [ADDITIVE_PROJECTION_WARNING];

  for (const id of selectedIds) {
    const server = asRecord(servers[id]);
    const prefix = `mcp_servers.${tomlKey(id)}`;

    if (typeof server.url === 'string') {
      args.push(...projectHttpServer(prefix, server.url, server));
      continue;
    }

    if (typeof server.command === 'string') {
      args.push(...projectStdioServer(prefix, server.command, server));
      continue;
    }

    warnings.push(`codex adapter cannot project MCP server '${id}': expected a URL or command.`);
  }

  return { args, warnings };
};
