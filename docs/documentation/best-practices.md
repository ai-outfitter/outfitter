# Best practices

Outfitter works best with a few stable personas and many focused skills. Personas define who the agent is and the boundaries it operates within. Skills define what the agent can progressively learn to do. Tasks bind them to repeatable objectives.

The target shape for a project:

- zero authored profile files (profiles are [selections](./profiles.md));
- a small set of reusable [personas](./personas.md);
- one [skill](./skills.md) per capability rather than one skill per task or trigger;
- one reusable DeepWork job per multi-step procedure where needed;
- lightweight [tasks](./tasks.md) that bind those resources;
- the minimum GitHub workflow set required by trigger and permission boundaries;
- only the transitive resource closure required by the selected tasks when [dumping](./dump-and-bake.md).

## Prefer a few personas and many skills

Create a persona for a durable identity or policy boundary — engineering, platform operations, support, a customer persona. A persona owns operating policy and safety boundaries, conventions, and the short rules for selecting skills.

Add a skill when the new behavior is a capability within an existing identity: issue planning, code review, deployment smoke testing, KPI reporting, release preparation. Adding a new situation SHOULD usually add a skill and a concise activation rule, not another persona.

Prefer one persona with many skills:

```text
platform persona
├── issue-planning skill
├── issue-implementation skill
├── kpi-reporting skill
├── deployment-review skill
└── failed-deployment-triage skill
```

Avoid separate `issue-planner`, `deployment-reviewer`, and `kpi-reporter` personas when they share the same platform identity, permissions, and tools. Adding release notes later should add a `release-notes` skill, not a `release-notes-agent` persona with copies of the same policy.

Separate personas are appropriate when the policy boundary differs. An engineering agent may edit code, run tests, and push branches; a customer support agent may read customer conversations and draft replies but must not modify repositories. Those are different identities with different data access and write permissions — and each can still expose many focused skills.

## Keep tasks thin

A task owns an objective, an input contract, and completion criteria — nothing else. If a task body is describing _how_, move that content into a selected skill or DeepWork job. Different triggers that share an objective should share one task; a new trigger is workflow wiring, not a new task.

## Keep skills focused

Give each skill one recognizable capability and a description precise enough for an agent to decide when it applies. Keep common policy in the persona rather than repeating it across every skill.

Focused does not mean tiny. Err on the side of one larger skill that [routes to different references](./skills.md#skills-as-routers) over many near-duplicate skills: split a skill only when its description can no longer say when it applies. Point references at existing human-maintained documentation rather than writing new agent-only copies, and use [selection-added references](./skills.md#selection-added-references) to specialize a shared skill instead of forking it.

## Use references for human documentation

Keep canonical architecture, policy, and operating documents in normal `docs/` locations where people already maintain and review them. Declare those files as skill `references` instead of copying them into skill directories, and read them only after the skill activates so every run does not pay the context cost of every possible workflow. See [External references](./skills.md#external-references) for the reference format and trust rules.

## Keep routing concise

A persona can map stable runtime signals to relevant skills. Keep these activation rules short; detailed procedures belong in the selected skills and their references, never repeated in the persona (see [Where context and instructions live](./skills.md#where-context-and-instructions-live)).

```text
Select only the skill relevant to the current task.
- Planning request: use issue-planning.
- Approved implementation request: use issue-implementation.
- Recurring repository activity report: use kpi-reporting.
- Successful environment awaiting verification: use deployment-review.
- Failed environment update: use failed-deployment-triage.
Load detailed task content only after selecting the skill.
```

When an integration invokes a task, pass only the trusted identifiers its input contract declares. Keep untrusted source material out of inputs and let the selected skill retrieve only what it needs with trusted tools.

## Keep automation reusable

For agentic automation, prefer a small number of reusable workflows that invoke [tasks with structured inputs](./actions.md). Consolidate compatible tasks into as few workflows as practical; separate workflows are justified only by different triggers, permissions, credentials, or isolation boundaries. Adding a capability becomes a skill or task change instead of another near-duplicate workflow.

## Review the trust chain

Resources influence agent behavior and tool use. Follow [Trust and review](./catalogs.md#trust-and-review) for catalog sources, pin refs (full SHAs for CI), keep secrets out of agents, skills, references, and prompts, and run `outfitter validate --strict` in CI to catch broken slugs and references before they reach an agent run.
