# Controllable Elements

This document defines cross-agent-CLI concepts that Outfitter profiles may control.
Pi is the first supported CLI, and Claude Code is supported as an additional adapter.
Other CLIs may be added later while keeping the profile model generic.

Status values:

- **Supported**: Outfitter supports this control for the CLI.
- **Roadmap**: the CLI appears to support this concept, but Outfitter does not support it yet.
- **Unsupported**: the agent CLI cannot meaningfully support the concept or no known native mechanism exists.

## How to Read This Matrix

A `Supported` entry means Outfitter can control that concept for the agent CLI through at least one native mechanism: a config-directory boundary, state-path placement, generated files, environment variables, command-line flags, or pass-through arguments.
It does not always mean there is a one-to-one native CLI flag or that every generic profile selector has been mapped.

For example, Claude Code session/project state lives under Claude's config home rather than a standalone `--session-dir` flag.
Outfitter supports that session-directory concept for Claude by setting `CLAUDE_CONFIG_DIR` to the composite profile root, declaring Claude `projects/` state for persistence, and allowing `controls.session_directory` or `controls.claude.session_directory` to choose where that state is symlinked from.
Likewise, Claude skills are supported by materializing generic `controls.skills` selections and profile `skills/` folders into the profiled `CLAUDE_CONFIG_DIR/skills` directory, and commands remain supported as native directories under the profiled `CLAUDE_CONFIG_DIR` even though the generic `controls.prompt_template` selector is not yet translated into a Claude-specific selection flag.

## Defined Terms

### Agent Config Directory

The root directory that stores agent-global configuration, credentials, installed resources, and related state.

- Pi name: `PI_CODING_AGENT_DIR` / agent dir
- Claude name: `CLAUDE_CONFIG_DIR` / Claude config home

### Session Directory

The directory where conversation sessions, transcripts, or run state are stored.

- Pi name: `PI_CODING_AGENT_SESSION_DIR` / `--session-dir`
- Claude name: session/project state under `CLAUDE_CONFIG_DIR`, including `projects/` state managed by Outfitter state persistence

### Extensions

Executable/plugin modules that add tools, providers, hooks, or runtime behavior.

- Pi name: extensions, `--extension` / `-e`
- Claude name: plugins via `--plugin-dir`

### Skills

Reusable task instructions, workflows, or resource bundles exposed to the agent.

- Pi name: skills, `--skill`
- Claude name: skills under the Claude config directory; Outfitter materializes generic `controls.skills` selections, profile `skills/` folders, and `cli_specific/claude/skills` into per-skill entries inside the profiled `CLAUDE_CONFIG_DIR/skills`, deduplicated by normalized identity

### Prompt Templates

Named reusable prompts/templates available to the agent runtime.

- Pi name: prompt templates, `--prompt-template`
- Claude name: commands/prompts under the Claude config directory; Outfitter can profile native Claude commands through `cli_specific/claude/commands`, but generic `prompt_template` selection is not mapped yet

### System Prompt

The primary instruction text supplied to the agent.

- Pi name: `--system-prompt`, `SYSTEM.md`
- Claude name: `--system-prompt`

### Appended System Prompt

Additional instruction text layered onto the primary system prompt.

- Pi name: `--append-system-prompt`, `APPEND_SYSTEM.md`
- Claude name: `--append-system-prompt`

### Model Selection

The selected provider/model and related inference options.

- Pi name: `--provider`, `--model`, `--models`, `--thinking`
- Claude name: `--model`, `--effort`; generic `thinking` levels map onto `--effort` as `off`/`minimal`/`low` → `low`, `medium` → `medium`, `high` → `high`, `xhigh` → `xhigh`, `max` → `max`, with unknown values passed through unchanged; generic `provider` is not translated and warns

### Credentials and Environment

Environment variables, API keys, auth files, and related secret material needed by providers or tools.

- Pi name: provider env vars, `auth.json`, `--api-key`
- Claude name: environment variables and config files under `CLAUDE_CONFIG_DIR`

### Tool Availability

Configuration that enables, disables, or filters tools exposed to the agent.

- Pi name: tool settings and extension-provided tools
- Claude name: allowed/disallowed tools, roadmap adapter mapping

### Context Files

Project or profile files automatically loaded into context.

- Pi name: context files, `--no-context-files`
- Claude name: project memory/context files, roadmap adapter mapping

### Theme / UI Presentation

Terminal UI theme, keybindings, and presentation settings.

- Pi name: themes, `--theme`, `--no-themes`, `keybindings.json`; Outfitter reserves `Shift+Tab` for mode switching and maps thinking-level cycling to `Ctrl+Shift+T`
- Claude name: UI/theme controls, roadmap adapter mapping

### Project Override Policy

Whether project-local agent configuration is allowed, ignored, or constrained.

- Pi name: project `.pi/` resources and settings
- Claude name: project-local config, roadmap adapter mapping

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
| Extensions                  | Supported | Supported |
| Skills                      | Supported | Supported |
| Prompt Templates            | Supported | Supported |
| System Prompt               | Supported | Supported |
| Appended System Prompt      | Supported | Supported |
| Model Selection             | Supported | Supported |
| Credentials and Environment | Supported | Supported |
| Tool Availability           | Roadmap   | Roadmap   |
| Context Files               | Roadmap   | Roadmap   |
| Theme / UI Presentation     | Roadmap   | Roadmap   |
| Project Override Policy     | Roadmap   | Roadmap   |
| Working Directory           | Roadmap   | Roadmap   |
| Pass-through Arguments      | Supported | Supported |
| Bootstrap Hook              | Supported | Roadmap   |

## Day-One Interpretation

For v1, a Outfitter profile may describe all defined terms generically.
The Pi adapter is the first implementation, and pi remains the default adapter.
Adapter-specific overrides live under `controls.pi` and `controls.claude`; unsupported controls warn at runtime, and `--strict` makes those warnings fatal.
For Claude Code, generic `controls.skills` selections and profile `skills/` folders are materialized into the profiled `CLAUDE_CONFIG_DIR/skills`, `cli_specific/claude/.mcp.json` fragments are merged and loaded through `--mcp-config`, and `commands/` remains supported as a native configuration directory inside the profiled `CLAUDE_CONFIG_DIR`; the generic `controls.provider`, `controls.prompt_template`, and `controls.deepwork` selectors remain unmapped for Claude and warn if requested.
