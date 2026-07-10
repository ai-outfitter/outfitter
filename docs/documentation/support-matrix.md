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
- **Skills (Partial)** — native Claude skills work when a profile ships them as `cli_specific/claude/skills/` directories, which Outfitter places in the profiled config directory. The generic `controls.skills` selector (including catalog skill IDs) is not translated for Claude yet and warns if requested; the bundled Outfitter skill ships through the plugin channel instead.
- **Prompt templates (Partial)** — same shape: native `cli_specific/claude/commands/` directories work, but the generic `controls.prompt_template` selector is not translated and warns.
- **Model selection (Partial)** — `model` maps to `--model` and `thinking` maps to `--effort`, but `provider` is not translated for Claude and warns if requested.
- **Extensions** — `controls.extensions` entries are passed as repeated `--plugin-dir` flags.
- **Bundled Outfitter skill** — every launch also publishes Outfitter's own self-documentation skill (authored at `.outfitter/skills/outfitter` in the Outfitter repository) as a bundled plugin through `--plugin-dir`, so the agent can explain Outfitter and this launch's configuration.
- **DeepWork jobs** — the `controls.deepwork` selection is Pi-only today and warns on Claude.

## Pi notes

- Pi translates the full generic control set: `provider`, `model`, `thinking`, `system_prompt`, `append_system_prompt`, `extensions` (`--extension`), `skills` (`--skill`), `prompt_template` (`--prompt-template`), `environment`, `args`, `session_directory`, and DeepWork job selection.
- **Catalog skills** — `controls.skills` entries may be catalog skill IDs (bare strings or `{ id, references }` objects). Outfitter resolves IDs across project, directory-profile, and configured-source `skills/` directories following layer precedence, materializes `references`, `scripts`, and `assets` frontmatter into a generated skill beneath the composite profile, and passes the generated directory via `--skill`. `outfitter profile lint` validates selections and references before launch.
- Bootstrap behavior (for example the onboarding flow) uses an explicit Pi bootstrap extension via `--extension`.
- Every launch also passes Outfitter's own self-documentation skill — materialized with its documentation references into the composite profile — through `--skill`.

For the architecture-level definitions behind each row, see [Controllable elements](../architecture/controllable-elements.md).
