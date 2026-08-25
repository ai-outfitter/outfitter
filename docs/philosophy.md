# Outfitter Philosophy

Make, share, and switch the agent profiles your coding agents use — manually or programmatically. A profile is just an agent and the loadout it composes; there is no separate profile format.

## Trust through evidence

An agent is trusted the same way a new teammate is: small scopes, reviewed work, and a paper trail. Outfitter treats all three as configuration. A profile bounds what an agent can do per environment — the planning agent that has write tools at your desk has none in the cluster. Adversarial review is a workflow step rather than a virtue, and workflows are built so that every transition writes to the record.

## Own your session data

The session record — what was asked, what the agent did, what it touched, what the review found — serves you as much as it serves the auditor. It answers "what happened and was it allowed" for an audit, and the same records are the inputs to evals, policy tuning, and eventually training. Organizations that let session data evaporate at the end of each run discard the asset that makes the whole system improvable. Store clean records first and decide on dashboards later — dashboards can always be built over clean records; records cannot be reconstructed from dashboards.

## Expeditious agents

An agent is defined by its agency: its ability to make good decisions on the way to completing a task. Outfitter exists to make agents _expeditious_ — not just effective, but fast.

The two are linked. An agent loaded with every tool, prompt, and extension you have ever collected spends its context window carrying baggage instead of thinking. A tight profile — only the context, tools, and instructions relevant to the job at hand — preserves context headroom. That headroom translates directly into better decisions, shorter paths to completion, and faster sessions. High signal in, clear signal out.

Tight profiles also make delegation practical. When a role is small and well defined, it can be handed to a subagent and run in parallel with others. Focused profiles are what turn one overloaded agent into a coordinated set of fast ones.

## Composition over accumulation

The common failure mode is a single, ever-growing agent setup: one configuration that accretes every tool and instruction anyone has ever needed, serving no task particularly well. Outfitter takes the opposite approach. Agent profiles are small, purpose-built, and composable — you stack a personal baseline, a team convention, and a project-specific role, and switch between agents as the work changes. Each stays sharp because it never has to be everything at once.

## Individual, team, enterprise

The same mechanism scales up a stair-step:

- **Individuals** make profiles for their own recurring modes of work and switch between them per task or per project.
- **Teams** share profiles through catalog repositories, so a new teammate starts with proven, organization-approved roles instead of assembling a setup from scratch.
- **Enterprises** publish and pin curated catalogs, keeping agent configuration reviewable, versioned, and consistent across the organization.

At every level the goal is the same: the right profile, at the right moment, with nothing extra along for the ride.

## The ramp to an autonomous lifecycle

Outfitter's destination is a fully autonomous software development lifecycle: humans define goals and acceptance gates, agents own the middle. Nobody jumps there in one step. Adoption is a ramp with five rungs, and each Outfitter component targets a rung, so a user or an organization climbs without discarding the previous rung. This section is the canonical definition; the org README and Link's scanner plus reviewed-evidence workflow compress or extend it. The `sdlc-report` skill is an optional semantic reviewer.

1. **Assisted** — autocomplete and chat; a human's hands stay on the keyboard.
2. **Delegated** — a local agent does the task; the human defines the idea and reviews the PR.
3. **Automated** — a workflow runs without a laptop: an issue, a message, or a schedule triggers agents in CI or a cluster, and adversarial review is part of the pipeline.
4. **Governed** — the organization shares one pinned catalog of agents, skills, and policy; every agent action lands in an auditable record; resident agents work as onboarded teammates.
5. **Self-improving** — the audit record feeds evals and model improvement; humans set goals and acceptance gates, agents own the middle.

Two rules keep the climb honest. Never automate a workflow you have not first done manually — run it as an agent-assisted skill until you understand it, then promote it. And expand scope by moving the human locus of control outward one layer at a time: first the implementation, then the review, then the idea, until what remains human is the goal and the gate.
