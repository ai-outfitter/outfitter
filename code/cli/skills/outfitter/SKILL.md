---
name: outfitter
description: Help users create, inspect, and maintain Outfitter profiles, settings, setup sources, and Pi launch loadouts. Use when a user invokes /outfitter or asks for help setting up Outfitter-managed profiles, profile.yml files, profile sources, default profiles, skills, extensions, prompts, or setup repositories.
---

# Outfitter

Use this skill to guide profile setup for Outfitter-managed Pi sessions.

## Default behavior

If the user invokes `/outfitter` without a specific request:

1. Run `outfitter profile list` to show available profiles.
2. Summarize the profiles by name, scope/source when visible, and default status when visible.
3. Ask whether the user wants to create a new profile.
4. If they do, ask for the intended profile ID and scope before running `outfitter profile create`.

## Workflow

1. Inspect the current directory and home configuration before editing:
   - `.outfitter/settings.yml`
   - `.outfitter/local/settings.yml`
   - `.outfitter/profiles/*/profile.yml`
   - `~/.outfitter/settings.yml`
2. Identify the intended scope:
   - user profile: reusable across projects
   - project profile: checked into the repository
   - project-local profile: private machine-specific overrides
3. Prefer existing commands before manual file edits:
   - `outfitter setup <source>` to import setup sources
   - `outfitter sync` to refresh remote profile sources
   - `outfitter profile list` to inspect available profiles
   - `outfitter profile create <id> --scope user|project|project-local` to scaffold profiles
   - `outfitter run --profile <id>` to verify launch behavior
4. Keep profile changes focused:
   - put reusable resources under `skills/`, `prompts/`, `extensions/`, or `deepwork/jobs/`
   - put Pi-only resources under `cli_specific/pi/`
   - put Claude-only resources under `cli_specific/claude/`
5. Validate profile YAML against the current schema and run a smoke test with `outfitter run --profile <id> -- --help` when possible.

## Profile skeleton

```yaml
id: engineer
label: Engineer

controls:
  provider: openai-codex
  model: gpt-5.5
  thinking: xhigh
  append_system_prompt:
    - ./prompts/engineering.md
  skills:
    - ./skills/review
  pi:
    extensions:
      - git:github.com/ai-outfitter/ulta-tasklist
      - git:github.com/ai-outfitter/deepwork
    skills:
      - ./cli_specific/pi/skills/outfitter
```

## Notes

- Use profile IDs matching lowercase letters, digits, `.`, `_`, and `-`.
- Use `template: true` only for inheritance-only profiles.
- Do not store provider secrets in profile files; use Pi login, environment variables, or the user's private agent state.
