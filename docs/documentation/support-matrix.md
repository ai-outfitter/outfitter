# Adapter support matrix

What Outfitter can project per agent CLI. Pi is the primary and most complete adapter; Claude Code is supported with gaps.

Status values:

- **Supported** — Outfitter projects this concept for the CLI through at least one native mechanism.
- **Partial** — some of the concept works today, with documented gaps.
- **Roadmap** — the CLI appears to support the concept, but Outfitter does not project it yet.

When a composition requests something an adapter cannot project, Outfitter warns to stderr; `--strict` makes those warnings fatal.

Tasks and bake are not in this matrix — they are the subject of a [separate upcoming RFC](./tasks.md).

| What Outfitter projects                                                  | Pi        | Claude Code |
| ------------------------------------------------------------------------ | --------- | ----------- |
| Agent config directory                                                   | Supported | Supported   |
| Session directory                                                        | Supported | Supported   |
| Agent identity (`system-prompt.md`, `agents.md`, `agents/<id>/agent.md`) | Supported | Supported   |
| Subagents (`agents/<id>` as harness delegates)                           | Supported | Supported   |
| Skills (`skills/<id>`)                                                   | Supported | Partial     |
| Commands (`commands/`)                                                   | Supported | Partial     |
| Knowledge (`knowledge/`)                                                 | Supported | Partial     |
| Model selection (`models.json`)                                          | Supported | Partial     |
| MCP servers (`mcp.json`)                                                 | Supported | Supported   |
| Extensions (agent `extensions:` loadout)                                 | Supported | Roadmap     |
| Plugins (agent `plugins:` loadout)                                       | Supported | Roadmap     |
| Credentials and environment                                              | Supported | Supported   |
| DeepWork job selection                                                   | Supported | Roadmap     |
| Hooks                                                                    | Partial   | Partial     |
| Tool availability                                                        | Roadmap   | Roadmap     |
| Theme / UI presentation                                                  | Roadmap   | Roadmap     |
| Working directory                                                        | Roadmap   | Roadmap     |
| Pass-through arguments                                                   | Supported | Supported   |
| Bootstrap hook                                                           | Supported | Roadmap     |

## Claude Code notes

- **Config and session state** — Outfitter points `CLAUDE_CONFIG_DIR` at the baked composition, declares Claude state paths (`settings.json`, `agents/`, `skills/`, `commands/`, `plugins/`, `projects/`) for [state persistence](./state.md), and can [symlink a ported `~/.claude`](./porting-claude.md) so native use keeps working.
- **Subagents** — selected `agents/<id>` definitions are materialized into Claude's native agents directory.
- **Skills (Partial)** — selected skills are materialized into the config directory's skills surface; remaining gaps are tracked per release. The bundled Outfitter skill ships through the plugin channel.
- **Model selection (Partial)** — model maps to `--model` and thinking level to `--effort`; provider selection is not projected for Claude and warns if requested.
- **Hooks (Partial)** — hook configuration is projected into the generated `settings.json`; there is no portable protocol hooks resource yet. See [Hooks](./hooks.md).
- **DeepWork jobs** — job selection is Pi-only today and warns on Claude.
- **Bundled Outfitter skill** — every launch also publishes Outfitter's own self-documentation skill as a bundled plugin, so the agent can explain Outfitter and this launch's configuration.

## Pi notes

- Pi projects the full resource set: agent identity, subagents (via the subagent extension), skills (`--skill`), commands, model configuration, MCP, extensions (`--extension`) and plugins as first-class loadout elements, environment, pass-through args, session directory, and DeepWork job selection.
- Selected skills resolve across layers following [layer precedence](./concepts.md#layer-precedence); `references`, `scripts`, and `assets` frontmatter materialize into a generated skill passed via `--skill`. `outfitter validate` checks selections and references before launch.
- **Hooks (Partial)** — bootstrap behavior uses an explicit Pi extension via `--extension`; recurring per-event hooks are extension territory. See [Hooks](./hooks.md).
- Every launch also passes Outfitter's own self-documentation skill through `--skill`.

For the architecture-level definitions behind each row, see [Controllable elements](../architecture/controllable-elements.md).
