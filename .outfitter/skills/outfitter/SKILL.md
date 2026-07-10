---
name: outfitter
description: Explain Outfitter and help users create, inspect, and maintain Outfitter profiles, settings, skills, and setup sources. Use when a user asks about Outfitter itself — profiles, profile.yml files, profile sources and catalogs, skills, state persistence, launch configuration — or asks to set up, change, or debug an Outfitter-managed launch.

references:
  - file: docs/documentation/README.md
  - file: docs/documentation/getting-started.md
  - file: docs/documentation/concepts.md
  - file: docs/documentation/cli.md
  - file: docs/documentation/profiles.md
  - file: docs/documentation/profile-repository.md
  - file: docs/documentation/skills.md
  - file: docs/documentation/state.md
  - file: docs/documentation/support-matrix.md
  - file: docs/documentation/best-practices.md
  - file: docs/documentation/actions.md
  - file: docs/documentation/switching-to-outfitter.md
  - file: docs/documentation/first-time-cli-agent-users.md
  - file: docs/documentation/iterating-on-profiles.md
---

# Outfitter

Use this skill to answer questions about Outfitter and to guide changes to
Outfitter-managed profiles, settings, and launches. Classify the request, read
only the relevant reference, and follow its cross-references before answering
or editing configuration.

## Routing

- New to Outfitter, installing, or first launch: read
  `references/getting-started.md`.
- How a launch works — settings, profile resolution, layering, composite
  profiles: read `references/concepts.md`.
- Command flags and syntax for `outfitter run`, `setup`, `sync`, or
  `profile ...`: read `references/cli.md`.
- Writing or editing profiles, profile layouts, inheritance, prompt includes:
  read `references/profiles.md`.
- Shared profile catalogs, setup sources, publishing profiles or skills for
  other users: read `references/profile-repository.md`.
- Authoring or selecting skills, SKILL.md layout, skill references: read
  `references/skills.md`.
- What persists between runs, state persistence strategies, prompt choices:
  read `references/state.md`.
- What Outfitter can control per agent CLI (pi, Claude Code): read
  `references/support-matrix.md`.
- Structuring profiles versus skills, keeping instructions in one place: read
  `references/best-practices.md`.
- Running profiles headlessly in GitHub Actions: read `references/actions.md`.
- Migrating from another agent CLI setup: read
  `references/switching-to-outfitter.md`.
- Never used a CLI coding agent before: read
  `references/first-time-cli-agent-users.md`.
- Improving the currently active profile, including this launch's own
  configuration: read `references/iterating-on-profiles.md`.

`references/README.md` is the documentation index if no entry above fits.

## Working on Outfitter configuration

1. Inspect the current configuration before editing:
   - `.outfitter/settings.yml` and `.outfitter/local/settings.yml`
   - `.outfitter/profiles/` and `.outfitter/skills/`
   - `~/.outfitter/settings.yml` and `~/.outfitter/profiles/`
2. Prefer Outfitter commands over manual file edits:
   - `outfitter profile list` to inspect available profiles
   - `outfitter profile create <id> --scope user|project|project-local` to
     scaffold profiles
   - `outfitter profile lint` to validate profiles and skill references
   - `outfitter setup <source>` to import setup sources
   - `outfitter sync` to refresh remote profile sources
   - `outfitter run --profile <id>` to verify launch behavior
3. Keep each instruction in one place: durable operating context belongs in
   the profile, per-capability procedure belongs in a skill
   (`references/best-practices.md`).
4. Validate changes with `outfitter profile lint` and, when possible, a smoke
   test such as `outfitter run --profile <id> -- --help`.

## Default behavior

If the user asks for help with Outfitter without a specific request:

1. Run `outfitter profile list` to show available profiles.
2. Summarize the profiles by name, scope or source, and default status.
3. Ask whether the user wants to create or change a profile, and read
   `references/profiles.md` before scaffolding one.
