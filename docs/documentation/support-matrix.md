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
| Tool availability (agent `tools:` loadout)                               | Supported | Supported   |
| Theme / UI presentation                                                  | Roadmap   | Roadmap     |
| Working directory                                                        | Roadmap   | Roadmap     |
| Pass-through arguments                                                   | Supported | Supported   |
| Bootstrap hook                                                           | Supported | Roadmap     |

## Managed harness links

The rows above describe what `outfitter run` projects into a temporary composite directory. A
separate, opt-in command — [`outfitter link`](./linking.md) — provisions the harness's own
user-global config directory so a **directly launched** harness is set up without a wrapper.

| What `outfitter link` provisions | Pi        | Claude Code | Codex CLI   | Gemini CLI                 | Copilot CLI   |
| -------------------------------- | --------- | ----------- | ----------- | -------------------------- | ------------- |
| Skills (`skills/<id>`)           | Supported | Supported   | Supported   | Supported                  | Supported     |
| Commands                         | Roadmap   | Supported   | Supported   | Supported (generated TOML) | Not supported |
| Global instructions              | Roadmap   | Supported   | Supported   | Supported                  | Not supported |
| Hooks                            | Roadmap   | Supported   | Not written | Supported                  | Not supported |
| MCP servers                      | Roadmap   | Roadmap     | Roadmap     | Roadmap                    | Roadmap       |
| Subagents                        | Roadmap   | Roadmap     | Roadmap     | Roadmap                    | Roadmap       |

**MCP servers and subagents are the gap between a linked harness and a composed run.** `run`
projects both for Pi and Claude; `link` projects neither yet, so a composition depending on MCP or
delegation still needs `outfitter run`. Tracked in
[#187](https://github.com/ai-outfitter/outfitter/issues/187).

Notes on the gaps, which are deliberate rather than unimplemented:

- **Copilot CLI** discovers `~/.copilot/skills/<id>/SKILL.md`, but loads custom instructions from
  repository-scoped `AGENTS.md` files rather than a documented user-global path, and exposes no hook
  or custom-command surface.
- **Pi** is provisioned at `~/.pi/agent`, the durable directory an unwrapped `pi` reads — not the
  temporary composite `run` points `PI_CODING_AGENT_DIR` at. Only skills are confirmed against the
  shipped build; its `commands/` and `hooks/` directories exist but their resolution root is not
  unambiguous there.
- **Codex hooks** are configured in `config.toml` behind a separate trust prompt. Writing one on the
  user's behalf would pre-authorize code execution, so Outfitter does not.
- **Gemini commands** are TOML documents with `description` and `prompt` keys, so they are generated
  rather than symlinked; every other command surface takes a live symlink to the catalog Markdown.

## Claude Code notes

- **Config and session state** — Outfitter points `CLAUDE_CONFIG_DIR` at the baked composition, declares Claude state paths (`settings.json`, `agents/`, `skills/`, `commands/`, `plugins/`, `projects/`) for [state persistence](./state.md), and can [symlink a ported `~/.claude`](./porting-claude.md) so native use keeps working.
- **Subagents** — selected `agents/<id>` definitions are materialized into Claude's native agents directory.
- **Skills (Partial)** — selected skills are materialized into the config directory's skills surface; remaining gaps are tracked per release. The bundled Outfitter skill ships through the plugin channel.
- **Model selection (Partial)** — model maps to `--model` and thinking level to `--effort`; provider selection is not projected for Claude and warns if requested.
- **Hooks (Partial)** — hook configuration is projected into the generated `settings.json`; there is no portable protocol hooks resource yet. See [Hooks](./hooks.md).
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
