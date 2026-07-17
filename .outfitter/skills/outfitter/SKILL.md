---
name: outfitter
description: Explain Outfitter and help users compose, inspect, and maintain .agents resources, agents and their loadouts, personas, skills, and settings. Use when a user asks about Outfitter itself — the .agents protocol, agent profiles and personas, catalogs, skills, state persistence, launch configuration — or asks to set up, change, debug, or migrate an Outfitter-managed launch.

# TODO: once directory reference materialization lands, collapse the list
# below to a single `- file: docs/documentation` entry so the whole
# documentation tree ships with this skill. Kept per-file until then.
references:
  - file: docs/documentation/README.md
  - file: docs/documentation/getting-started.md
  - file: docs/documentation/concepts.md
  - file: docs/documentation/settings.md
  - file: docs/documentation/cli.md
  - file: docs/documentation/profiles.md
  - file: docs/documentation/personas.md
  - file: docs/documentation/subagents.md
  - file: docs/documentation/agents.md
  - file: docs/documentation/skills.md
  - file: docs/documentation/tasks.md
  - file: docs/documentation/dump-and-bake.md
  - file: docs/documentation/catalogs.md
  - file: docs/documentation/state.md
  - file: docs/documentation/support-matrix.md
  - file: docs/documentation/best-practices.md
  - file: docs/documentation/actions.md
  - file: docs/documentation/hooks.md
  - file: docs/documentation/switching-to-outfitter.md
  - file: docs/documentation/porting-claude.md
  - file: docs/documentation/local-development.md
  - file: docs/documentation/migration.md
  - file: docs/documentation/first-time-cli-agent-users.md
  - file: docs/documentation/iterating-on-profiles.md
---

# Outfitter

Use this skill to answer questions about Outfitter and to guide changes to
`.agents` resources, agents and their loadouts, and launches. Classify the
request, read only the relevant reference, and follow its cross-references
before answering or editing configuration.

## Routing

- New to Outfitter, installing, or first launch: read
  `references/getting-started.md`.
- How a launch works — the `.agents` protocol, layers, resolver, composition:
  read `references/concepts.md`.
- Settings scopes, schema, or `settings.local.yml`: read
  `references/settings.md`.
- Command flags and syntax for `outfitter run`, `setup`, `sync`, `list`,
  `validate`, or `dump`: read `references/cli.md`.
- Agent profiles — an agent and its loadout (skills, subagents, mcp,
  extensions, plugins, model, thinking, tools): read `references/profiles.md`.
- The `agents/<id>/agent.md` resource format and loadout fields: read
  `references/agents.md`.
- Personas — the base-agent-plus-persona-documents convention: read
  `references/personas.md`.
- Subagents and leader-agent delegation: read `references/subagents.md`.
- Authoring or selecting skills, SKILL.md layout, skill references: read
  `references/skills.md`.
- Tasks and bake (a separate upcoming RFC): read `references/tasks.md`.
- Dumping the composed tree: read `references/dump-and-bake.md`.
- Shared catalogs, standalone `.agents` repositories, remote sources,
  publishing resources: read `references/catalogs.md`.
- What persists between runs, state persistence strategies, prompt choices:
  read `references/state.md`.
- What Outfitter can project per agent CLI (pi, Claude Code): read
  `references/support-matrix.md`.
- Structuring agent identity versus skills, keeping instructions in one place:
  read `references/best-practices.md`.
- Running tasks headlessly in GitHub Actions: read `references/actions.md`.
- Getting hooks working per harness: read `references/hooks.md`.
- Migrating from another agent CLI setup: read
  `references/switching-to-outfitter.md`.
- Porting an existing `~/.claude` directory into `~/.agents`: read
  `references/porting-claude.md`.
- Developing a personal `.agents` repository and upstreaming changes: read
  `references/local-development.md`.
- **Migrating from legacy `.outfitter` profiles** (`profile.yml`,
  `.outfitter/profiles`, `--profile` file ids): read `references/migration.md`.
  The runtime has no legacy compatibility; this reference is the manual
  migration path.
- Never used a CLI coding agent before: read
  `references/first-time-cli-agent-users.md`.
- Improving the currently active agent, including this launch's own
  configuration: read `references/iterating-on-profiles.md`.

`references/README.md` is the documentation index if no entry above fits.

## Working on Outfitter configuration

1. Inspect the current configuration before editing:
   - `.agents/settings.yml` and `.agents/settings.local.yml`
   - `.agents/agents/` and `.agents/skills/`
   - `~/.agents/settings.yml` and the `~/.agents/` tree
2. Prefer Outfitter commands over manual inspection:
   - `outfitter list` to inspect resolvable resources and their sources
   - `outfitter validate` to check layout, loadouts, and references
   - `outfitter setup <source>` to import catalogs
   - `outfitter sync` to refresh remote sources
   - `outfitter run <agent-id>` to verify launch behavior
   - `outfitter dump --out <dir>` to inspect exactly what a run composes
3. Keep each instruction in one place: durable identity belongs in the agent
   definition, per-capability procedure belongs in a skill
   (`references/best-practices.md`).
4. Validate changes with `outfitter validate --strict` and, when possible, a
   smoke test such as `outfitter run <agent-id> -- --help`.

## Default behavior

If the user asks for help with Outfitter without a specific request:

1. Run `outfitter list agents` to show resolvable agents and resources.
2. Summarize the agents by name, scope or source, and default status.
3. Ask whether the user wants to compose or change an agent, and read
   `references/profiles.md` and `references/agents.md` before editing.
