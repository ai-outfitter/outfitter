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

A profile's system prompt can map stable runtime metadata to relevant skills.
Keep this routing contract short; detailed procedures belong in the selected
skills and their references.

When a skill already defines a capability, do not repeat or include its
instructions through the profile's `system_prompt`, `append_system_prompt`,
`file`, or `repo_file` controls. Select the skill and state only its activation
condition. See [Where context and instructions live](./skills.md#where-context-and-instructions-live).

```text
Use trigger_context to select only the skill needed for this run.
- issues/opened with fix, feat, or idea labels: use issue-planning.
- issues/assigned to the platform account: use issue-implementation.
- schedule with report_kind weekly-kpi: use kpi-reporting.
- deployment_status success: use deployment-review.
- deployment_status failure: use failed-deployment-triage.
Fetch full event content only after selecting the skill.
```

Pass trusted identifiers and event metadata into the initial prompt. Do not
interpolate issue bodies, pull request bodies, comments, deployment logs, or
fetched page content before routing. Let the selected skill fetch only the
untrusted source material it needs with trusted tools.

## Keep automation reusable

For agentic automation, prefer a small number of reusable workflows that pass
structured trigger context to the same stable execution profile. Let that
profile activate the appropriate skill.

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
