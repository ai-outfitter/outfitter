# Switching to Outfitter

This guide is for people who already use Pi, Claude Code, Codex, Cursor, or another agent CLI and want Outfitter to make that setup repeatable. The goal is not to copy every local experiment into the tree. The goal is to capture the small set of habits that reliably jumpstart the human.

## Two adoption paths

**You already have a `.agents/` directory.** You're done with the hard part — Outfitter reads the protocol directly. Declare a [profile](./profiles.md) in `.agents/settings.yml` that selects your existing agents, skills, and knowledge by slug, and run `outfitter`. Nothing is converted or re-authored.

**Your setup lives in `~/.claude`.** Let `outfitter setup` port it into `~/.agents/` and symlink it back so Claude Code keeps working natively — see [Porting a Claude Code setup](./porting-claude.md). Your ported skills, agents, and commands are then referenceable by slug like any protocol resource.

Starting from neither? `outfitter setup` bootstraps from the default catalog — see [Getting started](./getting-started.md).

## Migration shape

1. Keep the current agent CLI installed and working.
2. Identify the behavior you rely on every week: prompts, planning rules, permission posture, skills, subagents, and state you want preserved.
3. Put stable personal defaults in your global layer — ideally a versioned standalone `.agents` repo ([Local development](./local-development.md)).
4. Add a project `.agents/` overlay only where a repository needs different instructions or tools.
5. Run `outfitter`, compare the session to your old workflow, and tighten the tree before adding more.

## What to migrate first

Migrate durable operating rules before migrating files:

- how much autonomy the agent gets;
- when it must plan before editing;
- how it should use subagents;
- what review or test evidence you expect;
- what writing voice or product judgment it should preserve;
- which skills are essential.

Leave transient chat tricks behind. If a rule is not worth committing to the tree, it probably belongs in the next prompt, not the baseline.

## Global layer template

Use this as a migration worksheet: one agent holding your durable posture and the skills you reach for.

```
<!-- ~/.agents/agents/workbench/agent.md -->
---
name: workbench
description: Personal agent-CLI habits migrated from my previous setup.
skills: [] # add only skills you expect to use repeatedly
---

# Workbench

You may inspect files, make focused edits, and run local validation commands.
Ask before deleting files, changing dependencies, pushing, publishing, touching
credentials, mutating production data, or making irreversible external changes.

Plan before broad rewrites. Use acceptance criteria that can be checked from
repo state. Prefer small commits and explain validation evidence before
calling work done.

Treat rough notes as source material, not final requirements: convert
ambiguous requests into a short plan, preserve interesting claims, remove filler.
```

```yaml
# ~/.agents/settings.yml
default_agent: workbench
default_harness: pi
```

## Project overlay template

Use a project overlay when a repository has instructions that should not leak into every session. The workspace layer merges over your global layer by ID; `agents.md` carries project context.

```
<!-- <repo>/.agents/agents.md -->

Use this repository's docs, tests, and issue tracker as the source of truth.
Record durable decisions in project files, not only in chat.
Run the narrowest relevant validation before broad checks.
```

A project overlay can add a skill to the workbench agent it inherits by ID, without redefining the whole agent:

```
<!-- <repo>/.agents/agents/workbench/agent.md -->
---
name: workbench # merges by ID over the global workbench agent
skills: [deployment-review] # resolves from <repo>/.agents/skills/
---
```

```yaml
# <repo>/.agents/settings.yml
default_agent: workbench
```

## Mapping old habits to Outfitter

| Existing habit                       | Outfitter shape                                                                                          |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------- |
| "Always plan before edits."          | Use the plan extension keybinding (`Shift+Tab` in the default Outfitter Pi setup) before implementation. |
| "Use YOLO except dangerous actions." | State allowed local actions and approval gates in your persona.                                          |
| "Run code review after changes."     | Select a review skill, then invoke it with a slash command such as `/skill:review`.                      |
| "Spawn a second agent for research." | Select an explorer [subagent](./subagents.md) and describe when the lead agent should delegate.          |
| "Use browser or GitHub helpers."     | Add the MCP server to `mcp.json` in the layer that needs it.                                             |
| "Keep project context durable."      | Commit it to the project's `.agents/agents.md`; keep personal defaults in your global layer.             |
| "Repeat the same CI/automation job." | Make it a [task](./tasks.md) with structured inputs.                                                     |

## Check the active capabilities

Because tools differ by CLI and composition, start migrated sessions with:

```text
List the active tools, skills, and subagents. Note which are vanilla harness
features, which come from the default catalog, and which are project-local.
Also read agents.md if this tree has one.
```

If a behavior is a project rule rather than a personal preference, put it in the project's `.agents/agents.md` so every agent session can inherit it.

## Migration checkpoint

Run:

```bash
outfitter
```

If the first session does not feel like a better version of your old setup, edit the persona before adding more files. The first win is reliable launch plus useful starting context; broader catalogs can come after that baseline holds.
