# Personas

A persona is **who the agent is** for a run: its primary identity, policy, and behavioral posture. Personas answer a different question than [profiles](./profiles.md) (what was selected) and [subagents](./subagents.md) (who the run can delegate to).

"Persona" is Outfitter terminology for a role, not a file type. A persona is a protocol [agent](./agents.md) — `agents/<id>/agent.md` plus optional `config.json` — selected into a profile's or task's `personas` list. There is no `persona.yml` and no separate personas directory; anything that can be an agent can be a persona.

## Selecting personas

```yaml
# .agents/settings.yml
profiles:
  reviewer:
    personas: [engineer, staff-reviewer]
```

At run time the resolver locates each slug across layers, then composes the definitions **in the declared order**: the tree's `system-prompt.md` forms the base, `agents.md` contributes shared operating context, and each persona's `agent.md` layers on top, later entries over earlier ones. Composition is deterministic — the same selection over the same sources always produces the same identity.

## Ordered composition

Order expresses refinement. A common pattern is a broad base persona followed by a narrowing one:

```yaml
personas: [engineer, staff-reviewer]
```

`engineer` establishes general engineering posture; `staff-reviewer` sharpens it into a reviewing stance. Because later personas win where guidance conflicts, put the most specific persona last.

Keep personas few and stable. A persona owns durable identity and policy; procedures belong in [skills](./skills.md), and per-run objectives belong in [tasks](./tasks.md). If you find yourself writing a persona per trigger or per workflow, you probably want a task selecting an existing persona instead.

## Personas vs. subagents

The same agent definition can serve as either:

- As a **persona**, the agent *is* the run — its definition becomes part of the system prompt.
- As a **subagent**, the agent is a delegate — projected into the harness's subagent mechanism and invoked with its own context. See [Subagents](./subagents.md).

A `code-reviewer` agent might be a subagent in an engineer's interactive profile (delegate reviews mid-session) and the sole persona of a `review-pr` task (the whole run is a review).

## Example: customer personas

Personas are not limited to engineering roles. A product team can maintain `agents/pragmatic-cto/` and `agents/skeptical-buyer/` and run feedback sessions as those identities — see [Persona reviews](./usecases/persona-reviews.md).
