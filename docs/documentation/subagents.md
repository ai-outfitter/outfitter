# Subagents

A subagent is a protocol [agent](./agents.md) projected into the harness's native delegation mechanism, so a run can hand focused work to a separate context. You declare subagents in an agent's loadout — the `subagents` field of its `agent.md` frontmatter or `config.json` — not in any settings map.

```markdown
---
name: engineer
subagents: [code-reviewer, explorer]
---
```

Each slug resolves to an `agents/<id>/` definition across layers like any other resource. At launch the adapter projects the selected definitions into the harness's subagent surface:

- **Claude Code** — materialized into the harness's agents directory so they are invocable as native subagents.
- **Pi** — registered through Pi's subagent extension mechanism.

See the [adapter support matrix](./support-matrix.md) for current coverage.

## Leader agents and delegation targets

The reason to give an agent subagents is to make it a **leader**: an agent that coordinates work and delegates the bounded pieces. A leader can delegate two ways, and the two compose:

- **To local coding-harness subagents** — agents projected into the running harness (Claude Code's agents directory, Pi's subagent extension). The leader hands off exploration, review, or parallelizable work to a fresh context on the same machine and gets the result back inline.
- **To issue- and action-backed subagents** — work dispatched asynchronously, backed by a GitHub issue and an [Outfitter action](./actions.md). The leader files the unit of work as an issue; an action runs the delegate agent headlessly and reports back on the issue or PR. This is how a leader parallelizes across machines and across time rather than within one session.

A leader's loadout is where both are declared: local delegates as `subagents`, remote work routed through the action it triggers. Keep each delegate bounded — one job, clear inputs, a defined deliverable back to the caller.

## When to give an agent subagents

- **One focused agent** — a single agent doing the work directly. Prefer this default; delegation adds latency and context loss.
- **One leader managing subagents** — a coordinating agent that delegates exploration, review, or parallelizable work.

## Authoring guidance

- Give each subagent a crisp `description` — the leader uses it to decide when to delegate.
- Keep subagents bounded: one job, clear inputs, a defined deliverable.
- Don't duplicate skill procedures into subagent definitions; a subagent can select and use [skills](./skills.md) through its own loadout like any agent.
