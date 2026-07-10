# Best practices

Outfitter works best with a few stable profiles and many focused skills.
Profiles define who the agent is and the boundaries it operates within. Skills
define what the agent can progressively learn to do.

## Prefer a few profiles and many skills

Create a profile for a durable identity or policy boundary — engineering,
platform operations, support, a customer persona. A profile owns model and
provider controls, operating policy and safety boundaries, tools and
permissions, conventions, and the short rules for selecting skills.

Add a skill when the new behavior is a capability within an existing identity:
issue planning, code review, deployment smoke testing, KPI reporting, release
preparation. Adding a new situation SHOULD usually add a skill and a concise
activation rule, not another profile. Reserve profile inheritance for genuine
control and policy composition; do not require consumers to inherit a profile
merely to access one of its skills.

Prefer one profile with many skills:

```text
platform profile
├── issue-planning skill
├── issue-implementation skill
├── kpi-reporting skill
├── deployment-review skill
└── failed-deployment-triage skill
```

Avoid separate `issue-planner`, `deployment-reviewer`, and `kpi-reporter`
profiles when they share the same platform identity, permissions, and tools.
Adding release notes later should add a `release-notes` skill to the platform
profile, not a `release-notes-agent` profile with copies of the same controls.

Separate profiles are appropriate when the policy boundary differs. An
engineering agent may edit code, run tests, and push branches; a customer
support agent may read customer conversations and draft replies but must not
modify repositories. Those are different identities with different data access,
tools, and write permissions, so separate `engineering` and `support` profiles
are appropriate — and each can still expose many focused skills.

## Keep skills focused

Give each skill one recognizable capability and a description precise enough
for an agent to decide when it applies. Keep common policy in the profile
rather than repeating it across every skill.

## Use references for human documentation

Keep canonical architecture, policy, and operating documents in normal `docs/`
locations where people already maintain and review them. Declare those files as
skill `references` instead of copying them into skill directories, and read
them only after the skill activates so every run does not pay the context cost
of every possible workflow. See
[External references](./skills.md#external-references) for the reference format
and trust rules.

## Keep routing concise

A profile's system prompt can map stable runtime signals to relevant skills.
Keep these activation rules short; detailed procedures belong in the selected
skills and their references, never repeated in the profile prompt (see
[Where context and instructions live](./skills.md#where-context-and-instructions-live)).

```text
Select only the skill relevant to the current task.
- Planning request: use issue-planning.
- Approved implementation request: use issue-implementation.
- Recurring repository activity report: use kpi-reporting.
- Successful environment awaiting verification: use deployment-review.
- Failed environment update: use failed-deployment-triage.
Load detailed task content only after selecting the skill.
```

When an integration launches the profile, pass only the trusted identifiers and
runtime metadata needed to choose a skill. Keep untrusted source material out
of the activation rules and let the selected skill retrieve only what it needs
with trusted tools.

## Keep automation reusable

For agentic automation, prefer a small number of reusable workflows that pass
concise runtime metadata to the same stable execution profile. Let that profile
activate the appropriate skill. One profile and one workflow can then support
issue planning, implementation, scheduled reporting, deployment review, and
future situations; adding a capability becomes a skill change instead of
another near-duplicate profile and automation job.

## Review the trust chain

Profiles and skills can influence agent behavior and tool use. Follow
[Trust and review](./profile-repository.md#trust-and-review) for catalog
sources, keep secrets out of profiles, skills, references, and prompts, and run
`outfitter profile lint --strict` in CI to catch broken skill IDs and
references before they reach an agent run.
