# Adapter support matrix

What Outfitter can control per agent CLI today. Pi is the primary and most complete adapter; Claude Code is supported with gaps.

Status values:

- **Supported** — Outfitter translates this concept for the CLI through at least one native mechanism.
- **Partial** — some of the concept works today, with documented gaps.
- **Roadmap** — the CLI appears to support the concept, but Outfitter does not translate it yet.

When a profile requests a control an adapter cannot translate, Outfitter warns to stderr; `--strict` makes those warnings fatal.

This matrix is checked against the cross-adapter conformance suite (`code/cli/tests/conformance/`): `npm run conformance` verifies every row below against real adapter behavior and fails when the table disagrees with the code.

| What you can control                              | Pi        | Claude Code |
| ------------------------------------------------- | --------- | ----------- |
| Agent config directory                            | Supported | Supported   |
| Session directory (`session_directory`)           | Supported | Supported   |
| Extensions / plugins (`extensions`)               | Supported | Supported   |
| Skills (`skills`)                                 | Supported | Supported   |
| Prompt templates / commands (`prompt_template`)   | Supported | Partial     |
| System prompt (`system_prompt`)                   | Supported | Supported   |
| Appended system prompt (`append_system_prompt`)   | Supported | Supported   |
| Model selection (`model`, `provider`, `thinking`) | Supported | Partial     |
| Credentials and environment (`environment`)       | Supported | Supported   |
| MCP servers (`cli_specific/<agent>/.mcp.json`)    | Supported | Supported   |
| DeepWork job selection (`deepwork`)               | Supported | Roadmap     |
| Tool availability                                 | Roadmap   | Roadmap     |
| Context files                                     | Roadmap   | Roadmap     |
| Theme / UI presentation                           | Roadmap   | Roadmap     |
| Project override policy                           | Roadmap   | Roadmap     |
| Working directory                                 | Roadmap   | Roadmap     |
| Pass-through arguments                            | Supported | Supported   |
| Bootstrap hook                                    | Supported | Roadmap     |

## Claude Code notes

- **Config and session state** — Outfitter points `CLAUDE_CONFIG_DIR` at the composite profile, declares Claude state paths (`settings.json`, `agents/`, `skills/`, `commands/`, `plugins/`, `projects/`) for persistence, and lets `session_directory` choose where `projects/` session state is symlinked from. There is no standalone session-dir flag.
- **Skills** — generic `controls.skills` selections (paths or bundled skill names), profile `skills/` folders, and `cli_specific/claude/skills/` directories are materialized as per-skill symlinks inside the profiled config directory's `skills/`, deduplicated by normalized identity with higher-precedence layers winning name conflicts. Entries of the native skills source stay reachable through mirrored symlinks. A requested skill that does not resolve to a `SKILL.md` directory warns (fatal under `--strict`).
- **MCP servers** — `cli_specific/claude/.mcp.json` fragments are merged across contributing profile layers (same precedence and identity rules as Pi) into a composite `.mcp.json` that is loaded through Claude Code's `--mcp-config` flag.
- **Prompt templates (Partial)** — native `cli_specific/claude/commands/` directories work, but the generic `controls.prompt_template` selector is not translated and warns.
- **Model selection (Partial)** — `model` maps to `--model`; `thinking` maps to `--effort` with the precise table `off`/`minimal`/`low` → `low`, `medium` → `medium`, `high` → `high`, `xhigh` → `xhigh`, `max` → `max`, and unknown values passed through unchanged. `provider` is not translated for Claude and warns if requested.
- **Extensions** — `controls.extensions` entries are passed as repeated `--plugin-dir` flags.
- **DeepWork jobs** — the `controls.deepwork` selection is Pi-only today and warns on Claude.

## Pi notes

- Pi translates the full generic control set: `provider`, `model`, `thinking`, `system_prompt`, `append_system_prompt`, `extensions` (`--extension`), `skills` (`--skill`), `prompt_template` (`--prompt-template`), `environment`, `args`, `session_directory`, and DeepWork job selection.
- **MCP servers** — `cli_specific/pi/.mcp.json` fragments are merged across contributing profile layers into a composite `.mcp.json` inside the profiled agent directory.
- Bootstrap behavior (for example the onboarding flow) uses an explicit Pi bootstrap extension via `--extension`.

For the architecture-level definitions behind each row, see [Controllable elements](../architecture/controllable-elements.md).
