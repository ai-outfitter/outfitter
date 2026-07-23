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

## The four delegation boundaries

Delegation is one concept — an agent hands a unit of work to another agent identity — with four boundaries it can cross. The composition being delegated to is ordinary `.agents` resources in every case; what changes is where the delegate runs and how it reports back.

| Boundary           | Mechanism                                                                                                                                                                                                                     | Reports back via                                                                           | Use when                                                                            |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------- |
| **In-run**         | Harness-native subagents (Claude Code's agents directory, Pi's subagent extension), declared in the leader's `subagents` loadout                                                                                              | Inline, same session                                                                       | Exploration, review, parallelizable work needing a fresh context now                |
| **CI-backed**      | A [GitHub Actions run](./actions.md): dispatch a workflow that does the work, or **assignment-as-trigger** — assign the issue/PR to a machine account whose events start the workflow (runs on hosted or self-hosted runners) | A comment or PR from the run; optionally a session-transcript artifact (adapter-dependent) | Work that should run asynchronously with its own token scope and an auditable trail |
| **Cluster-backed** | A Kubernetes subagent Job in the delegating agent's namespace, sharing its service account and quota ([in-cluster agents](./in-cluster.md))                                                                                   | The tracking issue/PR, or the delegating agent's next tick                                 | Cluster-local work; one bounded Job per delegated unit or per incoming event        |
| **Peer agent**     | Notify or assign a _persistent_ resident agent — its notifications channel is the intake                                                                                                                                      | Wherever the peer works: the issue, the PR, the thread                                     | Standing responsibilities owned by an always-on identity rather than one-off runs   |

A leader's loadout declares in-run delegates as `subagents`; the other three boundaries are reached through the tools the leader already has (dispatching a workflow, assigning an issue, filing work where a peer listens). Keep each delegate bounded — one job, clear inputs, a defined deliverable back to the caller.

## Delegation patterns

Two patterns recur on top of the boundaries; each deserves its own use-case treatment as the ecosystem matures:

- **Adversarial review.** Delegate critique to a _differently composed_ identity than the author — a different model, persona, or loadout, often a machine account, so the review carries no author bias and a visibly separate identity. The [personas convention](./personas.md) supplies the reviewer shape; the CI-backed boundary supplies the separate identity and audit trail.
- **Singleton coordinator.** Invert the fan-out: you always talk to **one** persistent agent (a machine account listening to its GitHub notifications), which keeps a bounded, prioritized queue and always chooses what to work on next. Everything else — CI runs, cluster Jobs, in-run subagents — is _its_ delegation target. The human interface stays one conversation; concurrency lives below it. "Assign the PR to the agent" becomes the entire UX.

## When to give an agent subagents

- **One focused agent** — a single agent doing the work directly. Prefer this default; delegation adds latency and context loss.
- **One leader managing subagents** — a coordinating agent that delegates exploration, review, or parallelizable work.

## Authoring guidance

- Give each subagent a crisp `description` — the leader uses it to decide when to delegate.
- Keep subagents bounded: one job, clear inputs, a defined deliverable.
- Don't duplicate skill procedures into subagent definitions; a subagent can select and use [skills](./skills.md) through its own loadout like any agent.
