# Subagents

A subagent is a protocol [agent](./agents.md) projected into the harness's native delegation mechanism, so the main run can hand focused work to a separate context. Subagents answer a different question than [personas](./personas.md): a persona is who the run _is_; a subagent is who the run can _call_.

Two stable patterns cover most setups:

- **One focused agent** — a single persona doing the work directly. Prefer this default; delegation adds latency and context loss.
- **One agent managing subagents** — a coordinating persona that delegates exploration, review, or parallelizable work to selected subagents.

## Selecting subagents

```yaml
# .agents/settings.yml
profiles:
  engineer:
    personas: [engineer]
    subagents: [code-reviewer, explorer]
```

Each slug resolves to an `agents/<id>/` definition across layers like any other resource. At launch the adapter projects the selected definitions into the harness's subagent surface:

- **Claude Code** — materialized into the harness's agents directory so they are invocable as native subagents.
- **Pi** — registered through Pi's subagent extension mechanism.

See the [adapter support matrix](./support-matrix.md) for current coverage.

## Subagent or persona?

| You want                                            | Use                                      |
| --------------------------------------------------- | ---------------------------------------- |
| The run to embody a role for its whole duration     | A persona                                |
| The run to hand a bounded job to a separate context | A subagent                               |
| A repeatable, bakeable unit of work                 | A [task](./tasks.md) selecting a persona |

The same definition can appear in both lists of different profiles. Write agent definitions role-first (what the identity is, when to invoke it) so they stay useful in either position.

## Authoring guidance

- Give each subagent a crisp `description` — the coordinating agent uses it to decide when to delegate.
- Keep subagents bounded: one job, clear inputs, a defined deliverable back to the caller.
- Don't duplicate skill procedures into subagent definitions; a subagent can select and use [skills](./skills.md) like any run.
