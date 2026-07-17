---
name: outfitter
description: Explain Outfitter and help users compose, inspect, and maintain .agents resources, profiles, personas, tasks, skills, and settings. Use when a user asks about Outfitter itself — the .agents protocol, profiles and personas, tasks and baking, catalogs, skills, state persistence, launch configuration — or asks to set up, change, debug, or migrate an Outfitter-managed launch.

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
`.agents` resources, profile selections, and launches. Classify the request,
read only the relevant reference, and follow its cross-references before
answering or editing configuration.

## Routing

- New to Outfitter, installing, or first launch: read
  `references/getting-started.md`.
- How a launch works — the `.agents` protocol, layers, resolver, composition,
  bake: read `references/concepts.md`.
- Settings scopes, schema, or `settings.local.yml`: read
  `references/settings.md`.
- Command flags and syntax for `outfitter run`, `setup`, `sync`, `list`,
  `validate`, `task bake`, or `dump`: read `references/cli.md`.
- Composing profiles — named selections of resources by slug: read
  `references/profiles.md`.
- Personas — identity composition from protocol agents: read
  `references/personas.md`.
- Subagents — delegating to agents from a run: read `references/subagents.md`.
- The `agents/<id>/agent.md` resource format: read `references/agents.md`.
- Authoring or selecting skills, SKILL.md layout, skill references: read
  `references/skills.md`.
- Tasks, task inputs, and completion contracts: read `references/tasks.md`.
- Baking tasks or dumping the composed tree: read
  `references/dump-and-bake.md`.
- Shared catalogs, standalone `.agents` repositories, remote sources,
  publishing resources: read `references/catalogs.md`.
- What persists between runs, state persistence strategies, prompt choices:
  read `references/state.md`.
- What Outfitter can project per agent CLI (pi, Claude Code): read
  `references/support-matrix.md`.
- Structuring personas versus skills versus tasks, keeping instructions in one
  place: read `references/best-practices.md`.
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
- Improving the currently active composition, including this launch's own
  configuration: read `references/iterating-on-profiles.md`.

`references/README.md` is the documentation index if no entry above fits.

## Working on Outfitter configuration

1. Inspect the current configuration before editing:
   - `.agents/settings.yml` and `.agents/settings.local.yml`
   - `.agents/agents/`, `.agents/skills/`, and `.agents/tasks/`
   - `~/.agents/settings.yml` and the `~/.agents/` tree
2. Prefer Outfitter commands over manual inspection:
   - `outfitter list` to inspect resolvable resources and their sources
   - `outfitter validate` to check layout, selections, and references
   - `outfitter setup <source>` to import catalogs
   - `outfitter sync` to refresh remote sources
   - `outfitter run --profile <id>` or `--task <id>` to verify launch behavior
   - `outfitter dump --out <dir>` to inspect exactly what a run composes
3. Keep each instruction in one place: durable identity belongs in a persona,
   per-capability procedure belongs in a skill, per-objective contracts belong
   in a task (`references/best-practices.md`).
4. Validate changes with `outfitter validate --strict` and, when possible, a
   smoke test such as `outfitter run --profile <id> -- --help`.

## Default behavior

If the user asks for help with Outfitter without a specific request:

1. Run `outfitter list` to show resolvable profiles and resources.
2. Summarize the profiles by name, scope or source, and default status.
3. Ask whether the user wants to compose or change a profile, and read
   `references/profiles.md` before editing settings.
