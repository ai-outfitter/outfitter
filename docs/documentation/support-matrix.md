# Adapter support matrix

What Outfitter can project per agent CLI. Pi is the primary and most complete adapter; Claude Code and Codex CLI are supported with gaps.

Status values:

- **Supported** — Outfitter projects this concept for the CLI through at least one native mechanism.
- **Partial** — some of the concept works today, with documented gaps.
- **Roadmap** — the CLI appears to support the concept, but Outfitter does not project it yet.

When a composition requests something an adapter cannot project, Outfitter warns to stderr; `--strict` makes those warnings fatal.

Tasks and bake are not in this matrix — they are the subject of a [separate upcoming RFC](./tasks.md).

| What Outfitter projects                                                  | Pi        | Claude Code | Codex CLI |
| ------------------------------------------------------------------------ | --------- | ----------- | --------- |
| Agent config directory                                                   | Supported | Supported   | Roadmap   |
| Session directory                                                        | Supported | Supported   | Roadmap   |
| Agent identity (`system-prompt.md`, `agents.md`, `agents/<id>/agent.md`) | Supported | Supported   | Roadmap   |
| Subagents (`agents/<id>` as harness delegates)                           | Supported | Supported   | Roadmap   |
| Skills (`skills/<id>`)                                                   | Supported | Partial     | Roadmap   |
| Commands (`commands/`)                                                   | Supported | Partial     | Roadmap   |
| Knowledge (`knowledge/`)                                                 | Supported | Partial     | Roadmap   |
| Model selection (`models.json`)                                          | Supported | Partial     | Partial   |
| MCP servers (`mcp.json`)                                                 | Supported | Supported   | Partial   |
| Extensions (agent `extensions:` loadout)                                 | Supported | Pi only     | Pi only   |
| Plugins (agent `plugins:` loadout)                                       | Supported | Roadmap     | Roadmap   |
| Credentials and environment                                              | Supported | Supported   | Roadmap   |
| DeepWork job selection                                                   | Supported | Roadmap     | Roadmap   |
| Hooks                                                                    | Partial   | Partial     | Roadmap   |
| Tool availability (agent `tools:` loadout)                               | Supported | Supported   | Roadmap   |
| Theme / UI presentation                                                  | Roadmap   | Roadmap     | Roadmap   |
| Working directory                                                        | Roadmap   | Roadmap     | Roadmap   |
| Pass-through arguments                                                   | Supported | Supported   | Supported |
| Bootstrap hook                                                           | Supported | Roadmap     | Roadmap   |

## Codex CLI notes

- **Launch mode** — Outfitter launches `codex` directly. Pass-through arguments choose the native mode: no subcommand keeps the interactive CLI shape, while `-- exec ...` selects non-interactive `codex exec`.
- **Agent identity and appended prompts** — Codex has no native identity projection yet: launches drop the composed identity/system prompt and any `--append-prompt` documents, supplied documents produce a separate warning, and `--strict` aborts before execution.
- **Model selection (Partial)** — an agent's model maps to `-m`. Provider maps have no projection element and produce no warning. Thinking, tools, skills, subagents, plugins, and prompt templates remain unsupported and warn when selected.
- **Extensions (Pi only)** — `extensions:` names pi extension packages, so a Codex or Claude Code launch installs none of them. This is a property of the element, not a gap a user can close, so it produces no warning and does not fail under `--strict`.
- **MCP servers (Partial)** — selected stdio fields (`command`, `args`, `env`, `cwd`) and streamable HTTP fields (`url`, `headers`) become repeated TOML-valued `-c mcp_servers.<id>.<key>=...` overrides. Server ids must contain only letters, digits, `_`, or `-`; other ids cannot be expressed by Codex `-c` key paths and are skipped with a warning. Legacy SSE and other HTTP transport types are also skipped with a warning. User and project `config.toml` servers remain active because Codex has no strict MCP isolation mode, so every launch warns that projection is additive, even when no servers are selected.
- **Stdio environment safety** — `${ENV_NAME}` becomes an `env_vars` reference only when the stdio `env` key is also `ENV_NAME`; a reference that would rename the variable is dropped with a warning. Literal values pass through `env` and are visible in process arguments.
- **HTTP header safety** — `${ENV_NAME}` becomes an `env_http_headers` reference, while `Authorization: Bearer ${ENV_NAME}` becomes `bearer_token_env_var`. Other header values pass through `http_headers` and are visible in process arguments. Outfitter warns for every literal stdio environment or HTTP header entry exposed in argv, so use environment references for secrets.

## Claude Code notes

- **Config and session state** — Claude inherits its native configuration by default: Outfitter leaves `CLAUDE_CONFIG_DIR` unset, so settings, credentials, trust, permission approvals, plugins, and sessions load and persist exactly as they do in native Claude. `--isolated` restores the temporary config directory and narrow state bridges for reproducible runs.
- **MCP servers** — selected profile servers are additive through `--mcp-config` in inherited mode, alongside user and project servers. Isolated mode adds `--strict-mcp-config` and excludes every native MCP source.
- **Subagents** — selected `agents/<id>` definitions are materialized into the generated composition plugin.
- **Skills** — selected skills are materialized into the generated composition plugin passed with `--plugin-dir`. The bundled Outfitter skill uses the same plugin channel.
- **Model selection (Partial)** — model maps to `--model` and thinking level to `--effort`; provider selection is not projected for Claude and warns if requested.
- **Hooks (Partial)** — user-native hooks remain active through inherited Claude settings; there is no portable protocol hooks resource yet. See [Hooks](./hooks.md).
- **Tool availability** — `tools.allow` (after `tools.deny` removes entries) maps to both `--tools` (_availability_: an unlisted builtin is not in the session) and `--allowedTools` (_permission_: the granted tools are pre-approved, so a headless session is not stopped by a prompt); `tools.deny` always maps to `--disallowedTools`, including when both are declared, and a bare denied name removes the tool from context per Claude's docs. An allowlist that `tools.deny` empties maps to `--tools ""`, Claude's documented "disable all tools" form. Caveat: per the CLI reference, `--tools` governs the built-in set only — MCP tools (`mcp__server__*`) are unaffected and are governed by which MCP servers the loadout selects, so `--tools ""` is not exactly pi's zero-tool session when MCP servers are present. Claude's behavior here comes from `claude --help` and the CLI reference, not local measurement.
- **DeepWork jobs** — job selection is Pi-only today and warns on Claude.
- **Bundled Outfitter skill** — every launch also publishes Outfitter's own self-documentation skill as a bundled plugin, so the agent can explain Outfitter and this launch's configuration.

## Pi notes

- Pi projects the full resource set: agent identity, subagents (via the subagent extension), skills (`--skill`), commands, model configuration, MCP, extensions (`--extension`) and plugins as first-class loadout elements, environment, pass-through args, session directory, and DeepWork job selection.
- Selected skills resolve across layers following [layer precedence](./concepts.md#layer-precedence); `references`, `scripts`, and `assets` frontmatter materialize into a generated skill passed via `--skill`. `outfitter validate` checks selections and references before launch.
- **Hooks (Partial)** — bootstrap behavior uses an explicit Pi extension via `--extension`; recurring per-event hooks are extension territory. See [Hooks](./hooks.md).
- **Tool availability** — `tools.allow` (after `tools.deny` removes entries) maps to `--no-tools --tools a,b,c`, and `tools.deny` maps to `--exclude-tools a,b,c`. `--tools` is a hard allowlist across built-in, extension, and custom tools, so the session's tool set is exactly that list. An allowlist that `tools.deny` empties maps to `--no-tools` alone, a session with no tools at all. Note that `--no-builtin-tools` is deliberately not used: it keeps extension and custom tools enabled, so it does not express an empty tool set.
- Every launch also passes Outfitter's own self-documentation skill through `--skill`.

For the architecture-level definitions behind each row, see [Controllable elements](../architecture/controllable-elements.md).
