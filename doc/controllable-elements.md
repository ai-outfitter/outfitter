# Controllable Elements

This document defines cross-agent-CLI concepts that Bridl profiles may control.
Pi is the first supported CLI.
Other CLIs are listed to keep the model generic and to clarify future adapter work.

Status values:

- **Supported**: Bridl supports this control for the CLI.
- **Roadmap**: the CLI appears to support this concept, but Bridl does not support it yet.
- **Unsupported**: the agent CLI cannot meaningfully support the concept or no known native mechanism exists.

## Defined Terms

### Agent Config Directory

The root directory that stores agent-global configuration, credentials, installed resources, and related state.

- Pi name: `PI_CODING_AGENT_DIR` / agent dir
- Claude name: configuration directory / Claude config home, roadmap adapter mapping

### Session Directory

The directory where conversation sessions, transcripts, or run state are stored.

- Pi name: `PI_CODING_AGENT_SESSION_DIR` / `--session-dir`
- Claude name: session storage, roadmap adapter mapping

### Extensions

Executable/plugin modules that add tools, providers, hooks, or runtime behavior.

- Pi name: extensions, `--extension` / `-e`
- Claude name: extensions/plugins/MCP-related customization, roadmap adapter mapping

### Skills

Reusable task instructions, workflows, or resource bundles exposed to the agent.

- Pi name: skills, `--skill`
- Claude name: skills, roadmap adapter mapping

### Prompt Templates

Named reusable prompts/templates available to the agent runtime.

- Pi name: prompt templates, `--prompt-template`
- Claude name: commands/prompts, roadmap adapter mapping

### System Prompt

The primary instruction text supplied to the agent.

- Pi name: `--system-prompt`, `SYSTEM.md`
- Claude name: system prompt/instructions, roadmap adapter mapping

### Appended System Prompt

Additional instruction text layered onto the primary system prompt.

- Pi name: `--append-system-prompt`, `APPEND_SYSTEM.md`
- Claude name: appended instructions, roadmap adapter mapping

### Model Selection

The selected provider/model and related inference options.

- Pi name: `--provider`, `--model`, `--models`, `--thinking`
- Claude name: model flags/settings, roadmap adapter mapping

### Credentials and Environment

Environment variables, API keys, auth files, and related secret material needed by providers or tools.

- Pi name: provider env vars, `auth.json`, `--api-key`
- Claude name: environment variables/auth config, roadmap adapter mapping

### Tool Availability

Configuration that enables, disables, or filters tools exposed to the agent.

- Pi name: tool settings and extension-provided tools
- Claude name: allowed/disallowed tools, roadmap adapter mapping

### Context Files

Project or profile files automatically loaded into context.

- Pi name: context files, `--no-context-files`
- Claude name: project memory/context files, roadmap adapter mapping

### Theme / UI Presentation

Terminal UI theme and presentation settings.

- Pi name: themes, `--theme`, `--no-themes`
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

Arguments not recognized by Bridl that are forwarded unmodified to the inner agent CLI.

- Pi name: native pi CLI args
- Claude name: native Claude CLI args

### Bootstrap Hook

An early-startup customization used to register providers, tools, hooks, or additional runtime behavior.

- Pi name: explicit bootstrap extension via `--extension` / `-e`
- Claude name: startup hook/plugin mechanism, roadmap adapter mapping

## Support Matrix

| Controllable Element        | Pi        | Claude  |
| --------------------------- | --------- | ------- |
| Agent Config Directory      | Supported | Roadmap |
| Session Directory           | Supported | Roadmap |
| Extensions                  | Supported | Roadmap |
| Skills                      | Supported | Roadmap |
| Prompt Templates            | Supported | Roadmap |
| System Prompt               | Supported | Roadmap |
| Appended System Prompt      | Supported | Roadmap |
| Model Selection             | Supported | Roadmap |
| Credentials and Environment | Supported | Roadmap |
| Tool Availability           | Roadmap   | Roadmap |
| Context Files               | Roadmap   | Roadmap |
| Theme / UI Presentation     | Roadmap   | Roadmap |
| Project Override Policy     | Roadmap   | Roadmap |
| Working Directory           | Roadmap   | Roadmap |
| Pass-through Arguments      | Supported | Roadmap |
| Bootstrap Hook              | Supported | Roadmap |

## Day-One Interpretation

For v1, a Bridl profile may describe all defined terms generically.
The Pi adapter is the first implementation, and its Supported matrix entries identify tested adapter behavior.
Any non-Pi adapter should be considered experimental until its matrix entries are upgraded from Roadmap to Supported.
