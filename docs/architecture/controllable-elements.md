# Controllable Elements

This document defines the cross-agent-CLI concepts an Outfitter composition may control — the harness-neutral vocabulary adapters project into native mechanisms. Pi is the first supported CLI, and Claude Code is supported as an additional adapter. Other CLIs may be added later while keeping the composition model generic.

Status values:

- **Supported**: Outfitter projects this element for the CLI.
- **Partial**: some of the element works today, with documented gaps.
- **Roadmap**: the CLI appears to support this concept, but Outfitter does not project it yet.
- **Future**: the concept itself is deferred to a separate upcoming RFC, not just its projection.
- **Unsupported**: the agent CLI cannot meaningfully support the concept or no known native mechanism exists.

## How to Read This Matrix

A `Supported` entry means Outfitter can project that concept for the agent CLI through at least one native mechanism: a config-directory boundary, state-path placement, generated files, environment variables, command-line flags, or pass-through arguments. It does not always mean there is a one-to-one native CLI flag.

For example, Claude Code session/project state lives under Claude's config home rather than a standalone `--session-dir` flag. Outfitter supports the session-directory concept for Claude by setting `CLAUDE_CONFIG_DIR` to the projection root and declaring Claude `projects/` state for persistence.

## Defined Terms

### Agent Config Directory

The root directory that stores agent-global configuration, credentials, installed resources, and related state.

- Pi name: `PI_CODING_AGENT_DIR` / agent dir
- Claude name: `CLAUDE_CONFIG_DIR` / Claude config home

### Session Directory

The directory where conversation sessions, transcripts, or run state are stored.

- Pi name: `PI_CODING_AGENT_SESSION_DIR` / `--session-dir`
- Claude name: session/project state under `CLAUDE_CONFIG_DIR`, including `projects/` state managed by Outfitter state persistence

### Personas

Not a composed key. A persona is a convention: a base review [agent](../documentation/agents.md) plus an interchangeable persona description document fed as input (see [Personas](../documentation/personas.md)). The controllable element underneath it is the agent's composed identity — `system-prompt.md`, `agents.md`, and the selected `agents/<id>/agent.md` — not a `personas` list.

- Pi name: `--system-prompt` / `--append-system-prompt` composition
- Claude name: `--system-prompt` / `--append-system-prompt` composition

### Subagents

Selected `agents/<id>` definitions projected as harness delegates.

- Pi name: subagent extension registration
- Claude name: native agent definitions under the config directory's `agents/`

### Skills

Protocol `skills/<id>/` packages exposed to the agent.

- Pi name: skills, `--skill`
- Claude name: skills under the Claude config directory

### Commands / Prompt Templates

Named reusable prompts or slash commands available to the agent runtime, from the tree's `commands/`.

- Pi name: prompt templates, `--prompt-template`
- Claude name: commands under the Claude config directory

### Knowledge

Reference documents from the tree's `knowledge/` made available to a run without loading them into context up front.

- Pi/Claude: materialized files in the projection; loading is progressive.

### Model Selection

The selected provider/model and related inference options, from `models.json` and per-agent `config.json`.

- Pi name: `--provider`, `--model`, `--models`, `--thinking`
- Claude name: `--model`, `--effort`

### MCP Servers

Model Context Protocol server configuration from the tree's `mcp.json`.

- Pi name: `mcp.json` in the agent dir
- Claude name: MCP configuration under the config directory

### Extensions

Pi extensions selected by an agent's loadout (`extensions:`) and loaded into the run. A first-class, pi-native configuration element in its own right — distinct from the single bootstrap extension Outfitter injects for mode switching. An agent can select any number of extensions; the adapter registers them alongside the bootstrap extension.

- Pi name: extensions loaded via `--extension` / `-e`
- Claude name: no direct equivalent; roadmap adapter mapping

### Plugins

Pi plugins selected by an agent's loadout (`plugins:`). Also first-class and pi-native, tracked separately from extensions because Pi treats them as a distinct mechanism.

- Pi name: plugin loading
- Claude name: plugin/marketplace mechanism, not mapped by Outfitter yet

### Credentials and Environment

Environment variables, API keys, auth files, and related secret material needed by providers or tools. Never stored in the tree; supplied at runtime.

- Pi name: provider env vars, `auth.json`, `--api-key`
- Claude name: environment variables and config files under `CLAUDE_CONFIG_DIR`

### Tasks

Named work contracts baked into immutable artifacts for headless execution. The task/bake surface is deferred to a [separate upcoming RFC](../documentation/tasks.md); today headless runs launch an agent in print mode with structured inputs.

- Pi name: headless print mode (`-p`) with the composed projection
- Claude name: print mode with the composed projection

### DeepWork Jobs

Reusable multi-step procedures selected by tasks or profiles.

- Pi name: `DEEPWORK_ADDITIONAL_JOBS_FOLDERS`
- Claude name: not mapped yet

### Hooks

Deterministic code at fixed session points. No protocol resource exists yet; see [Hooks](../documentation/hooks.md) for the roadmap TODO on an Outfitter hooks extension.

- Pi name: bootstrap extension via `--extension` / `-e`; per-event hooks are extension territory
- Claude name: `hooks` in the generated `settings.json`

### Tool Availability

Configuration that enables, disables, or filters tools exposed to the agent.

- Pi name: tool settings and extension-provided tools
- Claude name: allowed/disallowed tools, roadmap adapter mapping

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

### Bootstrap Hook

An early-startup customization used to register providers, tools, hooks, or additional runtime behavior.

- Pi name: explicit bootstrap extension via `--extension` / `-e`
- Claude name: startup hook/plugin mechanism, not mapped by Outfitter yet

## Support Matrix

| Controllable Element        | Pi        | Claude    |
| --------------------------- | --------- | --------- |
| Agent Config Directory      | Supported | Supported |
| Session Directory           | Supported | Supported |
| Personas                    | Supported | Supported |
| Subagents                   | Supported | Supported |
| Skills                      | Supported | Partial   |
| Commands / Prompt Templates | Supported | Partial   |
| Knowledge                   | Supported | Partial   |
| Model Selection             | Supported | Partial   |
| MCP Servers                 | Supported | Supported |
| Extensions                  | Supported | Roadmap   |
| Plugins                     | Supported | Roadmap   |
| Credentials and Environment | Supported | Supported |
| Tasks                       | Future    | Future    |
| DeepWork Jobs               | Supported | Roadmap   |
| Hooks                       | Partial   | Partial   |
| Tool Availability           | Roadmap   | Roadmap   |
| Theme / UI Presentation     | Roadmap   | Roadmap   |
| Working Directory           | Roadmap   | Roadmap   |
| Pass-through Arguments      | Supported | Supported |
| Bootstrap Hook              | Supported | Roadmap   |

The user-facing view of this matrix, with per-gap notes, lives in the [adapter support matrix](../documentation/support-matrix.md). Unsupported elements warn at runtime; `--strict` makes those warnings fatal.
