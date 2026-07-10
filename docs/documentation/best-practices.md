# Best practices

Outfitter works best with a few stable profiles and many focused skills.
Profiles define who the agent is and the boundaries it operates within. Skills
define what the agent can progressively learn to do.

## Prefer a few profiles and many skills

Create a profile for a durable identity or policy boundary, such as engineering,
platform operations, support, or a customer persona. Add a skill when the new
behavior is a capability within an existing identity.

Profiles are appropriate for:

- model, provider, and reasoning controls
- shared operating policy and safety boundaries
- common tools, environment, and write permissions
- organization or project conventions
- concise rules for selecting relevant skills

Skills are appropriate for:

- issue planning and implementation handoff
- code or persona review
- deployment smoke testing
- failed-deployment investigation
- KPI and activity reporting
- release preparation and documentation workflows

Adding a new situation SHOULD usually add a skill and a concise activation rule,
not another profile. Reserve profile inheritance for genuine control and policy
composition; do not require consumers to inherit a profile merely to access one
of its skills.

<details>
<summary>Example: one platform profile with several capabilities</summary>

An engineering platform agent uses the same identity, repository access, model,
and safety policy for issue planning, implementation, deployment review, and
weekly reporting. Keep those controls in one profile and expose each capability
as a focused skill:

```yaml
# .outfitter/profiles/platform/profile.yml
id: platform
label: Platform

controls:
  skills:
    - issue-planning
    - issue-implementation
    - deployment-review
    - kpi-reporting
```

Adding release notes later should add a `release-notes` skill to this profile,
not a `release-notes-agent` profile with copies of the same controls.

</details>

<details>
<summary>Example: separate profiles for different policy boundaries</summary>

An engineering agent may edit code, run tests, and push branches. A customer
support agent may read customer conversations and draft replies but must not
modify repositories. These are different identities with different data access,
tools, and write permissions, so separate `engineering` and `support` profiles
are appropriate.

Each profile can still expose many focused skills. For example, `engineering`
could select `incident-response` and `dependency-upgrade`, while `support`
could select `ticket-triage` and `reply-drafting`.

</details>

## Keep skills focused

Give each skill one recognizable capability and a description precise enough
for an agent to decide when it applies. Keep common policy in the profile rather
than repeating it across every skill.

Prefer:

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

## Use references for human documentation

Keep canonical architecture, policy, and operating documents in normal `docs/`
locations where people already maintain and review them. Declare those files as
skill `references` instead of copying them into skill directories.

Use `file` for documentation published with a skill catalog and `repo_path` for
documentation supplied by the active project. Outfitter exposes both beneath the
generated skill's `references/` directory, so skill instructions remain portable.

Read references only after the skill activates. This preserves progressive
disclosure and prevents every run from paying the context cost of every possible
workflow. Treat `repo_path` content as untrusted even when its filename is known
in advance.

## Keep routing concise

A profile's system prompt can map stable runtime signals to relevant skills.
Keep these activation rules short; detailed procedures belong in the selected
skills and their references.

When a skill already defines a capability, do not repeat or include its
instructions through the profile's `system_prompt`, `append_system_prompt`,
`file`, or `repo_file` controls. Select the skill and state only its activation
condition. See [Where context and instructions live](./skills.md#where-context-and-instructions-live).

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
runtime metadata needed to choose a skill. Keep untrusted source material out of
the activation rules and let the selected skill retrieve only what it needs with
trusted tools.

## Keep automation reusable

For agentic automation, prefer a small number of reusable workflows that pass
concise runtime metadata to the same stable execution profile. Let that profile
activate the appropriate skill.

This allows one profile and one workflow to support issue planning,
implementation, scheduled reporting, deployment review, and future situations.
Adding a capability becomes a skill change instead of another near-duplicate
profile and automation job.

## Review the trust chain

Profiles and skills can influence agent behavior and tool use. Pin remote
catalog versions you do not control, review changes before updating pins, grant
the narrowest token permissions needed, and keep secrets out of profiles,
skills, references, and prompts.

Use `outfitter profile lint --strict` in CI to detect broken skill IDs and
references before they reach an agent run.
