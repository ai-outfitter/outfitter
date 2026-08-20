# Controllable Elements

This document defines the cross-agent-CLI concepts an Outfitter composition may control — the harness-neutral vocabulary adapters project into native mechanisms.
Pi is the first supported CLI, and Claude Code and Codex CLI are supported as additional adapters.
Other CLIs may be added later while keeping the composition model generic.

Status values:

- **Supported**: Outfitter projects this element for the CLI.
- **Partial**: some of the element works today, with documented gaps.
- **Roadmap**: the CLI appears to support this concept, but Outfitter does not project it yet.
- **Future**: the concept itself is deferred to a separate upcoming RFC, not just its projection.
- **Unsupported**: the agent CLI cannot meaningfully support the concept or no known native mechanism exists.

## How to Read This Matrix

A `Supported` entry means Outfitter can project that concept for the agent CLI through at least one native mechanism: a config-directory boundary, state-path placement, generated files, environment variables, command-line flags, or pass-through arguments.
It does not always mean there is a one-to-one native CLI flag.

For example, Claude Code session/project state lives under Claude's config home rather than a standalone `--session-dir` flag.
Outfitter supports the session-directory concept for Claude under isolation, by setting `CLAUDE_CONFIG_DIR` to the projection root and declaring Claude `projects/` state for persistence. An inherited run leaves Claude's own session store in place, so `--continue` and `--resume` work without a bridge.

## Defined Terms

### Agent Config Directory

The root directory that stores agent-global configuration, credentials, installed resources, and related state.

- Pi name: `PI_CODING_AGENT_DIR` / agent dir
- Claude name: `--plugin-dir` over the native config home when inheriting; `CLAUDE_CONFIG_DIR` when isolated
- Codex name: `CODEX_HOME`; Outfitter does not redirect it in the current adapter

### Session Directory

The directory where conversation sessions, transcripts, or run state are stored.

- Pi name: `PI_CODING_AGENT_SESSION_DIR` / `--session-dir`
- Claude name: session/project state under `CLAUDE_CONFIG_DIR`, including `projects/` state managed by Outfitter state persistence

### Personas

Not a composed key.
A persona is a convention: a shared review [agent](../documentation/agents.md) plus one or more portable persona documents appended at launch in caller-chosen order (see [Personas](../documentation/personas.md)).
The controllable element underneath it is prompt append — `--append-prompt <file>` on the launch command, repeatable — not a `personas` list. The flag exists because the harnesses diverge here and passthrough cannot: pi reads a path from `--append-system-prompt` and accumulates repeats, while Claude Code needs `--append-system-prompt-file` and keeps only the last occurrence.

- Pi name: `--system-prompt` / repeated `--append-system-prompt` composition
- Claude name: `--system-prompt` / one `--append-system-prompt-file` over a concatenation

### Subagents

Selected `agents/<id>` definitions projected as harness delegates.

- Pi name: subagent extension registration
- Claude name: native agent definitions under the config directory's `agents/`

### Skills

Protocol `skills/<id>/` packages exposed to the agent.

- Pi name: skills, `--skill`
- Claude name: skills under the Claude config directory

### Commands / Prompt Templates

Named reusable prompts or slash commands may live in the tree's `commands/`.
Separately, an agent may select one eager `prompt_template` source with an explicit `{ file }` or `{ repo_file }` reference; Outfitter does not treat command slugs as prompt-source shorthand.

- Pi name: prompt templates, agent `prompt_template`, `--prompt-template`
- Claude name: commands under the Claude config directory; agent `prompt_template` projection is currently unsupported and follows warning/`--strict` policy

### Knowledge

Reference documents from the tree's `knowledge/` made available to a run without loading them into context up front.

- Pi/Claude: materialized files in the projection; loading is progressive.

### Model Selection

The selected provider/model and related inference options, from `models.json` and per-agent `config.json`.

- Pi name: `--provider`, `--model`, `--models`, `--thinking`
- Claude name: `--model`, `--effort`
- Codex name: `-m`; other inference controls are not projected yet

### MCP Servers

Model Context Protocol server configuration from the tree's `mcp.json`.

- Pi name: `mcp.json` in the agent dir
- Claude name: generated `mcp.json` passed through `--mcp-config`, with `--strict-mcp-config` added only for an isolated run
- Codex name: repeated TOML-valued `-c mcp_servers.<id>.<key>=...` overrides; additive with user/project configuration because Codex has no way to run with only the projected MCP servers

### Extensions

Pi extensions selected by an agent's loadout (`extensions:`) and loaded into the run.
A first-class, pi-native configuration element in its own right — distinct from the single bootstrap extension Outfitter injects for mode switching.
An agent can select any number of extensions; the adapter registers them alongside the bootstrap extension.

- Pi name: extensions loaded via `--extension` / `-e`
- Claude name: no direct equivalent; roadmap adapter mapping
- Exempt from the unsupported-element warning. The element names pi extension packages, so a claude
  or codex launch could never load them and the user has no setting that would change that. A non-pi
  launch installs none of them, says nothing about them, and does not fail under `--strict`.

### Plugins

Pi plugins selected by an agent's loadout (`plugins:`).
Also first-class and pi-native, tracked separately from extensions because Pi treats them as a distinct mechanism.

- Pi name: plugin loading
- Claude name: plugin/marketplace mechanism, not mapped by Outfitter yet

### Credentials and Environment

Environment variables, API keys, auth files, and related secret material needed by providers or tools.
Never stored in the tree; supplied at runtime.

- Pi name: provider env vars, `auth.json`, `--api-key`
- Claude name: environment variables and config files under `CLAUDE_CONFIG_DIR`

### Tasks

Named work contracts baked into immutable artifacts for headless execution.
The task/bake surface is deferred to a [separate upcoming RFC](../documentation/tasks.md); today headless runs launch an agent in print mode with structured inputs.

- Pi name: headless print mode (`-p`) with the composed projection
- Claude name: print mode with the composed projection

### DeepWork Jobs

Reusable multi-step procedures selected by an agent's loadout.

- Pi name: `DEEPWORK_ADDITIONAL_JOBS_FOLDERS`
- Claude name: not mapped yet

### Hooks

Deterministic code at fixed session points.
No protocol resource exists yet; see [Hooks](../documentation/hooks.md) for the roadmap TODO on an Outfitter hooks extension.

- Pi name: bootstrap extension via `--extension` / `-e`; per-event hooks are extension territory
- Claude name: `hooks` in the generated `settings.json`

### Tool Availability

The `tools: {allow?, deny?}` loadout element, which filters the tools exposed to the agent.
Projection removes every `deny` entry from `allow` first, then maps the result to native flags.

- Pi name: `--no-tools --tools a,b,c` for the filtered allowlist, plus `--exclude-tools a,b,c` whenever `deny` is declared. `--tools` is a hard allowlist across built-in, extension, and custom tools (measured against pi 0.83.0). `--no-builtin-tools` is deliberately not used, because it keeps extension and custom tools enabled.
- Claude name: `--tools a b c` (availability) **and** `--allowedTools a b c` (pre-approval) for the filtered allowlist, plus `--disallowedTools a b c` whenever `deny` is declared. Claude always receives the deny list, including when `allow` is declared too. The Claude behavior comes from `claude --help` and the CLI reference, not local measurement.

Both harnesses have an availability control; Claude layers a permission control on top of its own.
Claude's `--tools` governs **availability** of the built-in set: an unlisted builtin is not in the session, and `--tools ""` empties the set.
Claude's `--allowedTools` governs **permission**: it pre-approves the granted tools so a headless session is not stopped by an approval prompt.
An allowlist therefore projects to both flags on Claude, because either alone would be wrong: `--allowedTools` alone leaves every unlisted builtin available (merely unapproved), and `--tools` alone leaves the granted tools prompting.

The scope of Claude's `--tools` is the residual caveat: per the CLI reference it governs the **built-in set only**.
MCP tools (`mcp__server__*`) are unaffected by it; they are governed by which MCP servers the loadout selects, and by `--disallowedTools` patterns such as `mcp__*` — a Claude-only pattern syntax a harness-neutral profile cannot lean on.

The `deny` projection is still stated outright on both harnesses.
On pi, filtering a tool out of `allow` is already sufficient, because the tool then does not exist.
On Claude, a bare name in `--disallowedTools` removes the tool from context per the docs, so the explicit denial is an availability statement in its own right rather than a bet on the approval path.
Both harnesses therefore always receive the deny list when `deny` is declared, which satisfies OFTR-003.10.4 without depending on the filter alone.

Projection puts these names directly into harness argv, so a tool name must not start with `-` or contain a comma or whitespace.
A leading `-` would become an independent harness flag on Claude, where each name is its own argv element, and a comma would split one name into several inside pi's `--tools` value.
`agent.schema.json` rejects such names in `agent.md` frontmatter, the agent reader re-checks the loadout after `config.json` overlays merge (the schema does not see those), and projection throws rather than dropping them, because a silently discarded entry in a restriction is worse than a refused launch.
The reader also validates the raw shape of a `config.json` `tools` value — only `allow` and `deny` keys, each an array of non-empty strings — as a hard error per layer, because silently normalizing a malformed selection would launch the agent without the restriction its author wrote.
This also excludes Claude's scoped permission rules such as `Bash(npm run test:*)`, which is deliberate for a harness-neutral field: the same string means nothing to pi.

Both harnesses express every combination, so `tools` is never reported unsupported.
A deny-only selection projects to `--exclude-tools` on pi and `--disallowedTools` on Claude, and imposes no ceiling on the tools it does not name.

An allowlist that `deny` empties is a request for a session with no tools.
Pi expresses it as `--no-tools`, which removes built-in, extension, and custom tools alike.
Claude expresses it as `--tools ""`, the documented "disable all tools" form, passed as one empty-string argv element.
The two are close but not identical: `--tools ""` empties only the built-in set, so MCP tools from selected servers survive it on Claude.

### Theme / UI Presentation

Terminal UI theme, keybindings, and presentation settings.

- Pi name: themes, `--theme`, `--no-themes`, `keybindings.json`; Outfitter reserves `Shift+Tab` for mode switching and maps thinking-level cycling to `Ctrl+Shift+T`
- Claude name: UI/theme controls, roadmap adapter mapping

### Working Directory

The directory from which the inner agent CLI is launched.

- Pi name: cwd/session cwd
- Claude name: cwd/project directory

### Pass-through Arguments

Arguments not recognized by Outfitter that are forwarded unmodified to the inner agent CLI.

- Pi name: native pi CLI args
- Claude name: native Claude CLI args
- Codex name: pass-through `exec` selects the non-interactive subcommand; omitting it retains the interactive launch shape

### Bootstrap Hook

An early-startup customization used to register providers, tools, hooks, or additional runtime behavior.

- Pi name: explicit bootstrap extension via `--extension` / `-e`
- Claude name: startup hook/plugin mechanism, not mapped by Outfitter yet

## Support Matrix

| Controllable Element        | Pi        | Claude    | Codex     |
| --------------------------- | --------- | --------- | --------- |
| Agent Config Directory      | Supported | Supported | Roadmap   |
| Session Directory           | Supported | Supported | Roadmap   |
| Personas                    | Supported | Supported | Roadmap   |
| Subagents                   | Supported | Supported | Roadmap   |
| Skills                      | Supported | Partial   | Roadmap   |
| Commands / Prompt Templates | Supported | Partial   | Roadmap   |
| Knowledge                   | Supported | Partial   | Roadmap   |
| Model Selection             | Supported | Partial   | Partial   |
| MCP Servers                 | Supported | Supported | Partial   |
| Extensions                  | Supported | Pi only   | Pi only   |
| Plugins                     | Supported | Roadmap   | Roadmap   |
| Credentials and Environment | Supported | Supported | Roadmap   |
| Tasks                       | Future    | Future    | Future    |
| DeepWork Jobs               | Supported | Roadmap   | Roadmap   |
| Hooks                       | Partial   | Partial   | Roadmap   |
| Tool Availability           | Supported | Supported | Roadmap   |
| Theme / UI Presentation     | Roadmap   | Roadmap   | Roadmap   |
| Working Directory           | Roadmap   | Roadmap   | Roadmap   |
| Pass-through Arguments      | Supported | Supported | Supported |
| Bootstrap Hook              | Supported | Roadmap   | Roadmap   |

The user-facing view of this matrix, with per-gap notes, lives in the [adapter support matrix](../documentation/support-matrix.md).
Unsupported elements warn at runtime; `--strict` makes those warnings fatal.
