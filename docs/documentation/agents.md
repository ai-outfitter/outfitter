# Agents

An agent is the protocol's identity resource: a directory under `agents/<id>/` containing an `agent.md` definition and an optional `config.json`.

```text
.agents/
  agents/
    engineer/
      agent.md
      config.json   # optional
    code-reviewer/
      agent.md
```

Agent definitions are plain protocol resources — nothing about them is Outfitter-specific. Outfitter's contribution is how they are *used*: the same agent definition can be composed as a [persona](./personas.md) (the run's primary identity) or projected as a [subagent](./subagents.md) (a delegate the run can invoke). The [profile](./profiles.md) or [task](./tasks.md) making the selection decides which role it plays.

## agent.md

`agent.md` describes the identity in markdown: who the agent is, its policy and posture, how it approaches work, and any activation guidance. Keep it focused on durable identity and behavior — procedures for individual capabilities belong in [skills](./skills.md), and per-run objectives belong in [tasks](./tasks.md).

```markdown
---
name: code-reviewer
description: Reviews diffs for correctness and simplification opportunities.
---

# Code Reviewer

You review changes with a bias toward small, verifiable findings...
```

## config.json

The optional `config.json` carries structured configuration for the agent — model and tool preferences, harness-specific options — following the protocol's schema for the pinned revision. JSON files merge across layers per the protocol's JSON merge behavior, so a workspace layer can adjust one field of a globally defined agent without copying the whole definition.

## Tree-level context

Two files at the tree root complement agent definitions:

- `agents.md` — shared operating context that applies to every run from this tree, regardless of the selected personas.
- `system-prompt.md` — the base system prompt personas layer on top of.

## Resolution

Agents resolve by slug across layers — workspace, global, then remote sources — with merge-by-ID semantics: a workspace `agents/engineer/` overrides a global or remote one. `outfitter list agents` shows every resolvable agent and its winning source; `outfitter validate` reports broken or shadowed definitions.
