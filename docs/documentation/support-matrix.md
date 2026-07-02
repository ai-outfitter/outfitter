# Adapter support matrix

What Outfitter can control per agent CLI today. Pi is the primary and most complete adapter; Claude Code is supported with gaps.

Status values:

- **Supported** — Outfitter translates this concept for the CLI through at least one native mechanism.
- **Partial** — some of the concept works today, with documented gaps.
- **Roadmap** — the CLI appears to support the concept, but Outfitter does not translate it yet.

When a profile requests a control an adapter cannot translate, Outfitter warns to stderr; `--strict` makes those warnings fatal.

| What you can control                              | Pi        | Claude Code |
| ------------------------------------------------- | --------- | ----------- |
| Agent config directory                            | Supported | Supported   |
| Session directory (`session_directory`)           | Supported | Supported   |
| Extensions / plugins (`extensions`)               | Supported | Supported   |
| Skills (`skills`)                                 | Supported | Partial     |
| Prompt templates / commands (`prompt_template`)   | Supported | Partial     |
| System prompt (`system_prompt`)                   | Supported | Supported   |
| Appended system prompt (`append_system_prompt`)   | Supported | Supported   |
| Model selection (`model`, `provider`, `thinking`) | Supported | Partial     |
| Credentials and environment (`environment`)       | Supported | Supported   |
| Tool availability                                 | Roadmap   | Roadmap     |
| Context files                                     | Roadmap   | Roadmap     |
| Theme / UI presentation                           | Roadmap   | Roadmap     |
| Project override policy                           | Roadmap   | Roadmap     |
| Working directory                                 | Roadmap   | Roadmap     |
| Pass-through arguments                            | Supported | Supported   |
| Bootstrap hook                                    | Supported | Roadmap     |

## Claude Code notes

- **Config and session state** — Outfitter points `CLAUDE_CONFIG_DIR` at the composite profile, declares Claude state paths (`settings.json`, `agents/`, `skills/`, `commands/`, `plugins/`, `projects/`) for persistence, and lets `session_directory` choose where `projects/` session state is symlinked from. There is no standalone session-dir flag.
- **Skills (Partial)** — native Claude skills work when a profile ships them as `cli_specific/claude/skills/` directories, which Outfitter places in the profiled config directory. The generic `controls.skills` selector is not translated for Claude and warns if requested.
- **Prompt templates (Partial)** — same shape: native `cli_specific/claude/commands/` directories work, but the generic `controls.prompt_template` selector is not translated and warns.
- **Model selection (Partial)** — `model` maps to `--model` and `thinking` maps to `--effort`, but `provider` is not translated for Claude and warns if requested.
- **Extensions** — `controls.extensions` entries are passed as repeated `--plugin-dir` flags.
- **DeepWork jobs** — the `controls.deepwork` selection is Pi-only today and warns on Claude.

## Pi notes

- Pi translates the full generic control set: `provider`, `model`, `thinking`, `system_prompt`, `append_system_prompt`, `extensions` (`--extension`), `skills` (`--skill`), `prompt_template` (`--prompt-template`), `environment`, `args`, `session_directory`, and DeepWork job selection.
- Bootstrap behavior (for example the onboarding flow) uses an explicit Pi bootstrap extension via `--extension`.

For the architecture-level definitions behind each row, see [Controllable elements](../architecture/controllable-elements.md).
