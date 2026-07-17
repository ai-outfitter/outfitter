# Best practices

Outfitter works best with a few stable [agents](./agents.md) and many focused skills. An agent defines who it is, the boundaries it operates within, and — through its loadout — what it composes. Skills define what the agent can progressively learn to do.

The target shape for a project:

- zero authored profile files ([an agent and its loadout is the profile](./profiles.md));
- a small set of reusable agents;
- one [skill](./skills.md) per capability rather than one skill per trigger;
- one reusable DeepWork job per multi-step procedure where needed;
- the minimum GitHub workflow set required by trigger and permission boundaries;
- only the transitive resource closure required by the selected agent when [dumping](./dump-and-bake.md).

## Prefer a few agents and many skills

Create an agent for a durable identity or policy boundary — engineering, platform operations, support. An agent owns operating policy and safety boundaries, conventions, the short rules for selecting skills, and its loadout.

Add a skill when the new behavior is a capability within an existing identity: issue planning, code review, deployment smoke testing, KPI reporting, release preparation. Adding a new situation SHOULD usually add a skill and a concise activation rule, not another agent.

Prefer one agent with many skills:

```text
platform agent
├── issue-planning skill
├── issue-implementation skill
├── kpi-reporting skill
├── deployment-review skill
└── failed-deployment-triage skill
```

Avoid separate `issue-planner`, `deployment-reviewer`, and `kpi-reporter` agents when they share the same platform identity, permissions, and tools. Adding release notes later should add a `release-notes` skill, not a `release-notes-agent` with copies of the same policy.

Separate agents are appropriate when the policy boundary differs. An engineering agent may edit code, run tests, and push branches; a customer support agent may read customer conversations and draft replies but must not modify repositories. Those are different identities with different data access and write permissions — and each can still expose many focused skills.

## Keep skills focused

Give each skill one recognizable capability and a description precise enough for an agent to decide when it applies. Keep common policy in the agent definition rather than repeating it across every skill.

Focused does not mean tiny. Err on the side of one larger skill that [routes to different references](./skills.md#skills-as-routers) over many near-duplicate skills: split a skill only when its description can no longer say when it applies. Point references at existing human-maintained documentation rather than writing new agent-only copies, and use [loadout-added references](./skills.md#loadout-added-references) to specialize a shared skill instead of forking it.

## Use references for human documentation

Keep canonical architecture, policy, and operating documents in normal `docs/` locations where people already maintain and review them. Declare those files as skill `references` instead of copying them into skill directories, and read them only after the skill activates so every run does not pay the context cost of every possible workflow. See [External references](./skills.md#external-references) for the reference format and trust rules.

## Keep routing concise

An agent can map stable runtime signals to relevant skills. Keep these activation rules short; detailed procedures belong in the selected skills and their references, never repeated in the agent (see [Where context and instructions live](./skills.md#where-context-and-instructions-live)).

```text
Select only the skill relevant to the current task.
- Planning request: use issue-planning.
- Approved implementation request: use issue-implementation.
- Recurring repository activity report: use kpi-reporting.
- Successful environment awaiting verification: use deployment-review.
- Failed environment update: use failed-deployment-triage.
Load detailed content only after selecting the skill.
```

When an integration invokes an agent headlessly, pass only the trusted identifiers it expects. Keep untrusted source material out of inputs and let the selected skill retrieve only what it needs with trusted tools.

## Keep automation reusable

For agentic automation, prefer a small number of reusable workflows that run [agents with structured inputs](./actions.md). Consolidate compatible agents into as few workflows as practical; separate workflows are justified only by different triggers, permissions, credentials, or isolation boundaries. Adding a capability becomes a skill change instead of another near-duplicate workflow.

## Review the trust chain

Resources influence agent behavior and tool use. Follow [Trust and review](./catalogs.md#trust-and-review) for catalog sources, pin refs (full SHAs for CI), keep secrets out of agents, skills, references, and prompts, and run `outfitter validate --strict` in CI to catch broken slugs and references before they reach an agent run.
