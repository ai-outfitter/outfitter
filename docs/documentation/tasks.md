# Tasks

A task is a named, portable execution contract at `tasks/<id>/task.md`: the stable objective of a repeatable unit of work, the resources it composes, its input and output contract, and what "done" means. Tasks are the unit Outfitter [bakes](./dump-and-bake.md) and the unit thin environment adapters — [GitHub Actions](./actions.md) first — invoke.

Tasks stay lightweight. A task **selects** reusable [personas](./personas.md), [skills](./skills.md), and optional DeepWork jobs by slug rather than copying their content. Skills and jobs own detailed procedures; the task owns the objective, invocation contract, and completion expectations.

## task.md

```markdown
---
name: issue-triage
description: Triage a newly opened GitHub issue.
personas: [triage-agent]
skills: [issue-triage]
inputs:
  issue_number:
    type: integer
    required: true
  repository:
    type: string
    required: true
---

# Issue triage

Triage issue {{issue_number}} in {{repository}}.

## Objective

Classify the issue, apply the appropriate labels, and post one triage comment.

## Completion

- The issue carries exactly one `type/*` and one `priority/*` label.
- One comment summarizes the classification and next step.
- Do not close, edit, or assign the issue.
```

- **Selection** (`personas`, `skills`, and optionally `subagents`, `knowledge`, `jobs`) — the same fields as a [profile](./profiles.md), resolved by the same resolver. A task is effectively a profile plus an objective and contract.
- **`inputs`** — the structured invocation contract. Callers pass values (`--input issue_number=421` locally, structured `with:` inputs in CI); bake fails fast on missing or mistyped inputs instead of failing mid-run.
- **Body** — the stable objective and completion contract. Keep procedures out: if the body is describing *how*, that content belongs in a selected skill or DeepWork job.

## Running tasks

```bash
outfitter run --task issue-triage --input issue_number=421 --input repository=acme/api
```

`--task` always goes through the bake path: the task and its transitive dependencies are resolved into an immutable artifact before the harness launches, so a run in CI and a run on your laptop compose identically given the same sources, refs, and inputs.

## DeepWork jobs

A task that needs a reusable multi-step procedure selects a DeepWork job rather than encoding steps in its body:

```yaml
jobs: [weekly-report]
```

Jobs are referenced resources, not a replacement task format — one reusable job per multi-step procedure, selected by any task that needs it.

## Design guidance

- One task per stable objective; different triggers that share an objective should share a task.
- Prefer selecting an existing persona over authoring a task-specific one.
- Make completion criteria observable side effects (labels applied, comment posted, file pushed) — in headless runs nobody reads stdout.
- Keep inputs to identifiers and discriminators; never pass untrusted content (issue bodies, diffs) as inputs — let a selected skill fetch what it needs with trusted tools.
