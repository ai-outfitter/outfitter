# Migration from legacy profiles

Earlier Outfitter versions used an authored profile system: `.outfitter/` directories, `profile.yml` files, profile inheritance, and `--profile` pointing at profile definitions. [RFC #165](https://github.com/ai-outfitter/outfitter/issues/165) replaces that system with the Dotagents `.agents` protocol as a hard cut: the end-state runtime has **no knowledge of the old format** — no compatibility reader, no migration command, no deprecated aliases. (These docs describe that target; the released CLI still runs the legacy profile format during the transition.) This page is the manual migration reference, and the bundled Outfitter skill can walk an agent session through it interactively.

## Mapping

| Legacy                                                  | End state                                                                                                                                                                                        |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `.outfitter/profiles/<id>/profile.yml` (or `<id>.yml`)  | Split into resources: identity → `agents/<id>/agent.md`, procedures → `skills/`; the loadout lives in that [agent](./profiles.md)'s frontmatter / `config.json` — there is no separate selection |
| `controls.system_prompt` / `append_system_prompt`       | `system-prompt.md`, `agents.md`, and the agent's `agent.md` body                                                                                                                                 |
| `controls.model`, `provider`, `thinking`                | `models.json` (and per-agent `config.json`)                                                                                                                                                      |
| `controls.skills`                                       | The agent's `skills:` loadout; skills live at `skills/<id>/`                                                                                                                                     |
| `controls.extensions`, `args`, `environment`            | Harness configuration projected by adapters; MCP servers → `mcp.json`                                                                                                                            |
| Profile inheritance (`inherits:`)                       | Layer merge-by-ID, plus shared context in `system-prompt.md` / `agents.md`                                                                                                                       |
| `template: true` base profiles                          | A base agent whose shared context lives in `system-prompt.md` / `agents.md` (or a base agent selected as a delegate)                                                                             |
| `~/.outfitter/settings.yml`                             | `~/.agents/settings.yml`                                                                                                                                                                         |
| `<project>/.outfitter/settings.yml`                     | `<project>/.agents/settings.yml`                                                                                                                                                                 |
| `<project>/.outfitter/local/settings.yml` (nested dir)  | `<project>/.agents/settings.local.yml` (flat, gitignored)                                                                                                                                        |
| `profile_sources`                                       | `sources` supplying `.agents` payloads ([catalogs](./catalogs.md))                                                                                                                               |
| `default_profile`                                       | `default_agent` naming an agent slug                                                                                                                                                             |
| `outfitter run --profile <file-based id>`               | `outfitter run <agent-id>` (choose the harness with `--harness pi\|claude`)                                                                                                                      |
| `outfitter profile list` / `create` / `lint`            | `outfitter list agents` / author files directly / `outfitter validate`                                                                                                                           |
| `profile_export` / `generated-system-prompt.md`         | `outfitter dump` ([Dump and bake](./dump-and-bake.md))                                                                                                                                           |
| Free-form CI prompt + profile in `ai-outfitter/actions` | An agent run with structured inputs ([Actions](./actions.md)); the task/bake surface is a [future RFC](./tasks.md)                                                                               |

## Procedure

1. **Inventory** your `.outfitter/profiles`. For each profile, separate what it contains: identity/policy prose, capability procedures, model/provider config, tool wiring.
2. **Create resources**: one `agents/<id>/agent.md` per durable identity; one `skills/<id>/` per capability (most `append_system_prompt` procedure text belongs in skills); shared context into `agents.md`; model config into `models.json`; MCP into `mcp.json`.
3. **Rebuild as agents**: for each profile people actually ran, create an `agents/<id>/agent.md` whose frontmatter (or `config.json`) loadout selects the new resources by slug. Set `default_agent` to the one you run most. Inheritance chains become shared context in `system-prompt.md` / `agents.md` (or a base agent selected as a delegate), not an ordered selection.
4. **Move settings**: relocate `~/.outfitter/settings.yml` content into `~/.agents/settings.yml`, project settings into `<project>/.agents/settings.yml`, and anything under `.outfitter/local/` into a flat `.agents/settings.local.yml` (gitignore it). Rename `profile_sources` to `sources`; sources must now publish `.agents` payloads.
5. **Validate**: `outfitter validate --strict`, then `outfitter dump` and review the tree.
6. **Delete** the `.outfitter/` directory once the dump matches expectations.

A remote repository _named_ `.outfitter` remains a supported convention for organization control repos — but only when it publishes the new protocol payload. The name is supported; the previous profile layout inside it is not.

## Claude Code users

If your pre-Outfitter configuration lives in `~/.claude` rather than `.outfitter/`, skip this page — use [Porting a Claude Code setup](./porting-claude.md) instead.
