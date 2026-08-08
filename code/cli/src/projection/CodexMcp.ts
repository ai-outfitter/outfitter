// Translates selected protocol MCP server definitions into Codex CLI TOML overrides.

const asRecord = (value: unknown): Readonly<Record<string, unknown>> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : {};

const tomlString = (value: string): string =>
  JSON.stringify(
    value.replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/gu, '\uFFFD'),
  ).replace(/\u007F/gu, '\\u007F');
const CODEX_MCP_ID = /^[A-Za-z0-9_-]+$/u;
const ENVIRONMENT_REFERENCE = /\$\{[A-Za-z_][A-Za-z0-9_]*\}/u;

const tomlInlineTable = (value: Readonly<Record<string, string>>): string =>
  `{ ${Object.entries(value)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${tomlString(key)} = ${tomlString(item)}`)
    .join(', ')} }`;

const environmentReference = (value: string): string | undefined =>
  /^\$\{([A-Za-z_][A-Za-z0-9_]*)\}$/u.exec(value)?.[1];
const bearerTokenReference = (header: string, value: string): string | undefined =>
  header.toLowerCase() === 'authorization' ? /^Bearer \$\{([A-Za-z_][A-Za-z0-9_]*)\}$/iu.exec(value)?.[1] : undefined;
const supportedTransport = (value: unknown): boolean =>
  value === undefined || value === 'stdio' || value === 'http' || value === 'streamable-http';

const override = (key: string, value: string): readonly string[] => ['-c', `${key}=${value}`];

const warnUnexpandedReferences = (id: string, field: string, value: string, warnings: string[]): void => {
  if (ENVIRONMENT_REFERENCE.test(value)) {
    warnings.push(
      `codex MCP server '${id}' field '${field}' contains environment references that Codex does not expand.`,
    );
  }
};

const projectStdioEnvironmentEntry = (
  id: string,
  name: string,
  value: unknown,
  literalEnvironment: Record<string, string>,
  environmentVariables: string[],
  warnings: string[],
): void => {
  if (typeof value !== 'string') {
    warnings.push(`codex adapter dropped non-string MCP env entry '${name}' from server '${id}'.`);
    return;
  }
  const environment = environmentReference(value);
  if (environment === undefined) {
    literalEnvironment[name] = value;
    warnings.push(`codex MCP server '${id}' env entry '${name}' is literal and will be visible in process arguments.`);
    return;
  }
  if (name === environment) {
    environmentVariables.push(environment);
    return;
  }
  warnings.push(
    `codex adapter cannot project MCP server '${id}' env entry '${name}': environment reference '${value}' would rename '${environment}'.`,
  );
};

const projectHttpServer = (
  id: string,
  prefix: string,
  url: string,
  server: Readonly<Record<string, unknown>>,
  warnings: string[],
): readonly string[] => {
  warnUnexpandedReferences(id, 'url', url, warnings);
  const args = [...override(`${prefix}.url`, tomlString(url))];
  const literalHeaders: Record<string, string> = {};
  const environmentHeaders: Record<string, string> = {};
  let bearerTokenEnvironment: string | undefined;
  for (const [header, value] of Object.entries(asRecord(server.headers))) {
    if (typeof value !== 'string') {
      warnings.push(`codex adapter dropped non-string MCP header '${header}' from server '${id}'.`);
      continue;
    }
    const bearerToken = bearerTokenReference(header, value);
    const environment = environmentReference(value);
    if (bearerToken !== undefined) bearerTokenEnvironment = bearerToken;
    else if (environment === undefined) {
      literalHeaders[header] = value;
      warnings.push(`codex MCP server '${id}' header '${header}' is literal and will be visible in process arguments.`);
    } else environmentHeaders[header] = environment;
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
  id: string,
  prefix: string,
  command: string,
  server: Readonly<Record<string, unknown>>,
  warnings: string[],
): readonly string[] => {
  warnUnexpandedReferences(id, 'command', command, warnings);
  const args = [...override(`${prefix}.command`, tomlString(command))];
  if (Array.isArray(server.args)) {
    const commandArgs: string[] = [];
    for (const [index, value] of server.args.entries()) {
      if (typeof value === 'string') {
        warnUnexpandedReferences(id, `args[${index}]`, value, warnings);
        commandArgs.push(value);
      } else warnings.push(`codex adapter dropped non-string MCP arg at index ${index} from server '${id}'.`);
    }
    args.push(...override(`${prefix}.args`, `[${commandArgs.map(tomlString).join(', ')}]`));
  }
  const literalEnvironment: Record<string, string> = {};
  const environmentVariables: string[] = [];
  for (const [name, value] of Object.entries(asRecord(server.env))) {
    projectStdioEnvironmentEntry(id, name, value, literalEnvironment, environmentVariables, warnings);
  }
  if (Object.keys(literalEnvironment).length > 0) {
    args.push(...override(`${prefix}.env`, tomlInlineTable(literalEnvironment)));
  }
  if (environmentVariables.length > 0) {
    args.push(
      ...override(
        `${prefix}.env_vars`,
        `[${environmentVariables
          .sort((left, right) => left.localeCompare(right))
          .map(tomlString)
          .join(', ')}]`,
      ),
    );
  }
  if (typeof server.cwd === 'string') {
    warnUnexpandedReferences(id, 'cwd', server.cwd, warnings);
    args.push(...override(`${prefix}.cwd`, tomlString(server.cwd)));
  }
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
  const warnings: string[] = [ADDITIVE_PROJECTION_WARNING];

  for (const id of selectedIds) {
    if (!CODEX_MCP_ID.test(id)) {
      warnings.push(
        `codex adapter cannot project MCP server '${id}': id contains characters Codex -c key paths cannot express.`,
      );
      continue;
    }
    const server = asRecord(servers[id]);
    const prefix = `mcp_servers.${id}`;

    if (!supportedTransport(server.type)) {
      const transport =
        typeof server.type === 'string' ? server.type : (JSON.stringify(server.type) ?? typeof server.type);
      warnings.push(`codex adapter cannot project MCP server '${id}': transport '${transport}' is unsupported.`);
      continue;
    }

    if (typeof server.url === 'string') {
      args.push(...projectHttpServer(id, prefix, server.url, server, warnings));
      continue;
    }

    if (typeof server.command === 'string') {
      args.push(...projectStdioServer(id, prefix, server.command, server, warnings));
      continue;
    }

    warnings.push(`codex adapter cannot project MCP server '${id}': expected a URL or command.`);
  }

  return { args, warnings };
};
