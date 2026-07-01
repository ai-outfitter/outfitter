# Switching to Outfitter

This guide is for people who already use Pi, Claude Code, Codex, Cursor, or another agent CLI and want Outfitter to make that setup repeatable. The goal is not to copy every local experiment into a profile. The goal is to capture the small set of habits that reliably jumpstart the human.

## Migration shape

1. Keep the current agent CLI installed and working.
2. Identify the behavior you rely on every week: prompts, planning rules, permission posture, skills, subagents, and state you want preserved.
3. Create one Outfitter home profile for stable personal defaults.
4. Add project overlays only where a repository needs different instructions or tools.
5. Run `outfitter`, compare the session to your old workflow, and tighten the profile before adding more controls.

## What to migrate first

Migrate durable operating rules before migrating files:

- how much autonomy the agent gets;
- when it must plan before editing;
- how it should use subagents;
- what review or test evidence you expect;
- what writing voice or product judgment it should preserve;
- which skills/extensions are essential.

Leave transient chat tricks behind. If a rule is not worth committing to a profile, it probably belongs in the next prompt, not the baseline.

## Home profile template

Use this as a commented migration worksheet. The comments are intentionally user-facing: they encode the human jumpstart idea and the writing nucleation seed that should make a fresh session feel like your best existing setup.

```yaml
# ~/.outfitter/settings.yml
# Human jumpstart: this default profile should make `outfitter` feel like
# your current best agent setup, but with fewer manual launch steps.
default_profile: migrated-agent-workbench
default_agent: pi
profile_sources:
  - path: ./profiles

---
# ~/.outfitter/profiles/migrated-agent-workbench/profile.yml
id: migrated-agent-workbench
label: Migrated Agent Workbench
# Name the workflow this replaces: "Claude Code defaults", "Codex review mode", etc.
description: Personal agent-CLI habits migrated into an Outfitter-managed Pi profile.

controls:
  # YOLO posture: grant routine local autonomy while keeping irreversible work gated.
  append_system_prompt: |
    You may inspect files, make focused edits, and run local validation commands.
    Ask before deleting files, changing dependencies, pushing, publishing, touching credentials,
    mutating production data, or making irreversible external changes.

    Plan before broad rewrites. Use acceptance criteria that can be checked from repo state.
    Prefer small commits and explain validation evidence before calling work done.

    Writing nucleation: treat rough notes as source material, not final requirements.
    Convert ambiguous requests into a short plan, preserve interesting claims, and remove filler.

  # Keep controls minimal during migration. Add model/thinking/tool settings only when
  # they represent a stable preference rather than a one-off experiment.
  thinking: high

  # Skills can come from Pi packages, the Outfitter default profile catalog, or project profiles.
  # Add only skills you expect to use repeatedly.
  skills: []

  # Subagents may be provided by the active Pi/Outfitter profile or project config.
  # Document how you want the lead agent to use them even before adding custom definitions.
```

## Project overlay template

Use a project overlay when a repository has instructions that should not leak into every session.

```yaml
# <repo>/.outfitter/settings.yml
# Project jumpstart: select the repo-specific profile when `outfitter` starts here.
default_profile: project-workbench
profile_sources:
  # Import the home profile this project inherits from.
  # Adjust the relative path to match the repo's depth under your home directory.
  - path: ../../.outfitter/profiles
    only:
      - migrated-agent-workbench
  - path: ./profiles

---
# <repo>/.outfitter/profiles/project-workbench/profile.yml
id: project-workbench
label: Project Workbench
inherits:
  - migrated-agent-workbench
controls:
  append_system_prompt: |
    Use this repository's docs, tests, and issue tracker as the source of truth.
    Record durable decisions in project files, not only in chat.
    Run the narrowest relevant validation before broad checks.
```

## Mapping old habits to Outfitter

| Existing habit                       | Outfitter/Pi shape                                                                                       |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------- |
| “Always plan before edits.”          | Use the plan extension keybinding (`Shift+Tab` in the default Outfitter Pi setup) before implementation. |
| “Use YOLO except dangerous actions.” | State allowed local actions and approval gates in the profile.                                           |
| “Run code review after changes.”     | Add or enable a review skill, then invoke it inside Pi with a slash command such as `/skill:review`.     |
| “Spawn a second agent for research.” | Add subagent guidance and use available subagent definitions when active.                                |
| “Use browser or GitHub helpers.”     | Load the Pi extension/tool package through the profile that needs it.                                    |
| “Keep project context durable.”      | Commit project instructions to `AGENTS.md`; keep personal defaults in the Outfitter home profile.        |
| “Keep a project-specific prompt.”    | Add a project overlay that inherits the home profile.                                                    |

## Check the active capabilities

Because tools differ by CLI and profile, start migrated sessions with:

```text
List the active tools, skills, extensions, and subagents. Note which are vanilla Pi, which come from Outfitter's default profile catalog, and which are project-local. Also read AGENTS.md if this repo has one.
```

If a capability only exists because a Pi extension is active, document that in the profile or project README. If a behavior is a project rule rather than a personal preference, put it in `AGENTS.md` so every agent session can inherit it.

## Migration checkpoint

Run:

```bash
outfitter
```

If the first session does not feel like a better version of your old setup, edit the prompt seed before adding more files. The first win is reliable launch plus useful starting context; broader profile catalogs can come after that baseline holds.
