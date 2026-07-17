# Migration from legacy profiles

Earlier Outfitter versions used an authored profile system: `.outfitter/` directories, `profile.yml` files, profile inheritance, and `--profile` pointing at profile definitions. [RFC #165](https://github.com/ai-outfitter/outfitter/issues/165) replaced that system with the Dotagents `.agents` protocol as a hard cut: **the current runtime has no knowledge of the old format** — no compatibility reader, no migration command, no deprecated aliases. This page is the manual migration reference, and the bundled Outfitter skill can walk an agent session through it interactively.

## Mapping

| Legacy                                                  | End state                                                                                                                                          |
| ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.outfitter/profiles/<id>/profile.yml` (or `<id>.yml`)  | Split into resources: identity → `agents/<id>/agent.md`, procedures → `skills/`, plus a named [profile selection](./profiles.md) in `settings.yml` |
| `controls.system_prompt` / `append_system_prompt`       | `system-prompt.md`, `agents.md`, and persona `agent.md` bodies                                                                                     |
| `controls.model`, `provider`, `thinking`                | `models.json` (and per-agent `config.json`)                                                                                                        |
| `controls.skills`                                       | The selection's `skills:` list; skills live at `skills/<id>/`                                                                                      |
| `controls.extensions`, `args`, `environment`            | Harness configuration projected by adapters; MCP servers → `mcp.json`                                                                              |
| Profile inheritance (`inherits:`)                       | Ordered [persona composition](./personas.md) and layer merge-by-ID                                                                                 |
| `template: true` base profiles                          | A base persona composed first in `personas: [...]`                                                                                                 |
| `~/.outfitter/settings.yml`                             | `~/.agents/settings.yml`                                                                                                                           |
| `<project>/.outfitter/settings.yml`                     | `<project>/.agents/settings.yml`                                                                                                                   |
| `<project>/.outfitter/local/settings.yml` (nested dir)  | `<project>/.agents/settings.local.yml` (flat, gitignored)                                                                                          |
| `profile_sources`                                       | `sources` supplying `.agents` payloads ([catalogs](./catalogs.md))                                                                                 |
| `default_profile`                                       | `default_profile` naming a profile selection                                                                                                       |
| `outfitter run --profile <file-based id>`               | `outfitter run --profile <selection>` or `--task <id>`                                                                                             |
| `outfitter profile list` / `create` / `lint`            | `outfitter list profiles` / author files directly / `outfitter validate`                                                                           |
| `profile_export` / `generated-system-prompt.md`         | `outfitter dump` ([Dump and bake](./dump-and-bake.md))                                                                                             |
| Free-form CI prompt + profile in `ai-outfitter/actions` | Task ID + structured inputs through the bake path ([Actions](./actions.md))                                                                        |

## Procedure

1. **Inventory** your `.outfitter/profiles`. For each profile, separate what it contains: identity/policy prose, capability procedures, model/provider config, tool wiring.
2. **Create resources**: one `agents/<id>/agent.md` per durable identity; one `skills/<id>/` per capability (most `append_system_prompt` procedure text belongs in skills); shared context into `agents.md`; model config into `models.json`; MCP into `mcp.json`.
3. **Recreate selections**: for each profile people actually ran, add a named entry under `profiles:` in `settings.yml` selecting the new resources by slug. Inheritance chains become ordered `personas:` lists.
4. **Move settings**: relocate `~/.outfitter/settings.yml` content into `~/.agents/settings.yml`, project settings into `<project>/.agents/settings.yml`, and anything under `.outfitter/local/` into a flat `.agents/settings.local.yml` (gitignore it). Rename `profile_sources` to `sources`; sources must now publish `.agents` payloads.
5. **Validate**: `outfitter validate --strict`, then `outfitter dump` and review the tree.
6. **Delete** the `.outfitter/` directory once the dump matches expectations.

A remote repository _named_ `.outfitter` remains a supported convention for organization control repos — but only when it publishes the new protocol payload. The name is supported; the previous profile layout inside it is not.

## Claude Code users

If your pre-Outfitter configuration lives in `~/.claude` rather than `.outfitter/`, skip this page — use [Porting a Claude Code setup](./porting-claude.md) instead.
